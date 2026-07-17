import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getPackMock = vi.fn()
const updatePackMock = vi.fn()
const expireMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/client-packages", () => ({
  getClientPackageByIdMaybe: (...a: unknown[]) => getPackMock(...a),
  updateClientPackage: (...a: unknown[]) => updatePackMock(...a),
}))
vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { expire: (...a: unknown[]) => expireMock(...a) } } },
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST } from "@/app/api/admin/session-packs/[id]/mark-paid/route"

const PACK_ID = "22222222-2222-4222-8222-222222222222"

function call() {
  return POST(new Request(`http://localhost/api/admin/session-packs/${PACK_ID}/mark-paid`, { method: "POST" }), {
    params: Promise.resolve({ id: PACK_ID }),
  })
}

const owedPack = {
  id: PACK_ID,
  client_user_id: "c1",
  session_type: "1-on-1",
  payment_method: "cash",
  payment_status: "pending",
  price_cents: 50000,
  stripe_session_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  updatePackMock.mockImplementation((_id: string, patch: Record<string, unknown>) => ({ ...owedPack, ...patch }))
})

describe("POST /api/admin/session-packs/[id]/mark-paid", () => {
  it("marks an owed cash pack paid", async () => {
    getPackMock.mockResolvedValue(owedPack)
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).package.payment_status).toBe("paid")
    expect(updatePackMock).toHaveBeenCalledWith(PACK_ID, { payment_status: "paid" })
    expect(expireMock).not.toHaveBeenCalled()
  })

  it("expires the open checkout session when a stripe pack is paid offline", async () => {
    getPackMock.mockResolvedValue({ ...owedPack, payment_method: "stripe", stripe_session_id: "cs_123" })
    const res = await call()
    expect(res.status).toBe(200)
    expect(expireMock).toHaveBeenCalledWith("cs_123")
    expect(updatePackMock).toHaveBeenCalledWith(PACK_ID, { payment_status: "paid" })
  })

  it("still marks paid when expiring the checkout session fails", async () => {
    getPackMock.mockResolvedValue({ ...owedPack, payment_method: "stripe", stripe_session_id: "cs_123" })
    expireMock.mockRejectedValue(new Error("already expired"))
    const res = await call()
    expect(res.status).toBe(200)
    expect(updatePackMock).toHaveBeenCalledWith(PACK_ID, { payment_status: "paid" })
  })

  it("is idempotent for already-paid packs", async () => {
    getPackMock.mockResolvedValue({ ...owedPack, payment_status: "paid" })
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).alreadyPaid).toBe(true)
    expect(updatePackMock).not.toHaveBeenCalled()
  })

  it("refuses refunded packs", async () => {
    getPackMock.mockResolvedValue({ ...owedPack, payment_status: "refunded" })
    const res = await call()
    expect(res.status).toBe(409)
  })

  it("404s on a missing pack", async () => {
    getPackMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(404)
  })

  it("rejects non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await call()
    expect(res.status).toBe(403)
    expect(getPackMock).not.toHaveBeenCalled()
  })
})
