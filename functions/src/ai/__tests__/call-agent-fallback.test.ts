import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod"

/**
 * callAgent's OpenRouter-first policy, decided PER ATTEMPT.
 *
 * It used to be decided once per call: the first fallback-class OpenRouter
 * error set `useOpenRouter = false` for every remaining attempt. With the
 * Anthropic account unfunded, one retryable OpenRouter 429 therefore became a
 * certain failure that read "Your credit balance is too low" — the retries
 * never went back to the provider that could actually answer.
 */

const h = vi.hoisted(() => ({
  anthropicStream: vi.fn(),
  orAgent: vi.fn(),
}))

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: { stream: h.anthropicStream },
  })) as unknown as { new (): unknown } & { APIError: typeof APIError }
  ;(Anthropic as unknown as { APIError: typeof APIError }).APIError = APIError
  return { default: Anthropic, Anthropic }
})

vi.mock("../openrouter-agent.js", () => ({
  callAgentViaOpenRouter: h.orAgent,
}))

import { callAgent, MODEL_HAIKU, MODEL_SONNET, MODEL_GPT6_ASTRA } from "../anthropic.js"
import { ProviderFallbackError } from "../openrouter.js"

const ORIGINAL_KEY = process.env.OPENROUTER_API_KEY

beforeEach(() => {
  vi.useFakeTimers()
  h.anthropicStream.mockReset()
  h.orAgent.mockReset()
  process.env.OPENROUTER_API_KEY = "sk-or-test"
})

afterEach(() => {
  vi.useRealTimers()
  if (ORIGINAL_KEY === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = ORIGINAL_KEY
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

const schema = z.object({ ok: z.boolean() })

const OPENROUTER_OK = { content: { ok: true }, tokens_used: 42, cache_creation_tokens: 0, cache_read_tokens: 0 }

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

const creditError = () =>
  httpError(
    400,
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
  )

/** What client.messages.stream(...) returns, reduced to the one method callAgent reads. */
function anthropicFails(error: unknown) {
  return { finalMessage: () => Promise.reject(error) }
}

function anthropicAnswers() {
  return {
    finalMessage: async () => ({
      content: [{ type: "tool_use", input: { ok: false } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 5 },
    }),
  }
}

/** Run a callAgent to completion through pRetry's (fake) backoff timers. */
async function settle<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  const out = p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
  await vi.runAllTimersAsync()
  return out
}

const orModels = () => h.orAgent.mock.calls.map((c) => c[0] as string)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("callAgent: OpenRouter first, on every attempt", () => {
  it("retries an OpenRouter 429 ON OPENROUTER after the unfunded fallback fails", async () => {
    h.orAgent.mockRejectedValueOnce(httpError(429, "429 Rate limit exceeded")).mockResolvedValueOnce(OPENROUTER_OK)
    h.anthropicStream.mockImplementation(() => anthropicFails(creditError()))

    const { value, error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBeUndefined()
    expect(value?.content).toEqual({ ok: true })
    // Attempt 1: OpenRouter 429 -> Anthropic 400. Attempt 2: OpenRouter again.
    expect(h.orAgent).toHaveBeenCalledTimes(2)
    expect(h.anthropicStream).toHaveBeenCalledTimes(1)
  })

  it("serves a single attempt from Anthropic when OpenRouter 429s and Anthropic can answer", async () => {
    h.orAgent.mockRejectedValueOnce(httpError(429, "429 Rate limit exceeded"))
    h.anthropicStream.mockImplementation(() => anthropicAnswers())

    const { value, error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBeUndefined()
    expect(value?.content).toEqual({ ok: false })
    expect(h.orAgent).toHaveBeenCalledTimes(1)
    expect(h.anthropicStream).toHaveBeenCalledTimes(1)
  })

  it("still retries a malformed answer from a FUNDED fallback when OpenRouter's fault is not transient", async () => {
    // OpenRouter out of credit (402, not transient) on every attempt; Anthropic
    // funded but answering off-schema once. The old sticky fallback sent attempt
    // 2 to Anthropic and recovered. Judging the wrapper alone reads OpenRouter's
    // non-transient 402 and stops — so the model-output checks must look at the
    // fallback's own error, which is the answer that was actually malformed.
    h.orAgent.mockRejectedValue(httpError(402, "402 Insufficient credits"))
    const offSchema = {
      finalMessage: async () => ({
        content: [{ type: "tool_use", input: { ok: "nope" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    }
    h.anthropicStream.mockImplementationOnce(() => offSchema).mockImplementation(() => anthropicAnswers())

    const { value, error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBeUndefined()
    expect(value?.content).toEqual({ ok: false })
    expect(h.anthropicStream).toHaveBeenCalledTimes(2)
  })

  it("ends with an error that LEADS with OpenRouter when both providers keep failing", async () => {
    h.orAgent.mockRejectedValue(httpError(503, "503 Service Unavailable"))
    h.anthropicStream.mockImplementation(() => anthropicFails(creditError()))

    const { error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBeInstanceOf(ProviderFallbackError)
    const e = error as ProviderFallbackError
    expect(e.message.startsWith("OpenRouter failed: 503 Service Unavailable")).toBe(true)
    expect(e.message).toContain("credit balance is too low")
    // A ProviderFallbackError carrying OpenRouter's 503 is transient: all five
    // Sonnet attempts ran, then callAgent's Haiku last resort ran five more,
    // each one trying OpenRouter first.
    expect(orModels()).toEqual([...Array(5).fill(MODEL_SONNET), ...Array(5).fill(MODEL_HAIKU)])
    expect(h.anthropicStream).toHaveBeenCalledTimes(10)
  })

  it("never sends gpt-6-astra to Anthropic", async () => {
    h.orAgent.mockImplementation(async (model: string) => {
      if (model === MODEL_GPT6_ASTRA) throw httpError(503, "503 Service Unavailable")
      return OPENROUTER_OK
    })

    const { value, error } = await settle(callAgent("sys", "user", schema, { model: MODEL_GPT6_ASTRA }))

    expect(error).toBeUndefined()
    expect(value?.content).toEqual({ ok: true })
    expect(h.anthropicStream).not.toHaveBeenCalled()
    // Five astra attempts on OpenRouter, then the existing Haiku last resort.
    expect(orModels()).toEqual([...Array(5).fill(MODEL_GPT6_ASTRA), MODEL_HAIKU])
  })

  it("does not fall back or retry on an OpenRouter 400", async () => {
    const badRequest = httpError(400, "400 response_format.json_schema: invalid")
    h.orAgent.mockRejectedValue(badRequest)

    const { error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBe(badRequest)
    expect(h.orAgent).toHaveBeenCalledTimes(1)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("does not fall back or retry when OpenRouter was aborted by the caller's deadline", async () => {
    const aborted = Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })
    h.orAgent.mockRejectedValue(aborted)

    const { error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBe(aborted)
    expect(h.orAgent).toHaveBeenCalledTimes(1)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("surfaces an abort DURING the fallback as the abort itself, so nothing retries past the deadline", async () => {
    const aborted = Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })
    h.orAgent.mockRejectedValue(httpError(503, "503 Service Unavailable"))
    h.anthropicStream.mockImplementation(() => anthropicFails(aborted))

    const { error } = await settle(callAgent("sys", "user", schema))

    // Wrapped, it would carry OpenRouter's 503, read as transient, and retry.
    expect(error).toBe(aborted)
    expect(h.orAgent).toHaveBeenCalledTimes(1)
    expect(h.anthropicStream).toHaveBeenCalledTimes(1)
  })

  it("classifies a ProviderFallbackError by OpenRouter's half, not by words in Anthropic's message", async () => {
    // Status-less and not transient by its own message; Anthropic's half says
    // "529 overloaded". The retry goes to OpenRouter, so OpenRouter's fault is
    // the one that decides whether a retry is worth it.
    h.orAgent.mockRejectedValue(Object.assign(new Error("Connection error."), { name: "APIConnectionError" }))
    h.anthropicStream.mockImplementation(() => anthropicFails(httpError(529, "529 overloaded_error")))

    const { error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBeInstanceOf(ProviderFallbackError)
    expect(h.orAgent).toHaveBeenCalledTimes(1)
  })

  it("goes straight to Anthropic when OpenRouter is not configured (unchanged)", async () => {
    delete process.env.OPENROUTER_API_KEY
    h.anthropicStream.mockImplementation(() => anthropicAnswers())

    const { value, error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBeUndefined()
    expect(value?.content).toEqual({ ok: false })
    expect(h.orAgent).not.toHaveBeenCalled()
  })
})
