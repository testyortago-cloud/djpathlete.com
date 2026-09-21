import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * These tests exist because the warnings shipped INVISIBLE.
 *
 * The orchestrator computed them, logged them, and returned them — and
 * `handleWeekGeneration` then built `resultPayload` out of four other fields and
 * dropped them on the floor. Every check "passed" because every check read
 * `generateWeekSync`'s return value, which is the layer ABOVE the bug.
 *
 * So: never assert the orchestrator's result here. Assert what is written to the
 * job doc, because `ai_jobs/<id>.result` is the only thing the coach's dialog
 * ever reads (`useAiJob` → `extractWarnings`).
 */

const { mockGenerateWeekSync, mockGetFirestore, mockGetDatabase, mockNotifyCompleted, mockNotifyFailed } = vi.hoisted(
  () => ({
    mockGenerateWeekSync: vi.fn(),
    mockGetFirestore: vi.fn(),
    mockGetDatabase: vi.fn(),
    mockNotifyCompleted: vi.fn().mockResolvedValue(undefined),
    mockNotifyFailed: vi.fn().mockResolvedValue(undefined),
  }),
)

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: mockGetFirestore,
  FieldValue: { serverTimestamp: () => "TS" },
}))
vi.mock("firebase-admin/database", () => ({ getDatabase: mockGetDatabase }))
vi.mock("../ai/week-orchestrator.js", () => ({ generateWeekSync: mockGenerateWeekSync }))
vi.mock("../lib/notify-job-done.js", () => ({
  notifyJobCompleted: mockNotifyCompleted,
  notifyJobFailed: mockNotifyFailed,
}))
// The real deadline is used deliberately — it is cheap, and mocking it would
// only re-specify a contract the module already owns.

import { handleWeekGeneration } from "../week-generation.js"

const BUDGET_MS = 600_000

/** Two real warnings, copied from the shapes the orchestrator actually emits. */
const WARNINGS = [
  "4 exercises were removed because the model invented exercise IDs that do not exist. Day 2 and Day 5 are shorter than planned.",
  'Monday repeats the "horizontal push" movement family 3 times.',
]

function resultFrom(warnings: string[]) {
  return {
    new_week_number: 8,
    exercises_added: 35,
    token_usage: { architect: 1, selector: 2, total: 3, cache_creation: 0, cache_read: 0 },
    duration_ms: 323_300,
    warnings,
  }
}

describe("handleWeekGeneration — the job doc's result payload", () => {
  let jobUpdate: ReturnType<typeof vi.fn>
  let rtdbUpdate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockNotifyCompleted.mockResolvedValue(undefined)
    mockNotifyFailed.mockResolvedValue(undefined)

    jobUpdate = vi.fn().mockResolvedValue(undefined)
    rtdbUpdate = vi.fn().mockResolvedValue(undefined)

    const jobRef = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({
            status: "pending",
            input: {
              request: { program_id: "prog-1" },
              requestedBy: "admin-1",
              notify_email: null,
            },
          }),
        })
        .mockResolvedValue({ exists: true, data: () => ({ status: "processing" }) }),
      update: jobUpdate,
    }

    mockGetFirestore.mockReturnValue({ collection: () => ({ doc: () => jobRef }) })
    mockGetDatabase.mockReturnValue({ ref: () => ({ update: rtdbUpdate }) })
    mockGenerateWeekSync.mockResolvedValue(resultFrom(WARNINGS))
  })

  /** The completed write is the one the dialog reads. */
  function completedPayload() {
    const call = jobUpdate.mock.calls.find((c) => c[0]?.status === "completed")
    return call?.[0]?.result as Record<string, unknown> | undefined
  }

  it("writes the orchestrator's warnings into ai_jobs.result", async () => {
    await handleWeekGeneration("job-1", BUDGET_MS)

    // Assert the VALUE, not merely that something came back — a truthy check
    // would pass on a payload carrying the wrong array.
    expect(completedPayload()?.warnings).toEqual(WARNINGS)
  })

  it("still writes the four fields the dialog already depended on", async () => {
    await handleWeekGeneration("job-1", BUDGET_MS)

    expect(completedPayload()).toMatchObject({
      new_week_number: 8,
      exercises_added: 35,
      duration_ms: 323_300,
    })
  })

  it("writes an empty array — never a missing key — on a clean run", async () => {
    // Firestore rejects `undefined`, and the reader's `Array.isArray` guard
    // turns a missing key into silence, which is the failure being fixed.
    mockGenerateWeekSync.mockResolvedValue(resultFrom([]))

    await handleWeekGeneration("job-1", BUDGET_MS)

    const payload = completedPayload()
    expect(payload).toHaveProperty("warnings")
    expect(payload?.warnings).toEqual([])
  })

  it("coerces a missing warnings key to [] rather than letting Firestore reject it", async () => {
    // Types say `warnings` is always present, so this arm is unreachable today.
    // It is here because the exercises are already written to Supabase by this
    // point: an `undefined` in the payload makes `update()` throw, and the job
    // lands in "failed" with a week that actually exists. Degrading to "no
    // warnings" is strictly better than that.
    const { warnings: _dropped, ...withoutWarnings } = resultFrom(WARNINGS)
    mockGenerateWeekSync.mockResolvedValue(withoutWarnings)

    await handleWeekGeneration("job-1", BUDGET_MS)

    expect(completedPayload()?.warnings).toEqual([])
    const failed = jobUpdate.mock.calls.find((c) => c[0]?.status === "failed")
    expect(failed).toBeUndefined()
  })

  it("mirrors the warnings into the RTDB job mirror", async () => {
    // The dock listens to RTDB, not Firestore. Both surfaces are fed from the
    // same object, and this pins that they stay fed from the same object.
    await handleWeekGeneration("job-1", BUDGET_MS)

    const call = rtdbUpdate.mock.calls.find((c) => c[0]?.status === "completed")
    expect((call?.[0]?.result as Record<string, unknown>)?.warnings).toEqual(WARNINGS)
  })

  it("survives the shape the reader applies to it", async () => {
    // extractWarnings' real contract: an array of non-empty strings off
    // `result.warnings`. Re-implemented rather than imported — functions/ has
    // rootDir "src" and cannot import from components/.
    await handleWeekGeneration("job-1", BUDGET_MS)

    const raw = (completedPayload() as { warnings?: unknown })?.warnings
    expect(Array.isArray(raw)).toBe(true)
    const rendered = (raw as unknown[]).filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    expect(rendered).toHaveLength(2)
  })

  it("does not write a result payload when generation fails", async () => {
    mockGenerateWeekSync.mockRejectedValue(new Error("boom"))

    await handleWeekGeneration("job-1", BUDGET_MS)

    expect(completedPayload()).toBeUndefined()
    const failed = jobUpdate.mock.calls.find((c) => c[0]?.status === "failed")
    expect(failed?.[0]?.error).toBe("boom")
  })
})
