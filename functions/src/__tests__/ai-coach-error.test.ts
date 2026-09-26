import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"

// What an athlete sees when the exercise coach ("Coach DJP") fails.
//
// The incident: handleAiCoach's catch wrote `error.message` into the error
// chunk and the job doc, and CoachDjpPanel shows that text verbatim. After the
// OpenRouter move, a rate limit with the unfunded Anthropic account behind it
// reached the athlete as "OpenRouter failed: 429 ... The Anthropic fallback
// also failed: 400 {"type":"error",...credit balance...,"request_id":...}" —
// provider names, raw JSON and our billing state, in front of a client. This
// product is heading to white-label coaching, so none of that may ever reach
// an athlete. The full error stays in the server log for the owner.
//
// Every provider fault here is built from the SDKs' REAL error classes. Those
// classes never set `.name`, so a fake shaped like `{ name: "APIError" }`
// would not be the thing production throws.

const h = vi.hoisted(() => ({
  streamRaw: vi.fn(),
  callAgent: vi.fn(),
  getFirestore: vi.fn(),
  getSupabase: vi.fn(),
}))

// Only what ai-coach.ts imports. The real module is being edited by another
// task, and the provider routing has its own suite; this one is about what
// the handler does with whatever the stream throws.
vi.mock("../ai/anthropic.js", () => ({
  streamRaw: h.streamRaw,
  callAgent: h.callAgent,
  MODEL_HAIKU: "claude-haiku-4-5-20251001",
}))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: h.getFirestore,
  FieldValue: { serverTimestamp: () => "TS" },
}))
vi.mock("../ai/rag.js", () => ({
  retrieveSimilarContext: vi.fn(async () => []),
  formatRagContext: vi.fn(() => ""),
  buildRagAugmentedPrompt: vi.fn(),
  embedConversationMessage: vi.fn(async () => {}),
}))
vi.mock("../lib/supabase.js", () => ({ getSupabase: h.getSupabase }))

import { athleteFacingCoachError, COACH_UNAVAILABLE_MESSAGE, handleAiCoach } from "../ai-coach.js"
import { ProviderFallbackError } from "../ai/openrouter.js"

/** Words that must never reach an athlete: provider names, raw JSON, our billing state. */
const FORBIDDEN = ["OpenRouter", "Anthropic", "{", "credit"]

const openRouter429 = () =>
  OpenAI.APIError.generate(
    429,
    { error: { message: "Rate limit exceeded: free-models-per-min.", code: 429 } },
    undefined,
    new Headers(),
  )

/** Anthropic's real reply when the account is unfunded — the SDK stringifies the whole body into the message. */
const anthropicCreditError = () =>
  Anthropic.APIError.generate(
    400,
    {
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      },
      request_id: "req_011CT5009abc",
    },
    undefined,
    new Headers(),
  )

/** Exactly the fault the review reproduced: OpenRouter 429, then the unfunded Anthropic fallback. */
const providerFallback = () => new ProviderFallbackError(openRouter429(), anthropicCreditError())

describe("athleteFacingCoachError", () => {
  it("turns the OpenRouter-then-Anthropic failure into plain words with no provider, JSON or billing text", () => {
    const error = providerFallback()
    // Control: the fixture really does carry every forbidden thing, so the
    // assertions below cannot pass by the input being clean already.
    for (const word of FORBIDDEN) expect(error.message).toContain(word)

    const text = athleteFacingCoachError(error)

    expect(text).toBe(COACH_UNAVAILABLE_MESSAGE)
    for (const word of FORBIDDEN) expect(text).not.toContain(word)
  })

  it.each([
    ["an OpenRouter 429 rethrown as-is (the stream had already emitted)", openRouter429],
    ["the Anthropic credit error on its own", anthropicCreditError],
    [
      "an OpenRouter connection failure",
      () => new OpenAI.APIConnectionError({ message: "Connection error.", cause: new Error("ECONNRESET") }),
    ],
    ["an OpenRouter connection timeout", () => new OpenAI.APIConnectionTimeoutError()],
    ["a stream the caller aborted", () => new Anthropic.APIUserAbortError()],
    // The handler throws this with a plain Error that shares the catch with
    // every provider fault, and the same null also comes back when the lookup
    // itself failed, so it is not a message an athlete can act on.
    ["the handler's own 'Exercise not found'", () => new Error("Exercise not found")],
    // A thrown PostgREST error is an object, not an Error.
    [
      "a raw PostgREST error object",
      () => ({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null }),
    ],
    ["a non-error value", () => undefined],
  ])("gives the same safe text for %s", (_label, make) => {
    const text = athleteFacingCoachError(make())

    expect(text).toBe(COACH_UNAVAILABLE_MESSAGE)
    for (const word of FORBIDDEN) expect(text).not.toContain(word)
  })

  it("is a short sentence that tells the athlete what to do next", () => {
    expect(COACH_UNAVAILABLE_MESSAGE).toMatch(/try again/i)
    expect(COACH_UNAVAILABLE_MESSAGE.length).toBeLessThan(100)
  })
})

// ─── The handler's catch: what is written where ──────────────────────────────

type Written = Record<string, unknown>

function fakeFirestore(jobInput: Written) {
  const chunks: Written[] = []
  const jobUpdates: Written[] = []
  const jobRef = {
    get: async () => ({ exists: true, data: () => ({ status: "pending", type: "ai_coach", input: jobInput }) }),
    update: async (data: Written) => {
      jobUpdates.push(data)
    },
    collection: () => ({
      doc: () => ({
        set: async (data: Written) => {
          chunks.push(data)
        },
      }),
    }),
  }
  return { db: { collection: () => ({ doc: () => jobRef }) }, chunks, jobUpdates }
}

/** Every builder method returns the builder; awaiting it yields the table's canned result. */
function fakeSupabase(dataByTable: Record<string, unknown>) {
  return {
    from(table: string) {
      const result = { data: dataByTable[table] ?? null, error: null }
      const query: Record<string, unknown> = {}
      for (const method of ["select", "eq", "neq", "order", "limit", "single", "insert"]) {
        query[method] = () => query
      }
      query.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject)
      return query
    },
  }
}

const SQUAT = {
  id: "ex-1",
  name: "Back Squat",
  category: "strength",
  muscle_group: "legs",
  equipment: "barbell",
  is_bodyweight: false,
  training_intent: "strength",
  movement_pattern: null,
}

/** A stream that emits `texts` and then throws `error`. */
function failingStream(error: unknown, texts: string[] = []) {
  return async function* () {
    for (const text of texts) yield { type: "text" as const, text }
    throw error
  }
}

describe("handleAiCoach when the model call fails", () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    h.streamRaw.mockReset()
    h.callAgent.mockReset()
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ["both providers failed before a word was streamed", () => providerFallback(), [] as string[]],
    ["OpenRouter failed after the first words were already shown", () => openRouter429(), ["Nice work on "]],
  ])("writes only the safe text to the chunk and the job, and logs the full error: %s", async (_label, make, texts) => {
    const error = make()
    const fs = fakeFirestore({ exercise_id: "ex-1", userId: "user-1" })
    h.getFirestore.mockReturnValue(fs.db)
    h.getSupabase.mockReturnValue(fakeSupabase({ exercises: SQUAT, exercise_progress: [] }))
    h.streamRaw.mockImplementation(failingStream(error, texts))

    await handleAiCoach("job-7")

    const errorChunks = fs.chunks.filter((c) => c.type === "error")
    expect(errorChunks).toHaveLength(1)
    expect(errorChunks[0].data).toEqual({ message: COACH_UNAVAILABLE_MESSAGE })

    const failed = fs.jobUpdates.find((u) => u.status === "failed")
    expect(failed).toBeDefined()
    expect(failed!.error).toBe(COACH_UNAVAILABLE_MESSAGE)

    // Nothing the athlete can read carries provider, JSON or billing text.
    const athleteVisible = JSON.stringify([errorChunks, failed!.error])
    for (const word of ["OpenRouter", "Anthropic", "credit", "request_id"]) {
      expect(athleteVisible).not.toContain(word)
    }

    // The owner still gets the whole fault in the server log: the error
    // object itself, so its cause chain and both providers' texts survive.
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("job-7"), error)
  })

  it("does the same for the handler's own 'Exercise not found'", async () => {
    const fs = fakeFirestore({ exercise_id: "ex-missing", userId: "user-1" })
    h.getFirestore.mockReturnValue(fs.db)
    h.getSupabase.mockReturnValue(fakeSupabase({ exercise_progress: [] }))

    await handleAiCoach("job-8")

    expect(h.streamRaw).not.toHaveBeenCalled()
    expect(fs.chunks.filter((c) => c.type === "error").map((c) => c.data)).toEqual([
      { message: COACH_UNAVAILABLE_MESSAGE },
    ])
    expect(fs.jobUpdates.find((u) => u.status === "failed")?.error).toBe(COACH_UNAVAILABLE_MESSAGE)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("job-8"),
      expect.objectContaining({ message: "Exercise not found" }),
    )
  })
})
