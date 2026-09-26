import { createAnthropic } from "@ai-sdk/anthropic"
import { generateObject, JSONParseError, NoObjectGeneratedError, streamObject, TypeValidationError } from "ai"
import { JSONRepairError } from "jsonrepair"
import type { ZodSchema } from "zod"
import type { AgentCallResult } from "@/lib/ai/types"
// The default model for both entry points below. Imported as well as
// re-exported: `export { X } from "..."` creates no local binding.
import { MODEL_SONNET } from "@/lib/ai/models"
import pRetry from "p-retry"
import {
  canFallBackToAnthropic,
  isOpenRouterConfigured,
  ProviderFallbackError,
  shouldFallBackToAnthropic,
} from "@/lib/ai/openrouter"
import { callAgentViaOpenRouter } from "@/lib/ai/openrouter-agent"
import {
  streamObjectViaOpenRouter,
  streamWithAnthropicFallback,
  toToolSchema,
  type AgentObjectStream,
} from "@/lib/ai/openrouter-object-stream"

// No `getClient()`, no `streamChat()` and no `export { Anthropic }` any more
// (removed 2026-09-26). None had a caller, and each was a ready-made way to
// wire a NEW direct-Anthropic call back in after the OpenRouter migration —
// on an account with no credit, that is a feature that fails for every user.

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

// ─── The direct-Anthropic fallback provider ──────────────────────────────────

const provider = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// ─── Transient error detection ───────────────────────────────────────────────

/**
 * Worth another attempt? A 429 or a 5xx is; anything else fails the same way
 * every time.
 *
 * THE NUMERIC STATUS IS READ FIRST, from any SDK. It used to be read only off
 * `Anthropic.APIError`, so an OpenRouter (OpenAI SDK) 429 — the primary
 * provider's commonest fault — was classified by whether its MESSAGE happened
 * to contain "429". `statusCode` is the AI SDK's spelling (`APICallError`).
 *
 * A `ProviderFallbackError` is classified by its OpenRouter half: an
 * OpenRouter 429 whose Anthropic fallback then 400'd ("credit balance too
 * low") is still a rate limit, and the next attempt goes to OpenRouter again.
 *
 * A VALIDATION FAILURE IS NEVER TRANSIENT HERE, and is ruled out before the
 * message is read. Until 2026-09-26 the retry never ran (see `shouldRetry`),
 * so nobody noticed that the message fallback matched SUBSTRINGS: a `.max(500)`
 * Zod failure says "<=500 characters" and a jsonrepair failure says "at
 * position 1502", so the same schema miss cost one paid call or three
 * depending on the digits in it. The AI SDK path never retried a schema miss
 * (its `NoObjectGeneratedError` carries no status), and this keeps that
 * contract for both providers. The functions/ runtime's `callAgent` DOES retry
 * Zod and JSON failures, deliberately and by class — a different decision for
 * long-running jobs, not one to copy into a request path by accident.
 *
 * The message fallback that remains matches a status-shaped TOKEN (429 or 5xx
 * standing alone), for wrapped provider faults that lost their numeric field.
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof ProviderFallbackError) return isTransientError(error.openRouterError)
  if (isValidationError(error)) return false
  const e = error as { status?: unknown; statusCode?: unknown } | null
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : undefined
  if (status !== undefined) return status === 429 || status >= 500
  return error instanceof Error && /(^|\D)(429|5\d\d)(\D|$)/.test(error.message)
}

/**
 * The model answered, and the answer was not the shape asked for: a Zod miss
 * (`callAgentViaOpenRouter`'s `schema.parse`), unparseable JSON (`JSON.parse`,
 * then jsonrepair), or the AI SDK's wrappers for the same two things.
 *
 * `ZodError` is matched by NAME, covering zod 4's classic "ZodError" and core
 * "$ZodError", because an `instanceof` against one zod copy is false for an
 * error thrown by another.
 */
function isValidationError(error: unknown): boolean {
  if (
    NoObjectGeneratedError.isInstance(error) ||
    TypeValidationError.isInstance(error) ||
    JSONParseError.isInstance(error)
  ) {
    return true
  }
  if (error instanceof SyntaxError || error instanceof JSONRepairError) return true
  const name = (error as { name?: unknown } | null)?.name
  return name === "ZodError" || name === "$ZodError"
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

  // OpenRouter first, direct Anthropic as the fallback — decided PER ATTEMPT.
  //
  // It used to be decided once per call: the first fallback-class OpenRouter
  // error flipped the whole call to Anthropic for every remaining attempt.
  // With the Anthropic account unfunded that turned one retryable OpenRouter
  // 429 into a certain failure that read "credit balance is too low" — the
  // retries (had they run; see `shouldRetry` below) would all have gone to the
  // provider that could not answer. Now each attempt tries OpenRouter, a
  // fallback serves THAT attempt only, and when both fail the attempt throws a
  // `ProviderFallbackError` whose status is OpenRouter's, so the next attempt
  // is OpenRouter again.
  //
  // This path deliberately does NOT go through the AI SDK. `@ai-sdk/openai-compatible`
  // ships @ai-sdk/provider v4 while @ai-sdk/anthropic (which `ai@6` is pinned
  // against) ships v3, so its model object is not assignable to `LanguageModel`
  // — the two package version lines are not aligned across the ecosystem.
  // Using the raw OpenAI SDK sidesteps an `ai` v6 -> v7 upgrade that would
  // touch every AI feature in the app.
  const useOpenRouter = isOpenRouterConfigured()

  const viaOpenRouter = async () => {
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
  }

  const viaAnthropic = async () => {
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
  }

  const result = await pRetry(
    async () => {
      if (!useOpenRouter) return viaAnthropic()
      try {
        return await viaOpenRouter()
      } catch (e) {
        // A non-Claude id (gpt-6-astra) has nowhere else to go: sent to
        // Anthropic it 404s, and that 404 would replace the OpenRouter fault
        // the owner needs to see.
        if (!shouldFallBackToAnthropic(e) || !canFallBackToAnthropic(modelId)) throw e
        console.warn(
          `[callAgent] OpenRouter unavailable (${e instanceof Error ? e.message.slice(0, 160) : e}) — ` +
            `falling back to direct Anthropic for this attempt (model: ${modelId})`,
        )
        try {
          return await viaAnthropic()
        } catch (anthropicError) {
          throw new ProviderFallbackError(e, anthropicError)
        }
      }
    },
    {
      retries: 2,
      // p-retry 7 hands `shouldRetry` a CONTEXT ({error, attemptNumber,
      // retriesLeft}), not the error. This was `(error) => isTransientError(error)`,
      // which asked about the context object, got false for every failure,
      // and so never retried anything — a single 429 ended the call.
      shouldRetry: ({ error }) => isTransientError(error),
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

// ─── streamAgent: structured output, streamed ────────────────────────────────

/**
 * `callAgent`'s streaming twin: same schema, same provider options, same cache
 * handling — but the caller can read the object as it is written instead of
 * waiting for the whole thing.
 *
 * WHY IT EXISTS. A page build is a ~30s call whose only progress signal was a
 * spinner. `fullStream` yields the response object filling in, which is enough
 * for a UI to show the page assembling out of the model's own output rather
 * than out of a timer.
 *
 * WHICH PROVIDER. OpenRouter when it is configured (`streamObjectViaOpenRouter`,
 * forced tool choice — the same request shape `callAgent` sends); the AI SDK's
 * `streamObject` against direct Anthropic when it is not, unchanged. Until
 * 2026-09-26 this was Anthropic-only, which left the page builder as the one
 * feature still failing with "credit balance is too low" after the migration.
 * Both return the same `{fullStream, object}` handle, so the build route does
 * not know which one answered.
 *
 * The Anthropic fallback applies only when OpenRouter fails BEFORE the first
 * part reaches the caller — see `streamWithAnthropicFallback` for why that is
 * the only safe moment to switch.
 *
 * `structuredOutputMode: "jsonTool"` IS NOT OPTIONAL on the Anthropic path,
 * for exactly the reasons spelled out on `callAgent` above: the default
 * ("auto") uses Anthropic structured outputs, which reject every
 * `minLength`/`maxItems` our Zod schemas compile to and constrained-decode
 * `z.record(...)` into empty objects. This is one `providerOptions` line away
 * from being the fourth feature to step in that trap, so it is pinned here as
 * well rather than inherited from anywhere.
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
 * Do not "fix" this by adding `pRetry` here. (The provider fallback above is
 * not a retry of what the caller saw: it happens only when the caller has seen
 * nothing.)
 *
 * Failures arrive as a `{type:"error"}` part followed by the end of the
 * iteration, and `.object` rejects — with the same error, or on a refusal, a
 * truncated response or a schema violation. Attach a handler to `.object`
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
): AgentObjectStream<T> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS
  const modelId = options?.model ?? MODEL_SONNET

  const viaAnthropic = (): AgentObjectStream<T> => {
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
    const result =
      "messages" in source
        ? streamObject({ ...common, messages: source.messages })
        : streamObject({ ...common, prompt: source.prompt })
    // A CAST, AND ONLY A TYPE-LEVEL ONE. Inside this generic function the SDK
    // cannot decide whether `T` is an enum, an array or an object output, so
    // its partial type stays a union (`string | Set<...> | DeepPartial<T>`).
    // For any concrete object schema — the only kind `streamAgent` takes, and
    // the only kind the OpenRouter branch can send as tool parameters — it
    // resolves to exactly `DeepPartial<T>`, and the runtime value is unchanged.
    return result as unknown as AgentObjectStream<T>
  }

  if (!isOpenRouterConfigured()) return viaAnthropic()

  return streamWithAnthropicFallback({
    modelId,
    primary: streamObjectViaOpenRouter({
      modelId,
      systemPrompt,
      userMessage,
      schema,
      maxTokens,
      cacheSystemPrompt: options?.cacheSystemPrompt,
      images: options?.images,
    }),
    fallback: viaAnthropic,
  })
}
