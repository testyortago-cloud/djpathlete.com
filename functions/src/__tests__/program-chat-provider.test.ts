import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The AI Program Builder chat's model call: OpenRouter-first through the
// compat shim, retried on transient faults, and moved to Haiku when the
// primary model keeps failing.
//
// Two incidents shaped these tests. (1) Every turn went straight to the
// Anthropic SDK, whose account has no credit, so every turn failed with
// "Your credit balance is too low". (2) The retry never retried: p-retry 7
// hands `shouldRetry` a RetryContext ({error, attemptNumber, retriesLeft}),
// not the error, and `shouldRetry: (err) => isTransientError(err)` read
// `.status` off the context — always undefined — so a 429 went straight to
// Haiku on the first failure, and a Haiku 429 failed the turn outright.

const h = vi.hoisted(() => ({ compat: vi.fn() }))

vi.mock("../ai/openrouter-message.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/openrouter-message.js")>()),
  createMessageCompat: h.compat,
}))

// Only the model ids — the real module is being edited by another task and
// this suite is about retry semantics, not about that module.
vi.mock("../ai/anthropic.js", () => ({
  MODEL_OPUS: "claude-opus-4-6",
  MODEL_SONNET: "claude-sonnet-4-6",
  MODEL_HAIKU: "claude-haiku-4-5-20251001",
}))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: () => "TS" },
}))
vi.mock("../ai/orchestrator.js", () => ({ generateProgramSync: vi.fn() }))
vi.mock("../ai/rag.js", () => ({
  retrieveSimilarContext: vi.fn(),
  formatRagContext: vi.fn(),
  buildRagAugmentedPrompt: vi.fn(),
  embedConversationMessage: vi.fn(),
}))
vi.mock("../ai/program-chat-tools.js", () => ({
  listClients: vi.fn(),
  lookupClientProfile: vi.fn(),
  getExercisesForAI: vi.fn(),
}))
vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))

import { createWithRetry, isTransientError } from "../program-chat.js"
import { ProviderFallbackError } from "../ai/openrouter.js"

const OPUS = "claude-opus-4-6"
const HAIKU = "claude-haiku-4-5-20251001"

const statusError = (status: number, message = `${status} provider error`) =>
  Object.assign(new Error(message), { status })

/** Anthropic's reply when the account is unfunded — with a request id that happens to contain "500". */
const anthropicCreditError = () =>
  statusError(
    400,
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."},"request_id":"req_011CT5009"}',
  )

const ok = (text: string) => ({
  content: [{ type: "text", text }],
  usage: { input_tokens: 5, output_tokens: 3 },
  stop_reason: "stop",
})

const params = {
  max_tokens: 32000,
  system: "You are a program builder.",
  messages: [{ role: "user" as const, content: "Which clients do I have?" }],
}

/** Run to completion under fake timers — p-retry sleeps 3s, 6s, 12s between attempts. */
async function settle<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  let done = false
  const out = p.then(
    (value) => {
      done = true
      return { value }
    },
    (error) => {
      done = true
      return { error }
    },
  )
  for (let i = 0; i < 200 && !done; i++) await vi.advanceTimersByTimeAsync(1_000)
  return out
}

const modelsCalled = () => h.compat.mock.calls.map((c) => (c[0] as { model: string }).model)

beforeEach(() => {
  h.compat.mockReset()
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("createWithRetry", () => {
  it("retries a 429 on the SAME model, through the compat shim, instead of jumping to Haiku", async () => {
    h.compat.mockRejectedValueOnce(statusError(429)).mockResolvedValueOnce(ok("You have Ana and Ben."))

    const r = await settle(createWithRetry(params))

    expect(r.error).toBeUndefined()
    expect(r.value?.content).toEqual([{ type: "text", text: "You have Ana and Ben." }])
    expect(modelsCalled()).toEqual([OPUS, OPUS])
    // The whole request reaches the shim — the 32k budget included.
    expect(h.compat.mock.calls[0][0]).toMatchObject({ ...params, model: OPUS })
  })

  it("after exhausting retries on MODEL_OPUS, falls back to MODEL_HAIKU", async () => {
    h.compat.mockImplementation(async ({ model }: { model: string }) => {
      if (model === OPUS) throw statusError(503)
      return ok("from haiku")
    })

    const r = await settle(createWithRetry(params))

    expect(r.error).toBeUndefined()
    expect(r.value?.content).toEqual([{ type: "text", text: "from haiku" }])
    // 1 attempt + 3 retries on Opus, then Haiku.
    expect(modelsCalled()).toEqual([OPUS, OPUS, OPUS, OPUS, HAIKU])
  })

  it("retries a ProviderFallbackError whose OpenRouter half was a 429, calling the shim afresh each time", async () => {
    // Each attempt is a new createMessageCompat call, so each one tries
    // OpenRouter first again — one fallback never pins the turn to Anthropic.
    h.compat
      .mockRejectedValueOnce(new ProviderFallbackError(statusError(429, "Rate limit exceeded"), anthropicCreditError()))
      .mockResolvedValueOnce(ok("second try"))

    const r = await settle(createWithRetry(params))

    expect(r.value?.content).toEqual([{ type: "text", text: "second try" }])
    expect(modelsCalled()).toEqual([OPUS, OPUS])
  })

  it("does not retry or switch model on a 400 — it rethrows the same error once", async () => {
    const bad = statusError(400, "400 Invalid tool schema")
    h.compat.mockRejectedValue(bad)

    const r = await settle(createWithRetry(params))

    expect(r.error).toBe(bad)
    expect(modelsCalled()).toEqual([OPUS])
  })
})

describe("isTransientError", () => {
  it("classifies by a numeric status: 429 and 5xx are transient, 4xx are not", () => {
    expect(isTransientError(statusError(429))).toBe(true)
    expect(isTransientError(statusError(500))).toBe(true)
    expect(isTransientError(statusError(529))).toBe(true)
    expect(isTransientError(statusError(400))).toBe(false)
    expect(isTransientError(statusError(401))).toBe(false)
  })

  it("classifies a ProviderFallbackError by OpenRouter's fault, never by Anthropic's", () => {
    // OpenRouter 429 + Anthropic's final 400: the turn is still worth retrying.
    expect(isTransientError(new ProviderFallbackError(statusError(429), anthropicCreditError()))).toBe(true)
    // OpenRouter 402 (out of credit) + an Anthropic 500: retrying cannot help.
    expect(isTransientError(new ProviderFallbackError(statusError(402), statusError(500)))).toBe(false)
    // A status-less OpenRouter connection error has no status to lend the
    // wrapper, so the combined message would be all there is to read — and it
    // carries Anthropic's text ("529 Overloaded", or a request id like
    // "req_011CT5009" whose "500" a substring check would match). The verdict
    // must be whatever OpenRouter's own error gets, whichever way that goes.
    const conn = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })
    const overloaded = statusError(529, "529 Overloaded")
    expect(isTransientError(new ProviderFallbackError(conn, overloaded))).toBe(isTransientError(conn))
    expect(isTransientError(new ProviderFallbackError(conn, anthropicCreditError()))).toBe(isTransientError(conn))
  })

  it("keeps the existing message checks for status-less errors, and is null-safe", () => {
    expect(isTransientError(new Error("Overloaded"))).toBe(true)
    expect(isTransientError(new Error("upstream 503"))).toBe(true)
    expect(isTransientError(new Error("bad input"))).toBe(false)
    expect(isTransientError(null)).toBe(false)
    expect(isTransientError(undefined)).toBe(false)
  })
})
