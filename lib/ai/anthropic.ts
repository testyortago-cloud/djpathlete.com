import Anthropic from "@anthropic-ai/sdk"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateObject, streamText } from "ai"
import type { ZodSchema } from "zod"
import type { AgentCallResult } from "@/lib/ai/types"
import { AI_CHAT_MAX_TOKENS } from "@/lib/admin-ai-config"
import pRetry from "p-retry"

export { Anthropic }

export const MODEL_SONNET = "claude-sonnet-4-20250514"
export const MODEL_HAIKU = "claude-haiku-4-5-20251001"
const DEFAULT_MAX_TOKENS = 8192

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
    if (msg.includes("429") || msg.includes("529") || msg.includes("500") || msg.includes("502") || msg.includes("503")) {
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
  }
): Promise<AgentCallResult<T>> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS
  const modelId = options?.model ?? MODEL_SONNET

  const result = await pRetry(
    async () => {
      const res = await generateObject({
        model: provider(modelId),
        maxOutputTokens: maxTokens,
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
          `[callAgent] Attempt ${context.attemptNumber} failed (${context.retriesLeft} retries left): ${context.error.message}`
        )
      },
    }
  )

  const usage = result.usage
  const tokens_used = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)

  return {
    content: result.object as T,
    tokens_used,
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
