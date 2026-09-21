import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessAdminPath = vi.fn()
const jobSet = vi.fn()
const rtdbSet = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...a: unknown[]) => canAccessAdminPath(...a),
}))
vi.mock("@/lib/db/assignments", () => ({ getActiveUserIdsForProgram: vi.fn(async () => []) }))
vi.mock("@/lib/ai-jobs", () => ({ findInFlightWeekGeneration: vi.fn(async () => null) }))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "ts" } }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ id: "job-1", set: jobSet }) }) }),
  getAdminRtdb: () => ({ ref: () => ({ set: rtdbSet }) }),
}))

import { POST } from "@/app/api/admin/programs/[id]/generate-week/route"

const params = Promise.resolve({ id: "program-1" })
const req = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) })

/** The `request` object the route writes into the Firestore job document. */
function queuedRequest() {
  return jobSet.mock.calls[0]?.[0]?.input?.request as Record<string, unknown>
}

beforeEach(() => {
  authMock.mockReset()
  canAccessAdminPath.mockReset()
  jobSet.mockReset()
  rtdbSet.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  canAccessAdminPath.mockResolvedValue(true)
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
