import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const getPackageByStripeSessionMock = vi.fn()
const activatePaidPackageMock = vi.fn()

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  resolveSessionPaymentIntent: vi.fn(async () => null),
  stripe: {},
}))
vi.mock("@/lib/db/client-packages", () => ({
  getPackageByStripeSession: (...a: unknown[]) => getPackageByStripeSessionMock(...a),
  getPackageByStripePaymentId: vi.fn(),
  updateClientPackage: vi.fn(),
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
