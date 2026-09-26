import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod"
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"
import { JSONRepairError } from "jsonrepair"

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

// Only the CLIENT is faked. The error classes stay the SDK's own, so a test that
// throws `new Anthropic.APIUserAbortError()` throws exactly what a real aborted
// request throws — a class whose `.name` is plain "Error". This suite used to
// fake aborts as `{ name: "APIUserAbortError" }`, which no real SDK error ever
// carries, and stayed green while every real abort went unrecognised.
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@anthropic-ai/sdk")>()
  const Anthropic = Object.assign(
    vi.fn().mockImplementation(() => ({ messages: { stream: h.anthropicStream } })),
    {
      APIError: real.APIError,
      APIUserAbortError: real.APIUserAbortError,
      APIConnectionError: real.APIConnectionError,
      APIConnectionTimeoutError: real.APIConnectionTimeoutError,
    },
  )
  return { ...real, default: Anthropic, Anthropic }
})

vi.mock("../openrouter-agent.js", () => ({
  callAgentViaOpenRouter: h.orAgent,
}))

import { callAgent, MODEL_FABLE, MODEL_HAIKU, MODEL_SONNET, MODEL_GPT6_ASTRA } from "../anthropic.js"
import { ProviderFallbackError } from "../openrouter.js"
import { isAbortError } from "../../lib/deadline.js"

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

/** The options callAgentViaOpenRouter received on call `i` (its 7th argument). */
const orOptions = (i: number) => h.orAgent.mock.calls[i][6] as { effort?: string; signal?: AbortSignal }

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

  it("ends a persistent gpt-6-astra 503 as astra's own 503 — never Anthropic, never Haiku", async () => {
    // The architect and selector call astra with effort "medium". The Haiku
    // last resort used to take that call over, options and all: either Haiku
    // quietly wrote the training program, or the effort it inherited (sent as
    // `reasoning` next to a forced tool choice) 400'd and that 400 replaced the
    // 503 that says what actually happened.
    const outage = httpError(503, "503 Service Unavailable")
    h.orAgent.mockRejectedValue(outage)

    const { error } = await settle(callAgent("sys", "user", schema, { model: MODEL_GPT6_ASTRA, effort: "medium" }))

    expect(error).toBe(outage)
    expect(orModels()).toEqual(Array(5).fill(MODEL_GPT6_ASTRA))
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("still falls back to Haiku when a CLAUDE primary exhausts its retries on a 503", async () => {
    // Presence control for the test above: the last resort is narrowed to
    // Claude primaries, not removed.
    h.orAgent.mockImplementation(async (model: string) => {
      if (model === MODEL_SONNET) throw httpError(503, "503 Service Unavailable")
      return OPENROUTER_OK
    })
    h.anthropicStream.mockImplementation(() => anthropicFails(creditError()))

    const { value, error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBeUndefined()
    expect(value?.content).toEqual({ ok: true })
    expect(orModels()).toEqual([...Array(5).fill(MODEL_SONNET), MODEL_HAIKU])
  })

  it("does not hand the primary's effort to the Haiku fallback", async () => {
    // The blog draft runs on Fable with effort "medium". Through OpenRouter,
    // effort goes out as `reasoning` on every branch, including the forced
    // tool choice Haiku is asked with — a combination Anthropic refuses.
    h.orAgent.mockImplementation(async (model: string) => {
      if (model === MODEL_FABLE) throw httpError(503, "503 Service Unavailable")
      return OPENROUTER_OK
    })
    h.anthropicStream.mockImplementation(() => anthropicFails(creditError()))

    const { value, error } = await settle(callAgent("sys", "user", schema, { model: MODEL_FABLE, effort: "medium" }))

    expect(error).toBeUndefined()
    expect(value?.content).toEqual({ ok: true })
    expect(orModels()).toEqual([...Array(5).fill(MODEL_FABLE), MODEL_HAIKU])
    // Which value, not just presence: the primary still ran with its effort.
    expect(orOptions(0).effort).toBe("medium")
    expect(orOptions(5).effort).toBeUndefined()
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
    // What the openai SDK really throws when the signal fires mid-request.
    const aborted = new OpenAI.APIUserAbortError()
    expect(aborted.name).toBe("Error")
    h.orAgent.mockRejectedValue(aborted)

    const { error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBe(aborted)
    expect(h.orAgent).toHaveBeenCalledTimes(1)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("surfaces an abort DURING the fallback as the abort itself, so nothing retries past the deadline", async () => {
    // The Anthropic SDK's real class: `.name` is "Error", so only a class check
    // recognises it. Unrecognised, it was wrapped with OpenRouter's 503 and retried.
    const aborted = new Anthropic.APIUserAbortError()
    expect(aborted.name).toBe("Error")
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
    h.orAgent.mockRejectedValue(new OpenAI.APIConnectionError({ message: "Connection error." }))
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

describe("callAgent: the caller's deadline reaches the backoff sleep", () => {
  it("ends the call the moment the signal fires mid-backoff, with no further attempt and no Haiku", async () => {
    // pRetry sleeps 5s, 10s, 20s, 30s between attempts. Without the caller's
    // signal it slept through the deadline, then started one more attempt past
    // the budget before that attempt noticed the abort.
    const deadline = new AbortController()
    h.orAgent.mockImplementation(async (...args: unknown[]) => {
      // What the openai SDK does with a signal that has already fired.
      if ((args[6] as { signal?: AbortSignal }).signal?.aborted) throw new OpenAI.APIUserAbortError()
      throw httpError(503, "503 Service Unavailable")
    })
    h.anthropicStream.mockImplementation(() => anthropicFails(creditError()))

    let outcome: { error?: unknown } | undefined
    void callAgent("sys", "user", schema, { signal: deadline.signal }).then(
      () => (outcome = {}),
      (error: unknown) => (outcome = { error }),
    )

    // Attempt 1 (OpenRouter 503, unfunded fallback 400) is done; the first
    // 5-second backoff is running.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.orAgent).toHaveBeenCalledTimes(1)
    expect(outcome).toBeUndefined()

    deadline.abort()
    await vi.advanceTimersByTimeAsync(1)

    expect(outcome).toBeDefined()
    expect(outcome?.error).toBe(deadline.signal.reason)
    expect(isAbortError(outcome?.error)).toBe(true)

    // Let every timer that could still be pending run out: nothing else starts.
    await vi.runAllTimersAsync()
    expect(orModels()).toEqual([MODEL_SONNET])
    expect(h.anthropicStream).toHaveBeenCalledTimes(1)
  })
})

describe("callAgent: a malformed answer is retried as a malformed answer, never as an outage", () => {
  // The message fallback in isTransientError used to match SUBSTRINGS, so the
  // digits inside a validation message decided the retry policy: "at position
  // 1502" read as a 502, "<=500 characters" as a 500. Classified transient, the
  // schema miss then ran the whole Haiku last resort — five more paid calls —
  // for an answer that was simply the wrong shape.

  it("retries a jsonrepair failure 'at position 1502' on the same model and does not send it to Haiku", async () => {
    const unrepairable = new JSONRepairError('Unexpected character "}"', 1502)
    expect(unrepairable.message).toContain("position 1502")
    h.orAgent.mockRejectedValue(unrepairable)

    const { error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBe(unrepairable)
    // Five attempts: retried, deliberately — functions/ retries malformed output.
    expect(orModels()).toEqual(Array(5).fill(MODEL_SONNET))
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("retries a Zod '<=500 characters' miss on the same model and does not send it to Haiku", async () => {
    const tooLong = z
      .object({ excerpt: z.string().max(500) })
      .safeParse({ excerpt: "x".repeat(501) }).error as z.ZodError
    expect(tooLong.message).toContain("<=500")
    h.orAgent.mockRejectedValue(tooLong)

    const { error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBe(tooLong)
    expect(orModels()).toEqual(Array(5).fill(MODEL_SONNET))
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })
})

describe("callAgent: a status-less error is judged by a status-shaped token, not by any digits", () => {
  it("does not read 'hit 1500 max_tokens' as a 500 — a truncation is not retried and not sent to Haiku", async () => {
    // Not malformed output, so the validation screen does not catch it; only
    // the token boundary does. Retrying a truncation truncates again.
    const truncated = new Error(
      "Response truncated (hit 1500 max_tokens). Output is incomplete — increase maxTokens or reduce input size.",
    )
    h.orAgent.mockRejectedValue(truncated)

    const { error } = await settle(callAgent("sys", "user", schema, { maxTokens: 1500 }))

    expect(error).toBe(truncated)
    expect(orModels()).toEqual([MODEL_SONNET])
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("still treats a status-less '502 Bad Gateway' as transient", async () => {
    // Presence control for the tests above: the message fallback was narrowed
    // to a status-shaped token, not switched off.
    h.orAgent.mockImplementation(async (model: string) => {
      if (model === MODEL_SONNET) throw new Error("OpenRouter stream failed mid-response: 502 Bad Gateway")
      return OPENROUTER_OK
    })

    const { value, error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBeUndefined()
    expect(value?.content).toEqual({ ok: true })
    expect(orModels()).toEqual([...Array(5).fill(MODEL_SONNET), MODEL_HAIKU])
  })

  it("still treats a mid-stream Anthropic overloaded_error, which has no status, as transient", async () => {
    // The Anthropic SDK's own construction for an SSE `error` event
    // (core/streaming.js): status undefined, the event's JSON as the message.
    // No digits at all, so the word is the only thing that marks it transient.
    delete process.env.OPENROUTER_API_KEY
    const overloaded = new Anthropic.APIError(
      undefined,
      { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
      undefined,
      undefined,
    )
    expect(overloaded.status).toBeUndefined()
    h.anthropicStream.mockImplementation((body: { model: string }) =>
      body.model === MODEL_SONNET ? anthropicFails(overloaded) : anthropicAnswers(),
    )

    const { value, error } = await settle(callAgent("sys", "user", schema))

    expect(error).toBeUndefined()
    expect(value?.content).toEqual({ ok: false })
    const models = h.anthropicStream.mock.calls.map((c) => (c[0] as { model: string }).model)
    expect(models).toEqual([...Array(5).fill(MODEL_SONNET), MODEL_HAIKU])
  })
})
