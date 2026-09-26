// @vitest-environment node
//
// Pinned to node: the default jsdom environment crashes on worker start
// in this repo (ERR_REQUIRE_ESM in html-encoding-sniffer), and reports as
// "Test Files no tests" rather than a failure. Without this line the suite
// silently runs nothing.
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
const getOffersMock = vi.fn()
const getProgramByIdMock = vi.fn()
const createSessionMock = vi.fn()
const insertSingleMock = vi.fn()
const maybeSingleMock = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))
vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: (...a: unknown[]) => getFunnelByIdMock(...a),
  getStep: (...a: unknown[]) => getStepMock(...a),
  getPublishedCheckoutOffers: (...a: unknown[]) => getOffersMock(...a),
}))
vi.mock("@/lib/db/programs", () => ({ getProgramById: (...a: unknown[]) => getProgramByIdMock(...a) }))
vi.mock("@/lib/stripe", () => ({
  createFunnelProgramCheckoutSession: (...a: unknown[]) => createSessionMock(...a),
}))
vi.mock("@/lib/marketing/cookies", () => ({ parseAttrCookie: () => null }))
vi.mock("@/lib/db/marketing-attribution", () => ({ getAttributionBySession: vi.fn(async () => null) }))
vi.mock("@/lib/url", () => ({ getBaseUrl: () => "https://darrenjpaul.com" }))
// The ONE Host boundary. Mocked to a sentinel that is NOT the platform id, so
// a route that hard-codes platformBusinessId() (or resolves it any other way)
// cannot pass the tenant-threading assertions below.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "checkout-biz" }))
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
/** A real, priced, public program that this page does NOT offer. */
const OTHER_PROGRAM_ID = "dddddddd-1111-4222-8333-444444444444"

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
  getOffersMock.mockResolvedValue([{ productKind: "program", productId: PROGRAM_ID }])
  getProgramByIdMock.mockResolvedValue({
    id: PROGRAM_ID,
    name: "Comeback Code",
    description: "8 weeks",
    price_cents: 44900,
    is_active: true,
    is_public: true,
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
    getProgramByIdMock.mockResolvedValue({
      id: PROGRAM_ID,
      name: "Free thing",
      price_cents: price,
      is_active: true,
      is_public: true,
    })
    const { POST } = await import("@/app/api/funnels/checkout/route")
    expect((await POST(post(body()))).status).toBe(400)
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  // G40. Before it, the route sold ANY priced program whose id a request
  // named: a client's private plan (priced at what that client paid), a
  // retired program, another business's. The page is the offer; the request
  // only chooses among what the page sells.
  describe("G40: it sells only what the published page offers", () => {
    it("refuses a real, priced, public program the page does not offer", async () => {
      getProgramByIdMock.mockResolvedValue({
        id: OTHER_PROGRAM_ID,
        name: "Someone else's plan",
        price_cents: 12000,
        is_active: true,
        is_public: true,
      })
      const { POST } = await import("@/app/api/funnels/checkout/route")
      const res = await POST(post(body({ productId: OTHER_PROGRAM_ID })))
      expect(res.status).toBe(404)
      expect(createSessionMock).not.toHaveBeenCalled()
      // Refused BEFORE the lead write and the program read: a crafted id is
      // not a buyer, and nothing about the program is worth reading for it.
      expect(insertSingleMock).not.toHaveBeenCalled()
      expect(getProgramByIdMock).not.toHaveBeenCalled()
    })

    it("refuses when the page has not been published, so offers nothing", async () => {
      getOffersMock.mockResolvedValue([])
      const { POST } = await import("@/app/api/funnels/checkout/route")
      expect((await POST(post(body()))).status).toBe(404)
      expect(createSessionMock).not.toHaveBeenCalled()
    })

    it("refuses an id the page offers as a SESSION PACK, not as a program", async () => {
      // The kind is part of the offer. A pack id resolving in `programs` is a
      // coincidence of UUIDs, not something this page put on sale.
      getOffersMock.mockResolvedValue([{ productKind: "session_pack", productId: PROGRAM_ID }])
      const { POST } = await import("@/app/api/funnels/checkout/route")
      expect((await POST(post(body()))).status).toBe(404)
      expect(createSessionMock).not.toHaveBeenCalled()
    })

    it("sells an offered program when the page carries several offers", async () => {
      getOffersMock.mockResolvedValue([
        { productKind: "program", productId: OTHER_PROGRAM_ID },
        { productKind: "program", productId: PROGRAM_ID },
      ])
      const { POST } = await import("@/app/api/funnels/checkout/route")
      expect((await POST(post(body()))).status).toBe(200)
      expect(createSessionMock).toHaveBeenCalledTimes(1)
    })

    it("reads the offers of THIS step, under the request's own tenant", async () => {
      const { POST } = await import("@/app/api/funnels/checkout/route")
      await POST(post(body()))
      expect(getOffersMock).toHaveBeenCalledWith("checkout-biz", STEP_ID)
    })

    it("answers 503, not 'unavailable', when the offers cannot be read", async () => {
      // The reader throws on a PostgREST error. A buyer on a page that really
      // does sell the program must not be told it is not for sale.
      getOffersMock.mockRejectedValue(new Error("getPublishedCheckoutOffers(version): timeout"))
      const { POST } = await import("@/app/api/funnels/checkout/route")
      expect((await POST(post(body()))).status).toBe(503)
      expect(createSessionMock).not.toHaveBeenCalled()
    })

    it.each([
      ["inactive", { is_active: false, is_public: true }],
      ["not public", { is_active: true, is_public: false }],
    ])("refuses an offered program that is %s", async (_label, flags) => {
      // A page published last month can still name a program retired or made
      // private since. The page is not re-checked when a program changes, so
      // the sale is.
      getProgramByIdMock.mockResolvedValue({ id: PROGRAM_ID, name: "Comeback Code", price_cents: 44900, ...flags })
      const { POST } = await import("@/app/api/funnels/checkout/route")
      expect((await POST(post(body()))).status).toBe(404)
      expect(createSessionMock).not.toHaveBeenCalled()
    })
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

describe("tenancy", () => {
  it("threads the request's own resolved tenant into the funnel and step reads", async () => {
    // "checkout-biz" is the sentinel @/lib/tenancy/public's mock resolves to
    // above — distinct from any platform id, so a route that reads these
    // rows unscoped (or under platformBusinessId()) fails this rather than
    // passing by accident.
    const { POST } = await import("@/app/api/funnels/checkout/route")
    await POST(post(body()))
    expect(getFunnelByIdMock).toHaveBeenCalledWith("checkout-biz", FUNNEL_ID)
    expect(getStepMock).toHaveBeenCalledWith("checkout-biz", STEP_ID)
  })
})
