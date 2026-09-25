// @vitest-environment node
//
// Pinned to node: the default jsdom environment crashes on worker start
// in this repo (ERR_REQUIRE_ESM in html-encoding-sniffer), and reports as
// "Test Files no tests" rather than a failure. Without this line the suite
// silently runs nothing.
// The webhook branch for an anonymous funnel purchase.
//
// Four of the eight rows in the spec's test table live here, and each is a way
// the card is charged and the customer still gets nothing:
//
//   - flag off                 -> inert, not half-run
//   - metadata this flow did not write -> ignored, never guessed at
//   - grant fails              -> payment still recorded, and it RETRIES
//   - dispatched before the one-time fallthrough -> not silently swallowed
//
// That last one is the sharpest. A funnel session carries a programId and NO
// userId, which is exactly the shape `handleOneTimeCheckout` calls an "External
// Stripe checkout": it would write a record-keeping payment, grant nothing, and
// return 200. A page that had just taken money would look, from every log and
// dashboard, like it had worked.

import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const grantMock = vi.fn()
const getSettingMock = vi.fn()
const createPaymentMock = vi.fn(async (_row: unknown) => undefined)
const getPaymentByStripeIdMock = vi.fn(async (_id: unknown): Promise<unknown> => null)

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  stripe: { refunds: { create: vi.fn() } },
  resolveSessionPaymentIntent: vi.fn(async () => null),
}))
vi.mock("@/lib/funnels/checkout/grant", () => ({
  grantFunnelPurchase: (...a: unknown[]) => grantMock(...a),
}))
const buildGrantDepsMock = vi.fn((..._a: unknown[]) => ({ marker: "deps" }))
vi.mock("@/lib/funnels/checkout/deps", () => ({
  buildGrantDeps: (...a: unknown[]) => buildGrantDepsMock(...a),
}))
// The three mocks below control WHICH BUSINESS the payer's own contact
// resolves to — see "the funnel's own tenant, not the payer's" describe block
// at the bottom of this file. Defaulted to "no contact row" so the six
// pre-existing tests above (which do not care about tenant resolution) see
// today's behaviour: a first-time payer falls to `platformBusinessId()`.
const findContactMock = vi.fn(async (..._a: unknown[]) => null as { id: string; businessId: string } | null)
vi.mock("@/lib/db/contacts", () => ({
  findContactWithBusinessByIdentifiers: (...a: unknown[]) => findContactMock(...a),
  hasPurchaseSince: vi.fn(async () => false),
  // Not under test here (the capture-tenant suite owns it) — stubbed only so
  // `captureLead`'s real implementation, reached via the unmocked
  // `tryCaptureLeadFromCheckout`, degrades quietly instead of logging a
  // "no export defined on the mock" warning on every test in this file.
  recordContactEvent: vi.fn(async () => ({ contactId: "contact-stub", created: false })),
}))
vi.mock("@/lib/db/sequences", () => ({ exitRunsForContact: vi.fn(async () => undefined) }))
vi.mock("@/lib/db/pipeline", () => ({
  applyPipelineEvent: vi.fn(async () => ({ decision: { kind: "noop", reason: "test" }, opportunityId: null })),
}))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
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
// Not under test, and its real implementation reaches for a Supabase client
// this file does not stand up — which showed as a 25s hang, not an error.
vi.mock("@/lib/ads/conversions", () => ({ enqueuePaymentValueAdjustmentByEmail: vi.fn(async () => undefined) }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: () => ({ update: () => ({ eq: vi.fn(async () => undefined) }) }) }),
}))

const PROGRAM_ID = "11111111-2222-4333-8444-555555555555"

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_funnel_1",
    mode: "payment",
    payment_intent: "pi_funnel_1",
    customer: "cus_1",
    amount_total: 44900,
    currency: "usd",
    customer_details: { email: "buyer@example.com", name: "Jordan Blake" },
    metadata: {
      type: "funnel_purchase",
      productKind: "program",
      productId: PROGRAM_ID,
      funnelId: "f-1",
      stepId: "s-1",
      leadId: "lead-1",
    },
    ...overrides,
  }
}

function fire(sessionObject: Record<string, unknown>) {
  verifyMock.mockReturnValueOnce({
    type: "checkout.session.completed",
    id: "evt_1",
    data: { object: sessionObject },
  })
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: "{}",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getSettingMock.mockResolvedValue(true)
  getPaymentByStripeIdMock.mockResolvedValue(null)
  grantMock.mockResolvedValue({
    ok: true,
    outcome: "granted",
    userId: "user-1",
    accountCreated: true,
    alreadyOwned: false,
    emailFailed: false,
  })
})

describe("the funnel branch is reached at all", () => {
  it("grants, and does NOT fall through to the external-checkout path", async () => {
    // MUTANT KILLED: dispatching after the `mode`/one-time fallthrough, or not
    // dispatching at all. `handleOneTimeCheckout` sees programId-without-userId
    // as an external checkout and grants nothing — a silent no-delivery that
    // returns 200 and writes a plausible-looking payment row.
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire(session()))

    expect(res.status).toBe(200)
    expect(grantMock).toHaveBeenCalledTimes(1)
    expect(grantMock.mock.calls[0][0]).toEqual({
      idempotencyKey: "cs_funnel_1",
      email: "buyer@example.com",
      name: "Jordan Blake",
      productKind: "program",
      productId: PROGRAM_ID,
      leadId: "lead-1",
    })

    const payment = createPaymentMock.mock.calls[0][0] as unknown as Record<string, unknown>
    expect(payment.description).toBe("Funnel purchase")
    expect(payment.user_id).toBe("user-1")
  })
})

describe("the flag", () => {
  it("makes the branch inert when it is off", async () => {
    // MUTANT KILLED: gating only the ROUTE. A session created while the flag
    // was on can be retried for days after it is switched off, and half-running
    // a path the owner has disabled is worse than doing nothing.
    getSettingMock.mockResolvedValue(false)
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire(session()))

    expect(res.status).toBe(200)
    expect(grantMock).not.toHaveBeenCalled()
    expect(createPaymentMock).not.toHaveBeenCalled()
  })

  it("defaults to OFF when the setting has never been written", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    await POST(fire(session()))
    expect(getSettingMock).toHaveBeenCalledWith("funnel_anonymous_checkout_enabled", false)
  })
})

describe("metadata this flow did not write", () => {
  it.each([
    ["a product kind that has no grant path", { productKind: "session_pack" }],
    ["no product id", { productId: undefined }],
  ])("ignores %s rather than guessing", async (_label, patch) => {
    // Stripe metadata is hand-editable in the dashboard and visible to whoever
    // built the session. Inventing a product from a half-filled payload would
    // be granting on a shape nobody designed.
    const s = session()
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ ...s, metadata: { ...s.metadata, ...patch } }))

    expect(res.status).toBe(200)
    expect(grantMock).not.toHaveBeenCalled()
    expect(createPaymentMock).not.toHaveBeenCalled()
  })

  it("ignores a session with no buyer email", async () => {
    // With no email there is no account to find or create. Granting to nobody
    // is worse than refusing loudly.
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire(session({ customer_details: { email: null }, customer_email: null })))
    expect(res.status).toBe(200)
    expect(grantMock).not.toHaveBeenCalled()
  })
})

describe("when the grant fails after the card succeeded", () => {
  it("records the payment anyway and asks Stripe to retry", async () => {
    // BOTH HALVES MATTER. The money moved, so leaving the payment unrecorded
    // hides real revenue and makes the alert impossible to reconcile against
    // Stripe. And a 500 is how a transient database failure gets another
    // attempt — the grant is written to be replay-safe precisely so that retry
    // is the right answer rather than a second charge.
    grantMock.mockResolvedValue({ ok: false, stage: "grant", error: "db down" })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire(session()))

    expect(res.status).toBe(500)
    expect(createPaymentMock).toHaveBeenCalledTimes(1)
    const payment = createPaymentMock.mock.calls[0][0] as unknown as {
      user_id: string | null
      metadata: { granted: boolean }
    }
    // Nobody to attribute it to yet — but the payment is on the books.
    expect(payment.user_id).toBeNull()
    expect(payment.metadata.granted).toBe(false)
  })

  it("does not double-write the payment when Stripe retries", async () => {
    getPaymentByStripeIdMock.mockResolvedValue({ id: "pay-1" } as never)
    const { POST } = await import("@/app/api/stripe/webhook/route")
    await POST(fire(session()))
    expect(createPaymentMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// THE FUNNEL'S OWN TENANT, NOT THE PAYER'S.
//
// `handleFunnelPurchaseCheckout` used to be filed under `payerBusinessId` —
// the buyer's OWN contact's business, resolved a few lines above the
// `funnel_purchase` dispatch and reused for the sequence/pipeline hooks. Right
// for those; wrong here. A funnel is one coach's page, so a buyer who happens
// to already be a DIFFERENT coach's contact (they bought from coach A last
// month, and are now buying coach B's program from coach B's funnel) must not
// have this purchase — and the account, program assignment and welcome email
// it produces — filed under coach A's business.
//
// `createFunnelProgramCheckoutSession` now stamps the funnel's OWN
// `businessId` into the session's metadata; the webhook prefers it and falls
// back to `payerBusinessId` only when it is absent (a session created before
// this metadata key existed, which can still complete up to 24h later).
// ---------------------------------------------------------------------------
describe("the funnel's own tenant, not the payer's", () => {
  const FUNNEL_BUSINESS_ID = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa"
  const PAYER_BUSINESS_ID = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb"

  it("uses the funnel's metadata businessId, not the platform fallback, for a first-time payer", async () => {
    // No contact row for this buyer -- `payerBusinessId` would resolve to
    // `platformBusinessId()`. The funnel's own tenant must win regardless.
    findContactMock.mockResolvedValue(null)
    const s = session()
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ ...s, metadata: { ...s.metadata, businessId: FUNNEL_BUSINESS_ID } }))

    expect(res.status).toBe(200)
    expect(buildGrantDepsMock).toHaveBeenCalledWith(expect.objectContaining({ businessId: FUNNEL_BUSINESS_ID }))
  })

  it("falls back to exactly today's payerBusinessId behaviour when the session predates the metadata key", async () => {
    // A session created before this field existed has no `metadata.businessId`
    // at all -- not merely an empty string. The fallback is not optional: that
    // session can still complete hours or days after this ships.
    findContactMock.mockResolvedValue({ id: "contact-1", businessId: PAYER_BUSINESS_ID })
    const s = session()
    const metadata = { ...s.metadata } as Record<string, unknown>
    delete metadata.businessId
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ ...s, metadata }))

    expect(res.status).toBe(200)
    expect(buildGrantDepsMock).toHaveBeenCalledWith(expect.objectContaining({ businessId: PAYER_BUSINESS_ID }))
  })

  it("THE MISFILING CASE — does not file a cross-tenant sale under the buyer's OTHER business", async () => {
    // The sharpest case: the buyer is ALREADY a known contact of a DIFFERENT
    // business (they bought from that coach before) and is now buying THIS
    // funnel's coach's program. Without this fix, `payerBusinessId` would win
    // and coach B's sale would be recorded — grant, account, welcome email —
    // under coach A's business.
    findContactMock.mockResolvedValue({ id: "contact-1", businessId: PAYER_BUSINESS_ID })
    const s = session()
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ ...s, metadata: { ...s.metadata, businessId: FUNNEL_BUSINESS_ID } }))

    expect(res.status).toBe(200)
    const deps = buildGrantDepsMock.mock.calls[0][0] as { businessId: string }
    expect(deps.businessId).toBe(FUNNEL_BUSINESS_ID)
    expect(deps.businessId).not.toBe(PAYER_BUSINESS_ID)
  })
})
