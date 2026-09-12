import Anthropic from "@anthropic-ai/sdk"
import { toJSONSchema, type ZodSchema } from "zod"
import type { AgentCallResult } from "./types.js"
import pRetry from "p-retry"
import { jsonrepair } from "jsonrepair"
import { isAbortError } from "../lib/deadline.js"

export { Anthropic }

export const MODEL_OPUS = "claude-opus-4-6"
export const MODEL_OPUS_4_8 = "claude-opus-4-8"
export const MODEL_SONNET = "claude-sonnet-4-6"
export const MODEL_HAIKU = "claude-haiku-4-5-20251001"

/**
 * ADDITIVE ONLY — the values above are frozen (see lib/ai/models.ts for the
 * full reasoning; this file is its functions/ twin). Nothing here repoints an
 * existing agent. Add a constant, then repoint one call site at a time.
 *
 * Sonnet 5 is both NEWER and CHEAPER than Sonnet 4.6 ($2/$10 per MTok against
 * $3/$15), so it is a straight upgrade for the mechanical, short-output steps.
 */
export const MODEL_SONNET_5 = "claude-sonnet-5"

/**
 * Anthropic's most capable widely released model. Reserved for long-form work
 * a human actually reads — at $10/$50 per MTok it costs roughly 5x Sonnet 4.6
 * per call and is not worth it for a step whose output is a keyword or a meta
 * description.
 *
 * IT HAS A DIFFERENT REQUEST SURFACE. Forced tool choice (`tool_choice` of
 * "any" or "tool") returns a 400, which is exactly how callAgent has always
 * requested structured output — see `modelRejectsForcedToolChoice` below and
 * the structured-outputs branch in callAgentWithModel. Thinking is also always
 * on and cannot be disabled; depth is controlled with `output_config.effort`.
 */
export const MODEL_FABLE = "claude-fable-5-1"

/**
 * True for models that 400 on `tool_choice: {type: "tool" | "any"}`.
 *
 * Matched on a model-family prefix rather than an exact id so a future
 * `claude-fable-5-2` is handled correctly on the day it is first passed in,
 * rather than failing in production with a 400 that looks like an outage.
 * Mythos shares Fable's surface and is included for the same reason.
 */
export function modelRejectsForcedToolChoice(modelId: string): boolean {
  return /^claude-(fable|mythos)-/.test(modelId)
}
const DEFAULT_MAX_TOKENS = 32000

// ─── Enum normalization for model output ────────────────────────────────────
// The model may return enum values with spaces, dashes, or mixed case.
// Normalize known enum fields before Zod validation.

const ENUM_FIELD_NAMES = new Set([
  "split_type",
  "periodization",
  "recommended_split",
  "recommended_periodization",
  "role",
  "movement_pattern",
  "technique",
  "type",
  "priority",
  "training_age_category",
  "difficulty",
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
    console.error(
      `[toToolInputSchema] Failed to convert schema to JSON Schema:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * Keywords the structured-outputs validator (`output_config.format`) refuses.
 *
 * Discovered by probing the live API on 2026-09-12, not from documentation:
 *   output_config.format.schema: For 'array' type, 'minItems' values other
 *   than 0 or 1 are not supported (got: [2, 5])
 *
 * The constraint still holds — `schema.parse()` runs immediately afterwards —
 * but note WHERE it now holds: on our side, after generation, invisible to the
 * model.
 *
 * THAT IS WHY THIS LIST IS AS SHORT AS IT IS. The first version also stripped
 * minLength/maxLength "because Zod still enforces them". It does, but the model
 * could no longer SEE the 280-character excerpt cap, wrote 400 characters, was
 * rejected by Zod, retried with no feedback about what was wrong, and made the
 * identical mistake on all five attempts — 138 seconds to produce nothing. A
 * stripped constraint is not a constraint the model can satisfy; it is a trap
 * it falls into repeatedly.
 *
 * Do NOT extend this list speculatively. Every entry must come from an observed
 * 400, or it silently converts a working constraint into a retry loop.
 */
const UNSUPPORTED_SCHEMA_KEYWORDS = ["minItems", "maxItems"] as const

export function stripUnsupportedSchemaKeywords(node: unknown, depth = 0): unknown {
  if (depth > 20 || node === null || typeof node !== "object") return node
  if (Array.isArray(node)) return node.map((n) => stripUnsupportedSchemaKeywords(n, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if ((UNSUPPORTED_SCHEMA_KEYWORDS as readonly string[]).includes(key)) continue
    out[key] = stripUnsupportedSchemaKeywords(value, depth + 1)
  }
  return out
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
    if (
      msg.includes("429") ||
      msg.includes("529") ||
      msg.includes("overloaded") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503")
    ) {
      return true
    }
  }
  return false
}

// ─── callAgent: structured output via raw Anthropic SDK ─────────────────────

/**
 * Pure content-builder for the Anthropic user message. Backward-compatible:
 * when `images` is absent/empty and `cachedUserPrefix` is unset, returns the
 * bare `userMessage` string (identical to prior behavior). When `cachedUserPrefix`
 * is set (and no images), returns the prior `[cachedPrefix, text]` block array.
 * When `images` is present, image blocks are prepended, ahead of an optional
 * cached-prefix text block, ahead of the final user-message text block.
 * `documents` (base64 PDFs) lead the whole array when present.
 */
export function buildUserContent(
  userMessage: string,
  cachedUserPrefix: string | undefined,
  images: Array<{ media_type: string; data: string }> | undefined,
  documents?: Array<{ media_type: string; data: string }>,
): Anthropic.Messages.ContentBlockParam[] | string {
  const hasImages = !!images && images.length > 0
  const hasDocuments = !!documents && documents.length > 0
  if (!hasImages && !hasDocuments && !cachedUserPrefix) return userMessage
  const blocks: Anthropic.Messages.ContentBlockParam[] = []
  if (hasDocuments) {
    for (const doc of documents!) {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: doc.media_type as "application/pdf", data: doc.data },
      })
    }
  }
  if (hasImages) {
    for (const img of images!) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: img.media_type as "image/jpeg", data: img.data },
      })
    }
  }
  if (cachedUserPrefix) {
    blocks.push({ type: "text", text: cachedUserPrefix, cache_control: { type: "ephemeral" } })
  }
  blocks.push({ type: "text", text: userMessage })
  return blocks
}

function callAgentWithModel<T>(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  options?: {
    maxTokens?: number
    cacheSystemPrompt?: boolean
    /**
     * Optional stable prefix sent as a separately cached content block.
     * When set, the model sees: [cached prefix] + [userMessage].
     * Use for content that is identical across retries (e.g., exercise library, skeleton).
     * The block must be ≥ 1024 tokens to actually cache.
     */
    cachedUserPrefix?: string
    /**
     * Optional image blocks prepended to the user content (e.g. receipt photos).
     * When present, image blocks are sent ahead of the cached prefix (if any) and
     * the user message text.
     */
    images?: Array<{ media_type: string; data: string }>
    /**
     * Thinking depth / token spend, for models that support it. Only sent on
     * the structured-outputs path; the tool path's models are tuned without it
     * and adding it there would change behaviour for every existing agent.
     */
    effort?: "low" | "medium" | "high" | "max"
    /**
     * Optional base64 document blocks (currently application/pdf — receipt
     * invoices). Claude reads a PDF's text layer AND its page images, which is
     * why the receipt path sends PDFs here instead of rasterizing them before
     * sharp. Sent ahead of images, the cached prefix, and the user message.
     */
    documents?: Array<{ media_type: string; data: string }>
    /**
     * Aborts in-flight requests when the caller's wall-clock budget is spent.
     * See lib/deadline.ts — an abort is never retried and never falls back.
     */
    signal?: AbortSignal
  },
): Promise<AgentCallResult<T>> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS
  const client = getClient()
  const toolSchema = toToolInputSchema(schema)
  if (toolSchema) console.log(`[callAgent] Using structured tool_use output (model: ${modelId})`)

  return pRetry(
    async () => {
      const systemContent: Anthropic.Messages.TextBlockParam[] = [
        {
          type: "text" as const,
          text: systemPrompt,
          ...(options?.cacheSystemPrompt ? { cache_control: { type: "ephemeral" as const } } : {}),
        },
      ]

      let parsed: unknown
      let tokens_used: number
      let cache_creation_tokens = 0
      let cache_read_tokens = 0

      const userContent = buildUserContent(userMessage, options?.cachedUserPrefix, options?.images, options?.documents)

      if (toolSchema && modelRejectsForcedToolChoice(modelId)) {
        // ── Structured-outputs path (Fable / Mythos) ──────────────────────────
        // These models 400 on forced tool choice, so the schema goes in
        // `output_config.format` instead and the answer comes back as a text
        // block of schema-valid JSON rather than a tool_use block. Same Zod
        // validation downstream, so callers see no difference.
        const stream = client.messages.stream(
          {
            model: modelId,
            max_tokens: maxTokens,
            system: systemContent,
            output_config: {
              format: {
                type: "json_schema" as const,
                schema: stripUnsupportedSchemaKeywords(toolSchema) as Record<string, unknown>,
              },
              ...(options?.effort ? { effort: options.effort } : {}),
            },
            messages: [{ role: "user", content: userContent }],
          },
          { signal: options?.signal },
        )

        const response = await stream.finalMessage()

        // Thinking is always on for this family, so a refusal is a real
        // possibility on a 200. Checked BEFORE reading content, because the
        // content of a refused turn is not the answer.
        if (response.stop_reason === "refusal") {
          // `stop_details` is on the wire but not in @anthropic-ai/sdk 0.77's
          // Message type, hence the cast. Read it anyway — without the category
          // a refusal is indistinguishable from a bug in our own prompt.
          const details = (response as { stop_details?: unknown }).stop_details ?? null
          throw new Error(`Model declined the request (${modelId}); stop_details: ${JSON.stringify(details)}`)
        }
        if (response.stop_reason === "max_tokens") {
          throw new Error(
            `Response truncated (hit ${maxTokens} max_tokens). Output is incomplete — increase maxTokens or reduce input size.`,
          )
        }

        // Thinking blocks come first in content; take the text block, not [0].
        const textBlock = response.content.find((b) => b.type === "text")
        if (!textBlock || textBlock.type !== "text") {
          throw new Error("No text content in structured-outputs response")
        }
        try {
          parsed = JSON.parse(textBlock.text)
        } catch {
          parsed = JSON.parse(jsonrepair(textBlock.text))
        }

        tokens_used = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
        cache_creation_tokens = response.usage?.cache_creation_input_tokens ?? 0
        cache_read_tokens = response.usage?.cache_read_input_tokens ?? 0
      } else if (toolSchema) {
        // ── Primary path: structured output via tool_use (streaming to avoid 10min timeout) ──
        const stream = client.messages.stream(
          {
            model: modelId,
            max_tokens: maxTokens,
            system: systemContent,
            tools: [
              {
                name: "structured_output",
                description: "Output the structured result matching the required schema",
                input_schema: toolSchema,
              },
            ],
            tool_choice: { type: "tool" as const, name: "structured_output" },
            messages: [{ role: "user", content: userContent }],
          },
          { signal: options?.signal },
        )

        const response = await stream.finalMessage()

        // Check for truncation — if max_tokens was hit, the output is incomplete
        if (response.stop_reason === "max_tokens") {
          throw new Error(
            `Response truncated (hit ${maxTokens} max_tokens). Output is incomplete — increase maxTokens or reduce input size.`,
          )
        }

        const toolBlock = response.content.find((b) => b.type === "tool_use")
        if (!toolBlock || toolBlock.type !== "tool_use") {
          throw new Error("No tool_use block in Anthropic response")
        }

        parsed = toolBlock.input
        tokens_used = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
        cache_creation_tokens = response.usage?.cache_creation_input_tokens ?? 0
        cache_read_tokens = response.usage?.cache_read_input_tokens ?? 0
      } else {
        // ── Fallback: text-based JSON parsing (streaming to avoid 10min timeout) ──
        console.warn(`[callAgent] Falling back to text JSON parsing (model: ${modelId})`)

        const fallbackUserText =
          userMessage + "\n\nYou MUST respond with valid JSON matching this schema. Output ONLY the JSON object."
        // options.documents MUST be threaded here too. Omitting it sends the
        // retry with no PDF attached, and the model answers confidently from
        // the prompt alone instead of erroring — a silent wrong result.
        const fallbackUserContent = buildUserContent(
          fallbackUserText,
          options?.cachedUserPrefix,
          options?.images,
          options?.documents,
        )

        const stream = client.messages.stream(
          {
            model: modelId,
            max_tokens: maxTokens,
            system: systemContent,
            messages: [{ role: "user", content: fallbackUserContent }],
          },
          { signal: options?.signal },
        )

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
        cache_creation_tokens = response.usage?.cache_creation_input_tokens ?? 0
        cache_read_tokens = response.usage?.cache_read_input_tokens ?? 0
      }

      // Normalize enum fields before Zod validation (model may use spaces/dashes/mixed case)
      const normalized = normalizeEnumFields(parsed)
      const validated = schema.parse(normalized)
      return { content: validated as T, tokens_used, cache_creation_tokens, cache_read_tokens }
    },
    {
      retries: 4,
      minTimeout: 5_000,
      maxTimeout: 30_000,
      shouldRetry: (ctx) => {
        const err = ctx.error
        // The caller's time budget is gone — retrying spends wall-clock we do
        // not have and is the exact loop that wedged jobs in "processing".
        if (isAbortError(err)) {
          console.log(`[callAgent] Aborted by caller deadline — not retrying (model: ${modelId})`)
          return false
        }
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
          `[callAgent] Attempt ${ctx.attemptNumber} failed (${ctx.retriesLeft} retries left, model: ${modelId}): ${ctx.error.message?.slice(0, 200)}`,
        )
      },
    },
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
    cachedUserPrefix?: string
    images?: Array<{ media_type: string; data: string }>
    /** Base64 PDFs sent as Anthropic document blocks — see callAgentWithModel. */
    documents?: Array<{ media_type: string; data: string }>
    /**
     * Thinking depth for models that support it.
     *
     * Safe to leave set across the Haiku fallback below: `effort` is only put
     * on the wire by the structured-outputs branch, which Haiku never takes
     * (it does not reject forced tool choice), and Haiku 4.5 would 400 on the
     * parameter. Do not "simplify" this by sending effort on the tool path.
     */
    effort?: "low" | "medium" | "high" | "max"
    signal?: AbortSignal
  },
): Promise<AgentCallResult<T>> {
  const modelId = options?.model ?? MODEL_SONNET

  try {
    return await callAgentWithModel(modelId, systemPrompt, userMessage, schema, options)
  } catch (error) {
    // An aborted call means the caller is out of time. A Haiku fallback here
    // would start a WHOLE NEW request (up to 5 more attempts) past the budget.
    if (isAbortError(error)) throw error
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
    const toolUseBlocks = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")

    if (toolUseBlocks.length === 0) break

    // Execute tools in parallel
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await opts.executeTool(block.name, block.input as Record<string, unknown>)
        return { toolUseId: block.id, name: block.name, result }
      }),
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
