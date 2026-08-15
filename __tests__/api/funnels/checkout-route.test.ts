// POST /api/funnels/checkout — the anonymous, flag-gated route that starts a
// purchase from a published funnel page.
//
// THE ROUTE TAKES NO MONEY AND GRANTS NOTHING. It writes a lead and returns a
// Stripe session URL. So what these tests are really about is what it must
// REFUSE to start, and the one thing it must do even when the sale is about to
// happen elsewhere: capture the lead, because an abandoned checkout is
// otherwise invisible to the coach.

import { describe, it, expect, vi, beforeEach } from "vitest"

const getSettingMock = vi.fn()
const getFunnelByIdMock = vi.fn()
const getStepMock = vi.fn()
const getProgramByIdMock = vi.fn()
const createSessionMock = vi.fn()
const insertSingleMock = vi.fn()
const maybeSingleMock = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))
vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: (...a: unknown[]) => getFunnelByIdMock(...a),
  getStep: (...a: unknown[]) => getStepMock(...a),
}))
vi.mock("@/lib/db/programs", () => ({ getProgramById: (...a: unknown[]) => getProgramByIdMock(...a) }))
vi.mock("@/lib/stripe", () => ({
  createFunnelProgramCheckoutSession: (...a: unknown[]) => createSessionMock(...a),
}))
vi.mock("@/lib/marketing/cookies", () => ({ parseAttrCookie: () => null }))
vi.mock("@/lib/db/marketing-attribution", () => ({ getAttributionBySession: vi.fn(async () => null) }))
vi.mock("@/lib/url", () => ({ getBaseUrl: () => "https://darrenjpaul.com" }))
// The flag name lives in a LEAF module both this route and the Stripe webhook
// import — never route-to-route, which drags a whole route's dependency tree
// into the webhook. Real, not mocked: the name is the thing under test.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({ ilike: () => ({ maybeSingle: maybeSingleMock }) }),
      insert: () => ({ select: () => ({ single: insertSingleMock }) }),
    }),
  }),
}))

const FUNNEL_ID = "aaaaaaaa-1111-4222-8333-444444444444"
const STEP_ID = "bbbbbbbb-1111-4222-8333-444444444444"
const PROGRAM_ID = "cccccccc-1111-4222-8333-444444444444"

function body(overrides: Record<string, unknown> = {}) {
  return {
    funnelId: FUNNEL_ID,
    stepId: STEP_ID,
    productKind: "program",
    productId: PROGRAM_ID,
    email: "buyer@example.com",
    name: "Jordan Blake",
    elapsedMs: 9000,
    ...overrides,
  }
}

function post(payload: Record<string, unknown>) {
  return new Request("http://localhost/api/funnels/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getSettingMock.mockResolvedValue(true)
  getFunnelByIdMock.mockResolvedValue({ id: FUNNEL_ID, slug: "summer-camp", status: "published" })
  getStepMock.mockResolvedValue({ id: STEP_ID, funnel_id: FUNNEL_ID, slug: "buy" })
  getProgramByIdMock.mockResolvedValue({
    id: PROGRAM_ID,
    name: "Comeback Code",
    description: "8 weeks",
    price_cents: 44900,
  })
  createSessionMock.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" })
  maybeSingleMock.mockResolvedValue({ data: null })
  insertSingleMock.mockResolvedValue({ data: { id: "lead-1" }, error: null })
})

describe("the flag", () => {
  it("404s — not 403s — when it is off", async () => {
    // MUTANT KILLED: shipping this live, or answering 403. A 403 confirms the
    // endpoint exists and is merely disabled, which is a map of what to come
    // back for once it is switched on.
    getSettingMock.mockResolvedValue(false)
    const { POST } = await import("@/app/api/funnels/checkout/route")
    const res = await POST(post(body()))
    expect(res.status).toBe(404)
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it("defaults to OFF when nobody has written the setting", async () => {
    const { POST } = await import("@/app/api/funnels/checkout/route")
    await POST(post(body()))
    expect(getSettingMock).toHaveBeenCalledWith("funnel_anonymous_checkout_enabled", false)
  })
})

describe("what it refuses to start", () => {
  it("refuses to sell from a DRAFT funnel", async () => {
    // `/go` only serves published funnels, so a checkout against a draft could
    // only come from a crafted request or a stale tab. Taking money for a page
    // that is not live is worse than refusing it.
    getFunnelByIdMock.mockResolvedValue({ id: FUNNEL_ID, slug: "summer-camp", status: "draft" })
    const { POST } = await import("@/app/api/funnels/checkout/route")
    expect((await POST(post(body()))).status).toBe(404)
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it("refuses a step that belongs to a DIFFERENT funnel", async () => {
    // MUTANT KILLED: trusting the two ids independently. Both are supplied by
    // the browser, and a mismatched pair would sell one funnel's product under
    // another's attribution.
    getStepMock.mockResolvedValue({ id: STEP_ID, funnel_id: "some-other-funnel", slug: "buy" })
    const { POST } = await import("@/app/api/funnels/checkout/route")
    expect((await POST(post(body()))).status).toBe(404)
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it.each([
    ["no price", null],
    ["a zero price", 0],
  ])("refuses a program with %s", async (_label, price) => {
    getProgramByIdMock.mockResolvedValue({ id: PROGRAM_ID, name: "Free thing", price_cents: price })
    const { POST } = await import("@/app/api/funnels/checkout/route")
    expect((await POST(post(body()))).status).toBe(400)
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it("refuses a product kind that has no grant path", async () => {
    // Packs carry auto-renew consent and a mirror payments row; events need a
    // waiver. The schema is a literal so a crafted payload cannot reach a grant
    // path that does not exist yet.
    const { POST } = await import("@/app/api/funnels/checkout/route")
    expect((await POST(post(body({ productKind: "session_pack" })))).status).toBe(400)
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it.each([
    ["a honeypot hit", { website: "https://spam.example" }],
    ["a submission faster than a human can type", { elapsedMs: 200 }],
  ])("answers 200 with no session for %s", async (_label, patch) => {
    // 200 with no sessionUrl, so a bot learns nothing from the difference
    // between being caught and succeeding.
    const { POST } = await import("@/app/api/funnels/checkout/route")
    const res = await POST(post(body(patch)))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(createSessionMock).not.toHaveBeenCalled()
  })
})

describe("the sale it does start", () => {
  it("pins the buyer's email onto the Stripe session", async () => {
    // MUTANT KILLED: letting Stripe collect the email itself. The webhook
    // finds-or-creates the account BY EMAIL, so a different address there
    // grants the program to an account the buyer never sees.
    const { POST } = await import("@/app/api/funnels/checkout/route")
    const res = await POST(post(body()))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sessionUrl: "https://checkout.stripe.com/c/pay/cs_1",
      leadId: "lead-1",
    })
    const args = createSessionMock.mock.calls[0][0] as { buyerEmail: string; leadId: string | null }
    expect(args.buyerEmail).toBe("buyer@example.com")
    expect(args.leadId).toBe("lead-1")
  })

  it("captures the lead BEFORE Stripe, so an abandoned checkout is still a lead", async () => {
    // The reason the page asks for an email at all when Stripe would collect
    // one: a drop-off after this point is invisible here otherwise. Stripe saw
    // them; the coach did not.
    const { POST } = await import("@/app/api/funnels/checkout/route")
    await POST(post(body()))
    expect(insertSingleMock).toHaveBeenCalled()
  })

  it("attaches to an existing person instead of making a second account", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "existing-user" } })
    const { POST } = await import("@/app/api/funnels/checkout/route")
    const res = await POST(post(body()))
    expect(insertSingleMock).not.toHaveBeenCalled()
    expect((await res.json()).leadId).toBe("existing-user")
  })

  it("still sells when lead capture fails", async () => {
    // MUTANT KILLED: letting a lead-write failure block the sale. The purchase
    // is worth more than the attribution, and the webhook creates the account
    // from the Stripe payload regardless.
    insertSingleMock.mockResolvedValue({ data: null, error: { message: "db down" } })
    const { POST } = await import("@/app/api/funnels/checkout/route")
    const res = await POST(post(body()))
    expect(res.status).toBe(200)
    expect((await res.json()).sessionUrl).toContain("checkout.stripe.com")
    expect((await createSessionMock.mock.calls[0][0]).leadId).toBeNull()
  })

  it("reports a Stripe outage as 502 rather than a 500", async () => {
    createSessionMock.mockRejectedValue(new Error("stripe down"))
    const { POST } = await import("@/app/api/funnels/checkout/route")
    expect((await POST(post(body()))).status).toBe(502)
  })
})
