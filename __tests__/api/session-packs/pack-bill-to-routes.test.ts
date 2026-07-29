import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getClientPackageByIdMaybeMock = vi.fn()
const updateClientPackageMock = vi.fn()
const getUserByIdMock = vi.fn()
const resolvePackPaymentLinkMock = vi.fn()
const changePackBillToMock = vi.fn()
const sendPackPaymentLinkEmailMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/client-packages", () => ({
  getClientPackageByIdMaybe: (...a: unknown[]) => getClientPackageByIdMaybeMock(...a),
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: (...a: unknown[]) => getUserByIdMock(...a) }))
vi.mock("@/lib/services/pack-payment-link", () => ({
  resolvePackPaymentLink: (...a: unknown[]) => resolvePackPaymentLinkMock(...a),
  changePackBillTo: (...a: unknown[]) => changePackBillToMock(...a),
}))
vi.mock("@/lib/email", () => ({
  sendPackPaymentLinkEmail: (...a: unknown[]) => sendPackPaymentLinkEmailMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST as EMAIL_LINK } from "@/app/api/admin/session-packs/[id]/email-link/route"
import { PATCH as BILL_TO } from "@/app/api/admin/session-packs/[id]/bill-to/route"

const PACK = "33333333-3333-4333-8333-333333333333"
const CLIENT = "11111111-1111-4111-8111-111111111111"

function basePack(overrides: Record<string, unknown> = {}) {
  return {
    id: PACK,
    client_user_id: CLIENT,
    product_id: null,
    session_type: "Performance training",
    credits_total: 10,
    credits_used: 0,
    price_cents: 150000,
    payment_method: "stripe",
    payment_status: "pending",
    stripe_session_id: "cs_old",
    bill_to_email: null,
    bill_to_emailed_at: null,
    status: "active",
    ...overrides,
  }
}

function ctx() {
  return { params: Promise.resolve({ id: PACK }) }
}

function req(method: string, body?: unknown) {
  return new Request(`http://localhost/api/admin/session-packs/${PACK}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  getClientPackageByIdMaybeMock.mockResolvedValue(basePack())
  updateClientPackageMock.mockResolvedValue(basePack())
  getUserByIdMock.mockResolvedValue({ id: CLIENT, email: "luca@example.com", first_name: "Luca", last_name: "Morello" })
  resolvePackPaymentLinkMock.mockResolvedValue({ ok: true, url: "https://stripe.test/cs_1", refreshed: false })
  changePackBillToMock.mockResolvedValue({ ok: true, url: "https://stripe.test/cs_new", refreshed: true })
  sendPackPaymentLinkEmailMock.mockResolvedValue(undefined)
})

describe("POST /api/admin/session-packs/[id]/email-link", () => {
  it("rejects non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await EMAIL_LINK(req("POST"), ctx())
    expect(res.status).toBe(403)
    expect(sendPackPaymentLinkEmailMock).not.toHaveBeenCalled()
  })

  it("404s when the pack does not exist", async () => {
    getClientPackageByIdMaybeMock.mockResolvedValue(null)
    const res = await EMAIL_LINK(req("POST"), ctx())
    expect(res.status).toBe(404)
  })

  it("sends to the bill-to address and CCs the client", async () => {
    getClientPackageByIdMaybeMock.mockResolvedValue(basePack({ bill_to_email: "dad@example.com" }))
    const res = await EMAIL_LINK(req("POST"), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, sentTo: "dad@example.com" })
    expect(sendPackPaymentLinkEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "dad@example.com", ccClientEmail: "luca@example.com", clientName: "Luca Morello" }),
    )
  })

  it("falls back to the client's own email when no bill-to is set", async () => {
    await EMAIL_LINK(req("POST"), ctx())
    expect(sendPackPaymentLinkEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "luca@example.com" }),
    )
  })

  it("stamps bill_to_emailed_at only after a successful send", async () => {
    await EMAIL_LINK(req("POST"), ctx())
    expect(updateClientPackageMock).toHaveBeenCalledWith(
      PACK,
      expect.objectContaining({ bill_to_emailed_at: expect.any(String) }),
    )
  })

  it("502s and does NOT stamp the timestamp when the send fails", async () => {
    sendPackPaymentLinkEmailMock.mockRejectedValue(new Error("resend down"))
    const res = await EMAIL_LINK(req("POST"), ctx())
    expect(res.status).toBe(502)
    // A stamp here would tell the coach a link went out that never did.
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("propagates the link resolver's refusal instead of emailing a dead link", async () => {
    resolvePackPaymentLinkMock.mockResolvedValue({ ok: false, status: 409, error: "already paid" })
    const res = await EMAIL_LINK(req("POST"), ctx())
    expect(res.status).toBe(409)
    expect(sendPackPaymentLinkEmailMock).not.toHaveBeenCalled()
  })

  it("409s when there is no address to send to at all", async () => {
    getUserByIdMock.mockResolvedValue({ id: CLIENT, email: null, first_name: null, last_name: null })
    const res = await EMAIL_LINK(req("POST"), ctx())
    expect(res.status).toBe(409)
    expect(resolvePackPaymentLinkMock).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/admin/session-packs/[id]/bill-to", () => {
  it("rejects non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await BILL_TO(req("PATCH", { billToEmail: "dad@example.com" }), ctx())
    expect(res.status).toBe(403)
    expect(changePackBillToMock).not.toHaveBeenCalled()
  })

  it("400s on a malformed address", async () => {
    const res = await BILL_TO(req("PATCH", { billToEmail: "nope" }), ctx())
    expect(res.status).toBe(400)
    expect(changePackBillToMock).not.toHaveBeenCalled()
  })

  it("404s when the pack does not exist", async () => {
    getClientPackageByIdMaybeMock.mockResolvedValue(null)
    const res = await BILL_TO(req("PATCH", { billToEmail: "dad@example.com" }), ctx())
    expect(res.status).toBe(404)
  })

  it("sets the address and returns the re-issued link", async () => {
    const res = await BILL_TO(req("PATCH", { billToEmail: "dad@example.com" }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: "https://stripe.test/cs_new", billToEmail: "dad@example.com" })
    expect(changePackBillToMock).toHaveBeenCalledWith(expect.objectContaining({ id: PACK }), "dad@example.com")
  })

  it("accepts null to clear the address back to the client", async () => {
    const res = await BILL_TO(req("PATCH", { billToEmail: null }), ctx())
    expect(res.status).toBe(200)
    expect(changePackBillToMock).toHaveBeenCalledWith(expect.objectContaining({ id: PACK }), null)
  })

  it("propagates a refusal from the service with its status", async () => {
    changePackBillToMock.mockResolvedValue({ ok: false, status: 409, error: "already paid" })
    const res = await BILL_TO(req("PATCH", { billToEmail: "dad@example.com" }), ctx())
    expect(res.status).toBe(409)
  })
})
