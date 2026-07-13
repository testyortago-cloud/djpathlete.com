import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getClientPackageByIdMaybeMock = vi.fn()
const deleteClientPackageMock = vi.fn()
const updateClientPackageMock = vi.fn()
const createPackCheckoutSessionMock = vi.fn()
const retrieveSessionMock = vi.fn()
const expireSessionMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/client-packages", () => ({
  getClientPackageByIdMaybe: (...a: unknown[]) => getClientPackageByIdMaybeMock(...a),
  deleteClientPackage: (...a: unknown[]) => deleteClientPackageMock(...a),
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
}))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))
vi.mock("@/lib/stripe", () => ({
  createPackCheckoutSession: (...a: unknown[]) => createPackCheckoutSessionMock(...a),
  stripe: {
    checkout: {
      sessions: {
        retrieve: (...a: unknown[]) => retrieveSessionMock(...a),
        expire: (...a: unknown[]) => expireSessionMock(...a),
      },
    },
  },
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { DELETE } from "@/app/api/admin/session-packs/[id]/route"
import { POST as PAYMENT_LINK } from "@/app/api/admin/session-packs/[id]/payment-link/route"

const PACK = "33333333-3333-4333-8333-333333333333"

function basePack(overrides: Record<string, unknown> = {}) {
  return {
    id: PACK,
    client_user_id: "11111111-1111-4111-8111-111111111111",
    product_id: null,
    session_type: "1-on-1",
    credits_total: 10,
    credits_used: 1,
    price_cents: 50000,
    payment_method: "stripe",
    payment_status: "pending",
    stripe_session_id: "cs_old",
    status: "active",
    ...overrides,
  }
}

function ctx() {
  return { params: Promise.resolve({ id: PACK }) }
}

function req(method: string) {
  return new Request(`http://localhost/api/admin/session-packs/${PACK}`, { method })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  getClientPackageByIdMaybeMock.mockResolvedValue(basePack())
  deleteClientPackageMock.mockResolvedValue(undefined)
  updateClientPackageMock.mockResolvedValue(basePack())
  createPackCheckoutSessionMock.mockResolvedValue({ id: "cs_new", url: "https://stripe.test/cs_new" })
  retrieveSessionMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
  expireSessionMock.mockResolvedValue({})
})

describe("DELETE /api/admin/session-packs/[id]", () => {
  it("rejects non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await DELETE(req("DELETE"), ctx())
    expect(res.status).toBe(403)
    expect(deleteClientPackageMock).not.toHaveBeenCalled()
  })

  it("404s when the pack does not exist", async () => {
    getClientPackageByIdMaybeMock.mockResolvedValue(null)
    const res = await DELETE(req("DELETE"), ctx())
    expect(res.status).toBe(404)
  })

  it("deletes the pack after expiring an open unpaid checkout session", async () => {
    const res = await DELETE(req("DELETE"), ctx())
    expect(res.status).toBe(200)
    expect(retrieveSessionMock).toHaveBeenCalledWith("cs_old")
    expect(expireSessionMock).toHaveBeenCalledWith("cs_old")
    expect(deleteClientPackageMock).toHaveBeenCalledWith(PACK)
  })

  it("refuses to delete when the session state can't be verified (Stripe down)", async () => {
    retrieveSessionMock.mockRejectedValue(new Error("stripe down"))
    const res = await DELETE(req("DELETE"), ctx())
    expect(res.status).toBe(502)
    expect(deleteClientPackageMock).not.toHaveBeenCalled()
  })

  it("refuses to delete when the payment link can't be expired", async () => {
    expireSessionMock.mockRejectedValue(new Error("stripe down"))
    const res = await DELETE(req("DELETE"), ctx())
    expect(res.status).toBe(502)
    expect(deleteClientPackageMock).not.toHaveBeenCalled()
  })

  it("409s when the checkout was already completed (payment in flight)", async () => {
    retrieveSessionMock.mockResolvedValue({ status: "complete", url: null })
    const res = await DELETE(req("DELETE"), ctx())
    expect(res.status).toBe(409)
    expect(deleteClientPackageMock).not.toHaveBeenCalled()
  })

  it("deletes an expired-link pack without expiring anything", async () => {
    retrieveSessionMock.mockResolvedValue({ status: "expired", url: null })
    const res = await DELETE(req("DELETE"), ctx())
    expect(res.status).toBe(200)
    expect(expireSessionMock).not.toHaveBeenCalled()
    expect(deleteClientPackageMock).toHaveBeenCalledWith(PACK)
  })

  it("does not touch Stripe for paid packs", async () => {
    getClientPackageByIdMaybeMock.mockResolvedValue(basePack({ payment_status: "paid" }))
    const res = await DELETE(req("DELETE"), ctx())
    expect(res.status).toBe(200)
    expect(retrieveSessionMock).not.toHaveBeenCalled()
    expect(expireSessionMock).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/session-packs/[id]/payment-link", () => {
  it("rejects non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await PAYMENT_LINK(req("POST"), ctx())
    expect(res.status).toBe(403)
  })

  it("409s for packs not awaiting card payment", async () => {
    getClientPackageByIdMaybeMock.mockResolvedValue(basePack({ payment_method: "cash", payment_status: "paid" }))
    const res = await PAYMENT_LINK(req("POST"), ctx())
    expect(res.status).toBe(409)
  })

  it("returns the existing session url while it is still open", async () => {
    const res = await PAYMENT_LINK(req("POST"), ctx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.url).toBe("https://stripe.test/cs_old")
    expect(json.refreshed).toBe(false)
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("mints a fresh session when the old one expired and stores it on the pack", async () => {
    retrieveSessionMock.mockResolvedValue({ status: "expired", url: null })
    const res = await PAYMENT_LINK(req("POST"), ctx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.url).toBe("https://stripe.test/cs_new")
    expect(json.refreshed).toBe(true)
    expect(updateClientPackageMock).toHaveBeenCalledWith(PACK, { stripe_session_id: "cs_new" })
    expect(createPackCheckoutSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: "/client/sessions" }),
    )
  })

  it("409s instead of re-minting when the old session is complete (payment in flight)", async () => {
    retrieveSessionMock.mockResolvedValue({ status: "complete", url: null })
    const res = await PAYMENT_LINK(req("POST"), ctx())
    expect(res.status).toBe(409)
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("502s instead of re-minting when Stripe can't be reached", async () => {
    retrieveSessionMock.mockRejectedValue(new Error("stripe down"))
    const res = await PAYMENT_LINK(req("POST"), ctx())
    expect(res.status).toBe(502)
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })
})
