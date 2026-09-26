import Anthropic from "@anthropic-ai/sdk"
import { toJSONSchema, type ZodSchema } from "zod"
import type { AgentCallResult } from "./types.js"
import pRetry from "p-retry"
import { jsonrepair, JSONRepairError } from "jsonrepair"
import { isAbortError } from "../lib/deadline.js"
import {
  canFallBackToAnthropic,
  isOpenRouterConfigured,
  ProviderFallbackError,
  shouldFallBackToAnthropic,
} from "./openrouter.js"
import { callAgentViaOpenRouter } from "./openrouter-agent.js"
import { streamTextViaOpenRouter, streamWithToolsViaOpenRouter } from "./openrouter-stream.js"

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
 * The two agents that decide what a training week actually contains: the
 * Architect (slot structure) and the Exercise Selector (which exercise fills
 * each slot). Both orchestrators — new-program and add-a-week — read these, so
 * the pipeline cannot drift into using different models for the same job.
 *
 * Moved to Fable 5.1 on 2026-09-21 at the owner's request. Three things that
 * are easy to get wrong here:
 *
 * 1. The Selector previously passed NO model at all and silently defaulted to
 *    MODEL_SONNET. "Which model picks the exercises" was not written down
 *    anywhere — it was the parameter default.
 * 2. Fable 400s on forced tool choice, so callAgent routes it through the
 *    `output_config.format` branch instead. That is handled, not incidental —
 *    see modelRejectsForcedToolChoice above.
 * 3. Thinking is always on for this family, so these calls are slower per
 *    attempt than Sonnet was. The Selector runs inside a retry loop against a
 *    450s budget (WEEK_GENERATION_BUDGET_MS); if generations start timing out,
 *    this pair is the first thing to move back, not the retry count, and not
 *    the budget — its ~90s gap under the 540s Eventarc ceiling is what lets a
 *    blown run report "failed" instead of wedging in "processing".
 *
 * BENCHMARKED 2026-09-21 — Fable 5.1 vs GPT-6 Astra, identical request, same
 * client and history, one run each scope:
 *
 *              week: time / arch+sel tokens      day: time / arch+sel tokens
 *   Fable 5.1   288.7s / 18,915 + 44,576         133.7s / 16,757 + 37,142
 *   Astra       188.9s / 13,802 + 25,610         125.9s / 11,601 + 21,432
 *
 * Astra is ~35% faster and ~40% cheaper in tokens at the SAME list price
 * ($10/$50), and it did not hallucinate an exercise id — Fable invented one in
 * the week run, which was stripped and left a silent hole in the day. Both
 * honoured the equipment constraint perfectly (0 violations in all four runs).
 *
 * WHAT THE BENCHMARK DID NOT SETTLE, because both models did it: prescribing
 * REPS for isometric holds, "each side" on bilateral movements, and repeating a
 * movement family inside one session. Two vendors making identical mistakes is
 * a PROMPT problem, so those were fixed in the prompt and in program-quality.ts
 * rather than by choosing a model. Do not re-litigate them as a model choice.
 *
 * Astra's own weaknesses, from that one run: it dropped pulling entirely from an
 * upper-body day, and its single-day output had no warm-up block and ordered
 * activation before warm_up. Worth watching.
 *
 * n=1 per configuration. Repoint with PROGRAM_ARCHITECT_MODEL /
 * EXERCISE_SELECTOR_MODEL to re-run the comparison without editing code.
 */
export const MODEL_GPT6_ASTRA = "gpt-6-astra"

/**
 * Overridable so a head-to-head can be run without editing code — set
 * PROGRAM_ARCHITECT_MODEL / EXERCISE_SELECTOR_MODEL for one run and compare.
 * PRODUCTION LEAVES BOTH UNSET; the default is the pair above. An unmapped id
 * throws in toOpenRouterModel rather than silently falling back, so a typo here
 * fails loudly instead of quietly benchmarking the wrong model.
 */
export const MODEL_PROGRAM_ARCHITECT = process.env.PROGRAM_ARCHITECT_MODEL || MODEL_GPT6_ASTRA
export const MODEL_EXERCISE_SELECTOR = process.env.EXERCISE_SELECTOR_MODEL || MODEL_GPT6_ASTRA

/**
 * Thinking depth for the two agents above. gpt-6-astra takes the forced-tool
 * branch (it does not reject forced tool choice), and through OpenRouter
 * `buildChatRequest` sends effort as `reasoning` on that branch too — so this
 * does reach the wire. It would not on direct Anthropic, where only the
 * structured-outputs branch sends it, but astra never goes there.
 */
export const PROGRAM_AGENT_EFFORT = "medium" as const

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

/**
 * Worth another attempt? A 429 or a 5xx is; anything else fails the same way
 * every time.
 *
 * A `ProviderFallbackError` is classified by its OPENROUTER half, because the
 * next attempt goes to OpenRouter first (see callAgentWithModel). An OpenRouter
 * 429 whose unfunded Anthropic fallback then answered 400 "credit balance is
 * too low" is still a rate limit, and worth retrying. Classifying the wrapper
 * by its message instead would read ANTHROPIC's words — a "529" or an
 * "overloaded" in the fallback's footnote — as a verdict on OpenRouter.
 *
 * The numeric status is read from any SDK, not only `Anthropic.APIError`:
 * OpenRouter's errors come from the OpenAI SDK and carry the same `.status`.
 *
 * A MALFORMED ANSWER IS NEVER TRANSIENT, and is ruled out before the message
 * is read. The message fallback used to match SUBSTRINGS, so the digits inside
 * a validation message set the policy: a jsonrepair failure "at position 1502"
 * read as a 502 and a `.max(500)` Zod miss ("<=500 characters") as a 500. Both
 * are still retried — see `shouldRetry`, which retries malformed output on
 * purpose — but as what they are, so an exhausted run no longer takes callAgent's
 * Haiku last resort, five more paid calls for an answer that was the wrong shape.
 *
 * What remains of the message fallback is for provider faults that lost their
 * numeric field: a status-shaped TOKEN (429 or 5xx standing alone, not inside a
 * longer number) or the word "overloaded", which is how a mid-stream Anthropic
 * overloaded_error arrives — as an SSE error event with no HTTP status at all.
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof ProviderFallbackError) return isTransientError(error.openRouterError)
  if (isMalformedOutput(error)) return false
  const statusCode = (error as { status?: unknown } | null)?.status
  if (typeof statusCode === "number") {
    return statusCode === 429 || statusCode >= 500
  }
  if (!(error instanceof Error)) return false
  return /(^|\D)(429|5\d\d)(\D|$)/.test(error.message) || /overloaded/i.test(error.message)
}

/**
 * The model answered, and the answer was not the shape asked for: unparseable
 * JSON (`JSON.parse` throws a SyntaxError; `jsonrepair` throws its own
 * JSONRepairError, which is NOT a SyntaxError and names itself only "Error"),
 * or a Zod miss from `schema.parse`.
 *
 * Zod is matched by NAME — classic "ZodError" and core "$ZodError" — and by
 * constructor name, because an `instanceof` against one zod copy is false for
 * an error thrown by another.
 */
function isMalformedOutput(error: unknown): boolean {
  if (error instanceof SyntaxError || error instanceof JSONRepairError) return true
  const e = error as { name?: unknown; constructor?: { name?: unknown } } | null
  const name = e?.name
  return name === "ZodError" || name === "$ZodError" || e?.constructor?.name === "ZodError"
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
     * Thinking depth / token spend, for models that support it. Direct
     * Anthropic sends it only on the structured-outputs path
     * (`output_config.effort`). Through OpenRouter, `buildChatRequest` sends it
     * as `reasoning` on EVERY path, the forced-tool path included — which is
     * why callAgent's Haiku fallback does not pass it on.
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
  const toolSchema = toToolInputSchema(schema)
  // Name the branch, not just the intent. This used to print "tool_use" for
  // every schema-bearing call, including the Fable/Mythos ones that never take
  // the tool path — which reads as proof that forced tool choice worked.
  if (toolSchema) {
    const branch = modelRejectsForcedToolChoice(modelId) ? "output_config.format" : "tool_use"
    console.log(`[callAgent] Structured output via ${branch} (model: ${modelId})`)
  }

  const viaOpenRouter = () =>
    callAgentViaOpenRouter(modelId, systemPrompt, userMessage, schema, toolSchema, normalizeEnumFields, {
      maxTokens,
      cacheSystemPrompt: options?.cacheSystemPrompt,
      cachedUserPrefix: options?.cachedUserPrefix,
      images: options?.images,
      documents: options?.documents,
      effort: options?.effort,
      signal: options?.signal,
      useResponseFormat: modelRejectsForcedToolChoice(modelId),
    })

  // The direct-Anthropic implementation, unchanged. It is the whole call when
  // OpenRouter is not configured, and one attempt's fallback when it is.
  const viaAnthropic = async (): Promise<AgentCallResult<T>> => {
    const client = getClient()
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
  }

  // OpenRouter first, direct Anthropic as the fallback — decided PER ATTEMPT.
  //
  // It used to be decided once per call: the first fallback-class OpenRouter
  // error set `useOpenRouter = false` for every remaining attempt. With the
  // Anthropic account unfunded, one retryable OpenRouter 429 therefore became a
  // certain failure reading "Your credit balance is too low" — every retry went
  // to the provider that could not answer. Now each attempt tries OpenRouter,
  // a fallback serves THAT attempt only, and when both fail the attempt throws
  // a ProviderFallbackError that leads with OpenRouter's fault and carries its
  // status, so isTransientError judges the provider the next attempt goes to.
  const useOpenRouter = isOpenRouterConfigured()

  return pRetry(
    async () => {
      if (!useOpenRouter) return viaAnthropic()
      try {
        return await viaOpenRouter()
      } catch (e) {
        // Only provider-availability faults fall back. A 400 or a bad model
        // slug is OUR bug and fails identically on Anthropic, so falling back
        // would double its cost and hide it behind a working response. An
        // abort is the caller's deadline. A non-Claude id (gpt-6-astra, the
        // architect and selector default) has nowhere else to go: Anthropic
        // would 404 it, and that 404 would replace the fault worth seeing.
        if (isAbortError(e) || !shouldFallBackToAnthropic(e) || !canFallBackToAnthropic(modelId)) throw e
        console.warn(
          `[callAgent] OpenRouter unavailable (${e instanceof Error ? e.message.slice(0, 160) : e}) — ` +
            `falling back to direct Anthropic for this attempt (model: ${modelId})`,
        )
        try {
          return await viaAnthropic()
        } catch (anthropicError) {
          // The deadline firing DURING the fallback must stay an abort.
          // Wrapped, it would carry OpenRouter's status — a 503 reads as
          // transient — and pRetry would start another attempt past the budget.
          if (isAbortError(anthropicError)) throw anthropicError
          throw new ProviderFallbackError(e, anthropicError)
        }
      }
    },
    {
      retries: 4,
      minTimeout: 5_000,
      maxTimeout: 30_000,
      // The backoff sleeps are 5s, 10s, 20s and 30s. Without the caller's
      // signal, a deadline that fired mid-sleep was only noticed after the
      // sleep: up to 30s the budget no longer had, then one more attempt that
      // failed at once on the aborted signal (the SDK checks it before any
      // request goes out). With it, pRetry ends the sleep and throws the
      // signal's reason (an AbortError) at once. The isAbortError checks below
      // stay: they cover an abort thrown by the request itself.
      signal: options?.signal,
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
        // The two checks below are about the MODEL'S ANSWER, so they read the
        // error of whichever provider answered. When the fallback answered and
        // its output was malformed, that error sits inside the wrapper; judging
        // the wrapper alone would stop on OpenRouter's non-transient 402 and
        // never retry a funded Anthropic's recoverable bad answer.
        const answerError = err instanceof ProviderFallbackError ? err.anthropicError : err
        // Retry malformed JSON (JSON.parse's SyntaxError, or jsonrepair's
        // JSONRepairError when even the repair failed) and Zod misses. This is
        // deliberate for long-running jobs, and it is the ONLY route by which a
        // malformed answer is retried: isTransientError refuses it, so an
        // exhausted run does not go on to the Haiku last resort.
        if (isMalformedOutput(answerError)) return true
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
     * NOT carried into the Haiku fallback below. It used to be, on the grounds
     * that only the structured-outputs branch puts effort on the wire — true of
     * direct Anthropic, false through OpenRouter: `buildChatRequest` sends it
     * as `reasoning` on every branch, including the forced tool choice Haiku
     * is asked with. For a Claude model that reasoning is extended thinking,
     * which Anthropic refuses alongside a forced tool choice. So a Fable blog
     * draft (effort "medium") that exhausted its retries handed Haiku a request
     * built to 400, and that 400 replaced the fault worth seeing.
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
    // The Haiku last resort is for CLAUDE primaries only. A gpt-6-astra
    // failure (the architect and selector default) used to be rerouted here
    // too, astra's options and all: either Haiku silently wrote the training
    // program the owner chose astra for, or the effort it inherited made it
    // 400 and that 400 replaced astra's 503. A non-Claude primary's own error
    // is the one worth seeing.
    if (modelId !== MODEL_HAIKU && canFallBackToAnthropic(modelId) && isTransientError(error)) {
      console.warn(`[callAgent] ${modelId} exhausted all retries — falling back to ${MODEL_HAIKU}`)
      return callAgentWithModel(MODEL_HAIKU, systemPrompt, userMessage, schema, { ...options, effort: undefined })
    }
    throw error
  }
}

// ─── OpenRouter-first streaming ─────────────────────────────────────────────

/**
 * Stream from OpenRouter; switch to direct Anthropic only if OpenRouter failed
 * BEFORE the consumer received a single event.
 *
 * WHY THIS EXISTS. The first OpenRouter migration moved only the one-shot
 * calls. streamRaw and streamWithTools kept calling Anthropic directly, so with
 * the Anthropic account unfunded the admin "DJP Assistant" chat answered "Your
 * credit balance is too low" — which reads exactly like "this feature was never
 * moved to OpenRouter", because it hadn't been.
 *
 * WHY THE "EMITTED ANYTHING YET?" GATE. Both consumers write every event to
 * Firestore the moment it arrives (admin-chat.ts, ai-coach.ts), and
 * streamWithTools runs the tools between events. Once one event is out, a
 * second provider would repeat text the chat already shows and run the tools a
 * second time; there is no "unsay" event. So a fault after the first event is
 * rethrown exactly as it arrived.
 *
 * WHY THE WRAPPED ERROR. When both providers fail before anything was emitted,
 * admin-chat.ts's catch shows `error.message` to the owner. A
 * ProviderFallbackError leads with OpenRouter's fault — the story — and keeps
 * Anthropic's as the footnote. ai-coach.ts deliberately does NOT: its reader is
 * an athlete, so it logs this error and shows athleteFacingCoachError's fixed
 * "try again" text instead. Do not reword this error for athletes; it is not
 * shown to them. If the fallback had already emitted something,
 * its own error is rethrown as-is: by then it IS the stream being read.
 *
 * An abort is the caller's decision and never falls back, and a non-Claude id
 * never does either (Anthropic would 404 it and bury the real fault).
 */
async function* openRouterFirst<E>(args: {
  label: string
  modelId: string
  openRouter: () => AsyncGenerator<E>
  anthropic: () => AsyncGenerator<E>
}): AsyncGenerator<E> {
  let emitted = false
  let openRouterError: unknown
  try {
    for await (const event of args.openRouter()) {
      // Set BEFORE the yield: the consumer has the event the moment it is
      // yielded, whatever it then does with it.
      emitted = true
      yield event
    }
    return
  } catch (e) {
    if (emitted || isAbortError(e) || !shouldFallBackToAnthropic(e) || !canFallBackToAnthropic(args.modelId)) throw e
    openRouterError = e
  }

  console.warn(
    `[${args.label}] OpenRouter unavailable (${
      openRouterError instanceof Error ? openRouterError.message.slice(0, 160) : String(openRouterError)
    }) — falling back to direct Anthropic for this turn (model: ${args.modelId})`,
  )

  let fallbackEmitted = false
  try {
    for await (const event of args.anthropic()) {
      fallbackEmitted = true
      yield event
    }
  } catch (anthropicError) {
    if (fallbackEmitted || isAbortError(anthropicError)) throw anthropicError
    throw new ProviderFallbackError(openRouterError, anthropicError)
  }
}

// ─── streamRaw: plain text streaming for Firebase Functions ─────────────────

/**
 * OpenRouter first, direct Anthropic as the fallback — see openRouterFirst.
 * The event contract is the Anthropic implementation's, which ai-coach.ts
 * consumes; streamTextViaOpenRouter emits the same shapes in the same order.
 */
export async function* streamRaw(opts: {
  system: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>
  messages: Array<{ role: "user" | "assistant"; content: string }>
  maxTokens?: number
  model?: string
}): AsyncGenerator<{ type: "text"; text: string } | { type: "usage"; input_tokens: number; output_tokens: number }> {
  if (!isOpenRouterConfigured()) {
    yield* streamRawViaAnthropic(opts)
    return
  }
  const modelId = opts.model ?? MODEL_SONNET
  const maxTokens = opts.maxTokens ?? 16384
  yield* openRouterFirst({
    label: "streamRaw",
    modelId,
    openRouter: () =>
      streamTextViaOpenRouter({ model: modelId, system: opts.system, messages: opts.messages, maxTokens }),
    anthropic: () => streamRawViaAnthropic(opts),
  })
}

async function* streamRawViaAnthropic(
  opts: Parameters<typeof streamRaw>[0],
): AsyncGenerator<{ type: "text"; text: string } | { type: "usage"; input_tokens: number; output_tokens: number }> {
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

/**
 * OpenRouter first, direct Anthropic as the fallback — see openRouterFirst.
 * The event contract is the Anthropic implementation's, which admin-chat.ts
 * consumes; streamWithToolsViaOpenRouter emits the same shapes in the same
 * order, and runs the tool loop itself.
 */
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
  if (!isOpenRouterConfigured()) {
    yield* streamWithToolsViaAnthropic(opts)
    return
  }
  const modelId = opts.model ?? MODEL_SONNET
  yield* openRouterFirst({
    label: "streamWithTools",
    modelId,
    openRouter: () =>
      streamWithToolsViaOpenRouter({
        model: modelId,
        system: opts.system,
        messages: opts.messages,
        // An Anthropic.Tool may also carry `cache_control` or `type`, which an
        // OpenAI function definition has no slot for; these three are the tool.
        tools: opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        executeTool: opts.executeTool,
        toolLabels: opts.toolLabels,
        maxTokens: opts.maxTokens ?? 16384,
        maxToolRounds: opts.maxToolRounds ?? 5,
      }),
    anthropic: () => streamWithToolsViaAnthropic(opts),
  })
}

async function* streamWithToolsViaAnthropic(
  opts: Parameters<typeof streamWithTools>[0],
): AsyncGenerator<ToolStreamEvent> {
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
