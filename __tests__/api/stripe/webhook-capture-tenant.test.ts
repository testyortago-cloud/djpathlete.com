// @vitest-environment node
//
// checkout.session.completed — WHICH business the purchase capture files under.
//
// The webhook has no tenant of its own: one Stripe account serves every
// business. The pipeline half already resolves the payer's contact row and
// takes the business from it. The capture half used to call captureLead with
// no tenant at all, falling to the DAL's default. Now it is the NARROWER
// VARIANT of the platform.ts seam: the contact's business when the payer
// already has a contact row, platformBusinessId() only for a first-time payer.
//
// Three cases, and the third is the one that matters: the contact lookup sits
// inside a try/catch whose job is to keep a payment webhook from 5xx-ing, so
// a THROW there must still leave the capture with a tenant.
import { describe, it, expect, vi, beforeEach } from "vitest"

const OTHER_BUSINESS_ID = "22222222-2222-4222-8222-222222222222"

const verifyMock = vi.fn()
const getSettingMock = vi.fn()
const createPaymentMock = vi.fn(async (_row: unknown) => undefined)
const getPaymentByStripeIdMock = vi.fn(async (_id: unknown): Promise<unknown> => null)
const findContactMock = vi.fn()
const captureLeadMock = vi.fn(async (..._args: unknown[]) => "contact-1")

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  stripe: { refunds: { create: vi.fn() } },
  resolveSessionPaymentIntent: vi.fn(async () => null),
  retrieveSetupCard: vi.fn(),
}))
vi.mock("@/lib/funnels/checkout/grant", () => ({ grantFunnelPurchase: vi.fn() }))
vi.mock("@/lib/funnels/checkout/deps", () => ({ buildGrantDeps: vi.fn(() => ({})) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))
vi.mock("@/lib/db/payments", () => ({
  createPayment: (row: unknown) => createPaymentMock(row),
  getPaymentByStripeId: (id: unknown) => getPaymentByStripeIdMock(id),
  updatePayment: vi.fn(),
}))
vi.mock("@/lib/db/marketing-attribution", () => ({ findAttributionForContact: vi.fn(async () => null) }))
vi.mock("@/lib/db/assignments", () => ({
  createAssignment: vi.fn(),
  getAssignmentByUserAndProgram: vi.fn(),
  updateAssignment: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({ updateWeekAccess: vi.fn(), createWeekAccessBulk: vi.fn() }))
vi.mock("@/lib/db/subscriptions", () => ({
  createSubscription: vi.fn(),
  getSubscriptionByStripeId: vi.fn(async () => null),
  updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn(), getUserByEmail: vi.fn(async () => null) }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/db/event-signups", () => ({
  confirmSignup: vi.fn(),
  cancelSignup: vi.fn(),
  getSignupById: vi.fn(),
  getEventSignupByPaymentIntent: vi.fn(),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn() }))
vi.mock("@/lib/email", () => ({
  sendCoachPurchaseNotification: vi.fn(),
  sendEventSignupConfirmedEmail: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(), ghlTriggerWorkflow: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/ads/conversions", () => ({ enqueuePaymentValueAdjustmentByEmail: vi.fn(async () => undefined) }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: () => ({ update: () => ({ eq: vi.fn(async () => undefined) }) }) }),
}))
// The four this suite is about.
vi.mock("@/lib/db/contacts", () => ({
  findContactWithBusinessByIdentifiers: (...a: unknown[]) => findContactMock(...a),
}))
vi.mock("@/lib/lead-engine/capture", () => ({ captureLead: (...a: unknown[]) => captureLeadMock(...a) }))
vi.mock("@/lib/db/sequences", () => ({ exitRunsForContact: vi.fn(async () => undefined) }))
vi.mock("@/lib/db/pipeline", () => ({
  applyPipelineEvent: vi.fn(async () => ({ decision: { kind: "noop", reason: "test" }, opportunityId: null })),
}))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

function session() {
  return {
    id: "cs_capture_1",
    mode: "payment",
    payment_intent: "pi_capture_1",
    customer: "cus_1",
    amount_total: 4900,
    currency: "usd",
    customer_details: { email: "buyer@example.com", name: "Riley Buyer" },
    // `event_signup` on purpose: the capture runs BEFORE the metadata-type
    // dispatch, and this branch returns at once when `event_signup_id` is
    // absent (handleEventSignupCheckout's first guard), so the request never
    // reaches the one-time-checkout path and its unmocked billing modules.
    metadata: { type: "event_signup" },
  }
}

function fire(sessionObject: Record<string, unknown>) {
  verifyMock.mockReturnValueOnce({ type: "checkout.session.completed", id: "evt_1", data: { object: sessionObject } })
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: "{}",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getSettingMock.mockResolvedValue(false)
  getPaymentByStripeIdMock.mockResolvedValue(null)
})

describe("checkout.session.completed — which business the purchase capture files under", () => {
  it("a repeat payer's capture lands on THEIR contact's business", async () => {
    findContactMock.mockResolvedValue({ id: "contact-1", businessId: OTHER_BUSINESS_ID })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire(session()))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "purchase", businessId: OTHER_BUSINESS_ID })
  })

  it("a first-time payer's capture falls to the platform business through the seam", async () => {
    findContactMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire(session()))
    expect(res.status).toBe(200)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "purchase", businessId: "platform-biz" })
  })

  it("a contact lookup that THROWS still leaves the capture with the platform tenant", async () => {
    findContactMock.mockRejectedValue(new Error("contacts read failed"))
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire(session()))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })
})
