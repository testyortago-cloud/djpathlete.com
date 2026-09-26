// GENERATED TWIN of lib/ai/openrouter-agent.ts — functions/ has rootDir "src" and cannot import
// from lib/. Regenerate with scripts/gen-openrouter-twins.py rather than
// editing by hand; the two must not drift.
import { jsonrepair } from "jsonrepair"
import type { ZodSchema } from "zod"
import { getOpenRouterClient } from "./openrouter.js"
import { buildChatRequest, normalizeUsage, STRUCTURED_OUTPUT_NAME, type MediaPart } from "./openrouter-request.js"

/**
 * One structured-output call against OpenRouter.
 *
 * Deliberately imports NOTHING from ai/anthropic.ts: the schema converter and
 * the enum normalizer are passed in. That keeps the dependency acyclic (the
 * dispatcher lives in anthropic.ts and calls this), and it keeps this file
 * testable without dragging the Anthropic SDK in.
 *
 * No retry loop here either — each caller already wraps this in pRetry with
 * retry semantics that took real incidents to get right, and they differ on
 * purpose: both never retry an abort; the functions/ callAgent DOES retry a
 * malformed-JSON or Zod failure, while the lib/ callAgent does NOT (a schema
 * miss on a request path would cost up to three paid calls). Adding a second
 * loop inside would multiply the attempts rather than replace them.
 *
 * Twin: functions/src/ai/openrouter-agent.ts.
 */

export interface OpenRouterAgentResult<T> {
  content: T
  tokens_used: number
  cache_creation_tokens: number
  cache_read_tokens: number
}

export interface OpenRouterAgentOptions {
  maxTokens: number
  cacheSystemPrompt?: boolean
  cachedUserPrefix?: string
  images?: MediaPart[]
  documents?: MediaPart[]
  effort?: "low" | "medium" | "high" | "max"
  signal?: AbortSignal
  /** Use response_format instead of forced tool choice (models that refuse it). */
  useResponseFormat?: boolean
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return JSON.parse(jsonrepair(raw))
  }
}

export async function callAgentViaOpenRouter<T>(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  schema: ZodSchema<T>,
  toolSchema: Record<string, unknown> | null,
  normalizeEnums: (data: unknown) => unknown,
  options: OpenRouterAgentOptions,
): Promise<OpenRouterAgentResult<T>> {
  const client = getOpenRouterClient()

  const body = buildChatRequest({
    modelId,
    systemPrompt,
    userMessage,
    schema: toolSchema,
    maxTokens: options.maxTokens,
    cacheSystemPrompt: options.cacheSystemPrompt,
    cachedUserPrefix: options.cachedUserPrefix,
    images: options.images,
    documents: options.documents,
    effort: options.effort,
    useResponseFormat: options.useResponseFormat,
  })

  // Streamed for the same reason the Anthropic path is: a long generation on a
  // non-streaming connection can be cut by an intermediary well before the
  // model is done, and with a 25-minute budget that is not hypothetical.
  const stream = client.chat.completions.stream(body as Parameters<typeof client.chat.completions.stream>[0], {
    signal: options.signal,
  })
  const completion = await stream.finalChatCompletion()

  const choice = completion.choices?.[0]
  if (!choice) throw new Error(`No choices in OpenRouter response (model: ${modelId})`)

  // A refusal arrives as a successful HTTP 200 with a refusal field, exactly as
  // it does on the Anthropic path. Checked BEFORE reading content, because the
  // content of a refused turn is not the answer.
  const refusal = (choice.message as { refusal?: string | null })?.refusal
  if (refusal) {
    throw new Error(`Model declined the request (${modelId}): ${refusal}`)
  }

  if (choice.finish_reason === "length") {
    throw new Error(
      `Response truncated (hit ${options.maxTokens} max_tokens). Output is incomplete — increase maxTokens or reduce input size.`,
    )
  }

  let parsed: unknown
  if (toolSchema && !options.useResponseFormat) {
    const call = choice.message.tool_calls?.find(
      (c) => (c as { function?: { name?: string } }).function?.name === STRUCTURED_OUTPUT_NAME,
    )
    if (!call) {
      // Forcing did not take. Most likely the model answered in prose, which is
      // what happens when tool_choice was not understood — say so, rather than
      // failing later on an unhelpful Zod message about the content.
      throw new Error(
        `No ${STRUCTURED_OUTPUT_NAME} tool call in OpenRouter response (model: ${modelId}, ` +
          `finish_reason: ${choice.finish_reason}).`,
      )
    }
    parsed = parseJson((call as { function: { arguments: string } }).function.arguments)
  } else {
    const text = choice.message.content
    if (!text) throw new Error(`No text content in OpenRouter response (model: ${modelId})`)
    parsed = parseJson(text)
  }

  const usage = normalizeUsage(completion.usage as Parameters<typeof normalizeUsage>[0])
  const validated = schema.parse(normalizeEnums(parsed))

  return {
    content: validated as T,
    tokens_used: usage.tokens_used,
    cache_creation_tokens: usage.cache_creation_tokens,
    cache_read_tokens: usage.cache_read_tokens,
  }
}
