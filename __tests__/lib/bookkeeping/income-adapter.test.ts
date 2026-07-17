import { describe, it, expect } from "vitest"
import { buildIncomeDrafts } from "@/lib/bookkeeping/income-adapter"
import type { IncomeSourceRows } from "@/lib/bookkeeping/types"

function base(): IncomeSourceRows {
  return { payments: [], shopOrders: [], clientPackages: [], eventSignups: [], memberships: [] }
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
    }]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts[0]).toMatchObject({
      amount_cents: 50000, service_line: "session_packs", occurred_on: "2026-04-01",
      source_ref: "client_packages:22222222-2222-4222-8222-222222222221", memo: "10-Pack",
    })
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
    expect(drafts[0]).toMatchObject({ amount_cents: 12000, service_line: "camps", memo: "Summer Camp" })
  })
})

describe("buildIncomeDrafts — memberships gap", () => {
  it("emits no drafts but warns for each active membership", () => {
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
    expect(warnings.some((w) => w.includes("recurring revenue is not recorded"))).toBe(true)
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
