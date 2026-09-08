// @vitest-environment node
//
// Gap #14, Task 2 — WHICH source a completed checkout's lead capture files
// under. The webhook already discriminates checkout kinds by
// `session.metadata?.type` for the pipeline/fulfilment branches; this pins
// that `tryCaptureLeadFromCheckout`'s source argument (line 262) now reuses
// the same discriminator, and — the regression that matters most — that
// every checkout NOT of type shop_order/funnel_purchase keeps writing
// `purchase`, unchanged. `hasPurchaseSince` reads that source, so silently
// renaming it would be a real behaviour change wearing a labelling fix.
import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const getSettingMock = vi.fn()
const createPaymentMock = vi.fn(async (_row: unknown) => undefined)
const getPaymentByStripeIdMock = vi.fn(async (_id: unknown): Promise<unknown> => null)
const findContactMock = vi.fn()
const captureLeadMock = vi.fn(async (..._args: unknown[]) => "contact-1")
const handleShopOrderCheckoutMock = vi.fn(async (_s: unknown) => undefined)
const getPackageByStripeSessionMock = vi.fn(async (_id: unknown) => ({ payment_status: "paid" }))

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
  getSignupTenantById: vi.fn(),
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
// shop_order dispatches to this module, entirely separate from the DAL —
// unmocked, this would hit the real (unmocked-in-this-suite) Supabase reads
// inside it.
vi.mock("@/lib/shop/webhooks", () => ({ handleShopOrderCheckout: (s: unknown) => handleShopOrderCheckoutMock(s) }))
// session_pack's handler is given an already-paid pack so it takes its own
// idempotency early-return, never reaching resolveSessionPaymentIntent /
// activatePaidPackage.
vi.mock("@/lib/db/client-packages", () => ({
  getPackageByStripeSession: (id: unknown) => getPackageByStripeSessionMock(id),
  getPackageByStripePaymentId: vi.fn(),
  updateClientPackage: vi.fn(),
}))
vi.mock("@/lib/db/contacts", () => ({
  findContactWithBusinessByIdentifiers: (...a: unknown[]) => findContactMock(...a),
  hasPurchaseSince: vi.fn(async () => false),
}))
vi.mock("@/lib/lead-engine/capture", () => ({ captureLead: (...a: unknown[]) => captureLeadMock(...a) }))
vi.mock("@/lib/db/sequences", () => ({ exitRunsForContact: vi.fn(async () => undefined) }))
vi.mock("@/lib/db/pipeline", () => ({
  applyPipelineEvent: vi.fn(async () => ({ decision: { kind: "noop", reason: "test" }, opportunityId: null })),
}))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

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
  getSettingMock.mockResolvedValue(false)
  getPaymentByStripeIdMock.mockResolvedValue(null)
  getPackageByStripeSessionMock.mockResolvedValue({ payment_status: "paid" })
  findContactMock.mockResolvedValue(null)
})

const base = {
  id: "cs_1",
  mode: "payment",
  customer: "cus_1",
  amount_total: 4900,
  currency: "usd",
  customer_details: { email: "buyer@example.com", name: "Riley Buyer" },
}

describe("checkout.session.completed — which source the lead capture files under", () => {
  it("a shop order's completed checkout captures the lead as shop", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ ...base, metadata: { type: "shop_order" } }))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "shop" })
    expect(handleShopOrderCheckoutMock).toHaveBeenCalledTimes(1)
  })

  it("a funnel purchase's completed checkout captures the lead as funnel_checkout", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ ...base, metadata: { type: "funnel_purchase" } }))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "funnel_checkout" })
  })

  // THE REGRESSION THAT MATTERS MOST: purchase is being NARROWED, not
  // redefined. A plain coaching checkout (no metadata.type at all) must keep
  // writing `purchase` — hasPurchaseSince reads it.
  it("a plain coaching checkout with no metadata.type still captures the lead as purchase", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ ...base, metadata: {} }))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "purchase" })
  })

  it("an event-signup checkout still captures the lead as purchase, not shop or funnel_checkout", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ ...base, metadata: { type: "event_signup" } }))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "purchase" })
  })

  it("a save-card checkout still captures the lead as purchase", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ ...base, metadata: { type: "save_card" } }))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "purchase" })
  })

  it("a session-pack checkout still captures the lead as purchase", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ ...base, metadata: { type: "session_pack" } }))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "purchase" })
  })

  // M4's target: `session.metadata?.type` must stay optional-chained. A
  // session genuinely missing `metadata` (not merely `{}`) reaches
  // checkoutContactSource before tryCaptureLeadFromCheckout's own try/catch
  // — that call is evaluated as an ARGUMENT, outside the wrapper's try. Only
  // the `?.` keeps this from throwing and 500-ing the whole webhook.
  it("a session with no metadata property at all still captures the lead as purchase, not a 500", async () => {
    const { id, mode, customer, amount_total, currency, customer_details } = base
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(fire({ id, mode, customer, amount_total, currency, customer_details }))
    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "purchase" })
  })
})
