// @vitest-environment node
//
// Pinned to node: the default jsdom environment crashes on worker start
// in this repo (ERR_REQUIRE_ESM in html-encoding-sniffer), and reports as
// "Test Files no tests" rather than a failure. Without this line the suite
// silently runs nothing.
import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const getPackageByStripeSessionMock = vi.fn()
const getPackageByStripePaymentIdMock = vi.fn()
const updateClientPackageMock = vi.fn()
const activatePaidPackageMock = vi.fn()
const findContactMock = vi.fn()
const captureLeadMock = vi.fn(async (..._args: unknown[]) => "contact-1")

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
vi.mock("@/lib/db/marketing-attribution", () => ({ findAttributionForContact: vi.fn(async () => null) }))
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
// checkout.session.expired's abandoned-checkout capture (Lead Engine) needs
// these three real; without them findContactWithBusinessByIdentifiers hits
// the unmocked-select @/lib/supabase double above and throws UNCAUGHT (that
// call, unlike its completed-case sibling, has no try/catch of its own),
// which would 500 the whole webhook and mask the session-pack regression
// this file exists to guard.
vi.mock("@/lib/db/contacts", () => ({
  findContactWithBusinessByIdentifiers: (...a: unknown[]) => findContactMock(...a),
}))
vi.mock("@/lib/lead-engine/capture", () => ({ captureLead: (...a: unknown[]) => captureLeadMock(...a) }))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

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

function packExpiredEvent() {
  return {
    id: "evt_2",
    type: "checkout.session.expired",
    data: {
      object: {
        id: "cs_pack_2",
        metadata: { type: "session_pack" },
        customer_email: "pack-buyer@example.com",
        customer_details: null,
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
  findContactMock.mockResolvedValue(null)
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

// Task 2 (Lead Engine, sequence-content-and-branching): checkout.session.expired
// used to only reap an abandoned session pack. It now ALSO records a
// checkout_abandoned contact event — this suite's job is to prove the new
// capture code did not displace the pre-existing reap.
describe("Stripe webhook — session_pack expired", () => {
  it("still reaps an abandoned session pack", async () => {
    verifyMock.mockReturnValue(packExpiredEvent())
    getPackageByStripeSessionMock.mockResolvedValue({
      id: "pkg-2",
      client_user_id: "c1",
      payment_status: "pending",
      credits_used: 0,
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(updateClientPackageMock).toHaveBeenCalledWith("pkg-2", { status: "cancelled" })

    // "session_pack" is deliberately NOT a member of NON_COACHING_CHECKOUT_TYPES
    // (that set is {shop_order, event_signup, save_card} — see its own doc
    // comment in the route) — a session pack is a coaching sale, same as it
    // is on the completed side, where its capture already runs unconditionally.
    // So the abandoned-checkout gate, reusing that same set, does NOT exclude
    // it either: the reap and the lead capture both fire for an abandoned
    // pack checkout.
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({
      source: "checkout_abandoned",
      email: "pack-buyer@example.com",
    })
  })

  it("does not reap a pack that was already paid before it expired", async () => {
    verifyMock.mockReturnValue(packExpiredEvent())
    getPackageByStripeSessionMock.mockResolvedValue({
      id: "pkg-3",
      client_user_id: "c1",
      payment_status: "paid",
      credits_used: 0,
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(updateClientPackageMock).not.toHaveBeenCalled()
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
