import { describe, expect, it } from "vitest"
import {
  aggregateRevenue,
  normalizeMonthlyCents,
  type RevenueInputs,
} from "@/lib/automation/revenue-aggregator"

const empty: RevenueInputs = {
  active_subscriptions: [],
  failed_payments_last_7d: [],
  previous_mrr_cents: 0,
  new_customers_7d: 0,
  churned_customers_7d: 0,
}

describe("normalizeMonthlyCents", () => {
  it("month → as-is", () => {
    expect(normalizeMonthlyCents(20_000, "month")).toBe(20_000)
  })
  it("year → /12", () => {
    expect(normalizeMonthlyCents(120_000, "year")).toBe(10_000)
  })
  it("week → ×4.33 (rounded)", () => {
    expect(normalizeMonthlyCents(5_000, "week")).toBe(Math.round(5_000 * 4.33))
  })
  it("null / unknown interval → 0 (one-time charge, not MRR)", () => {
    expect(normalizeMonthlyCents(50_000, null)).toBe(0)
    expect(normalizeMonthlyCents(50_000, "lifetime")).toBe(0)
  })
})

describe("aggregateRevenue", () => {
  it("zeros out cleanly when there's no data", () => {
    const r = aggregateRevenue(empty)
    expect(r.mrr_cents).toBe(0)
    expect(r.mrr_delta_cents).toBe(0)
    expect(r.failed_payments_7d).toBe(0)
    expect(r.upcoming_renewals_14d).toBe(0)
    expect(r.top_at_risk_subscriptions).toEqual([])
  })

  it("sums monthly subscriptions correctly", () => {
    const r = aggregateRevenue({
      ...empty,
      active_subscriptions: [
        sub({ id: "s1", monthly_cents: 20_000 }),
        sub({ id: "s2", monthly_cents: 20_000 }),
        sub({ id: "s3", monthly_cents: 40_000 }),
      ],
    })
    expect(r.mrr_cents).toBe(80_000)
  })

  it("delta = mrr - previous_mrr", () => {
    const r = aggregateRevenue({
      ...empty,
      active_subscriptions: [sub({ id: "s1", monthly_cents: 30_000 })],
      previous_mrr_cents: 25_000,
    })
    expect(r.mrr_delta_cents).toBe(5_000)
  })

  it("counts upcoming renewals within 14 days only", () => {
    const soon = new Date(Date.now() + 5 * 86400000).toISOString()
    const later = new Date(Date.now() + 30 * 86400000).toISOString()
    const r = aggregateRevenue({
      ...empty,
      active_subscriptions: [
        sub({ id: "s1", monthly_cents: 20_000, current_period_end: soon }),
        sub({ id: "s2", monthly_cents: 30_000, current_period_end: later }),
      ],
    })
    expect(r.upcoming_renewals_14d).toBe(1)
    expect(r.upcoming_renewals_value_cents).toBe(20_000)
  })

  it("failed-payment totals: count + sum cents", () => {
    const r = aggregateRevenue({
      ...empty,
      failed_payments_last_7d: [
        { id: "p1", customer_email: "a@x.io", amount_cents: 10_000, created_at: nowIso() },
        { id: "p2", customer_email: "b@x.io", amount_cents: 25_000, created_at: nowIso() },
      ],
    })
    expect(r.failed_payments_7d).toBe(2)
    expect(r.failed_payment_value_cents).toBe(35_000)
  })

  it("ranks at-risk subs by mrr_cents desc and caps at 5", () => {
    const failingEmail = "danger@x.io"
    const subs = [
      sub({ id: "low", monthly_cents: 5_000, cancel_at_period_end: true }),
      sub({ id: "high", monthly_cents: 100_000, customer_email: failingEmail }),
      sub({ id: "mid", monthly_cents: 50_000, cancel_at_period_end: true }),
      sub({ id: "tiny1", monthly_cents: 1_000, cancel_at_period_end: true }),
      sub({ id: "tiny2", monthly_cents: 2_000, cancel_at_period_end: true }),
      sub({ id: "tiny3", monthly_cents: 3_000, cancel_at_period_end: true }),
      sub({ id: "safe", monthly_cents: 200_000 }),
    ]
    const r = aggregateRevenue({
      ...empty,
      active_subscriptions: subs,
      failed_payments_last_7d: [
        { id: "p1", customer_email: failingEmail, amount_cents: 10_000, created_at: nowIso() },
      ],
    })
    expect(r.top_at_risk_subscriptions).toHaveLength(5)
    expect(r.top_at_risk_subscriptions[0].subscription_id).toBe("high")
    expect(r.top_at_risk_subscriptions[0].reason).toBe("failed_payment")
    expect(r.top_at_risk_subscriptions[1].subscription_id).toBe("mid")
    expect(r.top_at_risk_subscriptions[1].reason).toBe("cancel_at_period_end")
  })

  it("cancel_at_period_end wins over failed_payment when both apply", () => {
    const email = "both@x.io"
    const r = aggregateRevenue({
      ...empty,
      active_subscriptions: [
        sub({
          id: "both",
          monthly_cents: 50_000,
          customer_email: email,
          cancel_at_period_end: true,
        }),
      ],
      failed_payments_last_7d: [
        { id: "p1", customer_email: email, amount_cents: 10_000, created_at: nowIso() },
      ],
    })
    expect(r.top_at_risk_subscriptions[0].reason).toBe("cancel_at_period_end")
  })

  it("safe subs (no cancel flag, no failed payment) do not appear in at-risk", () => {
    const r = aggregateRevenue({
      ...empty,
      active_subscriptions: [sub({ id: "safe", monthly_cents: 50_000 })],
    })
    expect(r.top_at_risk_subscriptions).toEqual([])
  })

  it("passes through new + churned counts unchanged", () => {
    const r = aggregateRevenue({ ...empty, new_customers_7d: 3, churned_customers_7d: 1 })
    expect(r.new_customers).toBe(3)
    expect(r.churned_customers).toBe(1)
  })
})

// ─── helpers ─────────────────────────────────────────────────────────────────

function sub(overrides: Partial<RevenueInputs["active_subscriptions"][number]>) {
  return {
    id: "s",
    customer_id: "c",
    customer_email: "x@x.io",
    monthly_cents: 0,
    current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
    cancel_at_period_end: false,
    ...overrides,
  }
}

function nowIso() {
  return new Date().toISOString()
}
