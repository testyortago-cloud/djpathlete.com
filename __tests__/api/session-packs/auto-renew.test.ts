import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getClientPackageByIdMaybeMock = vi.fn()
const updateClientPackageMock = vi.fn()
const canAccessAdminPathMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/client-packages", () => ({
  getClientPackageByIdMaybe: (...a: unknown[]) => getClientPackageByIdMaybeMock(...a),
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
}))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...a: unknown[]) => canAccessAdminPathMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))

const PACK = "pack-1"

function basePack(overrides: Record<string, unknown> = {}) {
  return {
    id: PACK,
    client_user_id: "u1",
    session_type: "Performance training",
    auto_renew: false,
    ...overrides,
  }
}

function ctx() {
  return { params: Promise.resolve({ id: PACK }) }
}

function req(body: unknown) {
  return new Request(`http://localhost/api/session-packs/${PACK}/auto-renew`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "u1", role: "client" } })
  getClientPackageByIdMaybeMock.mockResolvedValue(basePack())
  updateClientPackageMock.mockResolvedValue(basePack({ auto_renew: false }))
  canAccessAdminPathMock.mockResolvedValue(true)
  recordAuditMock.mockResolvedValue(undefined)
})

describe("client auto-renew route", () => {
  it("refuses to touch a pack belonging to someone else", async () => {
    authMock.mockResolvedValue({ user: { id: "u2", role: "client" } })
    getClientPackageByIdMaybeMock.mockResolvedValue({ id: "pack-1", client_user_id: "u1" })
    const { PATCH } = await import("@/app/api/client/session-packs/[id]/auto-renew/route")
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ autoRenew: false }) }),
      { params: Promise.resolve({ id: "pack-1" }) },
    )
    expect(res.status).toBe(403)
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("lets a client disarm their own pack", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "client" } })
    getClientPackageByIdMaybeMock.mockResolvedValue({ id: "pack-1", client_user_id: "u1" })
    const { PATCH } = await import("@/app/api/client/session-packs/[id]/auto-renew/route")
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ autoRenew: false }) }),
      { params: Promise.resolve({ id: "pack-1" }) },
    )
    expect(res.status).toBe(200)
    expect(updateClientPackageMock).toHaveBeenCalledWith("pack-1", { auto_renew: false })
  })

  it("lets a client arm their own pack and audits it", async () => {
    getClientPackageByIdMaybeMock.mockResolvedValue(basePack())
    updateClientPackageMock.mockResolvedValue(basePack({ auto_renew: true }))
    const { PATCH } = await import("@/app/api/client/session-packs/[id]/auto-renew/route")
    const res = await PATCH(req({ autoRenew: true }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, autoRenew: true })
    expect(updateClientPackageMock).toHaveBeenCalledWith(PACK, { auto_renew: true })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pack.auto_renew_enabled", category: "commerce" }),
    )
  })

  it("401s when there is no session", async () => {
    authMock.mockResolvedValue(null)
    const { PATCH } = await import("@/app/api/client/session-packs/[id]/auto-renew/route")
    const res = await PATCH(req({ autoRenew: true }), ctx())
    expect(res.status).toBe(401)
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("404s when the pack does not exist", async () => {
    getClientPackageByIdMaybeMock.mockResolvedValue(null)
    const { PATCH } = await import("@/app/api/client/session-packs/[id]/auto-renew/route")
    const res = await PATCH(req({ autoRenew: true }), ctx())
    expect(res.status).toBe(404)
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("400s on a malformed body", async () => {
    const { PATCH } = await import("@/app/api/client/session-packs/[id]/auto-renew/route")
    const res = await PATCH(req({ autoRenew: "yes" }), ctx())
    expect(res.status).toBe(400)
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("records auto_renew_disabled on disarm", async () => {
    getClientPackageByIdMaybeMock.mockResolvedValue(basePack({ auto_renew: true }))
    updateClientPackageMock.mockResolvedValue(basePack({ auto_renew: false }))
    const { PATCH } = await import("@/app/api/client/session-packs/[id]/auto-renew/route")
    const res = await PATCH(req({ autoRenew: false }), ctx())
    expect(res.status).toBe(200)
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pack.auto_renew_disabled", category: "commerce" }),
    )
  })
})

describe("admin auto-renew route", () => {
  it("rejects non-admins", async () => {
    canAccessAdminPathMock.mockResolvedValue(false)
    const { PATCH } = await import("@/app/api/admin/session-packs/[id]/auto-renew/route")
    const res = await PATCH(req({ autoRenew: true }), ctx())
    expect(res.status).toBe(403)
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("404s when the pack does not exist", async () => {
    authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
    getClientPackageByIdMaybeMock.mockResolvedValue(null)
    const { PATCH } = await import("@/app/api/admin/session-packs/[id]/auto-renew/route")
    const res = await PATCH(req({ autoRenew: true }), ctx())
    expect(res.status).toBe(404)
  })

  it("400s on a malformed body", async () => {
    authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
    const { PATCH } = await import("@/app/api/admin/session-packs/[id]/auto-renew/route")
    const res = await PATCH(req({ autoRenew: "yes" }), ctx())
    expect(res.status).toBe(400)
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("arms a client's pack and audits it", async () => {
    authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
    getClientPackageByIdMaybeMock.mockResolvedValue(basePack())
    updateClientPackageMock.mockResolvedValue(basePack({ auto_renew: true }))
    const { PATCH } = await import("@/app/api/admin/session-packs/[id]/auto-renew/route")
    const res = await PATCH(req({ autoRenew: true }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, autoRenew: true })
    expect(updateClientPackageMock).toHaveBeenCalledWith(PACK, { auto_renew: true })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pack.auto_renew_enabled", category: "commerce" }),
    )
  })

  it("disarms a client's pack and audits it", async () => {
    authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
    getClientPackageByIdMaybeMock.mockResolvedValue(basePack({ auto_renew: true }))
    updateClientPackageMock.mockResolvedValue(basePack({ auto_renew: false }))
    const { PATCH } = await import("@/app/api/admin/session-packs/[id]/auto-renew/route")
    const res = await PATCH(req({ autoRenew: false }), ctx())
    expect(res.status).toBe(200)
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pack.auto_renew_disabled", category: "commerce" }),
    )
  })
})
