// @vitest-environment node
//
// checkout.session.completed → the contact spine (Task 5). The deliberate
// rule (spec §4, "shop checkout" row): EVERY completed checkout captures a
// contact — merch, event tickets, save-card setups, memberships, funnel
// purchases, plain coaching sales, external Payment Link checkouts — NOT
// gated by session.metadata?.type the way applyPipelineEvent (a
// coaching-sale-only concept) is just above it in the route. A paying human
// is a contact regardless of what they bought.
//
// recordContactEvent is mocked directly (the same lighter-weight approach
// __tests__/api/spine/contact-spine.test.ts / shop-leads-spine.test.ts /
// inquiry-spine.test.ts use) — the REAL captureLead (lib/lead-engine/capture.ts)
// runs against the mock, proving the wiring without a live contacts table.
// findContactByIdentifiers (the PRE-EXISTING sequence/pipeline hook this
// route already runs for every checkout.session.completed, unrelated to
// this task) defaults to null so exitRunsForContact/applyPipelineEvent
// never fire here — that block is covered exhaustively by
// __tests__/api/webhooks/pipeline-hooks.test.ts and is untouched by Task 5;
// mocking it inert keeps this file's assertions focused on the one thing
// Task 5 adds. Every other DAL import the route pulls in for its many
// metadata-type branches is stubbed the same way its sibling
// __tests__/api/stripe/webhook-*.test.ts files already stub them.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyWebhookSignature: vi.fn(),
  findContactByIdentifiers: vi.fn(),
  recordContactEvent: vi.fn(),
  handleShopOrderCheckout: vi.fn(),
  confirmSignup: vi.fn(),
  getPaymentByStripeId: vi.fn(),
  createPayment: vi.fn(),
  getUserByEmail: vi.fn(),
  getSetting: vi.fn(),
}))

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => mocks.verifyWebhookSignature(...a),
  stripe: {
    refunds: { create: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
    paymentMethods: { retrieve: vi.fn() },
  },
  resolveSessionPaymentIntent: vi.fn(async () => null),
  retrieveSetupCard: vi.fn(async () => null),
}))
vi.mock("@/lib/db/contacts", () => ({
  findContactByIdentifiers: (...a: unknown[]) => mocks.findContactByIdentifiers(...a),
  recordContactEvent: (...a: unknown[]) => mocks.recordContactEvent(...a),
}))
// Inert — this pre-existing hook is never reached (findContactByIdentifiers
// defaults to null below), but mocked anyway so the real modules (which
// touch @/lib/supabase) are never loaded live even if a future edit to this
// file changes that default.
vi.mock("@/lib/db/sequences", () => ({ exitRunsForContact: vi.fn(async () => 0) }))
vi.mock("@/lib/db/pipeline", () => ({ applyPipelineEvent: vi.fn(async () => ({})) }))
vi.mock("@/lib/db/payment-methods", () => ({ upsertDefaultPaymentMethod: vi.fn() }))
vi.mock("@/lib/services/billing-payer", () => ({ resolveBillingUserId: vi.fn() }))
vi.mock("@/lib/db/client-memberships", () => ({
  createClientMembership: vi.fn(),
  getMembershipBySubscriptionId: vi.fn(),
  updateMembershipBySubscriptionId: vi.fn(),
}))
vi.mock("@/lib/packs/flags", () => ({
  sessionMembershipsEnabled: vi.fn(async () => false),
  cardOnFileEnabled: vi.fn(async () => false),
}))
vi.mock("@/lib/db/payments", () => ({
  createPayment: (...a: unknown[]) => mocks.createPayment(...a),
  getPaymentByStripeId: (...a: unknown[]) => mocks.getPaymentByStripeId(...a),
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
  getSubscriptionByStripeId: vi.fn(),
  updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({
  getUserById: vi.fn(),
  getUserByEmail: (...a: unknown[]) => mocks.getUserByEmail(...a),
}))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/email", () => ({
  sendCoachPurchaseNotification: vi.fn(),
  sendEventSignupConfirmedEmail: vi.fn(),
  sendEventSignupOverbookRefundEmail: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(), ghlTriggerWorkflow: vi.fn() }))
vi.mock("@/lib/db/event-signups", () => ({
  confirmSignup: (...a: unknown[]) => mocks.confirmSignup(...a),
  cancelSignup: vi.fn(),
  getSignupById: vi.fn(),
  getEventSignupByPaymentIntent: vi.fn(),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn() }))
vi.mock("@/lib/shop/webhooks", () => ({
  handleShopOrderCheckout: (...a: unknown[]) => mocks.handleShopOrderCheckout(...a),
}))
vi.mock("@/lib/db/client-packages", () => ({
  getPackageByStripeSession: vi.fn(),
  getPackageByStripePaymentId: vi.fn(),
  updateClientPackage: vi.fn(),
}))
vi.mock("@/lib/services/session-credits", () => ({ activatePaidPackage: vi.fn() }))
vi.mock("@/lib/ads/conversions", () => ({ enqueuePaymentValueAdjustmentByEmail: vi.fn(async () => undefined) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn(async () => undefined) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => mocks.getSetting(...a) }))

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_1",
    mode: "payment",
    metadata: {},
    payment_intent: null,
    amount_total: 9900,
    currency: "usd",
    customer_details: { email: "buyer@example.com", name: "Jordan Blake" },
    ...overrides,
  }
}

function makeReq(body = "{}") {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test_sig" },
    body,
  })
}

function eventFor(sessionObj: Record<string, unknown>) {
  return { type: "checkout.session.completed", data: { object: sessionObj } }
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — a queued .mockResolvedValueOnce /
  // .mockRejectedValueOnce that a test arms but whose code path never
  // reaches survives clearAllMocks and can leak into a later test that
  // calls the same mock (see __tests__/api/spine/event-signup-spine.test.ts's
  // fix-round writeup for the exact failure mode this avoids). Every
  // default this suite depends on is re-armed immediately below.
  vi.resetAllMocks()
  mocks.findContactByIdentifiers.mockResolvedValue(null)
  mocks.recordContactEvent.mockResolvedValue({ contactId: "contact-1", created: true, merged: false })
  mocks.handleShopOrderCheckout.mockResolvedValue(undefined)
  mocks.confirmSignup.mockResolvedValue({ ok: false, reason: "not_pending" })
  mocks.getPaymentByStripeId.mockResolvedValue(null)
  mocks.createPayment.mockResolvedValue({ id: "pay-1" })
  mocks.getUserByEmail.mockResolvedValue(null)
  mocks.getSetting.mockResolvedValue(false)
})

describe("POST /api/stripe/webhook — checkout.session.completed joins the contact spine", () => {
  it("a completed checkout with no metadata type still captures a lead with source purchase, tagged with the session id for redelivery reconciliation", async () => {
    mocks.verifyWebhookSignature.mockReturnValueOnce(eventFor(session({ id: "cs_test_1", metadata: {} })))

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "purchase",
        email: "buyer@example.com",
        name: "Jordan Blake",
        // Stripe delivers webhooks at-least-once; without stripe_session_id
        // on the timeline row, a redelivery writes an indistinguishable
        // second row with nothing tying it back to which checkout produced
        // it. This does not dedupe (append-only spine, by design) — it just
        // makes every row traceable to its session.
        metadata: expect.objectContaining({ stripe_session_id: "cs_test_1" }),
      }),
    )
  })

  it("a merch order (shop_order) STILL captures a lead — a paying human is a contact regardless of what they bought", async () => {
    mocks.verifyWebhookSignature.mockReturnValueOnce(
      eventFor(
        session({
          metadata: { type: "shop_order" },
          customer_details: { email: "merch@example.com", name: "Merch Buyer" },
        }),
      ),
    )

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mocks.handleShopOrderCheckout).toHaveBeenCalled()
    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: "purchase", email: "merch@example.com", name: "Merch Buyer" }),
    )
  })

  it("a $0 card-on-file setup (save_card) STILL captures a lead — no sale happened, but a human handed over a card", async () => {
    mocks.verifyWebhookSignature.mockReturnValueOnce(
      eventFor(
        session({
          metadata: { type: "save_card" },
          amount_total: 0,
          customer_details: { email: "card@example.com", name: "Card Saver" },
        }),
      ),
    )

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: "purchase", email: "card@example.com", name: "Card Saver" }),
    )
  })

  it("an event ticket (event_signup) STILL captures a lead — this is a SECOND, deliberate timeline entry alongside Task 4's event_signup capture at row creation, not a duplicate", async () => {
    mocks.verifyWebhookSignature.mockReturnValueOnce(
      eventFor(
        session({
          metadata: { type: "event_signup", event_signup_id: "sig-1", event_id: "evt-1" },
          payment_intent: "pi_evt_1",
          amount_total: 5000,
          customer_details: { email: "parent@example.com", name: "Parent Person" },
        }),
      ),
    )

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: "purchase", email: "parent@example.com", name: "Parent Person" }),
    )
  })

  it("a session membership checkout STILL captures a lead", async () => {
    mocks.verifyWebhookSignature.mockReturnValueOnce(
      eventFor(
        session({
          metadata: { type: "session_membership" },
          customer_details: { email: "member@example.com", name: "Member Person" },
        }),
      ),
    )

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: "purchase", email: "member@example.com", name: "Member Person" }),
    )
  })

  it("an anonymous funnel purchase STILL captures a lead", async () => {
    mocks.verifyWebhookSignature.mockReturnValueOnce(
      eventFor(
        session({
          metadata: { type: "funnel_purchase" },
          customer_details: { email: "funnel@example.com", name: "Funnel Buyer" },
        }),
      ),
    )

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: "purchase", email: "funnel@example.com", name: "Funnel Buyer" }),
    )
  })

  it("an external Stripe checkout (no programId/userId, Payment Link/dashboard) STILL captures a lead", async () => {
    mocks.verifyWebhookSignature.mockReturnValueOnce(
      eventFor(
        session({
          metadata: {},
          payment_intent: "pi_ext_1",
          customer_details: { email: "external@example.com", name: "External Buyer" },
        }),
      ),
    )

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mocks.createPayment).toHaveBeenCalled()
    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: "purchase", email: "external@example.com", name: "External Buyer" }),
    )
  })

  it("resolves email via session.customer_email when customer_details.email is absent — the same fallback the route's own pipeline hook already uses, read and reused rather than invented", async () => {
    mocks.verifyWebhookSignature.mockReturnValueOnce(
      eventFor(
        session({
          metadata: {},
          customer_details: undefined,
          customer_email: "fallback@example.com",
        }),
      ),
    )

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: "purchase", email: "fallback@example.com" }),
    )
  })

  it("does not call recordContactEvent when the session has no resolvable email at all — captureLead's own no-identifier short-circuit", async () => {
    mocks.verifyWebhookSignature.mockReturnValueOnce(
      eventFor(session({ metadata: {}, customer_details: undefined, customer_email: undefined })),
    )

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).not.toHaveBeenCalled()
  })

  it("never changes the webhook's response or existing side effects when recordContactEvent throws", async () => {
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("PGRST204 column missing"))
    mocks.verifyWebhookSignature.mockReturnValueOnce(eventFor(session({ metadata: { type: "shop_order" } })))

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ received: true })
    expect(mocks.handleShopOrderCheckout).toHaveBeenCalledTimes(1)
  })

  it("writes no consent row and takes no other action beyond the one recordContactEvent call — no @/lib/db/contact-consents import exists in this route", async () => {
    mocks.verifyWebhookSignature.mockReturnValueOnce(eventFor(session({ metadata: {} })))

    const { POST } = await import("@/app/api/stripe/webhook/route")
    await POST(makeReq())

    expect(mocks.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordContactEvent).toHaveBeenCalledWith(expect.objectContaining({ source: "purchase" }))
  })
})

// Whether a "purchase" capture enrols into a sequence is decided entirely
// inside the REAL recordContactEvent (lib/db/contacts.ts calls
// enrollIfTriggered unconditionally), which every test above mocks away —
// so it cannot be proven at this file's mocking depth. That mechanism-level
// claim ("NO sequence rides purchase in this stage", spec §4) is pinned for
// real, against the real enrollIfTriggered, in
// __tests__/lib/lead-engine/enroll.test.ts's own
// "does not enrol a 'purchase' source..." case — same harness the rest of
// that file already uses, so this file doesn't need a second, heavier
// real-recordContactEvent variant of itself just to cover one more source
// string through an already-generic, already-proven mechanism.
