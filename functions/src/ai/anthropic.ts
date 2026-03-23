import Anthropic from "@anthropic-ai/sdk"
import { toJSONSchema, type ZodSchema } from "zod"
import type { AgentCallResult } from "./types.js"
import pRetry from "p-retry"
import { jsonrepair } from "jsonrepair"

export { Anthropic }

export const MODEL_OPUS = "claude-opus-4-6-20250618"
export const MODEL_SONNET = "claude-sonnet-4-20250514"
export const MODEL_HAIKU = "claude-haiku-4-5-20251001"
const DEFAULT_MAX_TOKENS = 32000

// ─── Enum normalization for model output ────────────────────────────────────
// The model may return enum values with spaces, dashes, or mixed case.
// Normalize known enum fields before Zod validation.

const ENUM_FIELD_NAMES = new Set([
  "split_type", "periodization",
  "recommended_split", "recommended_periodization",
  "role", "movement_pattern", "technique", "type", "priority",
  "training_age_category", "difficulty",
])

function normalizeEnumValue(raw: unknown): string {
  if (typeof raw !== "string") return String(raw ?? "")
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s/\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
}

function normalizeEnumFields(data: unknown, depth = 0): unknown {
  if (depth > 15 || data === null || data === undefined) return data
  if (Array.isArray(data)) return data.map((item) => normalizeEnumFields(item, depth + 1))
  if (typeof data === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (ENUM_FIELD_NAMES.has(key) && typeof value === "string") {
        result[key] = normalizeEnumValue(value)
      } else {
        result[key] = normalizeEnumFields(value, depth + 1)
      }
    }
    return result
  }
  return data
}

// ─── Singleton client ───────────────────────────────────────────────────────

let _client: Anthropic | null = null

export function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  }
  return _client
}

// ─── Schema → JSON Schema for tool_use structured output ─────────────────────

function toToolInputSchema(schema: ZodSchema): { type: "object"; [key: string]: unknown } | null {
  try {
    const raw = toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>
    // Strip $schema metadata — Anthropic expects a plain JSON Schema object
    const { $schema: _, "~standard": _s, ...rest } = raw
    if (rest.type === "object") {
      const result = rest as { type: "object"; [key: string]: unknown }
      // Log the top-level properties for debugging schema generation issues
      const props = result.properties as Record<string, unknown> | undefined
      if (props) {
        console.log(`[toToolInputSchema] Generated schema with properties: ${Object.keys(props).join(", ")}`)
      }
      return result
    }
    console.warn(`[toToolInputSchema] Schema type is "${rest.type}", expected "object". Falling back to text mode.`)
    return null
  } catch (err) {
    console.error(`[toToolInputSchema] Failed to convert schema to JSON Schema:`, err instanceof Error ? err.message : err)
    return null
  }
}

// ─── Transient error detection ───────────────────────────────────────────────

function isTransientError(error: unknown): boolean {
  // Check via instanceof (may fail across module boundaries in Cloud Functions)
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 529 || error.status >= 500
  }
  // Duck-type check: Anthropic SDK errors have a numeric `status` property
  const statusCode = (error as { status?: number }).status
  if (typeof statusCode === "number") {
    return statusCode === 429 || statusCode === 529 || statusCode >= 500
  }
  // Fallback: check error message string for known transient codes/keywords
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes("429") || msg.includes("529") || msg.includes("overloaded") || msg.includes("500") || msg.includes("502") || msg.includes("503")) {
      return true
    }
  }
  return false
}

// ─── callAgent: structured output via raw Anthropic SDK ─────────────────────

function callAgentWithModel<T>(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  options?: {
    maxTokens?: number
    cacheSystemPrompt?: boolean
  }
): Promise<AgentCallResult<T>> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS
  const client = getClient()
  const toolSchema = toToolInputSchema(schema)
  if (toolSchema) console.log(`[callAgent] Using structured tool_use output (model: ${modelId})`)

  return pRetry(
    async () => {
      const systemContent: Anthropic.Messages.TextBlockParam[] = [{
        type: "text" as const,
        text: systemPrompt,
        ...(options?.cacheSystemPrompt ? { cache_control: { type: "ephemeral" as const } } : {}),
      }]

      let parsed: unknown
      let tokens_used: number

      if (toolSchema) {
        // ── Primary path: structured output via tool_use (streaming to avoid 10min timeout) ──
        const stream = client.messages.stream({
          model: modelId,
          max_tokens: maxTokens,
          system: systemContent,
          tools: [{
            name: "structured_output",
            description: "Output the structured result matching the required schema",
            input_schema: toolSchema,
          }],
          tool_choice: { type: "tool" as const, name: "structured_output" },
          messages: [{ role: "user", content: userMessage }],
        })

        const response = await stream.finalMessage()

        // Check for truncation — if max_tokens was hit, the output is incomplete
        if (response.stop_reason === "max_tokens") {
          throw new Error(`Response truncated (hit ${maxTokens} max_tokens). Output is incomplete — increase maxTokens or reduce input size.`)
        }

        const toolBlock = response.content.find((b) => b.type === "tool_use")
        if (!toolBlock || toolBlock.type !== "tool_use") {
          throw new Error("No tool_use block in Anthropic response")
        }

        parsed = toolBlock.input
        tokens_used = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
      } else {
        // ── Fallback: text-based JSON parsing (streaming to avoid 10min timeout) ──
        console.warn(`[callAgent] Falling back to text JSON parsing (model: ${modelId})`)

        const stream = client.messages.stream({
          model: modelId,
          max_tokens: maxTokens,
          system: systemContent,
          messages: [{
            role: "user",
            content: userMessage + "\n\nYou MUST respond with valid JSON matching this schema. Output ONLY the JSON object.",
          }],
        })

        const response = await stream.finalMessage()

        const textBlock = response.content.find((b) => b.type === "text")
        if (!textBlock || textBlock.type !== "text") {
          throw new Error("No text content in Anthropic response")
        }

        const jsonStr = textBlock.text.trim()
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          throw new SyntaxError("No JSON object found in response")
        }

        try {
          parsed = JSON.parse(jsonMatch[0])
        } catch {
          const repaired = jsonrepair(jsonMatch[0])
          parsed = JSON.parse(repaired)
        }

        tokens_used = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
      }

      // Normalize enum fields before Zod validation (model may use spaces/dashes/mixed case)
      const normalized = normalizeEnumFields(parsed)
      const validated = schema.parse(normalized)
      return { content: validated as T, tokens_used }
    },
    {
      retries: 4,
      minTimeout: 5_000,
      maxTimeout: 30_000,
      shouldRetry: (ctx) => {
        const err = ctx.error
        // Retry on transient API errors (429, 529, 5xx)
        if (isTransientError(err)) return true
        // Retry on JSON parse errors (model produced malformed JSON)
        if (err instanceof SyntaxError) return true
        // Retry on Zod validation errors (model output didn't match schema)
        if (err?.constructor?.name === "ZodError") return true
        console.log(`[callAgent] NOT retrying: ${err?.constructor?.name} (model: ${modelId})`)
        return false
      },
      onFailedAttempt: (ctx) => {
        console.warn(
          `[callAgent] Attempt ${ctx.attemptNumber} failed (${ctx.retriesLeft} retries left, model: ${modelId}): ${ctx.error.message?.slice(0, 200)}`
        )
      },
    }
  )
}

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
  const modelId = options?.model ?? MODEL_SONNET

  try {
    return await callAgentWithModel(modelId, systemPrompt, userMessage, schema, options)
  } catch (error) {
    // If primary model exhausted all retries on a transient error, fall back to Haiku
    if (modelId !== MODEL_HAIKU && isTransientError(error)) {
      console.warn(`[callAgent] ${modelId} exhausted all retries — falling back to ${MODEL_HAIKU}`)
      return callAgentWithModel(MODEL_HAIKU, systemPrompt, userMessage, schema, options)
    }
    throw error
  }
}

// ─── streamRaw: raw Anthropic streaming for Firebase Functions ──────────────

export async function* streamRaw(opts: {
  system: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>
  messages: Array<{ role: "user" | "assistant"; content: string }>
  maxTokens?: number
  model?: string
}): AsyncGenerator<{ type: "text"; text: string } | { type: "usage"; input_tokens: number; output_tokens: number }> {
  const client = getClient()
  const modelId = opts.model ?? MODEL_SONNET
  const maxTokens = opts.maxTokens ?? 16384

  const systemContent: Anthropic.Messages.TextBlockParam[] =
    typeof opts.system === "string"
      ? [{ type: "text" as const, text: opts.system }]
      : opts.system.map((block) => ({
          type: "text" as const,
          text: block.text,
          ...(block.cache_control ? { cache_control: block.cache_control } : {}),
        }))

  const stream = client.messages.stream({
    model: modelId,
    max_tokens: maxTokens,
    system: systemContent,
    messages: opts.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  })

  let inputTokens = 0
  let outputTokens = 0

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text", text: event.delta.text }
    } else if (event.type === "message_delta" && "usage" in event) {
      outputTokens = (event.usage as { output_tokens?: number })?.output_tokens ?? 0
    } else if (event.type === "message_start" && "message" in event) {
      const msg = event.message as { usage?: { input_tokens?: number } }
      inputTokens = msg.usage?.input_tokens ?? 0
    }
  }

  yield {
    type: "usage",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  }
}

// ─── streamWithTools: streaming with tool-use loop ──────────────────────────

export type ToolStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; label?: string }
  | { type: "tool_result"; name: string }
  | { type: "usage"; input_tokens: number; output_tokens: number }

export async function* streamWithTools(opts: {
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>
  messages: Array<{ role: "user" | "assistant"; content: string }>
  tools: Anthropic.Tool[]
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>
  toolLabels?: Record<string, string>
  maxTokens?: number
  model?: string
  maxToolRounds?: number
}): AsyncGenerator<ToolStreamEvent> {
  const client = getClient()
  const modelId = opts.model ?? MODEL_SONNET
  const maxTokens = opts.maxTokens ?? 16384
  const maxRounds = opts.maxToolRounds ?? 5

  const systemContent: Anthropic.Messages.TextBlockParam[] = opts.system.map((block) => ({
    type: "text" as const,
    text: block.text,
    ...(block.cache_control ? { cache_control: block.cache_control } : {}),
  }))

  // Convert simple messages to Anthropic format
  let apiMessages: Anthropic.MessageParam[] = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  let totalInputTokens = 0
  let totalOutputTokens = 0

  for (let round = 0; round < maxRounds; round++) {
    // Stream the response
    const stream = client.messages.stream({
      model: modelId,
      max_tokens: maxTokens,
      system: systemContent,
      messages: apiMessages,
      tools: opts.tools,
    })

    // Yield text deltas as they arrive and track tool_use block starts
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text }
      } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        yield {
          type: "tool_start",
          name: event.content_block.name,
          label: opts.toolLabels?.[event.content_block.name],
        }
      }
    }

    // Get the complete message to process tool calls
    const finalMessage = await stream.finalMessage()
    totalInputTokens += finalMessage.usage.input_tokens
    totalOutputTokens += finalMessage.usage.output_tokens

    // If no tool calls, we're done
    if (finalMessage.stop_reason !== "tool_use") break

    // Extract and execute tool calls
    const toolUseBlocks = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    )

    if (toolUseBlocks.length === 0) break

    // Execute tools in parallel
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await opts.executeTool(
          block.name,
          block.input as Record<string, unknown>
        )
        return { toolUseId: block.id, name: block.name, result }
      })
    )

    // Yield tool_result events
    for (const tr of toolResults) {
      yield { type: "tool_result", name: tr.name }
    }

    // Build tool result messages for the next round
    const toolResultContent: Anthropic.ToolResultBlockParam[] = toolResults.map((tr) => ({
      type: "tool_result" as const,
      tool_use_id: tr.toolUseId,
      content: tr.result,
    }))

    // Continue conversation with tool results
    apiMessages = [
      ...apiMessages,
      { role: "assistant" as const, content: finalMessage.content },
      { role: "user" as const, content: toolResultContent },
    ]
  }

  yield {
    type: "usage",
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
  }
}
