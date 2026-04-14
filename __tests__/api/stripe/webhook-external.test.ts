import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createPaymentMock = vi.fn(async (..._a: any[]) => ({ id: "pay-1" }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createSubscriptionMock = vi.fn(async (..._a: any[]) => ({ id: "sub-1" }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPaymentByStripeIdMock = vi.fn(async (..._a: any[]) => null as any)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getSubscriptionByStripeIdMock = vi.fn(async (..._a: any[]) => null as any)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getUserByEmailMock = vi.fn(async (..._a: any[]) => null as any)

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  resolveSessionPaymentIntent: vi.fn(async (session: { payment_intent?: string | null }) => session.payment_intent ?? null),
}))
vi.mock("@/lib/db/payments", () => ({
  createPayment: (...a: unknown[]) => createPaymentMock(...a),
  getPaymentByStripeId: (...a: unknown[]) => getPaymentByStripeIdMock(...a),
  updatePayment: vi.fn(),
}))
vi.mock("@/lib/db/subscriptions", () => ({
  createSubscription: (...a: unknown[]) => createSubscriptionMock(...a),
  getSubscriptionByStripeId: (...a: unknown[]) => getSubscriptionByStripeIdMock(...a),
  updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({
  getUserByEmail: (...a: unknown[]) => getUserByEmailMock(...a),
  getUserById: vi.fn(),
}))
// Stub all other DB modules the existing webhook imports
vi.mock("@/lib/db/assignments", () => ({
  createAssignment: vi.fn(), getAssignmentByUserAndProgram: vi.fn(), updateAssignment: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({
  updateWeekAccess: vi.fn(), createWeekAccessBulk: vi.fn(),
}))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/db/event-signups", () => ({
  confirmSignup: vi.fn(), cancelSignup: vi.fn(), getSignupById: vi.fn(),
  getEventSignupByPaymentIntent: vi.fn(),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn() }))
vi.mock("@/lib/email", () => ({
  sendCoachPurchaseNotification: vi.fn(),
  sendEventSignupConfirmedEmail: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(), ghlTriggerWorkflow: vi.fn() }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => ({ eq: vi.fn(async () => undefined) }),
    }),
  }),
}))

function makeReq(body = "{}") {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test_sig" },
    body,
  })
}

describe("Stripe webhook — external (metadata-less) checkouts", () => {
  beforeEach(() => {
    verifyMock.mockReset()
    createPaymentMock.mockClear()
    createSubscriptionMock.mockClear()
    getPaymentByStripeIdMock.mockReset()
    getPaymentByStripeIdMock.mockResolvedValue(null)
    getSubscriptionByStripeIdMock.mockReset()
    getSubscriptionByStripeIdMock.mockResolvedValue(null)
    getUserByEmailMock.mockReset()
    getUserByEmailMock.mockResolvedValue(null)
  })

  it("one-time checkout without metadata records as external payment with user_id=null", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: {},
          payment_intent: "pi_ext_1",
          customer: "cus_ext_1",
          customer_details: { email: "stranger@example.com" },
          amount_total: 14250,
          currency: "usd",
          id: "cs_ext_1",
        },
      },
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(createPaymentMock).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = createPaymentMock.mock.calls[0][0] as any as { user_id: string | null; description: string }
    expect(arg.user_id).toBeNull()
    expect(arg.description).toBe("External Stripe checkout")
  })

  it("links external payment to existing user when email matches", async () => {
    getUserByEmailMock.mockResolvedValueOnce({ id: "user-99", email: "known@example.com" })
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: {},
          payment_intent: "pi_ext_2",
          customer: "cus_ext_2",
          customer_details: { email: "known@example.com" },
          amount_total: 9900,
          currency: "usd",
          id: "cs_ext_2",
        },
      },
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = createPaymentMock.mock.calls[0][0] as any as { user_id: string | null }
    expect(arg.user_id).toBe("user-99")
  })

  it("subscription checkout without metadata creates external subscription + initial payment", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: {},
          subscription: "sub_ext_1",
          payment_intent: "pi_ext_3",
          customer: "cus_ext_3",
          customer_details: { email: "stranger@example.com" },
          amount_total: 48000,
          currency: "usd",
          id: "cs_ext_3",
        },
      },
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subArg = createSubscriptionMock.mock.calls[0][0] as any as { user_id: string | null; program_id: string | null }
    expect(subArg.user_id).toBeNull()
    expect(subArg.program_id).toBeNull()
    expect(createPaymentMock).toHaveBeenCalledTimes(1)
  })

  it("idempotent: skips when payment row already exists", async () => {
    getPaymentByStripeIdMock.mockResolvedValueOnce({ id: "pay-existing" })
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: {},
          payment_intent: "pi_ext_dup",
          customer: "cus_x",
          customer_details: { email: "x@x.com" },
          amount_total: 100,
          currency: "usd",
          id: "cs_dup",
        },
      },
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(createPaymentMock).not.toHaveBeenCalled()
  })

  it("external subscription with null session.payment_intent resolves PI from latest_invoice", async () => {
    const stripeMod = await import("@/lib/stripe")
    const resolveSpy = vi.spyOn(stripeMod, "resolveSessionPaymentIntent").mockResolvedValueOnce("pi_resolved_1")

    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: {},
          subscription: "sub_ext_5",
          payment_intent: null,
          customer: "cus_ext_5",
          customer_details: { email: "stranger@example.com" },
          amount_total: 24000,
          currency: "usd",
          id: "cs_ext_5",
        },
      },
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(createPaymentMock).toHaveBeenCalledTimes(1)
    const arg = createPaymentMock.mock.calls[0][0] as { stripe_payment_id: string }
    expect(arg.stripe_payment_id).toBe("pi_resolved_1")

    resolveSpy.mockRestore()
  })
})
