import { toJSONSchema, type ZodSchema } from "zod"
import {
  NoObjectGeneratedError,
  parsePartialJson,
  type DeepPartial,
  type FinishReason,
  type LanguageModelResponseMetadata,
  type LanguageModelUsage,
  type ObjectStreamPart,
} from "ai"
import type { ChatCompletionChunk, ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions"
import {
  canFallBackToAnthropic,
  getOpenRouterClient,
  ProviderFallbackError,
  shouldFallBackToAnthropic,
  toOpenRouterModel,
} from "@/lib/ai/openrouter"
import {
  buildSystemMessage,
  buildToolChoice,
  buildTools,
  buildUserMessage,
  normalizeUsage,
  STRUCTURED_OUTPUT_NAME,
  type OpenRouterUsage,
} from "@/lib/ai/openrouter-request"
import { liftStreamStatus } from "@/lib/ai/openrouter-stream"

/**
 * A structured object streamed from OpenRouter, in the shape AI SDK
 * `streamObject` hands its caller.
 *
 * WHY IT EXISTS. `streamAgent` — the AI page builder's only model call — was
 * left on `streamObject` with a direct Anthropic provider when every one-shot
 * call moved to OpenRouter, because `openrouter-message.ts` does not stream.
 * With the Anthropic account unfunded, every builder turn then failed with
 * "Your credit balance is too low".
 *
 * WHY NOT THE AI SDK. The same reason `callAgent`'s OpenRouter branch gives:
 * `@ai-sdk/openai-compatible` ships `@ai-sdk/provider` v4 while `ai@6` is
 * pinned against v3, so its model is not a `LanguageModel` here. This drives
 * the raw OpenAI SDK instead, and reproduces the four things
 * `app/api/admin/funnels/steps/[stepId]/build/route.ts` (`streamOneAttempt`)
 * actually reads — nothing more:
 *
 *   text-delta   one per tool-argument fragment; the route counts them as the
 *                live output meter and never reads the text
 *   object       the partial object, whenever a fragment changed it
 *   finish       usage, with cached tokens READ from the provider, never added
 *   .object      the validated answer, or a NoObjectGeneratedError carrying
 *                `.text` (raw arguments) and `.cause` (the ZodError), which is
 *                what `recoverObjectFromError` digs a double-encoded answer
 *                out of, and `.finishReason`, which the route reads to refuse
 *                recovering anything from a stream that did not finish
 *                normally ("length" above all)
 *
 * FAILURES ARE PARTS, NOT THROWS. A transport or API error becomes one
 * `{type:"error"}` part, the iteration then ends normally, and `.object`
 * rejects with the SAME error — a mid-stream one with OpenRouter's status
 * lifted onto it (`liftStreamStatus`), and never dressed as a
 * NoObjectGeneratedError. That is `streamObject`'s contract, and the
 * route depends on it: it has no `error` branch, because "the same failure
 * comes back out of `await objectPromise`". A stream that threw out of the
 * `for await` instead would skip the route's recovery and its retry entirely.
 *
 * Lib-only, not twinned: nothing in `functions/` streams an object.
 */

export type AgentObjectStreamPart<T> = ObjectStreamPart<DeepPartial<T>>

/**
 * The part of `streamObject`'s result every caller of `streamAgent` uses. Both
 * the OpenRouter stream below and the AI SDK's own result satisfy it, which is
 * what lets `streamAgent` pick a provider without the route knowing.
 */
export interface AgentObjectStream<T> {
  readonly fullStream: AsyncIterable<AgentObjectStreamPart<T>>
  readonly object: Promise<T>
}

/**
 * Zod schema to the plain JSON Schema OpenRouter's tool definition expects.
 * Returns null when the schema is not an object type, which sends a one-shot
 * call down the text-JSON path instead of producing an invalid tool definition.
 *
 * Lives here, not in anthropic.ts, because both OpenRouter paths need it and
 * this module must not import anthropic.ts (which imports this one, and which
 * constructs an Anthropic provider at module scope).
 */
export function toToolSchema(schema: ZodSchema): Record<string, unknown> | null {
  try {
    const raw = toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>
    const { $schema: _s, "~standard": _std, ...rest } = raw
    return rest.type === "object" ? rest : null
  } catch {
    return null
  }
}

/**
 * A single-consumer queue the producer pushes into and `fullStream` drains.
 *
 * The producer runs EAGERLY, not when the consumer first pulls, so `.object`
 * settles even for a caller that awaits it without iterating — the order the
 * route's comment warns about. Parts that arrive faster than the consumer
 * reads them wait here; a whole page is a few thousand small parts.
 */
function createPartQueue<P>() {
  const buffer: P[] = []
  let head = 0
  let ended = false
  let wake: (() => void) | null = null

  const notify = () => {
    const resolve = wake
    wake = null
    resolve?.()
  }

  async function* drain(): AsyncGenerator<P> {
    while (true) {
      if (head < buffer.length) {
        const part = buffer[head]
        buffer[head] = undefined as P // release it; the buffer only grows
        head += 1
        yield part
        continue
      }
      if (ended) return
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  }

  return {
    push(part: P) {
      buffer.push(part)
      notify()
    },
    end() {
      ended = true
      notify()
    },
    iterable: { [Symbol.asyncIterator]: drain } as AsyncIterable<P>,
  }
}

export interface StreamObjectViaOpenRouterArgs<T> {
  modelId: string
  systemPrompt: string
  userMessage: string
  schema: ZodSchema<T>
  maxTokens: number
  cacheSystemPrompt?: boolean
  images?: readonly { mediaType: string; data: string }[]
}

/**
 * The request, built the way the one-shot structured call builds it so the two
 * paths cannot drift: forced tool choice (`buildToolChoice`), the schema as the
 * tool's parameters, the cache breakpoint on the system prompt, the image in
 * the user turn.
 *
 * Deliberately NOT sent: `temperature` / `top_p` (Opus 5 rejects them) and any
 * `reasoning` key (the Anthropic path never set one, and turning thinking off
 * changes the answers the builder was tuned against).
 */
function buildStreamRequest<T>(args: StreamObjectViaOpenRouterArgs<T>): ChatCompletionCreateParamsStreaming {
  const toolSchema = toToolSchema(args.schema)
  if (!toolSchema) {
    // Our bug, not the provider's: status-less, so it never triggers the
    // Anthropic fallback.
    throw new Error("streamObjectViaOpenRouter needs a Zod object schema; the tool parameters must be an object.")
  }
  const body = {
    model: toOpenRouterModel(args.modelId),
    max_tokens: args.maxTokens,
    messages: [
      buildSystemMessage(args.systemPrompt, args.cacheSystemPrompt),
      buildUserMessage(
        args.userMessage,
        undefined,
        args.images?.map((image) => ({ media_type: image.mediaType, data: image.data })),
      ),
    ],
    tools: buildTools(toolSchema),
    tool_choice: buildToolChoice(),
    stream: true as const,
    stream_options: { include_usage: true },
  }
  // `cache_control` on a content part is an OpenRouter extension the OpenAI
  // types do not know about.
  return body as unknown as ChatCompletionCreateParamsStreaming
}

type StreamUsage = OpenRouterUsage & { completion_tokens_details?: { reasoning_tokens?: number } | null }

/**
 * OpenRouter's usage in the AI SDK's shape. `prompt_tokens` ALREADY INCLUDES
 * the cached reads and writes (see `normalizeUsage`), so `inputTokens` is that
 * number unchanged — the route adds input and output for the spend log, and
 * adding the cache counters here as well would double-count every cached turn.
 *
 * Absent usage stays undefined rather than becoming 0: the route falls back to
 * its own delta count for the meter only when the provider sent nothing.
 */
function toLanguageModelUsage(raw: StreamUsage | null | undefined): LanguageModelUsage {
  if (!raw) {
    return {
      inputTokens: undefined,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokens: undefined,
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      totalTokens: undefined,
    }
  }
  const normalized = normalizeUsage(raw)
  const input = raw.prompt_tokens
  const output = raw.completion_tokens
  const reasoning = raw.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: input,
    inputTokenDetails: {
      noCacheTokens:
        input === undefined
          ? undefined
          : Math.max(0, input - normalized.cache_read_tokens - normalized.cache_creation_tokens),
      cacheReadTokens: normalized.cache_read_tokens,
      cacheWriteTokens: normalized.cache_creation_tokens,
    },
    outputTokens: output,
    outputTokenDetails: {
      textTokens: output === undefined ? undefined : Math.max(0, output - (reasoning ?? 0)),
      reasoningTokens: reasoning,
    },
    totalTokens: normalized.tokens_used,
  }
}

function toFinishReason(raw: string | null | undefined): FinishReason {
  switch (raw) {
    case "stop":
      return "stop"
    case "length":
      return "length"
    case "tool_calls":
    case "function_call":
      return "tool-calls"
    case "content_filter":
      return "content-filter"
    case "error":
      return "error"
    default:
      return "other"
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Runs the request, pushes parts through `emit`, and resolves to the validated
 * object. Every transport failure is emitted as an error part BEFORE it is
 * rethrown, so the caller's `.object` and the stream agree on what went wrong.
 */
async function produce<T>(
  args: StreamObjectViaOpenRouterArgs<T>,
  emit: (part: AgentObjectStreamPart<T>) => void,
): Promise<T> {
  let stream: AsyncIterable<ChatCompletionChunk>
  let slug: string
  try {
    const body = buildStreamRequest(args)
    slug = body.model
    stream = await getOpenRouterClient().chat.completions.create(body)
  } catch (error) {
    emit({ type: "error", error })
    throw error
  }

  let responseId: string | undefined
  let responseModel: string | undefined
  let rawUsage: StreamUsage | null | undefined
  let rawFinish: string | null | undefined
  let content = ""
  let refusal = ""
  // The index of the structured_output call. Forced tool choice makes it the
  // only one; anything else the model streams is ignored, not concatenated.
  let toolIndex: number | undefined
  let argsText = ""
  let lastObjectJson: string | undefined

  try {
    for await (const chunk of stream) {
      if (chunk.id) responseId = chunk.id
      if (chunk.model) responseModel = chunk.model
      if (chunk.usage) rawUsage = chunk.usage as StreamUsage

      const choice = chunk.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) rawFinish = choice.finish_reason

      const delta = choice.delta
      if (typeof delta?.content === "string") content += delta.content
      if (typeof delta?.refusal === "string") refusal += delta.refusal

      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0
        if (toolIndex === undefined && call.function?.name === STRUCTURED_OUTPUT_NAME) toolIndex = index
        if (index !== toolIndex) continue
        const fragment = call.function?.arguments
        if (!fragment) continue

        argsText += fragment
        emit({ type: "text-delta", textDelta: fragment })

        // Same move `streamObject` makes: re-parse the whole prefix, and emit
        // only when the repaired value actually changed. A whitespace or
        // half-token delta leaves it identical, and a duplicate here becomes a
        // duplicate section event on the owner's screen.
        const { value } = await parsePartialJson(argsText)
        if (isPlainObject(value)) {
          const serialized = JSON.stringify(value)
          if (serialized !== lastObjectJson) {
            lastObjectJson = serialized
            emit({ type: "object", object: value as DeepPartial<T> })
          }
        }
      }
    }
  } catch (error) {
    // A fault mid-stream is the openai SDK's own `APIError(undefined,
    // data.error)`: status undefined, OpenRouter's number only in `.code`, and
    // `.name` plain "Error". Unlifted, `shouldFallBackToAnthropic` read a 502
    // as a status-less bug of our own and would not switch even when it was
    // the very first part (the whole-branch review, 2026-09-26). Lifted, it is
    // the provider fault it is, and the message the route logs and feeds its
    // retry names OpenRouter and the model. It stays a transport error, never
    // a NoObjectGeneratedError: the route rescues only the latter, because
    // this stream's last partial is then a prefix of an unfinished answer.
    const lifted = liftStreamStatus(error, slug)
    emit({ type: "error", error: lifted })
    throw lifted
  }

  const usage = toLanguageModelUsage(rawUsage)
  const finishReason = toFinishReason(rawFinish)
  const response: LanguageModelResponseMetadata = {
    id: responseId ?? "",
    timestamp: new Date(),
    modelId: responseModel ?? slug,
  }
  emit({ type: "finish", finishReason, usage, response })

  const failure = { response, usage, finishReason }

  if (toolIndex === undefined) {
    // A refusal, a prose answer, or a response cut off before the call began.
    // All three are "the model did not answer in the required shape", which
    // the route treats like a schema failure and retries with the reason.
    const said = refusal || content
    throw new NoObjectGeneratedError({
      message:
        `No object generated: the model did not call ${STRUCTURED_OUTPUT_NAME} ` +
        `(finish_reason: ${rawFinish ?? "none"}${refusal ? ", refused" : ""}).`,
      text: said || undefined,
      ...failure,
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(argsText)
  } catch (error) {
    throw new NoObjectGeneratedError({
      message:
        rawFinish === "length"
          ? `No object generated: the response was truncated at ${args.maxTokens} max_tokens, so its JSON is incomplete.`
          : "No object generated: could not parse the response.",
      cause: error instanceof Error ? error : undefined,
      text: argsText,
      ...failure,
    })
  }

  const result = args.schema.safeParse(parsed)
  if (!result.success) {
    throw new NoObjectGeneratedError({
      message: "No object generated: response did not match schema.",
      cause: result.error,
      text: argsText,
      ...failure,
    })
  }
  return result.data
}

/**
 * One structured object, streamed from OpenRouter with forced tool choice.
 *
 * Synchronous, like `streamObject`: the request starts now, and the handle is
 * returned before any byte arrives. NO RETRY and NO FALLBACK in here — see
 * `streamAgent` for why a stream cannot be retried transparently, and
 * `streamWithAnthropicFallback` below for the one moment it can switch.
 */
export function streamObjectViaOpenRouter<T>(args: StreamObjectViaOpenRouterArgs<T>): AgentObjectStream<T> {
  const queue = createPartQueue<AgentObjectStreamPart<T>>()
  const object = produce(args, (part) => queue.push(part)).finally(() => queue.end())
  // A rejection with no handler yet attached is reported as unhandled even
  // when the caller goes on to await it. This handler only claims it; every
  // other awaiter of `object` still sees the rejection.
  object.catch(() => {})
  return { fullStream: queue.iterable, object }
}

/**
 * OpenRouter first, direct Anthropic only if OpenRouter failed BEFORE the
 * consumer saw anything.
 *
 * THE ONLY SAFE MOMENT TO SWITCH is before the first part. After it, the route
 * has already drawn sections and counted deltas; a second provider would
 * replay them, and there is no "unsay" event. So the switch happens when — and
 * only when — the primary's FIRST part is an error that
 * `shouldFallBackToAnthropic` accepts, for a model Anthropic can serve.
 *
 * WHY THE FALLBACK'S ERROR PART IS TRUSTED OVER ITS `.object`. Measured in
 * `node_modules/ai` (DefaultStreamObjectResult): `streamObject` settles
 * `.object` only in its `finish` handler, so a request that is refused outright
 * — the unfunded account's 400 — emits one error part and leaves `.object`
 * pending FOREVER. Awaiting it would hang the builder until the function
 * timed out, so an error part ends the fallback here and becomes a
 * `ProviderFallbackError` that leads with OpenRouter's fault: "credit balance
 * too low" is the footnote, not the story.
 *
 * A schema failure from the fallback is NOT wrapped. It is a NoObjectGeneratedError
 * whose `.text` the route recovers double-encoded answers from; wrapping it
 * would hide that text behind `.cause`.
 */
export function streamWithAnthropicFallback<T>(args: {
  modelId: string
  primary: AgentObjectStream<T>
  fallback: () => AgentObjectStream<T>
}): AgentObjectStream<T> {
  const queue = createPartQueue<AgentObjectStreamPart<T>>()

  /**
   * Forwards parts and returns HOW to settle `.object` — as a thunk, not a
   * promise, so a provider's own `.object` rejection (a forwarded 400, a
   * schema failure) is passed through untouched instead of landing in the
   * catch below and being emitted a second time as an error part.
   */
  async function route(): Promise<() => Promise<T>> {
    const { primary } = args
    primary.object.catch(() => {})

    let openRouterError: unknown
    let switching = false
    let emitted = false
    for await (const part of primary.fullStream) {
      if (
        !emitted &&
        part.type === "error" &&
        shouldFallBackToAnthropic(part.error) &&
        canFallBackToAnthropic(args.modelId)
      ) {
        openRouterError = part.error
        switching = true
        break
      }
      emitted = true
      queue.push(part)
    }
    if (!switching) return () => primary.object

    console.warn(
      `[streamAgent] OpenRouter unavailable (${
        openRouterError instanceof Error ? openRouterError.message.slice(0, 160) : String(openRouterError)
      }) — falling back to direct Anthropic for this turn (model: ${args.modelId})`,
    )

    const fail = (anthropicError: unknown) => {
      const wrapped = new ProviderFallbackError(openRouterError, anthropicError)
      queue.push({ type: "error", error: wrapped })
      return () => {
        throw wrapped
      }
    }

    let fallback: AgentObjectStream<T>
    try {
      fallback = args.fallback()
    } catch (anthropicError) {
      return fail(anthropicError)
    }
    fallback.object.catch(() => {})

    try {
      for await (const part of fallback.fullStream) {
        if (part.type === "error") return fail(part.error)
        queue.push(part)
      }
    } catch (anthropicError) {
      // The AI SDK documents that its fullStream may THROW on a stream-ending
      // error rather than emit it. Same failure, same wrapping.
      return fail(anthropicError)
    }
    return () => fallback.object
  }

  const object = route()
    .then(
      (settle) => settle,
      (error: unknown) => {
        // Only an iterator that threw instead of emitting reaches here.
        // Surface it the way every other failure is surfaced.
        queue.push({ type: "error", error })
        return (): Promise<T> => {
          throw error
        }
      },
    )
    .finally(() => queue.end())
    .then((settle) => settle())
  object.catch(() => {})
  return { fullStream: queue.iterable, object }
}
