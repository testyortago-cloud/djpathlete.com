// The one sequence that turns a signup into a Stripe session, now shared by the
// event page's modal and a funnel's Register form.
//
// WHAT THESE TESTS GUARD is the half that must not drift between two callers:
// the capacity refusal, the waiver EVIDENCE written with the signup, and the
// ordering that never creates a signup for a camp it then refuses. Those are the
// legal gate and the money — the two things `2026-08-15-funnel-anonymous-checkout-design.md`
// says a second copy would get wrong.

import { describe, expect, it, vi, beforeEach } from "vitest"

const createSignup = vi.fn()
const getActiveDocument = vi.fn()
const createEventCheckoutSession = vi.fn()
const from = vi.fn()

vi.mock("@/lib/db/event-signups", () => ({ createSignup: (...a: unknown[]) => createSignup(...a) }))
vi.mock("@/lib/db/legal-documents", () => ({ getActiveDocument: (...a: unknown[]) => getActiveDocument(...a) }))
vi.mock("@/lib/stripe", () => ({
  createEventCheckoutSession: (...a: unknown[]) => createEventCheckoutSession(...a),
}))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({ from: (...a: unknown[]) => from(...a) }) }))

import { createEventSignupCheckout } from "@/lib/events/checkout"

const EVENT = {
  id: "e1",
  slug: "summer-camp",
  type: "camp",
  status: "published",
  stripe_price_id: "price_1",
  capacity: 12,
  signup_count: 3,
  title: "Summer Camp",
}

const INPUT = {
  parent_name: "Dana Reed",
  parent_email: "dana@example.com",
  parent_phone: null,
  athlete_name: "Sam Reed",
  athlete_age: 13,
  sport: null,
  notes: null,
  waiver_accepted: true,
}

beforeEach(() => {
  createSignup.mockReset().mockResolvedValue({ id: "s1" })
  getActiveDocument.mockReset().mockResolvedValue({ id: "doc1" })
  createEventCheckoutSession.mockReset().mockResolvedValue({ id: "cs_1", url: "https://stripe.test/pay" })
  from.mockReset().mockReturnValue({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) })
})

const base = { event: EVENT as never, input: INPUT as never, ipAddress: "1.2.3.4", userAgent: "UA", baseUrl: "https://x.test" }

describe("createEventSignupCheckout", () => {
  it("returns the session url and the signup id", async () => {
    await expect(createEventSignupCheckout("host-biz", base)).resolves.toMatchObject({
      ok: true,
      sessionUrl: "https://stripe.test/pay",
      signupId: "s1",
    })
  })

  it("threads the caller's businessId into createSignup as the first argument", async () => {
    // Sentinel is deliberately NOT the platform id: a helper that hard-codes
    // platformBusinessId() instead of using the argument would still pass a
    // test written against the platform id.
    await createEventSignupCheckout("host-biz", base)
    expect(createSignup.mock.calls[0][0]).toBe("host-biz")
  })

  it("files the waiver evidence with the signup", async () => {
    await createEventSignupCheckout("host-biz", base)
    const [businessId, eventId, , signupType, waiver] = createSignup.mock.calls[0]
    expect(businessId).toBe("host-biz")
    expect(eventId).toBe("e1")
    expect(signupType).toBe("paid")
    expect(waiver).toMatchObject({ document_id: "doc1", ip_address: "1.2.3.4", user_agent: "UA" })
  })

  it("does not pass waiver_accepted through to the database row", async () => {
    // The column is `waiver_accepted_at`, derived from the evidence object.
    // `CreateSignupDbInput` is `Omit<CreateSignupInput, "waiver_accepted">` for
    // exactly this reason — passing the boolean would target a column that does
    // not exist.
    await createEventSignupCheckout("host-biz", base)
    expect(createSignup.mock.calls[0][2]).not.toHaveProperty("waiver_accepted")
    expect(createSignup.mock.calls[0][2]).toMatchObject({ parent_email: "dana@example.com", athlete_age: 13 })
  })

  it("records a null document id when no waiver is active, rather than refusing", async () => {
    // Matches what the event route already does. The evidence is still filed —
    // "they accepted, and there was no active document" is a true record.
    getActiveDocument.mockResolvedValue(null)
    const out = await createEventSignupCheckout("host-biz", base)
    expect(out.ok).toBe(true)
    expect(createSignup.mock.calls[0][4]).toMatchObject({ document_id: null })
  })

  it("refuses at capacity WITHOUT creating a signup", async () => {
    // MUTANT: checking capacity after createSignup. Every refused attempt would
    // leave a pending row behind, and the next check would count it.
    const out = await createEventSignupCheckout("host-biz", { ...base, event: { ...EVENT, signup_count: 12 } as never })
    expect(out).toMatchObject({ ok: false, status: 409 })
    expect(out.ok === false && out.error).toMatch(/full/i)
    expect(createSignup).not.toHaveBeenCalled()
  })

  it("refuses an event with no Stripe price without creating a signup", async () => {
    const out = await createEventSignupCheckout("host-biz", {
      ...base,
      event: { ...EVENT, stripe_price_id: null } as never,
    })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(createSignup).not.toHaveBeenCalled()
  })

  it("reports a Stripe failure as 502 rather than throwing", async () => {
    createEventCheckoutSession.mockRejectedValue(new Error("stripe down"))
    const out = await createEventSignupCheckout("host-biz", base)
    expect(out).toMatchObject({ ok: false, status: 502 })
  })

  it("reports a session with no url as 502 rather than handing back undefined", async () => {
    // Stripe types `url` as nullable. Returning `{ok: true, sessionUrl: undefined}`
    // would send the visitor to the string "undefined".
    createEventCheckoutSession.mockResolvedValue({ id: "cs_1", url: null })
    const out = await createEventSignupCheckout("host-biz", base)
    expect(out).toMatchObject({ ok: false, status: 502 })
  })

  it("passes custom return urls straight through", async () => {
    await createEventSignupCheckout("host-biz", {
      ...base,
      returnUrls: { successUrl: "https://x.test/go/f/thank-you", cancelUrl: "https://x.test/go/f/register" },
    })
    expect(createEventCheckoutSession.mock.calls[0][0]).toMatchObject({
      successUrl: "https://x.test/go/f/thank-you",
      cancelUrl: "https://x.test/go/f/register",
    })
  })

  it("passes NO return urls when none are given, leaving the event page's own default", async () => {
    // MUTANT: defaulting these to the funnel's paths here. The event page's modal
    // shares this helper and must keep returning to the event pages.
    await createEventSignupCheckout("host-biz", base)
    const arg = createEventCheckoutSession.mock.calls[0][0]
    expect(arg.successUrl).toBeUndefined()
    expect(arg.cancelUrl).toBeUndefined()
  })

  it("stores the stripe session id against the signup", async () => {
    await createEventSignupCheckout("host-biz", base)
    expect(from).toHaveBeenCalledWith("event_signups")
  })
})
