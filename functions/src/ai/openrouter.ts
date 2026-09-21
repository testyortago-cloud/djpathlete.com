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

/**
 * Should a failed OpenRouter call be retried against direct Anthropic?
 *
 * ONLY for faults that are about the provider being unreachable, unpaid or
 * overloaded. A 400 means WE built a bad request — the same request would fail
 * identically on Anthropic, so falling back would just double the cost of every
 * bug and hide it behind a working response. An abort is the caller's deadline
 * and must not be retried at all.
 */
export function shouldFallBackToAnthropic(error: unknown): boolean {
  const e = error as { name?: string; status?: number } | null
  if (!e) return false
  if (e.name === "AbortError") return false

  const status = typeof e.status === "number" ? e.status : undefined
  if (status === undefined) return true // network / DNS / socket — provider unreachable
  if (status === 401 || status === 402 || status === 403) return true // key, credit, permission
  if (status === 408 || status === 429) return true // timeout, rate limit
  return status >= 500
}
