// @vitest-environment node
//
// Gap #14, fix round 1 — CRITICAL: narrowing `purchase` (a shop_order
// checkout now writes `shop`, a funnel_purchase checkout now writes
// `funnel_checkout`) silently broke `hasPurchaseSince`'s
// `.eq("source", "purchase")` filter, which the checkout.session.expired
// case reads to decide `alreadyPurchased`. Every OTHER webhook suite mocks
// `@/lib/db/contacts` and stubs `hasPurchaseSince`'s return value directly —
// none of them would have caught this, because none of them ever ran the
// REAL query against a REAL row carrying the narrowed source.
//
// This suite leaves `@/lib/db/contacts` UNMOCKED — `findContactWithBusiness-
// ByIdentifiers` and `hasPurchaseSince` run for real, against a tiny in-memory
// fake of the two tables they touch (`contacts`, `contact_timeline_events`).
// Only `captureLead` (a different module, @/lib/lead-engine/capture) is
// mocked, so the assertion is "was the abandoned-checkout lead captured",
// not a second layer of stubbing over the thing under test.
//
// The scenario, end to end:
//   1. A contact abandons a funnel checkout (session A).
//   2. They pay on a SECOND funnel checkout (session B) — writes a
//      `funnel_checkout` timeline event (Gap #14's change), dated AFTER
//      session A's `created`.
//   3. ~24h later, Stripe fires checkout.session.expired for session A.
//   4. hasPurchaseSince must see the `funnel_checkout` row and answer true,
//      so the paying customer is NOT enrolled in "you didn't finish
//      checking out".
import { describe, it, expect, vi, beforeEach } from "vitest"

type ContactRow = { id: string; business_id: string; email: string | null; user_id: string | null; created_at: string }
type TimelineRow = { id: string; business_id: string; contact_id: string; source: string; occurred_at: string }

let contactRows: ContactRow[] = []
let timelineRows: TimelineRow[] = []

// A minimal fake of the two tables the REAL findContactWithBusinessByIdentifiers
// and hasPurchaseSince touch. Any OTHER table reaching this mock is a sign
// something in the route is no longer isolated the way this suite assumes —
// it throws rather than silently returning nothing.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "contacts") {
        const filters: Array<[string, unknown]> = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api: any = {
          select() {
            return api
          },
          eq(col: string, val: unknown) {
            filters.push([col, val])
            return api
          },
          order() {
            return api
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then(resolve: any) {
            const matched = contactRows.filter((r) =>
              filters.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v),
            )
            return resolve({ data: matched, error: null })
          },
        }
        return api
      }
      if (table === "contact_timeline_events") {
        const filters: Array<[string, unknown]> = []
        const inFilters: Array<[string, unknown[]]> = []
        let gteCol: string | null = null
        let gteVal: string | null = null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api: any = {
          select() {
            return api
          },
          eq(col: string, val: unknown) {
            filters.push([col, val])
            return api
          },
          in(col: string, vals: unknown[]) {
            inFilters.push([col, vals])
            return api
          },
          gte(col: string, val: string) {
            gteCol = col
            gteVal = val
            return api
          },
          limit() {
            return api
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then(resolve: any) {
            const matched = timelineRows.filter((r) => {
              const rec = r as unknown as Record<string, unknown>
              const eqOk = filters.every(([c, v]) => rec[c] === v)
              const inOk = inFilters.every(([c, vs]) => vs.includes(rec[c]))
              const gteOk = gteCol === null || (rec[gteCol] as string) >= (gteVal as string)
              return eqOk && inOk && gteOk
            })
            return resolve({ data: matched, error: null })
          },
        }
        return api
      }
      throw new Error(`unmocked table in this integration suite: ${table}`)
    },
  }),
}))

const verifyMock = vi.fn()
const getSettingMock = vi.fn()
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
  createPayment: vi.fn(),
  getPaymentByStripeId: vi.fn(async () => null),
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
// The real @/lib/db/contacts runs — findContactWithBusinessByIdentifiers and
// hasPurchaseSince are the functions under test, backed by the @/lib/supabase
// fake above. Only lead capture itself is mocked (a different module).
vi.mock("@/lib/lead-engine/capture", () => ({ captureLead: (...a: unknown[]) => captureLeadMock(...a) }))
vi.mock("@/lib/db/sequences", () => ({ exitRunsForContact: vi.fn(async () => undefined) }))
vi.mock("@/lib/db/pipeline", () => ({
  applyPipelineEvent: vi.fn(async () => ({ decision: { kind: "noop", reason: "test" }, opportunityId: null })),
}))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
vi.mock("@/lib/db/client-packages", () => ({
  getPackageByStripeSession: vi.fn(),
  getPackageByStripePaymentId: vi.fn(),
  updateClientPackage: vi.fn(),
}))

const BUSINESS = "22222222-2222-2222-2222-222222222222"
const EMAIL = "funnel-buyer@example.com"
const CREATED_UNIX = 1_700_000_000 // session A's own `created` (Unix seconds)

function expiredEvent(sessionId: string) {
  verifyMock.mockReturnValueOnce({
    type: "checkout.session.expired",
    id: "evt_1",
    data: {
      object: {
        id: sessionId,
        customer_email: EMAIL,
        customer_details: { email: EMAIL },
        metadata: {},
        created: CREATED_UNIX,
      },
    },
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
  contactRows = [{ id: "contact-1", business_id: BUSINESS, email: EMAIL, user_id: null, created_at: "2026-01-01T00:00:00.000Z" }]
  timelineRows = []
})

describe("checkout.session.expired — the real hasPurchaseSince, not a stubbed return value", () => {
  it("does NOT capture checkout_abandoned when the contact already paid via a LATER funnel_checkout — the scenario this fix closes", async () => {
    // Session B (the SECOND, successful funnel checkout) wrote this row
    // AFTER session A (the one now expiring) was created.
    timelineRows = [
      {
        id: "t1",
        business_id: BUSINESS,
        contact_id: "contact-1",
        source: "funnel_checkout",
        occurred_at: "2026-11-14T22:15:00.000Z", // well after CREATED_UNIX (2023-11-14 22:13:20 UTC)
      },
    ]

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(expiredEvent("cs_session_a"))

    expect(res.status).toBe(200)
    expect(captureLeadMock).not.toHaveBeenCalled()
  })

  // THE PRESENCE CONTROL: with no qualifying purchase on file, the SAME
  // route, the SAME contact, the SAME session shape DOES capture the
  // abandonment — proving the test above passes because hasPurchaseSince
  // found a real row, not because nothing ran at all.
  it("DOES capture checkout_abandoned when the contact has no qualifying purchase since — the presence control", async () => {
    timelineRows = []

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(expiredEvent("cs_session_a"))

    expect(res.status).toBe(200)
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ source: "checkout_abandoned", email: EMAIL })
  })

  // The mirror of the scenario test, for `shop` rather than `funnel_checkout`
  // — hasPurchaseSince must recognise it too, even though a shop_order
  // checkout cannot reach this branch today (NON_COACHING_CHECKOUT_TYPES).
  it("does NOT capture checkout_abandoned when the qualifying purchase is `shop`", async () => {
    timelineRows = [
      {
        id: "t1",
        business_id: BUSINESS,
        contact_id: "contact-1",
        source: "shop",
        occurred_at: "2026-11-14T22:15:00.000Z",
      },
    ]

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(expiredEvent("cs_session_a"))

    expect(res.status).toBe(200)
    expect(captureLeadMock).not.toHaveBeenCalled()
  })
})
