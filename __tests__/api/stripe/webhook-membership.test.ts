import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const createMembershipMock = vi.fn()
const getMembershipMock = vi.fn()
const updateMembershipMock = vi.fn()

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  resolveSessionPaymentIntent: vi.fn(async () => null),
  retrieveSetupCard: vi.fn(),
  stripe: {},
}))
vi.mock("@/lib/db/client-memberships", () => ({
  createClientMembership: (...a: unknown[]) => createMembershipMock(...a),
  getMembershipBySubscriptionId: (...a: unknown[]) => getMembershipMock(...a),
  updateMembershipBySubscriptionId: (...a: unknown[]) => updateMembershipMock(...a),
}))
vi.mock("@/lib/db/payment-methods", () => ({ upsertDefaultPaymentMethod: vi.fn() }))
vi.mock("@/lib/db/client-packages", () => ({ getPackageByStripeSession: vi.fn(), getPackageByStripePaymentId: vi.fn(), updateClientPackage: vi.fn() }))
vi.mock("@/lib/services/session-credits", () => ({ activatePaidPackage: vi.fn() }))
vi.mock("@/lib/db/payments", () => ({ createPayment: vi.fn(), getPaymentByStripeId: vi.fn(async () => null), updatePayment: vi.fn() }))
vi.mock("@/lib/ads/conversions", () => ({ enqueuePaymentValueAdjustmentByEmail: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/marketing-attribution", () => ({ findAttributionByEmail: vi.fn() }))
vi.mock("@/lib/db/subscriptions", () => ({ createSubscription: vi.fn(), getSubscriptionByStripeId: vi.fn(async () => null), updateSubscriptionByStripeId: vi.fn() }))
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

const makeReq = () => new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" })

beforeEach(() => {
  vi.clearAllMocks()
  getMembershipMock.mockResolvedValue(null)
})

describe("Stripe webhook — session_membership", () => {
  it("creates a client_membership on a membership checkout", async () => {
    verifyMock.mockReturnValue({
      id: "evt",
      type: "checkout.session.completed",
      data: { object: { id: "cs", mode: "subscription", subscription: "sub_1", metadata: { type: "session_membership", userId: "u1", planId: "p1" } } },
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(createMembershipMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", plan_id: "p1", stripe_subscription_id: "sub_1", status: "active" }),
    )
  })

  it("cancels the membership on customer.subscription.deleted", async () => {
    getMembershipMock.mockResolvedValue({ id: "m1", user_id: "u1", stripe_subscription_id: "sub_1" })
    verifyMock.mockReturnValue({
      id: "evt",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", status: "canceled" } },
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(updateMembershipMock).toHaveBeenCalledWith("sub_1", expect.objectContaining({ status: "canceled" }))
  })
})
