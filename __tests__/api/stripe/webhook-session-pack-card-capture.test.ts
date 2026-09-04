// @vitest-environment node
//
// Pinned to node: the default jsdom environment crashes on worker start
// in this repo (ERR_REQUIRE_ESM in html-encoding-sniffer), and reports as
// "Test Files no tests" rather than a failure. Without this line the suite
// silently runs nothing.
import { describe, it, expect, vi, beforeEach } from "vitest"

// Task 6 regression guard: the webhook's session_pack completion handler
// must save the card against the PAYER (billingUserId), never the trainee,
// only when the checkbox was actually consented to (I5), preferring the
// identity stamped into checkout metadata over re-resolving it (Concern A),
// and must never let a card-save failure block pack creation. This is the
// second half of the highest-risk task in the pack-auto-renew plan — the
// first half (createPackCheckoutSession addressee branch) is covered by
// __tests__/lib/stripe/pack-checkout-card-capture.test.ts.

const verifyMock = vi.fn()
const getPackageByStripeSessionMock = vi.fn()
const activatePaidPackageMock = vi.fn()
const updateClientPackageMock = vi.fn()
const resolveBillingUserIdMock = vi.fn()
const upsertPmMock = vi.fn()
const piRetrieveMock = vi.fn()
const pmRetrieveMock = vi.fn()
const getUserByIdMock = vi.fn()
const cardOnFileEnabledMock = vi.fn()

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  resolveSessionPaymentIntent: vi.fn(async () => "pi_1"),
  stripe: {
    paymentIntents: { retrieve: (...a: unknown[]) => piRetrieveMock(...a) },
    paymentMethods: { retrieve: (...a: unknown[]) => pmRetrieveMock(...a) },
  },
}))
vi.mock("@/lib/db/client-packages", () => ({
  getPackageByStripeSession: (...a: unknown[]) => getPackageByStripeSessionMock(...a),
  getPackageByStripePaymentId: vi.fn(),
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
}))
vi.mock("@/lib/services/session-credits", () => ({ activatePaidPackage: (...a: unknown[]) => activatePaidPackageMock(...a) }))
vi.mock("@/lib/services/billing-payer", () => ({ resolveBillingUserId: (...a: unknown[]) => resolveBillingUserIdMock(...a) }))
vi.mock("@/lib/db/payment-methods", () => ({ upsertDefaultPaymentMethod: (...a: unknown[]) => upsertPmMock(...a) }))
vi.mock("@/lib/db/payments", () => ({ createPayment: vi.fn(), getPaymentByStripeId: vi.fn(async () => null), updatePayment: vi.fn() }))
vi.mock("@/lib/ads/conversions", () => ({ enqueuePaymentValueAdjustmentByEmail: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/marketing-attribution", () => ({ findAttributionForContact: vi.fn(async () => null) }))
vi.mock("@/lib/db/subscriptions", () => ({
  createSubscription: vi.fn(), getSubscriptionByStripeId: vi.fn(), updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserByEmail: vi.fn(async () => null), getUserById: (...a: unknown[]) => getUserByIdMock(...a) }))
vi.mock("@/lib/packs/flags", () => ({ cardOnFileEnabled: (...a: unknown[]) => cardOnFileEnabledMock(...a) }))
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

const PKG = {
  id: "pkg-1",
  client_user_id: "trainee-1",
  payment_status: "pending",
  credits_total: 10,
  price_cents: 50000,
}

function packCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_pack_1",
        metadata: { type: "session_pack", autoRenew: "true" },
        payment_intent: "pi_1",
        customer: "cus_payer",
        amount_total: 50000,
        currency: "usd",
        customer_details: { email: null },
        ...overrides,
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
  getPackageByStripeSessionMock.mockResolvedValue(PKG)
  cardOnFileEnabledMock.mockResolvedValue(true)
  resolveBillingUserIdMock.mockResolvedValue("payer-1")
  getUserByIdMock.mockResolvedValue({ id: "payer-1", stripe_customer_id: "cus_payer" })
  piRetrieveMock.mockResolvedValue({ id: "pi_1", payment_method: "pm_1" })
  pmRetrieveMock.mockResolvedValue({ id: "pm_1", card: { brand: "visa", last4: "4242", exp_month: 1, exp_year: 2030 } })
  upsertPmMock.mockResolvedValue(undefined)
  updateClientPackageMock.mockResolvedValue(undefined)
})

describe("Stripe webhook — session_pack card capture (Task 6)", () => {
  it("saves the card against the PAYER (billingUserId), never the trainee", async () => {
    verifyMock.mockReturnValue(packCompletedEvent())
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    // No metadata.billingUserId in this fixture, so falls back to re-resolving.
    expect(resolveBillingUserIdMock).toHaveBeenCalledWith("trainee-1")
    expect(upsertPmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "payer-1",
        stripe_payment_method_id: "pm_1",
        last4: "4242",
        is_default: true,
      }),
    )
    // Sanity: never asserted the wrong identity by accident.
    expect(upsertPmMock).not.toHaveBeenCalledWith(expect.objectContaining({ user_id: "trainee-1" }))
  })

  it("prefers the billingUserId stamped in checkout metadata over re-resolving (Concern A)", async () => {
    verifyMock.mockReturnValue(
      packCompletedEvent({ metadata: { type: "session_pack", autoRenew: "true", billingUserId: "payer-1" } }),
    )
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    // resolveBillingUserId would re-resolve independently, which is exactly
    // the TOCTOU this stamped identity exists to avoid — must not be called.
    expect(resolveBillingUserIdMock).not.toHaveBeenCalled()
    expect(upsertPmMock).toHaveBeenCalledWith(expect.objectContaining({ user_id: "payer-1" }))
  })

  it("skips the card save (and does not throw) when the resolved identity's stripe_customer_id does not match session.customer (Concern A)", async () => {
    // Simulates a stale/incorrect identity resolution: getUserById returns a
    // payer whose Stripe customer differs from the one this session actually
    // attached — must not save under a possibly-wrong user_id.
    getUserByIdMock.mockResolvedValue({ id: "payer-1", stripe_customer_id: "cus_someone_else" })
    verifyMock.mockReturnValue(packCompletedEvent())
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(upsertPmMock).not.toHaveBeenCalled()
  })

  it("arms auto_renew on the pack when metadata says the checkbox was checked", async () => {
    verifyMock.mockReturnValue(packCompletedEvent())
    await POST(makeReq())
    expect(updateClientPackageMock).toHaveBeenCalledWith("pkg-1", { auto_renew: true })
  })

  it("does not touch auto_renew when the checkbox was left unchecked", async () => {
    verifyMock.mockReturnValue(packCompletedEvent({ metadata: { type: "session_pack", autoRenew: "false" } }))
    await POST(makeReq())
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("saves no card when autoRenew was not consented to, even though a customer is attached (I5)", async () => {
    verifyMock.mockReturnValue(packCompletedEvent({ metadata: { type: "session_pack", autoRenew: "false" } }))
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(upsertPmMock).not.toHaveBeenCalled()
    // Consent gating happens before any identity resolution — don't even
    // spend the round-trip.
    expect(resolveBillingUserIdMock).not.toHaveBeenCalled()
  })

  it("saves no card when card_on_file_enabled is off, even with consent (I5 kill switch)", async () => {
    cardOnFileEnabledMock.mockResolvedValue(false)
    verifyMock.mockReturnValue(packCompletedEvent())
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(upsertPmMock).not.toHaveBeenCalled()
    // Gated before any identity resolution, same as the consent check.
    expect(resolveBillingUserIdMock).not.toHaveBeenCalled()
    // auto_renew arming is a separate concern from card CAPTURE — a pack can
    // still be armed even if, for whatever reason, capture is switched off.
    expect(updateClientPackageMock).toHaveBeenCalledWith("pkg-1", { auto_renew: true })
  })

  it("saves no card for an account-less billToEmail payer (no Stripe customer attached), even with consent", async () => {
    verifyMock.mockReturnValue(packCompletedEvent({ customer: null }))
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(upsertPmMock).not.toHaveBeenCalled()
    expect(resolveBillingUserIdMock).not.toHaveBeenCalled()
  })

  it("is best-effort: a card-save failure does not fail the pack activation", async () => {
    verifyMock.mockReturnValue(packCompletedEvent())
    piRetrieveMock.mockRejectedValue(new Error("stripe down"))
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(activatePaidPackageMock).toHaveBeenCalled()
  })
})
