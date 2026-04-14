import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const getSignupByIdMock = vi.fn()
const confirmSignupMock = vi.fn()
const cancelSignupMock = vi.fn()
const getEventByIdMock = vi.fn()
const getSignupByPiMock = vi.fn()
const updateSignupMock = vi.fn(async () => undefined)

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
}))
vi.mock("@/lib/db/event-signups", () => ({
  getSignupById: (...a: unknown[]) => getSignupByIdMock(...a),
  confirmSignup: (...a: unknown[]) => confirmSignupMock(...a),
  cancelSignup: (...a: unknown[]) => cancelSignupMock(...a),
  getEventSignupByPaymentIntent: (...a: unknown[]) => getSignupByPiMock(...a),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventByIdMock(...a) }))
vi.mock("@/lib/email", () => ({
  sendEventSignupConfirmedEmail: vi.fn(async () => undefined),
  sendCoachPurchaseNotification: vi.fn(async () => undefined),
}))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => ({ eq: updateSignupMock }),
    }),
  }),
}))
// Stub modules the existing webhook imports for program flow
vi.mock("@/lib/db/payments", () => ({
  createPayment: vi.fn(), getPaymentByStripeId: vi.fn(), updatePayment: vi.fn(),
}))
vi.mock("@/lib/db/assignments", () => ({
  createAssignment: vi.fn(), getAssignmentByUserAndProgram: vi.fn(), updateAssignment: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({
  updateWeekAccess: vi.fn(), createWeekAccessBulk: vi.fn(),
}))
vi.mock("@/lib/db/subscriptions", () => ({
  createSubscription: vi.fn(), getSubscriptionByStripeId: vi.fn(), updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn() }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(), ghlTriggerWorkflow: vi.fn() }))

function makeReq(body: string = "{}") {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test_sig" },
    body,
  })
}

describe("Stripe webhook — event_signup branches", () => {
  beforeEach(async () => {
    verifyMock.mockReset()
    getSignupByIdMock.mockReset()
    confirmSignupMock.mockReset()
    cancelSignupMock.mockReset()
    getEventByIdMock.mockReset()
    getSignupByPiMock.mockReset()
    updateSignupMock.mockClear()
    const { sendEventSignupConfirmedEmail } = await import("@/lib/email")
    vi.mocked(sendEventSignupConfirmedEmail).mockClear()
  })

  it("checkout.session.completed with event_signup metadata confirms signup + sends email", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { type: "event_signup", event_signup_id: "sig-1", event_id: "evt-1" },
          payment_intent: "pi_test_1",
          amount_total: 29900,
        },
      },
    })
    confirmSignupMock.mockResolvedValueOnce({ ok: true })
    getSignupByIdMock.mockResolvedValueOnce({ id: "sig-1", parent_email: "a@x.com", status: "confirmed" })
    getEventByIdMock.mockResolvedValueOnce({ id: "evt-1", title: "Camp", type: "camp", slug: "c", start_date: "" })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const { sendEventSignupConfirmedEmail } = await import("@/lib/email")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(confirmSignupMock).toHaveBeenCalledWith("sig-1")
    expect(sendEventSignupConfirmedEmail).toHaveBeenCalled()
  })

  it("checkout.session.completed without event_signup metadata does not invoke event handlers", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: { object: { mode: "payment", metadata: {}, payment_intent: "pi_x" } },
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const { sendEventSignupConfirmedEmail } = await import("@/lib/email")
    const res = await POST(makeReq())
    expect(confirmSignupMock).not.toHaveBeenCalled()
    expect(sendEventSignupConfirmedEmail).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it("idempotent: confirmSignup returning not_pending does not throw and does not send email", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { type: "event_signup", event_signup_id: "sig-1", event_id: "evt-1" },
          payment_intent: "pi_x", amount_total: 29900,
        },
      },
    })
    confirmSignupMock.mockResolvedValueOnce({ ok: false, reason: "not_pending" })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const { sendEventSignupConfirmedEmail } = await import("@/lib/email")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(sendEventSignupConfirmedEmail).not.toHaveBeenCalled()
  })

  it("charge.refunded matching an event signup flips status to refunded", async () => {
    verifyMock.mockReturnValueOnce({
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_test_1" } },
    })
    getSignupByPiMock.mockResolvedValueOnce({ id: "sig-1", status: "confirmed" })
    cancelSignupMock.mockResolvedValueOnce({ ok: true })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(cancelSignupMock).toHaveBeenCalledWith("sig-1")
    expect(updateSignupMock).toHaveBeenCalled()
  })
})
