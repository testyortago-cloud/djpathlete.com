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
const hasPurchaseSinceMock = vi.fn(async (..._args: unknown[]) => false)

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
  hasPurchaseSince: (...a: unknown[]) => hasPurchaseSinceMock(...a),
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

function fire(sessionObject: Record<string, unknown>, eventType = "checkout.session.completed") {
  verifyMock.mockReturnValueOnce({ type: eventType, id: "evt_1", data: { object: sessionObject } })
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

// checkout.session.expired — the abandoned-checkout lead capture. Reuses this
// suite's mocks rather than a second harness: same route, same tenant
// resolution, same captureLeadMock. `fire`'s second argument is the event
// type; the three tests above default to "checkout.session.completed" and
// are untouched.
describe("checkout.session.expired — abandoned coaching checkout capture", () => {
  it("captures an abandoned coaching checkout as a lead, with source checkout_abandoned", async () => {
    findContactMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(
      fire({ id: "cs_1", customer_email: "a@example.com", metadata: {} }, "checkout.session.expired"),
    )
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({
      source: "checkout_abandoned",
      email: "a@example.com",
      businessId: "platform-biz",
    })
  })

  it("ignores an abandoned shop checkout — not a coaching sale", async () => {
    findContactMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(
      fire(
        { id: "cs_2", customer_email: "b@example.com", metadata: { type: "shop_order" } },
        "checkout.session.expired",
      ),
    )
    expect(res.status).toBe(200)
    expect(findContactMock).not.toHaveBeenCalled()
    expect(captureLeadMock).not.toHaveBeenCalled()
  })

  it("a repeat customer's abandoned checkout files under THEIR contact's business", async () => {
    findContactMock.mockResolvedValue({ id: "contact-1", businessId: OTHER_BUSINESS_ID })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(
      fire({ id: "cs_4", customer_email: "d@example.com", metadata: {} }, "checkout.session.expired"),
    )
    expect(res.status).toBe(200)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({
      source: "checkout_abandoned",
      businessId: OTHER_BUSINESS_ID,
    })
  })

  // Mirrors "a contact lookup that THROWS still leaves the capture with the
  // platform tenant" above, for the expired case. Unlike the completed
  // case's contact/pipeline resolution, this lookup is the ONLY thing
  // between the guard and the capture -- no separate try/catch existed here
  // until this test proved one was needed: without it, a throw here
  // propagates past this case, out of the switch, into the route's own
  // top-level catch, and returns 500 -- Stripe retries the whole event
  // instead of the capture just falling back to the platform tenant.
  it("a contact lookup that THROWS still leaves the abandoned-checkout capture with the platform tenant", async () => {
    findContactMock.mockRejectedValue(new Error("contacts read failed"))
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(
      fire({ id: "cs_5", customer_email: "e@example.com", metadata: {} }, "checkout.session.expired"),
    )
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({
      source: "checkout_abandoned",
      businessId: "platform-biz",
    })
  })

  // The ordering problem this fix closes: a card declines on THIS session, the
  // customer immediately pays on a second one, `checkout.session.completed`
  // fires and captures a `purchase` timeline event, and only THEN does this
  // (now-stale) session's `expired` event arrive. Without the guard, the
  // paying customer gets a "you didn't finish checking out" email.
  it("does NOT capture when the contact already has a qualifying purchase since this session's created time", async () => {
    findContactMock.mockResolvedValue({ id: "contact-1", businessId: OTHER_BUSINESS_ID })
    hasPurchaseSinceMock.mockResolvedValue(true)
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(
      fire(
        { id: "cs_6", customer_email: "f@example.com", metadata: {}, created: 1_700_000_000 },
        "checkout.session.expired",
      ),
    )
    expect(res.status).toBe(200)
    expect(hasPurchaseSinceMock).toHaveBeenCalledWith("contact-1", OTHER_BUSINESS_ID, new Date(1_700_000_000 * 1000))
    expect(captureLeadMock).not.toHaveBeenCalled()
  })

  it("captures as before when the contact has no qualifying purchase", async () => {
    findContactMock.mockResolvedValue({ id: "contact-1", businessId: OTHER_BUSINESS_ID })
    hasPurchaseSinceMock.mockResolvedValue(false)
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(
      fire(
        { id: "cs_7", customer_email: "g@example.com", metadata: {}, created: 1_700_000_000 },
        "checkout.session.expired",
      ),
    )
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({
      source: "checkout_abandoned",
      businessId: OTHER_BUSINESS_ID,
    })
  })

  // A purchase that predates this session is an earlier, UNRELATED sale --
  // not evidence that this particular abandonment resolved itself. The DAL
  // reader (hasPurchaseSince) is the one that applies the "at or after"
  // comparison; from the route's point of view this looks identical to "no
  // qualifying purchase", which is exactly the point: an older purchase must
  // not suppress a genuinely new abandonment.
  it("still captures when the contact's only purchase predates this session — an earlier, unrelated sale", async () => {
    findContactMock.mockResolvedValue({ id: "contact-1", businessId: OTHER_BUSINESS_ID })
    hasPurchaseSinceMock.mockResolvedValue(false)
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(
      fire(
        { id: "cs_8", customer_email: "h@example.com", metadata: {}, created: 1_700_000_000 },
        "checkout.session.expired",
      ),
    )
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({
      source: "checkout_abandoned",
      businessId: OTHER_BUSINESS_ID,
    })
  })
})
