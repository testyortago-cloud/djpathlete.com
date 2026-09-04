// @vitest-environment node
//
// Pinned to node: the default jsdom environment crashes on worker start
// in this repo (ERR_REQUIRE_ESM in html-encoding-sniffer), and reports as
// "Test Files no tests" rather than a failure. Without this line the suite
// silently runs nothing.
// POST /api/funnels/submit — the branch that takes the money.
//
// The assertions that matter are about ORDER and ATTRIBUTION OF BLAME:
//  - the lead is written BEFORE Stripe is called, so an outage costs a checkout
//    and never the visitor most worth calling back;
//  - the mapping from the owner's field names onto createEventSignupSchema comes
//    from `role`, so renaming a label cannot break a checkout;
//  - a validation failure is reported with the OWNER'S label, not the schema's
//    key, because the parent never saw the word "athlete_age";
//  - a message-mode form is byte-identical to what it was before this branch.

import { describe, expect, it, vi, beforeEach } from "vitest"

const getPublishedFormConfig = vi.fn()
const createSubmission = vi.fn()
const getFunnelById = vi.fn()
const getStep = vi.fn()
const listSteps = vi.fn()
const getEventById = vi.fn()
const getSetting = vi.fn()
const createEventSignupCheckout = vi.fn()
const getAttributionBySession = vi.fn()

vi.mock("@/lib/db/funnels", () => ({
  getPublishedFormConfig: (...a: unknown[]) => getPublishedFormConfig(...a),
  createSubmission: (...a: unknown[]) => createSubmission(...a),
  getFunnelById: (...a: unknown[]) => getFunnelById(...a),
  getStep: (...a: unknown[]) => getStep(...a),
  listSteps: (...a: unknown[]) => listSteps(...a),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventById(...a) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSetting(...a) }))
vi.mock("@/lib/db/marketing-attribution", () => ({
  getAttributionBySession: (...a: unknown[]) => getAttributionBySession(...a),
}))
vi.mock("@/lib/events/checkout", () => ({
  createEventSignupCheckout: (...a: unknown[]) => createEventSignupCheckout(...a),
}))
vi.mock("@/lib/email", () => ({ sendNewFunnelLeadEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "u1" }, error: null }) }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}))

import { POST } from "@/app/api/funnels/submit/route"
// The real helper, not a hardcoded host: NEXTAUTH_URL differs between this
// machine (:3050) and CI, and pinning a literal made this test fail for a reason
// that had nothing to do with the URLs being built correctly.
import { getBaseUrl } from "@/lib/url"

const FUNNEL_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const STEP_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
const EVENT_ID = "cccccccc-3333-4333-8333-cccccccccccc"

const CHECKOUT_FIELDS = [
  { name: "parent_name", label: "Your name", type: "text", required: true, role: "parent_name" },
  { name: "email", label: "Email", type: "email", required: true, role: "parent_email" },
  { name: "mobile", label: "Mobile number", type: "tel", required: true, role: "parent_phone" },
  { name: "player", label: "Player's name", type: "text", required: true, role: "athlete_name" },
  { name: "age", label: "Player's age", type: "select", required: true, role: "athlete_age", options: ["12", "13"] },
  { name: "level", label: "Current level", type: "select", options: ["First season of tennis"] },
  { name: "waiver", label: "I accept the waiver", type: "checkbox", required: true, role: "waiver_accepted" },
]

const VALUES: Record<string, string> = {
  parent_name: "Dana Reed",
  email: "dana@example.com",
  mobile: "09952017559",
  player: "Sam Reed",
  age: "13",
  level: "First season of tennis",
  waiver: "on",
}

/**
 * A DISTINCT IP PER REQUEST, and not a stylistic choice.
 *
 * The route rate-limits 5 submissions per IP per minute in a module-level Map
 * that no test can reset. Sharing one IP meant the sixth test onwards got a 429,
 * so a suite that was correct in isolation failed in order — the whole tail of
 * this file went red for a reason that had nothing to do with what it asserts.
 */
let ipCounter = 0
function request(values: Record<string, string> = VALUES) {
  ipCounter += 1
  return new Request("http://t.test/api/funnels/submit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "UA",
      "x-forwarded-for": `203.0.113.${ipCounter}`,
    },
    body: JSON.stringify({ funnelId: FUNNEL_ID, stepId: STEP_ID, formKey: "register", values, elapsedMs: 9000 }),
  })
}

beforeEach(() => {
  getPublishedFormConfig.mockReset().mockResolvedValue({
    formKey: "register",
    successMode: "checkout",
    eventId: EVENT_ID,
    fields: CHECKOUT_FIELDS,
  })
  createSubmission.mockReset().mockResolvedValue({ id: "sub1" })
  getFunnelById.mockReset().mockResolvedValue({ id: FUNNEL_ID, slug: "summer-camp-2026", name: "Summer Camp 2026" })
  getStep.mockReset().mockResolvedValue({ id: STEP_ID, slug: "register", name: "Register" })
  listSteps.mockReset().mockResolvedValue([
    { id: STEP_ID, slug: "register", name: "Register", position: 2 },
    { id: "zzz", slug: "thank-you", name: "Confirmation", position: 4 },
    { id: "yyy", slug: "index", name: "Details", position: 1 },
  ])
  getEventById.mockReset().mockResolvedValue({
    id: EVENT_ID,
    slug: "camp",
    type: "camp",
    status: "published",
    stripe_price_id: "price_1",
    capacity: 12,
    signup_count: 1,
    title: "Camp",
  })
  getSetting.mockReset().mockResolvedValue(true)
  getAttributionBySession.mockReset().mockResolvedValue(null)
  createEventSignupCheckout
    .mockReset()
    .mockResolvedValue({ ok: true, sessionUrl: "https://stripe.test/pay", signupId: "s1" })
})

describe("POST /api/funnels/submit — checkout forms", () => {
  it("returns the Stripe session url", async () => {
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sessionUrl: "https://stripe.test/pay" })
  })

  it("maps the owner's own field names onto the signup schema via roles", async () => {
    await POST(request())
    expect(createEventSignupCheckout.mock.calls[0][0].input).toMatchObject({
      parent_name: "Dana Reed",
      parent_email: "dana@example.com",
      parent_phone: "09952017559",
      athlete_name: "Sam Reed",
      athlete_age: 13, // a NUMBER; the form submitted the string "13"
      waiver_accepted: true, // a BOOLEAN; the form submitted "on"
    })
  })

  it("writes the lead BEFORE calling Stripe", async () => {
    const order: string[] = []
    createSubmission.mockImplementation(async () => {
      order.push("submission")
      return { id: "sub1" }
    })
    createEventSignupCheckout.mockImplementation(async () => {
      order.push("checkout")
      return { ok: true, sessionUrl: "u", signupId: "s" }
    })
    await POST(request())
    expect(order).toEqual(["submission", "checkout"])
  })

  it("keeps the lead when Stripe fails", async () => {
    // MUTANT: moving the branch above createSubmission. The visitor most worth
    // calling back is the one who filled the form and could not pay, and this is
    // the only assertion that keeps them in the owner's leads.
    createEventSignupCheckout.mockResolvedValue({
      ok: false,
      status: 502,
      error: "Payment provider unavailable, please try again",
    })
    const res = await POST(request())
    expect(res.status).toBe(502)
    expect(createSubmission).toHaveBeenCalled()
  })

  it("keeps the owner's unroled answers in the submission payload", async () => {
    await POST(request())
    expect(createSubmission.mock.calls[0][0].payload).toMatchObject({ level: "First season of tennis" })
  })

  it("404s when the checkout flag is off, without touching Stripe", async () => {
    getSetting.mockResolvedValue(false)
    const res = await POST(request())
    expect(res.status).toBe(404)
    expect(createEventSignupCheckout).not.toHaveBeenCalled()
  })

  it("passes funnel-scoped return urls built from the funnel's own slugs", async () => {
    await POST(request())
    const { returnUrls } = createEventSignupCheckout.mock.calls[0][0]
    // The LAST step by position, not by array order — the fixture lists them
    // out of order deliberately.
    expect(returnUrls.successUrl).toBe(
      `${getBaseUrl()}/go/summer-camp-2026/thank-you?session_id={CHECKOUT_SESSION_ID}`,
    )
    expect(returnUrls.cancelUrl).toBe(`${getBaseUrl()}/go/summer-camp-2026/register?checkout=cancelled`)
  })

  it("leaves Stripe's session placeholder unescaped", async () => {
    // MUTANT: encodeURIComponent on the success url. Stripe would return
    // %7BCHECKOUT_SESSION_ID%7D as a literal and the confirmation page could
    // never look the session up.
    await POST(request())
    expect(createEventSignupCheckout.mock.calls[0][0].returnUrls.successUrl).toContain("{CHECKOUT_SESSION_ID}")
  })

  it("rejects an age outside the schema's range using the owner's own label", async () => {
    const res = await POST(request({ ...VALUES, age: "42" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Player's age must be between 6 and 21.")
    expect(createEventSignupCheckout).not.toHaveBeenCalled()
  })

  it("rejects a non-numeric age rather than coercing it", async () => {
    // `Number("13 years")` is NaN but `parseInt` is 13 — the mapper must not
    // accept a value it had to guess at.
    const res = await POST(request({ ...VALUES, age: "13 years" }))
    expect(res.status).toBe(400)
    expect(createEventSignupCheckout).not.toHaveBeenCalled()
  })

  it("rejects an unticked waiver", async () => {
    const res = await POST(request({ ...VALUES, waiver: "" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/waiver/i)
    expect(createEventSignupCheckout).not.toHaveBeenCalled()
  })

  it('rejects a waiver posted as the string "false"', async () => {
    // A browser cannot send this; a script can. `Boolean("false")` is true.
    const res = await POST(request({ ...VALUES, waiver: "false" }))
    expect(res.status).toBe(400)
    expect(createEventSignupCheckout).not.toHaveBeenCalled()
  })

  it("refuses when the camp stopped being published after the page went live", async () => {
    getEventById.mockResolvedValue({ id: EVENT_ID, status: "draft", capacity: 12, signup_count: 0 })
    const res = await POST(request())
    expect(res.status).toBe(400)
    expect(createEventSignupCheckout).not.toHaveBeenCalled()
  })

  it("surfaces a full camp as the helper reported it", async () => {
    createEventSignupCheckout.mockResolvedValue({ ok: false, status: 409, error: "This camp is full." })
    const res = await POST(request())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("This camp is full.")
  })

  it("leaves a message-mode form completely unchanged", async () => {
    // MUTANT: running the flag check or the event lookup for every submission.
    // Every lead-gen form in the app posts through this route.
    getPublishedFormConfig.mockResolvedValue({
      formKey: "optin",
      successMode: "message",
      fields: [{ name: "email", label: "Email", type: "email", required: true }],
    })
    const res = await POST(request({ email: "a@b.test" }))
    expect(await res.json()).toMatchObject({ ok: true })
    expect(createEventSignupCheckout).not.toHaveBeenCalled()
    expect(getSetting).not.toHaveBeenCalled()
    expect(getEventById).not.toHaveBeenCalled()
  })
})
