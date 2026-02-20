import Anthropic from "@anthropic-ai/sdk"
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages"
import type { ZodSchema } from "zod"
import type { AgentCallResult } from "@/lib/ai/types"
import { AI_CHAT_MAX_TOKENS } from "@/lib/admin-ai-config"

export const MODEL_SONNET = "claude-sonnet-4-20250514"
export const MODEL_HAIKU = "claude-haiku-4-5-20251001"
const DEFAULT_MAX_TOKENS = 8192

let _client: Anthropic | null = null

export function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  }
  return _client
}

/**
 * Extract JSON from a response that may be wrapped in markdown code blocks.
 * Claude sometimes returns ```json ... ``` around the JSON output.
 */
function extractJSON(text: string): string {
  // Try to extract from markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim()
  }

  // Try to find a JSON object or array directly
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (jsonMatch) {
    return jsonMatch[1].trim()
  }

  // Return as-is and let JSON.parse handle the error
  return text.trim()
}

/**
 * Call an AI agent with a system prompt and user message.
 * Parses and validates the response against a Zod schema.
 */
export async function callAgent<T>(
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  options?: { maxTokens?: number; model?: string }
): Promise<AgentCallResult<T>> {
  const client = getClient()
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS

  const response = await client.messages.create({
    model: options?.model ?? MODEL_SONNET,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  })

  // Extract text content from the response
  const textBlock = response.content.find((block) => block.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI response did not contain text content")
  }

  const rawJSON = extractJSON(textBlock.text)

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJSON)
  } catch (parseError) {
    throw new Error(
      `Failed to parse AI response as JSON: ${parseError instanceof Error ? parseError.message : "Unknown parse error"}. Raw text: ${textBlock.text.slice(0, 500)}`
    )
  }

  const validationResult = schema.safeParse(parsed)
  if (!validationResult.success) {
    const issues = validationResult.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(
      `AI response failed schema validation:\n${issues}\n\nRaw output (truncated): ${JSON.stringify(parsed).slice(0, 500)}`
    )
  }

  const tokens_used =
    (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)

  return {
    content: validationResult.data,
    tokens_used,
  }
}

/**
 * Stream a chat completion as SSE. Supports prompt caching via structured
 * system blocks with cache_control.
 */
export function streamChat(opts: {
  system: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>
  messages: MessageParam[]
  maxTokens?: number
  model?: string
}) {
  const client = getClient()
  return client.messages.stream({
    model: opts.model ?? MODEL_SONNET,
    max_tokens: opts.maxTokens ?? AI_CHAT_MAX_TOKENS,
    system: opts.system,
    messages: opts.messages,
  })
}
