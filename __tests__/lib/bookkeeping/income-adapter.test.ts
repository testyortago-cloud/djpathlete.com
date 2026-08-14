import { describe, it, expect } from "vitest"
import { buildIncomeDrafts } from "@/lib/bookkeeping/income-adapter"
import type { IncomeSourceRows } from "@/lib/bookkeeping/types"

function base(): IncomeSourceRows {
  return { payments: [], shopOrders: [], clientPackages: [], eventSignups: [], memberships: [] }
}

const P1 = "aaaaaaa1-0000-4000-8000-000000000001"
const P2 = "aaaaaaa2-0000-4000-8000-000000000002"
const P3 = "aaaaaaa3-0000-4000-8000-000000000003"
const P4 = "aaaaaaa4-0000-4000-8000-000000000004"
const C1 = "ccccccc1-0000-4000-8000-000000000001"
const S1 = "sssssss1-0000-4000-8000-000000000001"
const PRG = "ddddddd1-0000-4000-8000-000000000001"

function src(over: Partial<IncomeSourceRows>): IncomeSourceRows {
  return { payments: [], shopOrders: [], clientPackages: [], eventSignups: [], memberships: [], ...over } as IncomeSourceRows
}
function pay(over: Record<string, unknown>) {
  return { id: P1, status: "succeeded", amount_cents: 1000, created_at: "2026-07-01T10:00:00Z", description: null, metadata: {}, user_id: null, payer_name: null, payer_email: null, program_name: null, ...over } as never
}
function mirror(over: Record<string, unknown> & { mtype: string }) {
  const { mtype, ...rest } = over
  return pay({ metadata: { type: mtype }, ...rest })
}
function pack(over: Record<string, unknown>) {
  return { id: C1, payment_status: "paid", price_cents: 1000, purchased_at: "2026-07-01T10:00:00Z", session_type: "1-on-1", product_name: null, credits_total: null, client_name: null, stripe_session_id: "cs_test_1", stripe_payment_id: "pi_test_1", ...over } as never
}
function signup(over: Record<string, unknown>) {
  return { id: S1, signup_type: "paid", status: "confirmed", amount_paid_cents: 1000, created_at: "2026-07-01T10:00:00Z", parent_name: null, event_title: null, ...over } as never
}

describe("buildIncomeDrafts — payments", () => {
  it("emits a succeeded payment as gross income with a dedupe ref", () => {
    const input = base()
    input.payments = [{
      id: "11111111-1111-4111-8111-111111111111", user_id: null,
      stripe_payment_id: "pi_1", stripe_customer_id: null, amount_cents: 9900,
      currency: "usd", status: "succeeded", description: "Program purchase",
      metadata: { programId: "p1", customerEmail: "a@b.com" },
      created_at: "2026-03-02T10:00:00Z", updated_at: "2026-03-02T10:00:00Z",
      gclid: null, gbraid: null, wbraid: null, fbclid: null,
    }]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      direction: "income", amount_cents: 9900, occurred_on: "2026-03-02",
      source: "platform_import", source_ref: "payments:11111111-1111-4111-8111-111111111111",
      counterparty: "a@b.com",
    })
  })
  it("skips refunded payments with a warning", () => {
    const input = base()
    input.payments = [{
      id: "11111111-1111-4111-8111-111111111112", user_id: null, stripe_payment_id: "pi_2",
      stripe_customer_id: null, amount_cents: 5000, currency: "usd", status: "refunded",
      description: "x", metadata: {}, created_at: "2026-03-02T10:00:00Z",
      updated_at: "2026-03-02T10:00:00Z", gclid: null, gbraid: null, wbraid: null, fbclid: null,
    }]
    const { drafts, warnings } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(0)
    expect(warnings.some((w) => w.includes("refunded"))).toBe(true)
  })
  it("does NOT double-count a Stripe pack that also has a payments mirror row", () => {
    // A Stripe-paid pack writes BOTH a payments row (metadata.type=session_pack)
    // and a client_packages row. Only the richer pack row should become a draft.
    const input = base()
    input.payments = [{
      id: "11111111-1111-4111-8111-111111111199", user_id: "u1", stripe_payment_id: "pi_pack",
      stripe_customer_id: null, amount_cents: 50000, currency: "usd", status: "succeeded",
      description: "Session pack", metadata: { type: "session_pack", client_package_id: "22222222-2222-4222-8222-222222222221" },
      created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z",
      gclid: null, gbraid: null, wbraid: null, fbclid: null,
    }]
    input.clientPackages = [{
      id: "22222222-2222-4222-8222-222222222221",
      client_user_id: "22222222-2222-4222-8222-2222222222aa",
      product_id: null, session_type: "1-on-1", credits_total: 10, credits_used: 0,
      price_cents: 50000, payment_method: "stripe", payment_status: "paid", status: "active",
      stripe_session_id: null, stripe_payment_id: "pi_pack", assignment_id: null,
      purchased_at: "2026-04-01T00:00:00Z", created_by: null,
      created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z",
      product_name: "10-Pack",
    } as never]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].source_ref).toBe("client_packages:22222222-2222-4222-8222-222222222221")
    expect(drafts.reduce((s, d) => s + d.amount_cents, 0)).toBe(50000)
  })
  it("does NOT double-count a Stripe event signup that also has a payments mirror row", () => {
    const input = base()
    input.payments = [{
      id: "11111111-1111-4111-8111-1111111111a9", user_id: null, stripe_payment_id: "pi_evt",
      stripe_customer_id: null, amount_cents: 12000, currency: "usd", status: "succeeded",
      description: "Event signup", metadata: { type: "event_signup", signup_id: "33333333-3333-4333-8333-333333333331" },
      created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
      gclid: null, gbraid: null, wbraid: null, fbclid: null,
    }]
    input.eventSignups = [{ id: "33333333-3333-4333-8333-333333333331", event_id: "e1", signup_type: "paid",
      status: "confirmed", amount_paid_cents: 12000, parent_name: "Pat", parent_email: "p@x.com",
      athlete_name: "Kid", user_id: null, stripe_session_id: null, stripe_payment_intent_id: "pi_evt",
      created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
      event_title: "Summer Camp", event_type: "camp" } as never]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].source_ref).toBe("event_signups:33333333-3333-4333-8333-333333333331")
  })
  it("silently skips pending/failed payments (no income leak, no warning)", () => {
    const input = base()
    input.payments = ["pending", "failed"].map((status, i) => ({
      id: `11111111-1111-4111-8111-11111111112${i}`, user_id: null, stripe_payment_id: `pi_s${i}`,
      stripe_customer_id: null, amount_cents: 7000, currency: "usd", status,
      description: "x", metadata: {}, created_at: "2026-03-02T10:00:00Z",
      updated_at: "2026-03-02T10:00:00Z", gclid: null, gbraid: null, wbraid: null, fbclid: null,
    })) as never
    const { drafts, warnings } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })
})

describe("buildIncomeDrafts — packs, shop, events", () => {
  it("emits a paid pack", () => {
    const input = base()
    input.clientPackages = [{
      id: "22222222-2222-4222-8222-222222222221",
      client_user_id: "22222222-2222-4222-8222-2222222222aa",
      product_id: null, session_type: "1-on-1", credits_total: 10, credits_used: 0,
      price_cents: 50000, payment_method: "cash", payment_status: "paid", status: "active",
      stripe_session_id: null, stripe_payment_id: null, assignment_id: null,
      purchased_at: "2026-04-01T00:00:00Z", created_by: null,
      created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z",
      product_name: "10-Pack",
    } as never]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts[0]).toMatchObject({
      amount_cents: 50000, service_line: "session_packs", occurred_on: "2026-04-01",
      source_ref: "client_packages:22222222-2222-4222-8222-222222222221", memo: "10-Pack (10 sessions)",
    })
  })
  it("skips shop orders in excluded statuses (canceled/refunded/pending)", () => {
    const input = base()
    input.shopOrders = ["canceled", "refunded", "pending"].map((status, i) => ({
      id: `55555555-5555-4555-8555-55555555556${i}`, total_cents: 9999, subtotal_cents: 9999,
      shipping_cents: 0, status, customer_name: "C", customer_email: "c@c.com", user_id: null,
      order_number: `ox${i}`, stripe_session_id: null, stripe_payment_intent_id: null,
      refund_amount_cents: null, items: [], created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z", shipped_at: null,
    })) as never
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(0)
  })
  it("emits a confirmed paid event signup, skips interest rows", () => {
    const input = base()
    input.eventSignups = [
      { id: "33333333-3333-4333-8333-333333333331", event_id: "e1", signup_type: "paid",
        status: "confirmed", amount_paid_cents: 12000, parent_name: "Pat", parent_email: "p@x.com",
        athlete_name: "Kid", user_id: null, stripe_session_id: null, stripe_payment_intent_id: null,
        created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
        event_title: "Summer Camp", event_type: "camp" } as never,
      { id: "33333333-3333-4333-8333-333333333332", event_id: "e1", signup_type: "interest",
        status: "pending", amount_paid_cents: null, parent_name: "X", parent_email: "x@x.com",
        athlete_name: "Y", user_id: null, stripe_session_id: null, stripe_payment_intent_id: null,
        created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
        event_title: "Summer Camp", event_type: "camp" } as never,
    ]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ amount_cents: 12000, service_line: "camps", memo: "Summer Camp — signup" })
  })
})

describe("buildIncomeDrafts — memberships gap", () => {
  it("emits no drafts but warns once for active memberships", () => {
    const input = base()
    input.memberships = [{
      id: "44444444-4444-4444-8444-444444444441", user_id: "u1", plan_id: "pl1",
      status: "active", current_period_start: null, current_period_end: null,
      cancel_at_period_end: false, canceled_at: null, stripe_subscription_id: "sub_1",
      stripe_customer_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      plan_name: "Monthly", plan_price_cents: 9900, plan_interval: "month",
    } as never]
    const { drafts, warnings } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(0)
    expect(warnings.some((w) => w.includes("recurring membership revenue is not in the database"))).toBe(true)
  })

  it("emits exactly one window-scoped warning for multiple active memberships, naming the count and window dates", () => {
    const input = base()
    input.memberships = [
      {
        id: "44444444-4444-4444-8444-444444444441", user_id: "u1", plan_id: "pl1",
        status: "active", current_period_start: null, current_period_end: null,
        cancel_at_period_end: false, canceled_at: null, stripe_subscription_id: "sub_1",
        stripe_customer_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        plan_name: "Monthly", plan_price_cents: 9900, plan_interval: "month",
      } as never,
      {
        id: "44444444-4444-4444-8444-444444444442", user_id: "u2", plan_id: "pl1",
        status: "trialing", current_period_start: null, current_period_end: null,
        cancel_at_period_end: false, canceled_at: null, stripe_subscription_id: "sub_2",
        stripe_customer_id: null, created_at: "2026-01-05T00:00:00Z", updated_at: "2026-01-05T00:00:00Z",
        plan_name: "Monthly", plan_price_cents: 9900, plan_interval: "month",
      } as never,
    ]
    const { drafts, warnings } = buildIncomeDrafts(input, { from: "2026-01-01", to: "2026-01-31" })
    expect(drafts).toHaveLength(0)
    const membershipWarnings = warnings.filter((w) => w.includes("recurring membership revenue is not in the database"))
    expect(membershipWarnings).toHaveLength(1)
    expect(membershipWarnings[0]).toContain("2 membership(s)")
    expect(membershipWarnings[0]).toContain("2026-01-01…2026-01-31")
  })
})

describe("buildIncomeDrafts — ordering", () => {
  it("sorts drafts by occurred_on ascending", () => {
    const input = base()
    input.shopOrders = [
      { id: "55555555-5555-4555-8555-555555555552", total_cents: 100, subtotal_cents: 100,
        shipping_cents: 0, status: "paid", customer_name: "B", customer_email: "b@b.com",
        user_id: null, order_number: "o2", stripe_session_id: null, stripe_payment_intent_id: null,
        refund_amount_cents: null, items: [], created_at: "2026-06-05T00:00:00Z",
        updated_at: "2026-06-05T00:00:00Z", shipped_at: null } as never,
      { id: "55555555-5555-4555-8555-555555555551", total_cents: 200, subtotal_cents: 200,
        shipping_cents: 0, status: "paid", customer_name: "A", customer_email: "a@a.com",
        user_id: null, order_number: "o1", stripe_session_id: null, stripe_payment_intent_id: null,
        refund_amount_cents: null, items: [], created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z", shipped_at: null } as never,
    ]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts.map((d) => d.occurred_on)).toEqual(["2026-06-01", "2026-06-05"])
  })
})

describe("enriched memos and counterparties (2026-07-19)", () => {
  it("composes program memos and athlete counterparties", () => {
    const { drafts } = buildIncomeDrafts(src({
      payments: [
        pay({ id: P1, amount_cents: 32000, description: "program", metadata: { programId: PRG }, program_name: "Cannon Baller!", payer_name: "Cannon Kremer" }),
        pay({ id: P2, amount_cents: 8000, description: "program week", metadata: { programId: PRG, weekNumber: 3 }, program_name: "Cannon Baller!", payer_name: "Cannon Kremer" }),
        pay({ id: P3, amount_cents: 5000, metadata: { type: "session_fee" }, payer_name: null, payer_email: "sf@x.com" }),
      ],
    }))
    expect(drafts.map((d) => d.memo)).toEqual([
      "Cannon Baller! — program purchase",
      "Cannon Baller! — week 3 access",
      "Session fee",
    ])
    expect(drafts[0].counterparty).toBe("Cannon Kremer")
    expect(drafts[2].counterparty).toBe("sf@x.com")
  })

  it("prefills Performance Training for a program-linked payment even when the description doesn't say so (F3.2)", () => {
    // "Subscription renewal" contains neither "program" nor "week", so
    // paymentServiceLine's text match alone would land on "other" — the
    // program_name link must win.
    const { drafts } = buildIncomeDrafts(src({
      payments: [pay({ id: P1, amount_cents: 9900, description: "Subscription renewal", metadata: { programId: PRG }, program_name: "Cannon Baller!" })],
    }))
    expect(drafts[0].service_line).toBe("performance_training")
  })

  it("details pack and signup drafts", () => {
    const { drafts } = buildIncomeDrafts(src({
      clientPackages: [pack({ id: C1, price_cents: 150000, product_name: "1-On-1", credits_total: 10, client_name: "Sandeep Chennadi" })],
      eventSignups: [signup({ id: S1, amount_paid_cents: 8500, event_title: "Summer Speed Camp", parent_name: "A Parent" })],
    }))
    expect(drafts.map((d) => d.memo)).toEqual(["1-On-1 (10 sessions)", "Summer Speed Camp — signup"])
    expect(drafts.map((d) => d.counterparty)).toEqual(["Sandeep Chennadi", "A Parent"])
  })
})

describe("orphaned-mirror fallback (2026-07-19)", () => {
  it("counts the real 4×$85 case: event mirrors with zero signup rows", () => {
    const { drafts, warnings } = buildIncomeDrafts(src({
      payments: [
        mirror({ id: P1, amount_cents: 8500, created_at: "2026-05-04T10:00:00Z", mtype: "event_signup" }),
        mirror({ id: P2, amount_cents: 8500, created_at: "2026-05-09T10:00:00Z", mtype: "event_signup" }),
        mirror({ id: P3, amount_cents: 8500, created_at: "2026-05-09T11:00:00Z", mtype: "event_signup" }),
        mirror({ id: P4, amount_cents: 8500, created_at: "2026-05-14T10:00:00Z", mtype: "event_signup" }),
      ],
    }))
    expect(drafts).toHaveLength(4)
    expect(drafts.every((d) => d.memo === "Camp/event signup (record deleted)" && d.service_line === "camps")).toBe(true)
    expect(drafts.map((d) => d.source_ref).sort()).toEqual([P1, P2, P3, P4].map((id) => `payments:${id}`).sort())
    expect(warnings).toContain("4 event-signup payment(s) counted directly — the signup records no longer exist.")
  })

  it("still skips mirrors whose source rows exist (double-count regression pin)", () => {
    const { drafts, warnings } = buildIncomeDrafts(src({
      payments: [mirror({ id: P1, amount_cents: 150000, created_at: "2026-07-17T10:00:00Z", mtype: "session_pack" })],
      clientPackages: [pack({ id: C1, price_cents: 150000, purchased_at: "2026-07-10T10:00:00Z", product_name: "1-On-1", credits_total: 10 })],
    }))
    expect(drafts).toHaveLength(1)
    expect(drafts[0].source_ref).toBe(`client_packages:${C1}`)
    expect(warnings.some((w) => w.includes("counted directly"))).toBe(false)
  })

  it("pairs one-to-one: two equal mirrors, one candidate → one skip + one fallback", () => {
    const { drafts } = buildIncomeDrafts(src({
      payments: [
        mirror({ id: P1, amount_cents: 20000, created_at: "2026-07-06T10:00:00Z", mtype: "session_pack" }),
        mirror({ id: P2, amount_cents: 20000, created_at: "2026-07-07T10:00:00Z", mtype: "session_pack" }),
      ],
      clientPackages: [pack({ id: C1, price_cents: 20000, purchased_at: "2026-07-06T09:00:00Z", credits_total: 5 })],
    }))
    expect(drafts).toHaveLength(2)
    expect(drafts.map((d) => d.source_ref).sort()).toEqual([`client_packages:${C1}`, `payments:${P2}`].sort())
  })

  it("respects the ±7-day window boundary: 7 pairs, 8 falls back", () => {
    const seven = buildIncomeDrafts(src({
      payments: [mirror({ id: P1, amount_cents: 150000, created_at: "2026-07-17T10:00:00Z", mtype: "session_pack" })],
      clientPackages: [pack({ id: C1, price_cents: 150000, purchased_at: "2026-07-10T10:00:00Z", credits_total: 10 })],
    }))
    expect(seven.drafts).toHaveLength(1)
    const eight = buildIncomeDrafts(src({
      payments: [mirror({ id: P1, amount_cents: 150000, created_at: "2026-07-18T10:00:00Z", mtype: "session_pack" })],
      clientPackages: [pack({ id: C1, price_cents: 150000, purchased_at: "2026-07-10T10:00:00Z", credits_total: 10 })],
    }))
    expect(eight.drafts).toHaveLength(2)
    expect(eight.warnings).toContain("1 session-pack payment(s) counted directly — the pack records no longer exist.")
  })

  it("cash packs never absorb an orphan mirror's pairing slot", () => {
    const { drafts, warnings } = buildIncomeDrafts(src({
      payments: [mirror({ id: P1, amount_cents: 20000, created_at: "2026-07-06T10:00:00Z", mtype: "session_pack" })],
      clientPackages: [
        pack({ id: C1, price_cents: 20000, purchased_at: "2026-07-05T10:00:00Z", credits_total: 5, stripe_session_id: null, stripe_payment_id: null }),
      ],
    }))
    expect(drafts).toHaveLength(2)
    expect(drafts.map((d) => d.source_ref).sort()).toEqual([`client_packages:${C1}`, `payments:${P1}`].sort())
    expect(warnings).toContain("1 session-pack payment(s) counted directly — the pack records no longer exist.")
  })
})

describe("id-first mirror pairing + alt_ref cross-run dedupe (final review 2026-07-20)", () => {
  it("pairs by client_package_id even when amount and date diverge — id pairing ignores both", () => {
    // A DIFFERENT amount (promo/price-edit) and a 20-day gap would both fail
    // the legacy amount±7day heuristic, but the mirror carries the exact
    // client_package_id, so it must still pair.
    const { drafts } = buildIncomeDrafts(src({
      payments: [
        pay({ id: P1, amount_cents: 99900, created_at: "2026-07-26T10:00:00Z", metadata: { type: "session_pack", client_package_id: C1 } }),
      ],
      clientPackages: [pack({ id: C1, price_cents: 50000, purchased_at: "2026-07-06T09:00:00Z", credits_total: 10 })],
    }))
    expect(drafts).toHaveLength(1)
    expect(drafts[0].source_ref).toBe(`client_packages:${C1}`)
    expect(drafts[0].amount_cents).toBe(50000) // the source-table draft's own amount, untouched by the mirror's
    expect(drafts[0].alt_ref).toBe(`payments:${P1}`)
  })

  it("orphan-with-id: event_signup_id matching no signup falls back, alt_ref points at the deleted source ref", () => {
    const { drafts } = buildIncomeDrafts(src({
      payments: [pay({ id: P1, amount_cents: 8500, created_at: "2026-07-12T10:00:00Z", metadata: { type: "event_signup", event_signup_id: S1 } })],
    }))
    expect(drafts).toHaveLength(1)
    expect(drafts[0].source_ref).toBe(`payments:${P1}`)
    expect(drafts[0].alt_ref).toBe(`event_signups:${S1}`)
  })

  it("permutation invariance: reversing the payments array yields identical sorted source_ref/alt_ref sets", () => {
    const buildFixture = (): IncomeSourceRows =>
      src({
        payments: [
          pay({ id: P1, amount_cents: 50000, created_at: "2026-07-06T10:00:00Z", metadata: { type: "session_pack", client_package_id: C1 } }),
          pay({ id: P2, amount_cents: 8500, created_at: "2026-07-12T10:00:00Z", metadata: { type: "event_signup", event_signup_id: S1 } }),
        ],
        clientPackages: [pack({ id: C1, price_cents: 50000, purchased_at: "2026-07-06T09:00:00Z", credits_total: 10 })],
      })
    const forward = buildIncomeDrafts(buildFixture())
    const reversedInput = buildFixture()
    reversedInput.payments = [...reversedInput.payments].reverse()
    const reversed = buildIncomeDrafts(reversedInput)

    const refSet = (result: typeof forward) => result.drafts.map((d) => `${d.source_ref}|${d.alt_ref ?? ""}`).sort()
    expect(refSet(reversed)).toEqual(refSet(forward))
  })

  it("legacy id-less mirror still pairs by amount±7d (id-first pairing doesn't regress the fallback path)", () => {
    const { drafts } = buildIncomeDrafts(src({
      payments: [mirror({ id: P1, amount_cents: 12000, created_at: "2026-05-03T10:00:00Z", mtype: "event_signup" })],
      eventSignups: [signup({ id: S1, amount_paid_cents: 12000, created_at: "2026-05-01T10:00:00Z" })],
    }))
    expect(drafts).toHaveLength(1)
    expect(drafts[0].source_ref).toBe(`event_signups:${S1}`)
  })

  it("C1: an auto-renewal mirror pairs with the NEW pack it names, not double-booked as its own draft", () => {
    // Before the fix, pack-renewal.ts wrote metadata.type = "pack_auto_renewal",
    // which this adapter didn't recognize as a mirror row at all — it fell
    // through to the generic non-mirror path and became a SECOND income draft
    // on top of the one the renewal's own (paid) client_packages row already
    // produces. A $750 renewal was booked as $1,500. The fix routes it through
    // the same id-pairing branch a manual sale uses: metadata.type =
    // "session_pack" + client_package_id = the renewal's OWN id (not the
    // depleted source pack's).
    const { drafts } = buildIncomeDrafts(src({
      payments: [
        pay({
          id: P1, amount_cents: 75000, created_at: "2026-08-14T10:00:00Z",
          metadata: { type: "session_pack", client_package_id: C1, auto_renewal: true, source_package_id: "source-pack-id" },
        }),
      ],
      clientPackages: [
        pack({ id: C1, price_cents: 75000, purchased_at: "2026-08-14T10:00:00Z", credits_total: 10, stripe_session_id: null, stripe_payment_id: null }),
      ],
    }))
    expect(drafts).toHaveLength(1)
    expect(drafts.reduce((s, d) => s + d.amount_cents, 0)).toBe(75000)
    expect(drafts[0].source_ref).toBe(`client_packages:${C1}`)
    expect(drafts[0].alt_ref).toBe(`payments:${P1}`)
  })

  it("orphan session-pack draft: literal memo and payer-chain counterparty (F3.4)", () => {
    const { drafts } = buildIncomeDrafts(src({
      payments: [pay({ id: P1, amount_cents: 45000, created_at: "2026-07-12T10:00:00Z", metadata: { type: "session_pack" }, payer_name: "Riley Cole" })],
    }))
    expect(drafts).toHaveLength(1)
    expect(drafts[0].memo).toBe("Session pack (record deleted)")
    expect(drafts[0].counterparty).toBe("Riley Cole")
  })
})
