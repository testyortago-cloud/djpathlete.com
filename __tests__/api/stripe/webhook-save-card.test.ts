import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const retrieveCardMock = vi.fn()
const upsertPmMock = vi.fn()

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  resolveSessionPaymentIntent: vi.fn(async () => null),
  retrieveSetupCard: (...a: unknown[]) => retrieveCardMock(...a),
  stripe: {},
}))
vi.mock("@/lib/db/payment-methods", () => ({ upsertDefaultPaymentMethod: (...a: unknown[]) => upsertPmMock(...a) }))
vi.mock("@/lib/db/client-packages", () => ({ getPackageByStripeSession: vi.fn(), getPackageByStripePaymentId: vi.fn(), updateClientPackage: vi.fn() }))
vi.mock("@/lib/services/session-credits", () => ({ activatePaidPackage: vi.fn() }))
vi.mock("@/lib/db/payments", () => ({ createPayment: vi.fn(), getPaymentByStripeId: vi.fn(async () => null), updatePayment: vi.fn() }))
vi.mock("@/lib/ads/conversions", () => ({ enqueuePaymentValueAdjustmentByEmail: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/marketing-attribution", () => ({ findAttributionByEmail: vi.fn() }))
vi.mock("@/lib/db/subscriptions", () => ({ createSubscription: vi.fn(), getSubscriptionByStripeId: vi.fn(), updateSubscriptionByStripeId: vi.fn() }))
vi.mock("@/lib/db/users", () => ({ getUserByEmail: vi.fn(async () => null), getUserById: vi.fn() }))
vi.mock("@/lib/db/assignments", () => ({ createAssignment: vi.fn(), getAssignmentByUserAndProgram: vi.fn(), updateAssignment: vi.fn() }))
vi.mock("@/lib/db/week-access", () => ({ updateWeekAccess: vi.fn(), createWeekAccessBulk: vi.fn() }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/db/event-signups", () => ({ confirmSignup: vi.fn(), cancelSignup: vi.fn(), getSignupById: vi.fn(), getEventSignupByPaymentIntent: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn() }))
vi.mock("@/lib/shop/webhooks", () => ({ handleShopOrderCheckout: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendCoachPurchaseNotification: vi.fn(), sendEventSignupConfirmedEmail: vi.fn(), sendEventSignupOverbookRefundEmail: vi.fn() }))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(), ghlTriggerWorkflow: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({ from: () => ({ update: () => ({ eq: vi.fn() }) }) }) }))

import { POST } from "@/app/api/stripe/webhook/route"

function saveCardEvent() {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_setup", mode: "setup", metadata: { type: "save_card", userId: "u1" }, setup_intent: "seti_1" } },
  }
}

function makeReq() {
  return new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" })
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyMock.mockReturnValue(saveCardEvent())
  retrieveCardMock.mockResolvedValue({ paymentMethodId: "pm_1", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 })
})

describe("Stripe webhook — save_card", () => {
  it("stores the saved card as the client's default and returns 200", async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(upsertPmMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", stripe_payment_method_id: "pm_1", last4: "4242", is_default: true }),
    )
  })

  it("no-ops (still 200) when the card can't be resolved", async () => {
    retrieveCardMock.mockResolvedValue(null)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(upsertPmMock).not.toHaveBeenCalled()
  })
})
