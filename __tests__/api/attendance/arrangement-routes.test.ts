import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const getActiveArrangementMock = vi.fn()
const createArrangementMock = vi.fn()
const endArrangementMock = vi.fn()
const getActivePackageMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: (...a: unknown[]) => canAccessMock(...a) }))
vi.mock("@/lib/db/attendance-arrangements", () => ({
  getActiveArrangementForClient: (...a: unknown[]) => getActiveArrangementMock(...a),
  createArrangement: (...a: unknown[]) => createArrangementMock(...a),
  endArrangement: (...a: unknown[]) => endArrangementMock(...a),
}))
vi.mock("@/lib/db/client-packages", () => ({
  getActivePackageForClient: (...a: unknown[]) => getActivePackageMock(...a),
}))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))

import { POST as START } from "@/app/api/admin/attendance-arrangements/route"
import { POST as END } from "@/app/api/admin/attendance-arrangements/end/route"

const CLIENT = "11111111-1111-4111-8111-111111111111"
const ARR = "22222222-2222-4222-8222-222222222222"

function req(body: unknown) {
  return new Request("http://localhost/api/admin/attendance-arrangements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach", role: "admin" } })
  canAccessMock.mockResolvedValue(true)
})

describe("POST /api/admin/attendance-arrangements", () => {
  it("rejects a signed-out caller", async () => {
    authMock.mockResolvedValue(null)
    const res = await START(req({ clientUserId: CLIENT }))
    expect(res.status).toBe(403)
    expect(createArrangementMock).not.toHaveBeenCalled()
  })

  it("rejects a caller without admin access", async () => {
    canAccessMock.mockResolvedValue(false)
    const res = await START(req({ clientUserId: CLIENT }))
    expect(res.status).toBe(403)
    expect(createArrangementMock).not.toHaveBeenCalled()
  })

  it("rejects a body with no client", async () => {
    const res = await START(req({}))
    expect(res.status).toBe(400)
    expect(createArrangementMock).not.toHaveBeenCalled()
  })

  it("creates an active arrangement with the label the coach typed", async () => {
    getActiveArrangementMock.mockResolvedValue(null)
    getActivePackageMock.mockResolvedValue(null)
    createArrangementMock.mockResolvedValue({ id: ARR, label: "Riverside Tennis Club" })

    const res = await START(req({ clientUserId: CLIENT, label: "Riverside Tennis Club" }))

    expect(res.status).toBe(200)
    const row = createArrangementMock.mock.calls[0][0]
    expect(row.client_user_id).toBe(CLIENT)
    expect(row.label).toBe("Riverside Tennis Club")
    expect(row.status).toBe("active")
    expect(row.created_by).toBe("coach")
  })

  it("refuses a second arrangement for a client who already has one", async () => {
    getActiveArrangementMock.mockResolvedValue({ id: ARR })
    const res = await START(req({ clientUserId: CLIENT }))
    expect(res.status).toBe(409)
    expect(createArrangementMock).not.toHaveBeenCalled()
  })

  it("warns when the client still has an active pack that will burn first", async () => {
    getActiveArrangementMock.mockResolvedValue(null)
    getActivePackageMock.mockResolvedValue({ id: "p1" })
    createArrangementMock.mockResolvedValue({ id: ARR, label: null })

    const res = await START(req({ clientUserId: CLIENT }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.warning).toMatch(/still has an active pack/i)
  })

  it("does not warn when there is no pack", async () => {
    getActiveArrangementMock.mockResolvedValue(null)
    getActivePackageMock.mockResolvedValue(null)
    createArrangementMock.mockResolvedValue({ id: ARR, label: null })

    const body = await (await START(req({ clientUserId: CLIENT }))).json()
    expect(body.warning).toBeNull()
    // Presence control: the arrangement really was created, so a null warning
    // is the route's answer and not an early return.
    expect(body.arrangement.id).toBe(ARR)
  })

  it("clamps a very long note instead of rejecting the whole request", async () => {
    getActiveArrangementMock.mockResolvedValue(null)
    getActivePackageMock.mockResolvedValue(null)
    createArrangementMock.mockResolvedValue({ id: ARR, label: null })

    const res = await START(req({ clientUserId: CLIENT, notes: "x".repeat(5000) }))

    expect(res.status).toBe(200)
    expect(createArrangementMock.mock.calls[0][0].notes).toHaveLength(1000)
  })

  it("records the audit trail for a started arrangement", async () => {
    getActiveArrangementMock.mockResolvedValue(null)
    getActivePackageMock.mockResolvedValue(null)
    createArrangementMock.mockResolvedValue({ id: ARR, label: "Riverside" })

    await START(req({ clientUserId: CLIENT, label: "Riverside" }))

    expect(recordAuditMock).toHaveBeenCalledTimes(1)
    expect(recordAuditMock.mock.calls[0][0].action).toBe("attendance.arrangement_started")
  })
})

describe("POST /api/admin/attendance-arrangements/end", () => {
  it("rejects a caller without admin access", async () => {
    canAccessMock.mockResolvedValue(false)
    const res = await END(req({ arrangementId: ARR }))
    expect(res.status).toBe(403)
    expect(endArrangementMock).not.toHaveBeenCalled()
  })

  it("ends an active arrangement and stamps the end date", async () => {
    endArrangementMock.mockResolvedValue({ id: ARR, label: "Riverside", client_user_id: CLIENT, ended_on: "2026-08-29" })

    const res = await END(req({ arrangementId: ARR }))

    expect(res.status).toBe(200)
    expect(endArrangementMock).toHaveBeenCalledTimes(1)
    expect(endArrangementMock.mock.calls[0][0]).toBe(ARR)
    // Second argument is the end date, in YYYY-MM-DD.
    expect(endArrangementMock.mock.calls[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(recordAuditMock.mock.calls[0][0].action).toBe("attendance.arrangement_ended")
  })

  it("answers 409 when there was no active arrangement to end", async () => {
    endArrangementMock.mockResolvedValue(null)
    const res = await END(req({ arrangementId: ARR }))
    expect(res.status).toBe(409)
    expect(recordAuditMock).not.toHaveBeenCalled()
  })
})
