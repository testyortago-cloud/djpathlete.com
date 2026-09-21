import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessAdminPath = vi.fn()
const jobSet = vi.fn()
const jobUpdate = vi.fn()
const rtdbSet = vi.fn()
const enqueueGenerationTask = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...a: unknown[]) => canAccessAdminPath(...a),
}))
vi.mock("@/lib/db/assignments", () => ({ getActiveUserIdsForProgram: vi.fn(async () => []) }))
vi.mock("@/lib/ai-jobs", () => ({ findInFlightWeekGeneration: vi.fn(async () => null) }))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "ts" } }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({
    collection: () => ({ doc: () => ({ id: "job-1", set: jobSet, update: jobUpdate }) }),
  }),
  getAdminRtdb: () => ({ ref: () => ({ set: rtdbSet }) }),
}))
vi.mock("@/lib/ai-task-queue", () => ({
  GENERATION_QUEUES: { week: "weekGenerationTask", program: "programGenerationTask" },
  enqueueGenerationTask: (...a: unknown[]) => enqueueGenerationTask(...a),
}))

import { POST } from "@/app/api/admin/programs/[id]/generate-week/route"

const params = Promise.resolve({ id: "program-1" })
const req = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) })

/** The `request` object the route writes into the Firestore job document. */
function queuedRequest() {
  return jobSet.mock.calls[0]?.[0]?.input?.request as Record<string, unknown>
}

/** The whole job document. */
function jobDoc() {
  return jobSet.mock.calls[0]?.[0] as Record<string, unknown>
}

beforeEach(() => {
  authMock.mockReset()
  canAccessAdminPath.mockReset()
  jobSet.mockReset()
  jobUpdate.mockReset()
  rtdbSet.mockReset()
  enqueueGenerationTask.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  canAccessAdminPath.mockResolvedValue(true)
  enqueueGenerationTask.mockResolvedValue(undefined)
})

describe("generate-week — equipment_override", () => {
  it("omits the key entirely when the coach did not set an override", async () => {
    const res = await POST(req({}), { params })
    expect(res.status).toBe(202)
    // Presence is the signal the orchestrator tests with Array.isArray(). A
    // `null` here would read as "overridden" and hard-filter every ordinary
    // generation down to bodyweight.
    expect("equipment_override" in queuedRequest()).toBe(false)
  })

  it("forwards an EMPTY override — 'nothing at all' is a real answer", async () => {
    const res = await POST(req({ equipment_override: [] }), { params })
    expect(res.status).toBe(202)
    expect(queuedRequest().equipment_override).toEqual([])
  })

  it("forwards a ticked list verbatim", async () => {
    const res = await POST(req({ equipment_override: ["yoga_mat", "resistance_band"] }), { params })
    expect(res.status).toBe(202)
    expect(queuedRequest().equipment_override).toEqual(["yoga_mat", "resistance_band"])
  })

  it("rejects equipment outside the canonical vocabulary", async () => {
    const res = await POST(req({ equipment_override: ["hotel_towel"] }), { params })
    expect(res.status).toBe(400)
    expect(jobSet).not.toHaveBeenCalled()
  })

  it("rejects a non-array override rather than coercing it", async () => {
    const res = await POST(req({ equipment_override: "yoga_mat" }), { params })
    expect(res.status).toBe(400)
    expect(jobSet).not.toHaveBeenCalled()
  })

  it("still requires admin access", async () => {
    canAccessAdminPath.mockResolvedValue(false)
    const res = await POST(req({ equipment_override: [] }), { params })
    expect(res.status).toBe(403)
    expect(jobSet).not.toHaveBeenCalled()
  })
})

describe("generate-week — Cloud Tasks dispatch", () => {
  it('marks the job dispatch:"task" so the Firestore trigger yields', async () => {
    // Both triggers are live during the deploy window. Without this field the
    // create trigger ALSO runs the job — two AI runs, two charges, two weeks
    // written over each other.
    await POST(req({}), { params })
    expect(jobDoc().dispatch).toBe("task")
  })

  it("enqueues the job on the week queue after writing the doc", async () => {
    await POST(req({}), { params })
    expect(enqueueGenerationTask).toHaveBeenCalledWith("weekGenerationTask", "job-1")
  })

  it("does not enqueue anything when validation rejected the request", async () => {
    await POST(req({ equipment_override: ["hotel_towel"] }), { params })
    expect(enqueueGenerationTask).not.toHaveBeenCalled()
  })

  it("marks the job failed and answers 503 when the enqueue does not land", async () => {
    // A doc nobody will ever pick up is an invisible failure: the coach watches
    // a spinner forever, AND the pending doc reads as in-flight, which blocks
    // them from starting another one.
    enqueueGenerationTask.mockRejectedValue(new Error("queue weekGenerationTask not found"))
    const res = await POST(req({}), { params })
    expect(res.status).toBe(503)
    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("queue weekGenerationTask not found"),
      }),
    )
  })

  it("does not leave the job pending after a failed enqueue", async () => {
    enqueueGenerationTask.mockRejectedValue(new Error("nope"))
    await POST(req({}), { params })
    const status = jobUpdate.mock.calls.at(-1)?.[0]?.status
    expect(status).not.toBe("pending")
    expect(status).toBe("failed")
  })
})
