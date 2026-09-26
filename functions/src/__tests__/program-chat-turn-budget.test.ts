import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import OpenAI from "openai"

// A program-chat turn that builds a program, then runs out of the turn's time
// budget, must still end "completed".
//
// The incident: handleProgramChat created ONE 450s deadline and handed it to
// generate_program AND to every later model call. When generation spent that
// budget, it still saved week 1, queued the rest, and the program_created card
// went to the coach — and then the closing model call started on a deadline
// that had already fired. p-retry's throwIfAborted threw before a request was
// made, and the turn ended "failed" with a DeadlineExceededError: a saved
// program reported as a failed turn.

const h = vi.hoisted(() => ({ compat: vi.fn(), generate: vi.fn() }))

vi.mock("../ai/openrouter-message.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/openrouter-message.js")>()),
  createMessageCompat: h.compat,
}))
vi.mock("../ai/anthropic.js", () => ({
  MODEL_OPUS: "claude-opus-4-6",
  MODEL_SONNET: "claude-sonnet-4-6",
  MODEL_HAIKU: "claude-haiku-4-5-20251001",
}))
vi.mock("../ai/orchestrator.js", () => ({ generateProgramSync: h.generate }))
vi.mock("../ai/rag.js", () => ({
  retrieveSimilarContext: vi.fn(async () => []),
  formatRagContext: vi.fn(() => ""),
  buildRagAugmentedPrompt: vi.fn((prompt: string) => prompt),
  embedConversationMessage: vi.fn(async () => {}),
}))
vi.mock("../ai/program-chat-tools.js", () => ({
  listClients: vi.fn(),
  lookupClientProfile: vi.fn(),
  getExercisesForAI: vi.fn(),
}))

// ─── In-memory Firestore and Supabase ─────────────────────────────────────────

type Row = Record<string, unknown>
const store = vi.hoisted(() => ({
  chunks: [] as Array<Record<string, unknown>>,
  jobUpdates: [] as Array<Record<string, unknown>>,
  stateSets: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ table: string; rows: unknown }>,
}))

vi.mock("firebase-admin/firestore", () => {
  const job = {
    status: "pending",
    type: "program_chat",
    input: { messages: [{ role: "user", content: "Build it." }], userId: "coach-1", session_id: "session-1" },
  }
  const jobRef = {
    get: async () => ({ exists: true, data: () => job }),
    update: async (u: Record<string, unknown>) => {
      store.jobUpdates.push(u)
    },
    collection: () => ({
      doc: () => ({
        set: async (c: Record<string, unknown>) => {
          store.chunks.push(c)
        },
      }),
    }),
  }
  const stateRef = {
    get: async () => ({ exists: false, data: () => undefined }),
    set: async (s: Record<string, unknown>) => {
      store.stateSets.push(s)
    },
  }
  return {
    getFirestore: () => ({
      collection: (name: string) => ({ doc: () => (name === "ai_jobs" ? jobRef : stateRef) }),
    }),
    FieldValue: { serverTimestamp: () => "TS" },
  }
})

vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      insert: (rows: unknown) => {
        store.inserts.push({ table, rows })
        return { select: async () => ({ data: [{ id: "history-1", role: "assistant" }] }) }
      },
    }),
  }),
}))

import { closingCallBudget, handleProgramChat } from "../program-chat.js"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PARTIAL_SUMMARY =
  "Weeks 1-1 of 8 are built and saved. The remaining weeks are being generated in the background, " +
  "starting at week 2; they will appear on the program as each one finishes."

const callGenerate = {
  content: [
    {
      type: "tool_use",
      id: "tu-1",
      name: "generate_program",
      input: { client_id: null, goals: ["strength"], duration_weeks: 8, sessions_per_week: 3 },
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5 },
  stop_reason: "tool_use",
}

const reply = (text: string) => ({
  content: [{ type: "text", text }],
  usage: { input_tokens: 10, output_tokens: 5 },
  stop_reason: "stop",
})

/** generateProgramSync that spends `ms` of wall clock (firing any deadline inside it) and saves week 1 of 8. */
const partialGenerationTaking = (ms: number) => async () => {
  vi.advanceTimersByTime(ms)
  return {
    program_id: "program-1",
    validation: { pass: true, issues: [] },
    token_usage: {},
    duration_ms: ms,
    retries: 0,
    partial: { weeks_completed: 1, total_weeks: 8, next_week: 2, continuation_job_id: "continuation-1" },
  }
}

/** A model call still in flight at `ms` from now: it aborts the way the OpenAI SDK does once its signal fires. */
const hangsFor =
  (ms: number) =>
  ({ signal }: { signal?: AbortSignal }) => {
    const pending = new Promise<never>((_, reject) => {
      signal?.addEventListener("abort", () => reject(new OpenAI.APIUserAbortError()), { once: true })
    })
    vi.advanceTimersByTime(ms)
    return pending
  }

const signalOf = (call: number) => (h.compat.mock.calls[call][0] as { signal?: AbortSignal }).signal
const chunksOf = (type: string) => store.chunks.filter((c) => c.type === type)
const lastJobUpdate = () => store.jobUpdates[store.jobUpdates.length - 1]
const historyAssistantRow = () => {
  const history = store.inserts.find((i) => i.table === "ai_conversation_history")
  return (history?.rows as Row[] | undefined)?.find((r) => r.role === "assistant")
}

beforeEach(() => {
  store.chunks.length = 0
  store.jobUpdates.length = 0
  store.stateSets.length = 0
  store.inserts.length = 0
  h.compat.mockReset()
  h.generate.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-26T10:00:00Z"))
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── The budget arithmetic ───────────────────────────────────────────────────

describe("closingCallBudget (a model call after generate_program ran this turn)", () => {
  // The function is hard-killed at 540s. 30s is kept back for the rest of the
  // turn (history insert, state save, done/completed). A closing reply gets at
  // most 60s, and under 15s it is not worth starting.

  it("keeps the turn's deadline unchanged while it still has at least as long as a closing reply would get", () => {
    expect(closingCallBudget(100_000, 350_000)).toEqual({ kind: "turn" })
    expect(closingCallBudget(390_000, 60_000)).toEqual({ kind: "turn" })
  })

  it("gives the closing reply its own deadline once generation has spent the turn's", () => {
    // Generation ran to 455s: the turn's budget fired at 450s.
    expect(closingCallBudget(455_000, 0)).toEqual({ kind: "own", budgetMs: 55_000 })
    // Budget nearly spent: 50s left, but a closing reply may have 60s.
    expect(closingCallBudget(400_000, 50_000)).toEqual({ kind: "own", budgetMs: 60_000 })
  })

  it("never lets the closing reply run into the 30s kept before the 540s hard kill", () => {
    for (let elapsed = 0; elapsed <= 540_000; elapsed += 1_000) {
      const budget = closingCallBudget(elapsed, Math.max(0, 450_000 - elapsed))
      if (budget.kind === "own") expect(elapsed + budget.budgetMs).toBeLessThanOrEqual(510_000)
    }
  })

  it("skips the model call when under 15s would be left for it", () => {
    expect(closingCallBudget(495_000, 0)).toEqual({ kind: "own", budgetMs: 15_000 })
    expect(closingCallBudget(495_001, 0)).toEqual({ kind: "skip" })
    expect(closingCallBudget(500_000, 0)).toEqual({ kind: "skip" })
    // Past the hard kill's margin entirely: never a negative budget.
    expect(closingCallBudget(530_000, 0)).toEqual({ kind: "skip" })
  })
})

// ─── The turn ─────────────────────────────────────────────────────────────────

describe("handleProgramChat — a turn that built a program", () => {
  it("ends completed with the model's closing reply when generation spent the turn's budget on a partial program", async () => {
    const abortedAtCall: boolean[] = []
    h.compat.mockImplementation(async ({ signal }: { signal?: AbortSignal }) => {
      abortedAtCall.push(signal?.aborted ?? false)
      return abortedAtCall.length === 1 ? callGenerate : reply("Week 1 is saved; the other seven are on their way.")
    })
    h.generate.mockImplementation(partialGenerationTaking(455_000))

    await handleProgramChat("job-1")

    // The generation's own deadline was the turn's, and it fired inside it.
    const generationDeadline = h.generate.mock.calls[0][6] as { signal: AbortSignal }
    expect(generationDeadline.signal).toBe(signalOf(0))
    expect(generationDeadline.signal.aborted).toBe(true)
    // The closing reply ran on a fresh, live deadline.
    expect(h.compat).toHaveBeenCalledTimes(2)
    expect(signalOf(1)).not.toBe(signalOf(0))
    expect(abortedAtCall).toEqual([false, false])

    expect(chunksOf("program_created")).toHaveLength(1)
    expect(chunksOf("delta").map((c) => (c.data as Row).text)).toEqual([
      "Week 1 is saved; the other seven are on their way.",
    ])
    expect(chunksOf("error")).toEqual([])
    expect(chunksOf("done")).toHaveLength(1)
    expect(lastJobUpdate()).toMatchObject({ status: "completed" })
    expect(store.jobUpdates.some((u) => u.status === "failed")).toBe(false)
    // Both the turn's deadline and the closing call's own were released.
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps the turn's deadline for the closing reply when generation left plenty of it", async () => {
    h.compat.mockResolvedValueOnce(callGenerate).mockResolvedValueOnce(reply("Your program is ready."))
    h.generate.mockImplementation(partialGenerationTaking(100_000))

    await handleProgramChat("job-1")

    expect(signalOf(1)).toBe(signalOf(0))
    expect(lastJobUpdate()).toMatchObject({ status: "completed" })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("closes with a fixed message, sent like any reply, when the closing reply's own deadline cuts it off", async () => {
    // 455s of generation leaves the closing reply 55s; the model is still
    // thinking at 60s.
    h.compat.mockResolvedValueOnce(callGenerate).mockImplementationOnce(hangsFor(60_000))
    h.generate.mockImplementation(partialGenerationTaking(455_000))

    await handleProgramChat("job-1")

    expect(h.compat).toHaveBeenCalledTimes(2) // an abort is never retried, and Haiku is never tried
    expect(chunksOf("delta").map((c) => (c.data as Row).text)).toEqual([PARTIAL_SUMMARY])
    expect(historyAssistantRow()?.content).toBe(PARTIAL_SUMMARY)
    expect(chunksOf("error")).toEqual([])
    expect(lastJobUpdate()).toMatchObject({ status: "completed" })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("still fails the turn when the closing call fails for a reason that is not the clock", async () => {
    // The allowance is for the budget only. A request the provider refuses
    // outright is a real failure, and the coach should see it as one.
    h.compat
      .mockResolvedValueOnce(callGenerate)
      .mockRejectedValueOnce(Object.assign(new Error("400 Invalid tool schema"), { status: 400 }))
    h.generate.mockImplementation(partialGenerationTaking(455_000))

    await handleProgramChat("job-1")

    expect(lastJobUpdate()).toMatchObject({ status: "failed", error: "400 Invalid tool schema" })
    expect(chunksOf("delta")).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("skips the closing model call when too little time is left, and says what was saved", async () => {
    h.compat.mockResolvedValueOnce(callGenerate)
    h.generate.mockImplementation(partialGenerationTaking(500_000))

    await handleProgramChat("job-1")

    expect(h.compat).toHaveBeenCalledTimes(1)
    // Skipped, not attempted and cut off: the catch-path fallback would produce
    // the same chunks, so only the log line tells the two apart.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("too little time left for a closing reply"))
    expect(chunksOf("delta").map((c) => (c.data as Row).text)).toEqual([PARTIAL_SUMMARY])
    expect(historyAssistantRow()?.content).toBe(PARTIAL_SUMMARY)
    // The closing text is the assistant's turn in the saved history, so the
    // next turn resumes from a well-formed conversation.
    const saved = store.stateSets[0]?.apiMessages as Array<{ role: string; content: unknown }>
    expect(saved[saved.length - 1]).toEqual({ role: "assistant", content: PARTIAL_SUMMARY })
    expect(lastJobUpdate()).toMatchObject({ status: "completed" })
  })

  it("says a fully built program is saved when the closing call is skipped", async () => {
    h.compat.mockResolvedValueOnce(callGenerate)
    h.generate.mockImplementation(async () => {
      vi.advanceTimersByTime(500_000)
      return { program_id: "program-1", validation: { pass: true, issues: [] }, duration_ms: 500_000 }
    })

    await handleProgramChat("job-1")

    const [closing] = chunksOf("delta").map((c) => (c.data as Row).text as string)
    expect(closing).toMatch(/built and saved/)
    expect(lastJobUpdate()).toMatchObject({ status: "completed" })
  })

  it("says the program could not be built when generation failed and the closing call is skipped", async () => {
    h.compat.mockResolvedValueOnce(callGenerate)
    h.generate.mockImplementation(async () => {
      vi.advanceTimersByTime(500_000)
      throw new Error("Program generation ran out of time before any week could be built")
    })

    await handleProgramChat("job-1")

    const [closing] = chunksOf("delta").map((c) => (c.data as Row).text as string)
    expect(closing).toBe(
      "The program could not be built: Program generation ran out of time before any week could be built",
    )
    expect(closing).not.toMatch(/saved/)
  })
})

describe("handleProgramChat — a turn that did not run generate_program", () => {
  it("still fails at the turn's deadline, reporting the time budget rather than the SDK's abort", async () => {
    // The control: the closing-reply allowance belongs only to a turn that ran
    // generate_program. A plain chat turn that runs out of time is a failure,
    // and it must say so in the job's own words.
    h.compat.mockImplementationOnce(hangsFor(450_000))

    await handleProgramChat("job-1")

    expect(lastJobUpdate()).toMatchObject({ status: "failed" })
    expect(lastJobUpdate().error).toMatch(/exceeded its 450s time budget/)
    expect(chunksOf("error")).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
