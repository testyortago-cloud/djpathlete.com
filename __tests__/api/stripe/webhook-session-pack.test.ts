import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const getPackageByStripeSessionMock = vi.fn()
const getPackageByStripePaymentIdMock = vi.fn()
const updateClientPackageMock = vi.fn()
const activatePaidPackageMock = vi.fn()

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  resolveSessionPaymentIntent: vi.fn(async () => null),
  stripe: {},
}))
vi.mock("@/lib/db/client-packages", () => ({
  getPackageByStripeSession: (...a: unknown[]) => getPackageByStripeSessionMock(...a),
  getPackageByStripePaymentId: (...a: unknown[]) => getPackageByStripePaymentIdMock(...a),
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
}))
vi.mock("@/lib/services/session-credits", () => ({ activatePaidPackage: (...a: unknown[]) => activatePaidPackageMock(...a) }))
vi.mock("@/lib/db/payments", () => ({ createPayment: vi.fn(), getPaymentByStripeId: vi.fn(async () => null), updatePayment: vi.fn() }))
vi.mock("@/lib/ads/conversions", () => ({ enqueuePaymentValueAdjustmentByEmail: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/marketing-attribution", () => ({ findAttributionByEmail: vi.fn() }))
vi.mock("@/lib/db/subscriptions", () => ({
  createSubscription: vi.fn(), getSubscriptionByStripeId: vi.fn(), updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserByEmail: vi.fn(async () => null), getUserById: vi.fn() }))
vi.mock("@/lib/db/assignments", () => ({ createAssignment: vi.fn(), getAssignmentByUserAndProgram: vi.fn(), updateAssignment: vi.fn() }))
vi.mock("@/lib/db/week-access", () => ({ updateWeekAccess: vi.fn(), createWeekAccessBulk: vi.fn() }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/db/event-signups", () => ({
  confirmSignup: vi.fn(), cancelSignup: vi.fn(), getSignupById: vi.fn(), getEventSignupByPaymentIntent: vi.fn(),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn() }))
vi.mock("@/lib/shop/webhooks", () => ({ handleShopOrderCheckout: vi.fn() }))
vi.mock("@/lib/email", () => ({
  sendCoachPurchaseNotification: vi.fn(), sendEventSignupConfirmedEmail: vi.fn(), sendEventSignupOverbookRefundEmail: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(), ghlTriggerWorkflow: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({ from: () => ({ update: () => ({ eq: vi.fn() }) }) }) }))

import { POST } from "@/app/api/stripe/webhook/route"

function packCompletedEvent() {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_pack_1",
        metadata: { type: "session_pack" },
        payment_intent: null,
        amount_total: 50000,
        currency: "usd",
        customer: null,
        customer_details: { email: null },
      },
    },
  }
}

function refundEvent(paymentIntentId: string | null = "pi_renew_1") {
  return {
    id: "evt_refund_1",
    type: "charge.refunded",
    data: { object: { payment_intent: paymentIntentId } },
  }
}

function makeReq() {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test_sig" },
    body: "{}",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyMock.mockReturnValue(packCompletedEvent())
  getPackageByStripePaymentIdMock.mockResolvedValue(null)
  updateClientPackageMock.mockResolvedValue(undefined)
})

describe("Stripe webhook — session_pack completed", () => {
  it("throws (HTTP 500) when no pack matches the session, so Stripe retries", async () => {
    getPackageByStripeSessionMock.mockResolvedValue(null)
    const res = await POST(makeReq())
    expect(res.status).toBe(500)
    expect(activatePaidPackageMock).not.toHaveBeenCalled()
  })

  it("activates the pending pack and returns 200 when the pack is found", async () => {
    getPackageByStripeSessionMock.mockResolvedValue({
      id: "pkg-1",
      client_user_id: "c1",
      payment_status: "pending",
      credits_total: 10,
      price_cents: 50000,
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(activatePaidPackageMock).toHaveBeenCalledWith(expect.objectContaining({ id: "pkg-1" }), null)
  })

  it("is idempotent — skips re-activation when already paid", async () => {
    getPackageByStripeSessionMock.mockResolvedValue({
      id: "pkg-1",
      client_user_id: "c1",
      payment_status: "paid",
      credits_total: 10,
      price_cents: 50000,
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(activatePaidPackageMock).not.toHaveBeenCalled()
  })
})

// I1 regression: an auto-renewal charge used to leave stripe_payment_id null
// on the pack it created, so getPackageByStripePaymentId could never match a
// refund of that charge — the payments row would flip to refunded while the
// pack stayed paid/active with a full set of credits. pack-renewal.ts now
// stamps the NEW PaymentIntent id onto the renewal pack; these tests cover
// the webhook side of that fix — that a match, once found, is acted on.
describe("Stripe webhook — session_pack refund (I1)", () => {
  it("flips a matched pack to refunded, clawing back its credits", async () => {
    verifyMock.mockReturnValue(refundEvent("pi_renew_1"))
    getPackageByStripePaymentIdMock.mockResolvedValue({
      id: "renewal-pkg-1",
      client_user_id: "c1",
      status: "active",
      payment_status: "paid",
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(getPackageByStripePaymentIdMock).toHaveBeenCalledWith("pi_renew_1")
    expect(updateClientPackageMock).toHaveBeenCalledWith("renewal-pkg-1", {
      status: "refunded",
      payment_status: "refunded",
    })
  })

  it("is a no-op when no pack matches the refunded PaymentIntent (e.g. stripe_payment_id was never stamped)", async () => {
    verifyMock.mockReturnValue(refundEvent("pi_orphan"))
    getPackageByStripePaymentIdMock.mockResolvedValue(null)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("does not re-refund a pack that's already marked refunded", async () => {
    verifyMock.mockReturnValue(refundEvent("pi_renew_1"))
    getPackageByStripePaymentIdMock.mockResolvedValue({
      id: "renewal-pkg-1",
      client_user_id: "c1",
      status: "refunded",
      payment_status: "refunded",
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })
})
