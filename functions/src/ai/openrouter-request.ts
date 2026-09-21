// GENERATED TWIN of lib/ai/openrouter-request.ts — functions/ has rootDir "src" and cannot import
// from lib/. Regenerate with scripts/gen-openrouter-twins.py rather than
// editing by hand; the two must not drift.
import { toOpenRouterModel, toReasoningEffort } from "./openrouter.js"

/**
 * Translating one Anthropic Messages request into one OpenRouter (OpenAI
 * Chat Completions) request.
 *
 * Kept as pure functions with no network in them, because that is the only part
 * of this migration that can be tested without a live key: these build the
 * request, and tests pin its exact shape. Whether OpenRouter then BEHAVES as
 * documented is a separate question that only a real call answers.
 *
 * Twin: functions/src/ai/openrouter-request.ts. Change one, change both.
 */

export interface MediaPart {
  media_type: string
  data: string
}

export type ContentPart =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } }

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string | ContentPart[]
}

/**
 * System prompt as a content-part array so a cache breakpoint can sit on it.
 *
 * OpenRouter passes `cache_control` straight through to Anthropic, so the
 * breakpoint means the same thing it did before — but ONLY when the content is
 * an array of parts. A plain string cannot carry one, which is why this always
 * returns parts when caching is on.
 */
export function buildSystemMessage(systemPrompt: string, cache: boolean | undefined): ChatMessage {
  if (!cache) return { role: "system", content: systemPrompt }
  return {
    role: "system",
    content: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
  }
}

/**
 * User turn, mirroring buildUserContent's ordering exactly: documents, then
 * images, then the cached prefix, then the variable message.
 *
 * The ordering is load-bearing for caching — a cache breakpoint only helps if
 * everything BEFORE it is byte-identical between calls, so the stable prefix
 * has to precede the variable suffix. Reordering these silently drops the hit
 * rate to zero while everything still works.
 */
export function buildUserMessage(
  userMessage: string,
  cachedUserPrefix?: string,
  images?: MediaPart[],
  documents?: MediaPart[],
): ChatMessage {
  const hasImages = !!images?.length
  const hasDocuments = !!documents?.length
  if (!hasImages && !hasDocuments && !cachedUserPrefix) {
    return { role: "user", content: userMessage }
  }

  const parts: ContentPart[] = []
  for (const [i, doc] of (documents ?? []).entries()) {
    parts.push({
      type: "file",
      file: { filename: `document-${i + 1}.pdf`, file_data: `data:${doc.media_type};base64,${doc.data}` },
    })
  }
  for (const img of images ?? []) {
    parts.push({ type: "image_url", image_url: { url: `data:${img.media_type};base64,${img.data}` } })
  }
  if (cachedUserPrefix) {
    parts.push({ type: "text", text: cachedUserPrefix, cache_control: { type: "ephemeral" } })
  }
  parts.push({ type: "text", text: userMessage })
  return { role: "user", content: parts }
}

/** The name the structured-output tool/schema is registered under. */
export const STRUCTURED_OUTPUT_NAME = "structured_output"

/**
 * Forced tool choice, OpenAI-shaped.
 *
 * Anthropic spells this `{type:"tool", name}`; OpenAI nests the name under
 * `function`. Sending Anthropic's spelling to OpenRouter is not an error it
 * reports — the field is simply not recognised as forcing anything, so the
 * model is free to answer in prose and the Zod parse fails downstream with a
 * message about the CONTENT rather than the request.
 */
export function buildToolChoice(): { type: "function"; function: { name: string } } {
  return { type: "function", function: { name: STRUCTURED_OUTPUT_NAME } }
}

export function buildTools(schema: Record<string, unknown>) {
  return [
    {
      type: "function" as const,
      function: {
        name: STRUCTURED_OUTPUT_NAME,
        description: "Output the structured result matching the required schema",
        parameters: schema,
      },
    },
  ]
}

/**
 * `response_format` for the models that refuse forced tool choice.
 *
 * `strict` is deliberately FALSE. Strict mode requires every object to set
 * `additionalProperties:false` and to list every property as required, which
 * the Zod-generated schemas here do not do. Turning it on would reject the
 * request outright; leaving it off still constrains the model and Zod still
 * validates the result afterwards.
 */
export function buildResponseFormat(schema: Record<string, unknown>) {
  return {
    type: "json_schema" as const,
    json_schema: { name: STRUCTURED_OUTPUT_NAME, strict: false, schema },
  }
}

export interface OpenRouterUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null
}

export interface NormalizedUsage {
  tokens_used: number
  cache_creation_tokens: number
  cache_read_tokens: number
}

/**
 * OpenRouter's usage block in the shape the rest of the codebase already logs.
 *
 * Anthropic reports `cache_creation_input_tokens` / `cache_read_input_tokens`
 * as SEPARATE counters alongside `input_tokens`. OpenRouter reports cache
 * numbers nested under `prompt_tokens_details`, and `prompt_tokens` ALREADY
 * INCLUDES them — so these are read, not added, or every cached call would
 * double-count its prompt.
 */
export function normalizeUsage(usage: OpenRouterUsage | null | undefined): NormalizedUsage {
  const prompt = usage?.prompt_tokens ?? 0
  const completion = usage?.completion_tokens ?? 0
  return {
    tokens_used: prompt + completion,
    cache_creation_tokens: usage?.prompt_tokens_details?.cache_write_tokens ?? 0,
    cache_read_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

/**
 * The full request body for one structured-output call.
 *
 * `useResponseFormat` picks between the two strategies, mirroring the split
 * that already exists for models which reject forced tool choice.
 */
export function buildChatRequest(args: {
  modelId: string
  systemPrompt: string
  userMessage: string
  schema: Record<string, unknown> | null
  maxTokens: number
  cacheSystemPrompt?: boolean
  cachedUserPrefix?: string
  images?: MediaPart[]
  documents?: MediaPart[]
  effort?: "low" | "medium" | "high" | "max"
  useResponseFormat?: boolean
}): Record<string, unknown> {
  const messages: ChatMessage[] = [
    buildSystemMessage(args.systemPrompt, args.cacheSystemPrompt),
    buildUserMessage(args.userMessage, args.cachedUserPrefix, args.images, args.documents),
  ]

  const body: Record<string, unknown> = {
    model: toOpenRouterModel(args.modelId),
    max_tokens: args.maxTokens,
    messages,
  }

  if (args.schema) {
    if (args.useResponseFormat) {
      body.response_format = buildResponseFormat(args.schema)
    } else {
      body.tools = buildTools(args.schema)
      body.tool_choice = buildToolChoice()
    }
  }

  if (args.effort) {
    body.reasoning = { effort: toReasoningEffort(args.effort) }
  }

  return body
}
