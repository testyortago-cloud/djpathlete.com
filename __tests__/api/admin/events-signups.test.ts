import { describe, it, expect, vi, beforeEach } from "vitest"

const { NoAccessibleBusinessError } = vi.hoisted(() => {
  class NoAccessibleBusinessError extends Error {
    constructor() {
      super("This account has no business it can access")
      this.name = "NoAccessibleBusinessError"
    }
  }
  return { NoAccessibleBusinessError }
})

const authMock = vi.fn()
const getSignupByIdMock = vi.fn()
const getEventByIdMock = vi.fn()
const confirmSignupMock = vi.fn()
const cancelSignupMock = vi.fn()
const sendConfirmedMock = vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined)
// Mocked, or the route's resolveAdminTenantForRequest reaches a real
// Supabase client and this stops being a unit test. Sentinel is "admin-biz",
// never the platform id and never "host-biz" (the PUBLIC boundary's own
// sentinel).
const resolveTenantMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => authMock(...args) }))
vi.mock("@/lib/db/event-signups", () => ({
  getSignupById: (...a: unknown[]) => getSignupByIdMock(...a),
  confirmSignup: (...a: unknown[]) => confirmSignupMock(...a),
  cancelSignup: (...a: unknown[]) => cancelSignupMock(...a),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventByIdMock(...a) }))
vi.mock("@/lib/email", () => ({ sendEventSignupConfirmedEmail: (...a: unknown[]) => sendConfirmedMock(...a) }))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
  NoAccessibleBusinessError,
}))

function makeReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/events/evt-1/signups/sig-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: "evt-1", signupId: "sig-1" }) }

const sigMatching = { id: "sig-1", event_id: "evt-1", parent_email: "a@x.com", status: "pending" }

describe("PATCH /api/admin/events/[id]/signups/[signupId]", () => {
  beforeEach(() => {
    authMock.mockReset()
    getSignupByIdMock.mockReset()
    getEventByIdMock.mockReset()
    confirmSignupMock.mockReset()
    cancelSignupMock.mockReset()
    sendConfirmedMock.mockClear()
    resolveTenantMock.mockReset()
    authMock.mockResolvedValue({ user: { id: "u1", role: "admin" } })
    resolveTenantMock.mockResolvedValue({ businessId: "admin-biz", choices: [], isOperator: true })
  })

  it("returns 403 when not admin", async () => {
    authMock.mockResolvedValueOnce(null)
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(403)
  })

  it("returns 403 when the caller has no accessible business", async () => {
    resolveTenantMock.mockRejectedValueOnce(new NoAccessibleBusinessError())
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(403)
    expect(getSignupByIdMock).not.toHaveBeenCalled()
  })

  it("returns 404 when signup does not belong to event", async () => {
    getSignupByIdMock.mockResolvedValueOnce({ ...sigMatching, event_id: "other-evt" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(404)
  })

  it("returns 400 on invalid action", async () => {
    getSignupByIdMock.mockResolvedValueOnce(sigMatching)
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "reject" }), ctx)
    expect(res.status).toBe(400)
  })

  it("maps not_pending to 409 on confirm", async () => {
    getSignupByIdMock.mockResolvedValue(sigMatching)
    confirmSignupMock.mockResolvedValueOnce({ ok: false, reason: "not_pending" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(409)
  })

  it("maps at_capacity to 409 on confirm", async () => {
    getSignupByIdMock.mockResolvedValue(sigMatching)
    confirmSignupMock.mockResolvedValueOnce({ ok: false, reason: "at_capacity" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(409)
  })

  it("confirm happy path returns refetched signup and fires email", async () => {
    getSignupByIdMock.mockResolvedValueOnce(sigMatching)
    confirmSignupMock.mockResolvedValueOnce({ ok: true })
    getSignupByIdMock.mockResolvedValueOnce({ ...sigMatching, status: "confirmed" })
    getEventByIdMock.mockResolvedValueOnce({
      id: "evt-1",
      title: "T",
      type: "clinic",
      slug: "s",
      start_date: "",
      location_name: "L",
    })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(200)
    expect(sendConfirmedMock).toHaveBeenCalled()
    const data = await res.json()
    expect(data.signup.status).toBe("confirmed")
  })

  // MUTANT: getSignupById(signupId) / confirmSignup(signupId) / cancelSignup(signupId)
  // / getEventById(id) with no leading businessId. TypeScript cannot catch a
  // swap here (both remaining params are strings), so this asserts the
  // resolved tenant reaches every one of them, in the businessId-first slot.
  it("threads the resolved tenant into every DAL call, not the platform id", async () => {
    getSignupByIdMock.mockResolvedValueOnce(sigMatching)
    confirmSignupMock.mockResolvedValueOnce({ ok: true })
    getSignupByIdMock.mockResolvedValueOnce({ ...sigMatching, status: "confirmed" })
    getEventByIdMock.mockResolvedValueOnce({
      id: "evt-1",
      title: "T",
      type: "clinic",
      slug: "s",
      start_date: "",
      location_name: "L",
    })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "confirm" }), ctx)
    expect(res.status).toBe(200)
    expect(getSignupByIdMock).toHaveBeenCalledWith("admin-biz", "sig-1")
    expect(confirmSignupMock).toHaveBeenCalledWith("admin-biz", "sig-1")
    expect(getEventByIdMock).toHaveBeenCalledWith("admin-biz", "evt-1")
  })

  it("cancel happy path returns refetched signup, no email", async () => {
    getSignupByIdMock.mockResolvedValueOnce(sigMatching)
    cancelSignupMock.mockResolvedValueOnce({ ok: true })
    getSignupByIdMock.mockResolvedValueOnce({ ...sigMatching, status: "cancelled" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "cancel" }), ctx)
    expect(res.status).toBe(200)
    expect(sendConfirmedMock).not.toHaveBeenCalled()
    expect(cancelSignupMock).toHaveBeenCalledWith("admin-biz", "sig-1")
  })

  it("cancel maps not_cancellable to 409", async () => {
    getSignupByIdMock.mockResolvedValueOnce(sigMatching)
    cancelSignupMock.mockResolvedValueOnce({ ok: false, reason: "not_cancellable" })
    const { PATCH } = await import("@/app/api/admin/events/[id]/signups/[signupId]/route")
    const res = await PATCH(makeReq({ action: "cancel" }), ctx)
    expect(res.status).toBe(409)
  })
})
