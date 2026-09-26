// GENERATED TWIN of lib/ai/openrouter.ts — functions/ has rootDir "src" and cannot import
// from lib/. Regenerate with scripts/gen-openrouter-twins.py rather than
// editing by hand; the two must not drift.
import OpenAI from "openai"

/**
 * OpenRouter is the primary provider for every model call. Direct Anthropic
 * remains as an automatic fallback — see `shouldFallBackToAnthropic`.
 *
 * OpenRouter speaks the OpenAI Chat Completions schema and does NOT expose an
 * Anthropic `/v1/messages` endpoint, so this is a genuine shape change, not a
 * base-URL swap. Everything Anthropic-native we rely on has an equivalent, but
 * each one is spelled differently:
 *
 *   forced tool choice   tool_choice:{type:"tool"}  -> {type:"function",function:{name}}
 *   json schema output   output_config.format       -> response_format json_schema
 *   thinking depth       effort                     -> reasoning:{effort}
 *   prompt caching       cache_control on blocks    -> same, passed through
 *   cache accounting     cache_creation_input_tokens-> usage.prompt_tokens_details
 *
 * This file is the ONLY place any of that is decided. There is a twin at
 * functions/src/ai/openrouter.ts because `functions/` has rootDir "src" and
 * cannot import from `lib/`. Change one, change both.
 */

/**
 * MEASURED 2026-09-21 against a live key, not assumed:
 *
 *   sonnet-4.6  forced tool_choice   PASS  3.8s
 *   haiku-4.5   forced tool_choice   PASS  2.9s
 *   opus-4.6    forced tool_choice   PASS  3.9s
 *   fable-5.1   response_format      PASS  5.9s
 *   fable-5.1   forced tool_choice   FAIL  400 "Provider returned error"
 *
 * Fable STILL refuses forced tool choice through OpenRouter — the normalization
 * does not paper over it, it just relays the provider's 400. So the per-model
 * split in `modelRejectsForcedToolChoice` remains load-bearing here, and is not
 * an Anthropic-only quirk to be tidied away: delete it and every architect and
 * selector call 400s, because both of those run on Fable.
 *
 * That 400 deliberately does NOT trigger the Anthropic fallback (see
 * shouldFallBackToAnthropic) — it is a malformed request on our side, and it is
 * unreachable in practice precisely because the split routes Fable correctly.
 */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

/**
 * Anthropic's own model ids to OpenRouter slugs.
 *
 * Two naming differences, both easy to get wrong: OpenRouter uses DOTS where
 * Anthropic uses dashes for the version, and it drops Anthropic's dated
 * suffixes (`claude-haiku-4-5-20251001` is `anthropic/claude-haiku-4.5`).
 *
 * Verified against https://openrouter.ai/api/v1/models on 2026-09-21 — every id
 * below was present. A model missing from OpenRouter would 404 at request time,
 * so `toOpenRouterModel` refuses unknown ids loudly instead of guessing a slug.
 */
export const OPENROUTER_MODEL_MAP: Record<string, string> = {
  "claude-opus-4-6": "anthropic/claude-opus-4.6",
  "claude-opus-4-8": "anthropic/claude-opus-4.8",
  "claude-opus-5": "anthropic/claude-opus-5",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
  "claude-sonnet-5": "anthropic/claude-sonnet-5",
  "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
  "claude-fable-5-1": "anthropic/claude-fable-5.1",
  // Non-Anthropic entries are legitimate now that OpenRouter is the provider —
  // the KEY is just the id this codebase passes around, it does not have to be
  // an Anthropic one. Added for the 2026-09-21 program-generation A/B.
  "gpt-6-astra": "openai/gpt-6-astra",
  "gpt-6-astra-pro": "openai/gpt-6-astra-pro",
}

/**
 * Translate a native Anthropic model id for OpenRouter.
 *
 * Throws rather than passing the id through unchanged. A silent passthrough
 * would send "claude-sonnet-4-6" to OpenRouter, get a 404 that reads like an
 * outage, and then — because the fallback treats provider errors as
 * transient — quietly serve every one of those calls from direct Anthropic.
 * The migration would look complete while nothing had actually moved.
 */
export function toOpenRouterModel(modelId: string): string {
  const slug = OPENROUTER_MODEL_MAP[modelId]
  if (!slug) {
    throw new Error(
      `No OpenRouter slug for model "${modelId}". Add it to OPENROUTER_MODEL_MAP ` +
        `(check https://openrouter.ai/api/v1/models for the exact id).`,
    )
  }
  return slug
}

/** True when an OpenRouter key is present. */
export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

let _client: OpenAI | null = null

export function getOpenRouterClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        // Optional attribution headers OpenRouter uses for its dashboard.
        // Harmless if unset.
        ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
        ...(process.env.OPENROUTER_APP_NAME ? { "X-Title": process.env.OPENROUTER_APP_NAME } : {}),
      },
    })
  }
  return _client
}

/** Test seam — the client caches the key, which a test may change between cases. */
export function resetOpenRouterClient(): void {
  _client = null
}

/**
 * Anthropic's `effort` scale mapped onto OpenRouter's `reasoning.effort`.
 * OpenRouter accepts low | medium | high, so Anthropic's "max" collapses to
 * "high" — the nearest thing it has, and it is better to run slightly shallower
 * than to have the whole request rejected for an unknown enum value.
 */
export function toReasoningEffort(effort: "low" | "medium" | "high" | "max"): "low" | "medium" | "high" {
  return effort === "max" ? "high" : effort
}

/** Node/undici socket-level failures that mean "could not reach the provider". */
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
])

/**
 * How far down `.cause` to look for a socket errno. The SDK's own shape is two
 * levels deep — APIConnectionError, then undici's TypeError("fetch failed"),
 * then the socket error that carries `.code` — and a caller wrapping it once
 * more makes three. The bound is also what stops a cyclic chain from hanging
 * the classifier inside a catch block.
 */
const MAX_CAUSE_DEPTH = 4

type ErrorShape = { name?: unknown; status?: unknown; code?: unknown; cause?: unknown }

/**
 * `instanceof` that tolerates a stubbed SDK: a suite that mocks the module
 * leaves these statics undefined, and `x instanceof undefined` THROWS — from
 * inside the catch block that was classifying the real failure.
 */
function isInstance(error: object, cls: unknown): boolean {
  return typeof cls === "function" && error instanceof cls
}

function className(error: object): unknown {
  return (error as { constructor?: { name?: unknown } }).constructor?.name
}

/**
 * True when the caller aborted: a DOMException-style AbortError, or either
 * SDK's APIUserAbortError.
 *
 * WHY THE CLASS AND NOT `.name`. Neither the openai nor the Anthropic SDK sets
 * `.name` on its error classes, so a real APIUserAbortError reads plain "Error"
 * there. A `.name` check recognised only the fakes the tests used to build.
 * `instanceof` covers the openai copy this file imports even if a minifier
 * renames the class; the constructor name covers the Anthropic SDK's class and
 * any other module copy. The `.name` checks remain for errors that do name
 * themselves (openrouter-stream's callerAbort sets "AbortError").
 */
export function isCallerAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if (isInstance(error, OpenAI.APIUserAbortError)) return true
  const name = (error as ErrorShape).name
  return name === "AbortError" || name === "APIUserAbortError" || className(error) === "APIUserAbortError"
}

const CONNECTION_ERROR_CLASSES = new Set(["APIConnectionError", "APIConnectionTimeoutError"])

/** The SDK's connection classes, by class (see isCallerAbort for why not `.name` alone). */
function isConnectionErrorClass(error: object): boolean {
  // APIConnectionTimeoutError extends APIConnectionError, so one check is both.
  if (isInstance(error, OpenAI.APIConnectionError)) return true
  const cls = className(error)
  const name = (error as ErrorShape).name
  return (
    (typeof cls === "string" && CONNECTION_ERROR_CLASSES.has(cls)) ||
    (typeof name === "string" && CONNECTION_ERROR_CLASSES.has(name))
  )
}

/** A socket-level errno on the error itself or anywhere down its (bounded) cause chain. */
function hasNetworkErrno(error: object): boolean {
  let current: unknown = error
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (!current || typeof current !== "object") return false
    const code = (current as ErrorShape).code
    if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return true
    current = (current as ErrorShape).cause
  }
  return false
}

/**
 * Should a failed OpenRouter call be retried against direct Anthropic?
 *
 * ONLY for faults that are about the provider being unreachable, unpaid or
 * overloaded.
 *
 * A STATUS-LESS ERROR IS NOT AUTOMATICALLY A NETWORK FAULT, and treating it as
 * one is how a migration silently un-migrates itself. The first version of this
 * returned true for anything without a `.status`, which swept up our OWN bugs:
 * a TypeError in the request builder, or the `No OpenRouter slug` throw two
 * functions above, would each be read as "provider unreachable" and every
 * affected call would be quietly served by Anthropic. The system looks healthy,
 * the bill moves to the other provider, and nothing says why. So a status-less
 * error falls back only when it is a connection failure — the SDK's
 * APIConnectionError / APIConnectionTimeoutError, or a socket-level errno on
 * the error or down its cause chain.
 *
 * Those classes are recognised by CLASS, not by `.name`. The SDK never sets
 * `.name` (it reads "Error"), and they carry neither `.status` nor `.code`: the
 * errno, when there is one, sits on `.cause.cause`. The previous version
 * matched `.name` and the top-level `.code` only, so a real unreachable
 * OpenRouter was classified as our own bug and never fell back, while tests
 * that faked `{ name: "APIConnectionError" }` stayed green.
 *
 * A 400 or 404 means WE built a bad request; the same request fails identically
 * on Anthropic, so falling back would double the cost of the bug and hide it
 * behind a working response. An abort is the caller's deadline and is never
 * retried, whatever its cause chain says the socket was doing.
 */
export function shouldFallBackToAnthropic(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if (isCallerAbort(error)) return false

  const e = error as ErrorShape
  const status = typeof e.status === "number" ? e.status : undefined
  if (status === undefined) return hasNetworkErrno(error) || isConnectionErrorClass(error)
  if (status === 401 || status === 402 || status === 403) return true // key, credit, permission
  if (status === 408 || status === 429) return true // timeout, rate limit
  return status >= 500
}

/**
 * Can direct Anthropic serve this model at all?
 *
 * The fallback exists for Claude models only. `gpt-6-astra` (the program
 * architect and exercise selector default) is an OpenAI model that only
 * OpenRouter can reach; sent to Anthropic it answers a 404, and that 404 would
 * then replace the OpenRouter fault the owner actually needed to see.
 */
export function canFallBackToAnthropic(modelId: string): boolean {
  return modelId.startsWith("claude-")
}

function describeProviderError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === "number" ? `status ${status}` : String(error)
}

/**
 * Thrown when OpenRouter failed AND the Anthropic fallback failed too.
 *
 * WHY IT EXISTS. Before this, the fallback's error was the only one that
 * surfaced. With the Anthropic account unfunded, every OpenRouter hiccup — a
 * 429, a 5xx, a missing key — reached the owner as Anthropic's "Your credit
 * balance is too low", which reads exactly like "this feature was never moved
 * to OpenRouter". The primary provider's failure is the story; the fallback's
 * is a footnote, so the message leads with OpenRouter's.
 *
 * `status` is OpenRouter's, not Anthropic's, so retry logic classifies the
 * PRIMARY fault: an OpenRouter 429 stays retryable instead of being ended by
 * Anthropic's 400.
 */
export class ProviderFallbackError extends Error {
  readonly status: number | undefined
  readonly openRouterError: unknown
  readonly anthropicError: unknown

  constructor(openRouterError: unknown, anthropicError: unknown) {
    // One trailing period off OpenRouter's text: its messages usually end in
    // one ("401 User not found."), and the owner reads this in the chat.
    super(
      `OpenRouter failed: ${describeProviderError(openRouterError).replace(/\.$/, "")}. ` +
        `The Anthropic fallback also failed: ${describeProviderError(anthropicError)}`,
      { cause: openRouterError },
    )
    this.name = "ProviderFallbackError"
    const status = (openRouterError as { status?: unknown } | null)?.status
    this.status = typeof status === "number" ? status : undefined
    this.openRouterError = openRouterError
    this.anthropicError = anthropicError
  }
}
