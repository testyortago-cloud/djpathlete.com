import Anthropic from "@anthropic-ai/sdk"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateObject, streamText } from "ai"
import type { ZodSchema } from "zod"
import type { AgentCallResult } from "@/lib/ai/types"
// The default model for both entry points below. Imported as well as
// re-exported: `export { X } from "..."` creates no local binding.
import { MODEL_SONNET } from "@/lib/ai/models"
import { AI_CHAT_MAX_TOKENS } from "@/lib/admin-ai-config"
import pRetry from "p-retry"

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

// ─── callAgent: structured output via generateObject ─────────────────────────

export async function callAgent<T>(
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  options?: {
    maxTokens?: number
    model?: string
    cacheSystemPrompt?: boolean
  },
): Promise<AgentCallResult<T>> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS
  const modelId = options?.model ?? MODEL_SONNET

  const result = await pRetry(
    async () => {
      const res = await generateObject({
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
          anthropic: { structuredOutputMode: "jsonTool" },
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
        prompt: userMessage,
        schema,
      })
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
