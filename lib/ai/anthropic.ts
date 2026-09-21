import Anthropic from "@anthropic-ai/sdk"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateObject, streamObject, streamText } from "ai"
import type { ZodSchema } from "zod"
import type { AgentCallResult } from "@/lib/ai/types"
// The default model for both entry points below. Imported as well as
// re-exported: `export { X } from "..."` creates no local binding.
import { MODEL_SONNET } from "@/lib/ai/models"
import { AI_CHAT_MAX_TOKENS } from "@/lib/admin-ai-config"
import pRetry from "p-retry"
import { toJSONSchema } from "zod"
import { isOpenRouterConfigured, shouldFallBackToAnthropic } from "@/lib/ai/openrouter"
import { callAgentViaOpenRouter } from "@/lib/ai/openrouter-agent"

export { Anthropic }

// ─── Model ids ───────────────────────────────────────────────────────────────
//
// MOVED, NOT REPOINTED. The four ids now live in `lib/ai/models.ts`, which
// imports NOTHING, and are re-exported here so every existing
// `from "@/lib/ai/anthropic"` import keeps working byte-identically. The values
// are unchanged: MODEL_OPUS / MODEL_SONNET / MODEL_HAIKU are what the 4-agent
// program-generation pipeline, the strategy agents and the bookkeeper are all
// tuned against, and repointing one would silently change behaviour for every
// AI feature in the app.
//
// The reason for the split is one-directional and is about what an IMPORTER
// pays: this module constructs an Anthropic provider at module scope (below),
// so reaching it for a single string constant drags the SDK — and that
// constructor — into the importing bundle. A config leaf, a validator or a
// client component that only needs an ID should import from `@/lib/ai/models`;
// anything that actually CALLS a model imports from here, as before.
export { MODEL_OPUS, MODEL_SONNET, MODEL_HAIKU, MODEL_OPUS_5 } from "@/lib/ai/models"

const DEFAULT_MAX_TOKENS = 32000

// ─── Singleton clients ───────────────────────────────────────────────────────

let _client: Anthropic | null = null

export function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  }
  return _client
}

const provider = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// ─── Transient error detection ───────────────────────────────────────────────

function isTransientError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status >= 500
  }
  // Vercel AI SDK wraps errors — check for status in the cause chain
  if (error instanceof Error) {
    const msg = error.message
    if (
      msg.includes("429") ||
      msg.includes("529") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503")
    ) {
      return true
    }
  }
  return false
}

/**
 * One image attached to a single model call (2026-09-14 spec §3).
 *
 * `data` is bare base64 — no `data:<type>;base64,` prefix. `{type:"image",
 * image, mediaType}` is the AI SDK v6 `ImagePart` shape (verified against
 * `node_modules/@ai-sdk/provider-utils/dist/index.d.ts:568`); the provider
 * converts it to Anthropic's `{type:"image", source:{type:"base64", ...}}`.
 */
export interface AgentImage {
  mediaType: string
  data: string
}

/**
 * The one message shape `promptOrMessages` ever sends: a single user turn
 * carrying the owner's text and (optionally) one or more images.
 */
type AgentUserMessage = {
  role: "user"
  content: Array<{ type: "text"; text: string } | { type: "image"; image: string; mediaType: string }>
}

/**
 * Builds the `prompt`-or-`messages` half of an AI SDK call.
 *
 * TWO COMPLETE OBJECTS, NOT A CONDITIONAL SPREAD. The SDK's `Prompt` type is a
 * union whose branches carry `messages?: never` / `prompt?: never`, so a
 * spread like `{...(images ? {messages} : {prompt})}` widens BOTH keys to
 * `X | undefined` and matches neither branch. The type error it produces points
 * at the call site rather than at the spread, which costs a confusing half-hour.
 *
 * A zero-length array is "no image": `if (images)` alone would be true for `[]`
 * and would silently switch every caller that defaults the option to a
 * one-text-part `messages` list, changing the request shape forever for no
 * reason.
 *
 * THE IMAGE RIDES HERE, IN THE USER MESSAGE, AND NOWHERE ELSE. The system
 * prompt is a cached prefix and Anthropic's cache is a strict prefix match —
 * anything per-turn in it is a silent cache invalidator on every turn of every
 * page.
 *
 * THE EXPLICIT RETURN TYPE ANNOTATION IS LOAD-BEARING, not decoration. Without
 * it, TS infers the return type from the two `return` statements, and once one
 * branch is `as const` (needed for the `{prompt}` branch, which has no array to
 * fight with) and the other isn't, narrowing a `const source = promptOrMessages(...)`
 * with `"messages" in source` at the call site stops excluding the `{prompt}`
 * branch cleanly — `source.messages` comes out typed `AgentUserMessage[] |
 * undefined` and the call below fails to typecheck with an error that blames
 * `messages: ... | undefined` and gives no hint that the fix is here.
 */
function promptOrMessages(
  userMessage: string,
  images?: readonly AgentImage[],
): { prompt: string } | { messages: AgentUserMessage[] } {
  if (!images || images.length === 0) return { prompt: userMessage }
  return {
    messages: [
      {
        role: "user",
        content: [
          // Text FIRST: it is the whole turn context, and the instruction to
          // read the attachment belongs in front of the attachment.
          { type: "text", text: userMessage },
          ...images.map((image) => ({
            type: "image" as const,
            image: image.data,
            mediaType: image.mediaType,
          })),
        ],
      },
    ],
  }
}

// ─── callAgent: structured output via generateObject ─────────────────────────

/**
 * Zod schema to the plain JSON Schema OpenRouter's tool definition expects.
 * Returns null when the schema is not an object type, which sends the call down
 * the text-JSON path instead of producing an invalid tool definition.
 */
function toToolSchema(schema: ZodSchema): Record<string, unknown> | null {
  try {
    const raw = toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>
    const { $schema: _s, "~standard": _std, ...rest } = raw
    return rest.type === "object" ? rest : null
  } catch {
    return null
  }
}

export async function callAgent<T>(
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  options?: {
    maxTokens?: number
    model?: string
    cacheSystemPrompt?: boolean
    images?: readonly AgentImage[]
  },
): Promise<AgentCallResult<T>> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS
  const modelId = options?.model ?? MODEL_SONNET

  // OpenRouter first, direct Anthropic as the fallback. Hoisted out of the
  // retry callback so that once a call has fallen back for a provider-level
  // reason, the remaining attempts do not each pay another failed round-trip.
  //
  // This path deliberately does NOT go through the AI SDK. `@ai-sdk/openai-compatible`
  // ships @ai-sdk/provider v4 while @ai-sdk/anthropic (which `ai@6` is pinned
  // against) ships v3, so its model object is not assignable to `LanguageModel`
  // — the two package version lines are not aligned across the ecosystem.
  // Using the raw OpenAI SDK sidesteps an `ai` v6 -> v7 upgrade that would
  // touch every AI feature in the app.
  let useOpenRouter = isOpenRouterConfigured()

  const result = await pRetry(
    async () => {
      if (useOpenRouter) {
        try {
          const or = await callAgentViaOpenRouter(
            modelId,
            systemPrompt,
            userMessage,
            schema,
            toToolSchema(schema),
            (d) => d,
            {
              maxTokens,
              cacheSystemPrompt: options?.cacheSystemPrompt,
              images: options?.images?.map((i) => ({ media_type: i.mediaType, data: i.data })),
            },
          )
          // Shaped like generateObject's result so the accounting below is
          // reached by exactly one path, not two.
          return {
            object: or.content,
            usage: { inputTokens: or.tokens_used, outputTokens: 0 },
            providerMetadata: {
              anthropic: {
                cacheCreationInputTokens: or.cache_creation_tokens,
                cacheReadInputTokens: or.cache_read_tokens,
              },
            },
          } as unknown as Awaited<ReturnType<typeof generateObject>>
        } catch (e) {
          if (!shouldFallBackToAnthropic(e)) throw e
          useOpenRouter = false
          console.warn(
            `[callAgent] OpenRouter unavailable (${e instanceof Error ? e.message.slice(0, 160) : e}) — ` +
              `falling back to direct Anthropic for the rest of this call (model: ${modelId})`,
          )
        }
      }

      // TWO COMPLETE CALLS, NOT A CONDITIONAL SPREAD. See `promptOrMessages`
      // above: the AI SDK's `Prompt` type is a union whose branches carry
      // `messages?: never` / `prompt?: never`, so spreading its result here
      // widens both keys to `X | undefined` and matches neither branch.
      const common = {
        model: provider(modelId),
        maxOutputTokens: maxTokens,
        // Force the tool-based JSON path. The default ("auto") uses Anthropic
        // structured outputs (output_format.schema) on supporting models, and
        // that endpoint REJECTS schemas carrying minLength/maxLength/minimum/
        // maximum/minItems/maxItems — which every Zod .min()/.max() in our
        // schemas compiles to ("For 'array' type, property 'maxItems' is not
        // supported"; broke strategist memos + nightly ad recommendations).
        // It also constrained-decodes z.record(...) fields (action args,
        // recommendation payloads) into EMPTY objects via forced
        // additionalProperties:false. jsonTool sends the schema as a tool
        // input_schema instead — same mechanism the functions/ runtime uses
        // in production — which accepts all constraints; Zod still validates
        // the response client-side.
        providerOptions: {
          anthropic: { structuredOutputMode: "jsonTool" as const },
        },
        system: options?.cacheSystemPrompt
          ? [
              {
                role: "system" as const,
                content: systemPrompt,
                providerOptions: {
                  anthropic: { cacheControl: { type: "ephemeral" as const } },
                },
              },
            ]
          : systemPrompt,
        schema,
      }
      const source = promptOrMessages(userMessage, options?.images)
      const res = await ("messages" in source
        ? generateObject({ ...common, messages: source.messages })
        : generateObject({ ...common, prompt: source.prompt }))
      return res
    },
    {
      retries: 2,
      shouldRetry: (error) => isTransientError(error),
      onFailedAttempt: (context) => {
        console.warn(
          `[callAgent] Attempt ${context.attemptNumber} failed (${context.retriesLeft} retries left): ${context.error.message}`,
        )
      },
    },
  )

  const usage = result.usage
  const tokens_used = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
  const anthropicMeta = (result.providerMetadata?.anthropic ?? {}) as {
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
  const cache_creation_tokens = anthropicMeta.cacheCreationInputTokens ?? 0
  const cache_read_tokens = anthropicMeta.cacheReadInputTokens ?? 0

  return {
    content: result.object as T,
    tokens_used,
    cache_creation_tokens,
    cache_read_tokens,
  }
}

// ─── streamChat: streaming text via streamText ───────────────────────────────

export function streamChat(opts: {
  system:
    | string
    | Array<{
        type: "text"
        text: string
        cache_control?: { type: "ephemeral" }
      }>
  messages: Array<{ role: "user" | "assistant"; content: string }>
  maxTokens?: number
  model?: string
}) {
  const modelId = opts.model ?? MODEL_SONNET
  const maxTokens = opts.maxTokens ?? AI_CHAT_MAX_TOKENS

  // Convert system blocks to Vercel AI SDK format
  if (typeof opts.system === "string") {
    return streamText({
      model: provider(modelId),
      maxOutputTokens: maxTokens,
      system: opts.system,
      messages: opts.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    })
  }

  const systemMessages = opts.system.map((block) => ({
    role: "system" as const,
    content: block.text,
    ...(block.cache_control
      ? {
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" as const } },
          },
        }
      : {}),
  }))

  return streamText({
    model: provider(modelId),
    maxOutputTokens: maxTokens,
    system: systemMessages,
    messages: opts.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  })
}

// ─── streamAgent: structured output via streamObject ─────────────────────────

/**
 * `callAgent`'s streaming twin: same schema, same provider options, same cache
 * handling — but the caller can read the object as it is written instead of
 * waiting for the whole thing.
 *
 * WHY IT EXISTS. A page build is a ~30s call whose only progress signal was a
 * spinner. `partialObjectStream` yields the response object filling in, which
 * is enough for a UI to show the page assembling out of the model's own output
 * rather than out of a timer.
 *
 * `structuredOutputMode: "jsonTool"` IS NOT OPTIONAL, for exactly the reasons
 * spelled out on `callAgent` above: the default ("auto") uses Anthropic
 * structured outputs, which reject every `minLength`/`maxItems` our Zod schemas
 * compile to and constrained-decode `z.record(...)` into empty objects. This is
 * one `providerOptions` line away from being the fourth feature to step in that
 * trap, so it is pinned here as well rather than inherited from anywhere.
 *
 * ---------------------------------------------------------------------------
 * IT DELIBERATELY DOES NOT RETRY, AND THAT IS NOT AN OVERSIGHT.
 * ---------------------------------------------------------------------------
 * `callAgent` wraps `generateObject` in `pRetry` because that call either
 * returns a whole object or throws, so a transient 429/5xx can be retried with
 * nobody the wiser. A stream cannot be retried transparently once a consumer
 * has read from it — by the time the ninth chunk 529s, the caller has already
 * rendered eight sections, and a silent second attempt would replay them.
 *
 * Retrying is therefore the CALLER's decision, because only the caller knows
 * what it has already shown. `app/api/admin/funnels/steps/[stepId]/build`
 * already owns a two-attempt loop and resets its progress display on attempt 2.
 * Do not "fix" this by adding `pRetry` here.
 *
 * Errors surface in two places and both must be handled: iterating
 * `partialObjectStream` can throw, and awaiting `.object` rejects on a refusal,
 * a truncated response or a schema violation. Attach a handler to `.object`
 * BEFORE the iteration if the iteration is awaited first, or Node reports an
 * unhandled rejection for a failure the caller does go on to catch.
 */
export function streamAgent<T>(
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  options?: {
    maxTokens?: number
    model?: string
    cacheSystemPrompt?: boolean
    images?: readonly AgentImage[]
  },
) {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS
  const modelId = options?.model ?? MODEL_SONNET

  // TWO COMPLETE CALLS, NOT A CONDITIONAL SPREAD — see `promptOrMessages` and
  // the matching comment in `callAgent` above.
  const common = {
    model: provider(modelId),
    maxOutputTokens: maxTokens,
    providerOptions: {
      anthropic: { structuredOutputMode: "jsonTool" as const },
    },
    system: options?.cacheSystemPrompt
      ? [
          {
            role: "system" as const,
            content: systemPrompt,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" as const } },
            },
          },
        ]
      : systemPrompt,
    schema,
  }
  const source = promptOrMessages(userMessage, options?.images)
  return "messages" in source
    ? streamObject({ ...common, messages: source.messages })
    : streamObject({ ...common, prompt: source.prompt })
}
