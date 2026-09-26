// Which provider serves a callAgent / streamAgent call, and what happens when
// it fails (2026-09-26).
//
// Three bugs this pins, each of which shipped:
//
//   1. callAgent's retry NEVER RAN. p-retry 7 calls `shouldRetry` with a
//      context object ({error, attemptNumber, retriesLeft}); the code read it
//      as the error itself, so `isTransientError(context)` was false for every
//      failure and a single 429 ended the call.
//   2. One OpenRouter hiccup moved the WHOLE call to direct Anthropic, which
//      has no credit — so a retryable OpenRouter 429 surfaced to the owner as
//      Anthropic's "credit balance is too low", and the retries (had they run)
//      would all have gone to Anthropic too.
//   3. streamAgent — the AI page builder — never used OpenRouter at all.
//
// The clients are faked at the module boundary: `generateObject`/`streamObject`
// stand for direct Anthropic, `callAgentViaOpenRouter`/`getOpenRouterClient`
// for OpenRouter. vitest loads .env.local, so the real OPENROUTER_API_KEY is
// in the environment; every test stubs it explicitly rather than inheriting it.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest"
import { z } from "zod"

const generateObjectMock = vi.fn()
const streamObjectMock = vi.fn()
const callAgentViaOpenRouterMock = vi.fn()
const createMock = vi.fn()

vi.mock("ai", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    streamObject: (...args: unknown[]) => streamObjectMock(...args),
  }
})

vi.mock("@/lib/ai/openrouter-agent", () => ({
  callAgentViaOpenRouter: (...args: unknown[]) => callAgentViaOpenRouterMock(...args),
}))

vi.mock("@/lib/ai/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/openrouter")>()
  return {
    ...actual,
    getOpenRouterClient: () => ({ chat: { completions: { create: createMock } } }),
  }
})

import { callAgent, streamAgent } from "@/lib/ai/anthropic"
import { ProviderFallbackError } from "@/lib/ai/openrouter"

const schema = z.object({ answer: z.string() })

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

const ANTHROPIC_OK = {
  object: { answer: "from anthropic" },
  usage: { inputTokens: 10, outputTokens: 5 },
  providerMetadata: {},
}

const OPENROUTER_OK = {
  content: { answer: "from openrouter" },
  tokens_used: 42,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
}

/**
 * Settles a callAgent promise while p-retry's backoff timers run on the fake
 * clock. Real timers would cost 1s + 2s per exhausted call for no information.
 */
async function settle<T>(promise: Promise<T>) {
  const outcome = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  await vi.runAllTimersAsync()
  return outcome
}

let warn: MockInstance<typeof console.warn>

beforeEach(() => {
  vi.useFakeTimers()
  generateObjectMock.mockReset()
  streamObjectMock.mockReset()
  callAgentViaOpenRouterMock.mockReset()
  createMock.mockReset()
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  warn.mockRestore()
})

describe("callAgent retry (direct Anthropic only — OpenRouter not configured)", () => {
  beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", ""))

  it("actually retries a 429 and returns the second attempt's answer", async () => {
    // The message carries "429" on purpose: the old `isTransientError` would
    // have said yes to THIS error. It was never asked — it was handed p-retry's
    // context object instead. So this fails on the old code for exactly one
    // reason, the shouldRetry signature.
    generateObjectMock
      .mockRejectedValueOnce(statusError(429, "429 rate_limit_error"))
      .mockResolvedValueOnce(ANTHROPIC_OK)

    const outcome = await settle(callAgent("system", "user", schema))

    expect(outcome).toEqual({ ok: true, value: expect.objectContaining({ content: { answer: "from anthropic" } }) })
    expect(generateObjectMock).toHaveBeenCalledTimes(2)
  })

  it("classifies by the numeric status first, so a 503 with no code in its message is retried", async () => {
    generateObjectMock
      .mockRejectedValueOnce(statusError(503, "Service Unavailable"))
      .mockResolvedValueOnce(ANTHROPIC_OK)
    const outcome = await settle(callAgent("system", "user", schema))
    expect(outcome.ok).toBe(true)
    expect(generateObjectMock).toHaveBeenCalledTimes(2)
  })

  it("does not retry a 400 — the same request fails the same way every time", async () => {
    const credit = statusError(400, "400 invalid_request_error: Your credit balance is too low")
    generateObjectMock.mockRejectedValue(credit)
    const outcome = await settle(callAgent("system", "user", schema))
    expect(outcome).toEqual({ ok: false, error: credit })
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })
})

describe("callAgent fallback (OpenRouter configured)", () => {
  beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "or-test-key"))

  it("OpenRouter 429 + Anthropic 400 fails THAT attempt as ProviderFallbackError, and the retry goes back to OpenRouter", async () => {
    callAgentViaOpenRouterMock
      .mockRejectedValueOnce(statusError(429, "429 Rate limit exceeded"))
      .mockResolvedValueOnce(OPENROUTER_OK)
    generateObjectMock.mockRejectedValue(statusError(400, "400 Your credit balance is too low"))

    const outcome = await settle(callAgent("system", "user", schema, { model: "claude-sonnet-4-6" }))

    expect(outcome).toEqual({ ok: true, value: expect.objectContaining({ content: { answer: "from openrouter" } }) })
    expect(callAgentViaOpenRouterMock).toHaveBeenCalledTimes(2)
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
    // The failed attempt was logged with OpenRouter's fault first.
    const logged = warn.mock.calls.map((call) => String(call[0]))
    expect(logged.some((line) => line.includes("OpenRouter failed: 429"))).toBe(true)
  })

  it("when every attempt fails both ways, the error the caller sees LEADS with OpenRouter", async () => {
    callAgentViaOpenRouterMock.mockRejectedValue(statusError(429, "429 Rate limit exceeded"))
    generateObjectMock.mockRejectedValue(statusError(400, "400 Your credit balance is too low"))

    const outcome = await settle(callAgent("system", "user", schema, { model: "claude-sonnet-4-6" }))

    expect(outcome.ok).toBe(false)
    const error = (outcome as { error: unknown }).error
    expect(error).toBeInstanceOf(ProviderFallbackError)
    expect((error as Error).message.startsWith("OpenRouter failed: 429")).toBe(true)
    expect((error as ProviderFallbackError).status).toBe(429)
    // Three attempts, each trying OpenRouter first.
    expect(callAgentViaOpenRouterMock).toHaveBeenCalledTimes(3)
    expect(generateObjectMock).toHaveBeenCalledTimes(3)
  })

  it("serves one attempt from Anthropic when OpenRouter is down and Anthropic answers", async () => {
    callAgentViaOpenRouterMock.mockRejectedValueOnce(statusError(503, "503 upstream"))
    generateObjectMock.mockResolvedValueOnce(ANTHROPIC_OK)
    const outcome = await settle(callAgent("system", "user", schema, { model: "claude-sonnet-4-6" }))
    expect(outcome).toEqual({ ok: true, value: expect.objectContaining({ content: { answer: "from anthropic" } }) })
    expect(callAgentViaOpenRouterMock).toHaveBeenCalledTimes(1)
  })

  it("never sends a non-Claude model to Anthropic — the OpenRouter error is what the caller sees", async () => {
    const down = statusError(503, "503 upstream")
    callAgentViaOpenRouterMock.mockRejectedValue(down)

    const outcome = await settle(callAgent("system", "user", schema, { model: "gpt-6-astra" }))

    expect(outcome).toEqual({ ok: false, error: down })
    expect(generateObjectMock).not.toHaveBeenCalled()
    // Still retried: the 503 is transient, it just has nowhere else to go.
    expect(callAgentViaOpenRouterMock).toHaveBeenCalledTimes(3)
  })

  it("does not fall back on a 400 from OpenRouter — that is our malformed request", async () => {
    const bad = statusError(400, "400 Provider returned error")
    callAgentViaOpenRouterMock.mockRejectedValue(bad)
    const outcome = await settle(callAgent("system", "user", schema, { model: "claude-sonnet-4-6" }))
    expect(outcome).toEqual({ ok: false, error: bad })
    expect(generateObjectMock).not.toHaveBeenCalled()
    expect(callAgentViaOpenRouterMock).toHaveBeenCalledTimes(1)
  })
})

// Once the retry above started running at all, `isTransientError`'s old
// message fallback went live: any status-less error whose text merely
// CONTAINED "500" was a retry. A `.max(500)` Zod failure says "<=500
// characters", and a jsonrepair failure says "at position 1502" — so the same
// schema miss cost three paid calls or one depending on the digits in it.
describe("callAgent retry classification (OpenRouter configured)", () => {
  beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "or-test-key"))

  it("does not retry a Zod failure, even one whose message contains 500", async () => {
    const zodError = z.object({ answer: z.string().max(500) }).safeParse({ answer: "x".repeat(600) }).error as Error
    // The premise, asserted rather than assumed: without the digits this test
    // would pass on the old code too and prove nothing.
    expect(zodError.message).toContain("500")
    callAgentViaOpenRouterMock.mockRejectedValue(zodError)

    const outcome = await settle(callAgent("system", "user", schema, { model: "claude-sonnet-4-6" }))

    expect(outcome).toEqual({ ok: false, error: zodError })
    expect(callAgentViaOpenRouterMock).toHaveBeenCalledTimes(1)
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it("does not retry a malformed-JSON failure whose position happens to read 502", async () => {
    const { JSONRepairError } = await import("jsonrepair")
    const repair = new JSONRepairError("Unexpected character", 502)
    expect(repair.message).toContain("502")
    callAgentViaOpenRouterMock.mockRejectedValue(repair)

    const outcome = await settle(callAgent("system", "user", schema, { model: "claude-sonnet-4-6" }))

    expect(outcome).toEqual({ ok: false, error: repair })
    expect(callAgentViaOpenRouterMock).toHaveBeenCalledTimes(1)
  })

  it("does not retry a status-less error whose digits only CONTAIN a status code", async () => {
    // "1500" is not a 500. The substring check said it was.
    const truncated = new Error("Response truncated (hit 1500 max_tokens). Output is incomplete.")
    callAgentViaOpenRouterMock.mockRejectedValue(truncated)

    const outcome = await settle(callAgent("system", "user", schema, { model: "claude-sonnet-4-6" }))

    expect(outcome).toEqual({ ok: false, error: truncated })
    expect(callAgentViaOpenRouterMock).toHaveBeenCalledTimes(1)
  })

  it("still retries a status-less error that names a transient status as a status", async () => {
    // The control for the two above: the message fallback is narrowed, not
    // removed. A wrapped provider fault with no numeric field is still a retry.
    callAgentViaOpenRouterMock
      .mockRejectedValueOnce(new Error("Upstream error: 502 Bad Gateway"))
      .mockResolvedValueOnce(OPENROUTER_OK)

    const outcome = await settle(callAgent("system", "user", schema, { model: "claude-sonnet-4-6" }))

    expect(outcome).toEqual({ ok: true, value: expect.objectContaining({ content: { answer: "from openrouter" } }) })
    expect(callAgentViaOpenRouterMock).toHaveBeenCalledTimes(2)
  })
})

// ─── streamAgent ────────────────────────────────────────────────────────────

type Part = { type: string; [key: string]: unknown }

async function drain(stream: { fullStream: AsyncIterable<unknown> }): Promise<Part[]> {
  const parts: Part[] = []
  for await (const part of stream.fullStream) parts.push(part as Part)
  return parts
}

function openRouterAnswer(json: string) {
  const base = { id: "gen-1", model: "anthropic/claude-opus-5" }
  return (async function* () {
    yield {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: "c1", type: "function", function: { name: "structured_output", arguments: "" } },
            ],
          },
          finish_reason: null,
        },
      ],
    }
    yield {
      ...base,
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: json } }] }, finish_reason: null },
      ],
    }
    yield { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }
    yield { ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }
  })()
}

/** What the AI SDK's streamObject really does when the request itself is refused. */
function anthropicRefused(error: unknown) {
  return {
    fullStream: (async function* () {
      yield { type: "error", error }
    })(),
    // NEVER SETTLES. Measured in node_modules/ai (DefaultStreamObjectResult):
    // `_object` is resolved or rejected only in the `finish` handler, so a
    // doStream that throws leaves it pending forever. A fallback that awaited
    // it would hang the page builder until the function timed out.
    object: new Promise(() => {}),
  }
}

function anthropicAnswer(answer: unknown) {
  return {
    fullStream: (async function* () {
      yield { type: "object", object: answer }
      yield { type: "finish", usage: { inputTokens: 1, outputTokens: 2 } }
    })(),
    object: Promise.resolve(answer),
  }
}

describe("streamAgent routing", () => {
  beforeEach(() => vi.useRealTimers())

  it("streams from OpenRouter when it is configured, and never touches the AI SDK", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key")
    createMock.mockResolvedValue(openRouterAnswer('{"answer":"hi"}'))

    const stream = streamAgent("system", "user", schema, { model: "claude-opus-5", maxTokens: 2000 })
    const parts = await drain(stream)

    await expect(stream.object).resolves.toEqual({ answer: "hi" })
    expect(parts.map((p) => p.type)).toEqual(["text-delta", "object", "finish"])
    expect(streamObjectMock).not.toHaveBeenCalled()
    expect((createMock.mock.calls[0][0] as { model: string }).model).toBe("anthropic/claude-opus-5")
  })

  it("uses the AI SDK Anthropic path, unchanged, when OpenRouter is not configured", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "")
    const handle = anthropicAnswer({ answer: "hi" })
    streamObjectMock.mockReturnValue(handle)

    const stream = streamAgent("system", "user", schema, { model: "claude-opus-5" })

    expect(stream).toBe(handle)
    expect(createMock).not.toHaveBeenCalled()
  })

  it("OpenRouter 503 before any part + Anthropic refused: ProviderFallbackError leading with OpenRouter, and no hang", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key")
    const down = statusError(503, "503 Service Unavailable")
    const credit = statusError(400, "400 Your credit balance is too low")
    createMock.mockRejectedValue(down)
    streamObjectMock.mockReturnValue(anthropicRefused(credit))

    const stream = streamAgent("system", "user", schema, { model: "claude-opus-5" })
    const parts = await drain(stream)
    const error = await stream.object.catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderFallbackError)
    expect((error as Error).message.startsWith("OpenRouter failed: 503")).toBe(true)
    expect((error as ProviderFallbackError).anthropicError).toBe(credit)
    expect(parts).toEqual([{ type: "error", error }])
    expect(streamObjectMock).toHaveBeenCalledTimes(1)
  })

  it("OpenRouter 503 before any part + Anthropic answering: the consumer gets Anthropic's parts and object", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key")
    createMock.mockRejectedValue(statusError(503, "503 Service Unavailable"))
    streamObjectMock.mockReturnValue(anthropicAnswer({ answer: "from anthropic" }))

    const stream = streamAgent("system", "user", schema, { model: "claude-opus-5" })
    const parts = await drain(stream)

    expect(parts.map((p) => p.type)).toEqual(["object", "finish"])
    await expect(stream.object).resolves.toEqual({ answer: "from anthropic" })
  })

  it("never falls back once a part has reached the consumer", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key")
    const late = statusError(503, "503 mid-stream")
    const base = { id: "gen-1", model: "anthropic/claude-opus-5" }
    createMock.mockResolvedValue(
      (async function* () {
        yield {
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", type: "function", function: { name: "structured_output", arguments: '{"an' } },
                ],
              },
              finish_reason: null,
            },
          ],
        }
        throw late
      })(),
    )

    const stream = streamAgent("system", "user", schema, { model: "claude-opus-5" })
    const parts = await drain(stream)

    expect(parts.at(-1)).toEqual({ type: "error", error: late })
    await expect(stream.object).rejects.toBe(late)
    expect(streamObjectMock).not.toHaveBeenCalled()
  })

  it("does not fall back on a 400, or for a model Anthropic cannot serve", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key")
    const bad = statusError(400, "400 Provider returned error")
    createMock.mockRejectedValueOnce(bad)
    const first = streamAgent("system", "user", schema, { model: "claude-opus-5" })
    expect(await drain(first)).toEqual([{ type: "error", error: bad }])
    await expect(first.object).rejects.toBe(bad)

    const down = statusError(503, "503 Service Unavailable")
    createMock.mockRejectedValueOnce(down)
    const second = streamAgent("system", "user", schema, { model: "gpt-6-astra" })
    expect(await drain(second)).toEqual([{ type: "error", error: down }])
    await expect(second.object).rejects.toBe(down)

    expect(streamObjectMock).not.toHaveBeenCalled()
  })
})
