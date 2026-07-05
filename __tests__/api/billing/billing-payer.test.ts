import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getUserMock = vi.fn()
const setMock = vi.fn()
const clearMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/users", () => ({ getUserById: (...a: unknown[]) => getUserMock(...a) }))
vi.mock("@/lib/db/client-billing-payers", () => ({
  setBillingPayer: (...a: unknown[]) => setMock(...a),
  clearBillingPayer: (...a: unknown[]) => clearMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST } from "@/app/api/admin/clients/[id]/billing-payer/route"

const CLIENT = "11111111-1111-4111-8111-111111111111"
const PAYER = "22222222-2222-4222-8222-222222222222"
const ctx = { params: Promise.resolve({ id: CLIENT }) }
const req = (b: Record<string, unknown>) =>
  new Request("http://x/api/admin/clients/x/billing-payer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  })

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  getUserMock.mockResolvedValue({ id: PAYER, email: "dad@example.com", role: "client" })
})

describe("POST /api/admin/clients/[id]/billing-payer", () => {
  it("403 for non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await POST(req({ payerUserId: PAYER }), ctx)).status).toBe(403)
  })

  it("400 when the payer is the client themselves", async () => {
    const res = await POST(req({ payerUserId: CLIENT }), ctx)
    expect(res.status).toBe(400)
    expect(setMock).not.toHaveBeenCalled()
  })

  it("404 when the payer does not exist", async () => {
    getUserMock.mockResolvedValue(null)
    expect((await POST(req({ payerUserId: PAYER }), ctx)).status).toBe(404)
  })

  it("400 when the payer is not a client (e.g. an admin)", async () => {
    getUserMock.mockResolvedValue({ id: PAYER, email: "coach@example.com", role: "admin" })
    const res = await POST(req({ payerUserId: PAYER }), ctx)
    expect(res.status).toBe(400)
    expect(setMock).not.toHaveBeenCalled()
  })

  it("sets the payer", async () => {
    const res = await POST(req({ payerUserId: PAYER }), ctx)
    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(CLIENT, PAYER, "coach-1")
  })

  it("clears the payer on null", async () => {
    const res = await POST(req({ payerUserId: null }), ctx)
    expect(res.status).toBe(200)
    expect(clearMock).toHaveBeenCalledWith(CLIENT)
    expect(setMock).not.toHaveBeenCalled()
  })
})
