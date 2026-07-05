import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const updateSlotMock = vi.fn()
const getSlotMock = vi.fn()
const getAssignmentMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/packs/flags", () => ({ recurringSessionsEnabled: vi.fn(async () => true) }))
vi.mock("@/lib/db/recurring-sessions", () => ({
  updateRecurringSession: (...a: unknown[]) => updateSlotMock(...a),
  deleteRecurringSession: vi.fn(),
  getRecurringSessionById: (...a: unknown[]) => getSlotMock(...a),
}))
vi.mock("@/lib/db/assignments", () => ({ getAssignmentById: (...a: unknown[]) => getAssignmentMock(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { PATCH } from "@/app/api/admin/sessions/[id]/route"

const ASG = "11111111-1111-1111-8111-111111111111"

const req = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/admin/sessions/slot-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
const ctx = { params: Promise.resolve({ id: "slot-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  updateSlotMock.mockResolvedValue({ id: "slot-1" })
  getSlotMock.mockResolvedValue({ id: "slot-1", client_user_id: "c1" })
  getAssignmentMock.mockResolvedValue({ id: ASG, user_id: "c1", status: "active" })
})

describe("PATCH /api/admin/sessions/[id] — hybrid program link", () => {
  it("links an assignment that belongs to the slot's client", async () => {
    const res = await PATCH(req({ assignmentId: ASG }), ctx)
    expect(res.status).toBe(200)
    expect(updateSlotMock).toHaveBeenCalledWith("slot-1", expect.objectContaining({ assignment_id: ASG }))
  })

  it("400s when the assignment belongs to a different client (no update)", async () => {
    getAssignmentMock.mockResolvedValue({ id: ASG, user_id: "someone-else", status: "active" })
    const res = await PATCH(req({ assignmentId: ASG }), ctx)
    expect(res.status).toBe(400)
    expect(updateSlotMock).not.toHaveBeenCalled()
  })

  it("400s when the assignment does not exist", async () => {
    getAssignmentMock.mockResolvedValue(null)
    const res = await PATCH(req({ assignmentId: ASG }), ctx)
    expect(res.status).toBe(400)
    expect(updateSlotMock).not.toHaveBeenCalled()
  })

  it("unlinks with assignmentId null", async () => {
    const res = await PATCH(req({ assignmentId: null }), ctx)
    expect(res.status).toBe(200)
    expect(updateSlotMock).toHaveBeenCalledWith("slot-1", expect.objectContaining({ assignment_id: null }))
    expect(getAssignmentMock).not.toHaveBeenCalled()
  })

  it("leaves the link untouched when assignmentId is absent", async () => {
    const res = await PATCH(req({ status: "paused" }), ctx)
    expect(res.status).toBe(200)
    const patch = updateSlotMock.mock.calls[0][1] as Record<string, unknown>
    expect("assignment_id" in patch).toBe(false)
  })
})
