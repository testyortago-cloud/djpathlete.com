import { describe, expect, it } from "vitest"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"
import {
  allocateSharedCosts,
  serviceLineProfit,
  type ServiceLineProfitRow,
} from "@/lib/bookkeeping/service-line-profit"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_PT_INCOME = "a0000000-0000-4000-8000-000000000001"
const ACC_EQUIP_PT = "a0000000-0000-4000-8000-000000000002"  // expense tagged performance_training
const ACC_SOFTWARE = "a0000000-0000-4000-8000-000000000003"  // expense, no service line → shared
const ACC_CAMP_COST = "a0000000-0000-4000-8000-000000000004" // expense tagged camps, no camp income
const ACC_SP_EXPENSE = "a0000000-0000-4000-8000-000000000005" // expense tagged session_packs
const ACC_CONSULT = "a0000000-0000-4000-8000-000000000006"   // expense tagged consulting (unrecognized)

function account(over: Partial<InsightAccount>): InsightAccount {
  return {
    id: ACC_PT_INCOME, book_id: BOOK, name: "Performance Training", account_type: "income",
    service_line: "performance_training", tax_category: null, sort_order: 0,
    is_deductible_candidate: false, requires_business_purpose: false, archived_at: null,
    ...over,
  }
}
let seq = 0
function entry(over: Partial<InsightEntry>): InsightEntry {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: BOOK, account_id: ACC_PT_INCOME, direction: "income", amount_cents: 10000,
    occurred_on: "2026-03-01", counterparty: null, memo: null, source: "manual",
    business_purpose: null, document_id: null,
    ...over,
  }
}

const accounts: InsightAccount[] = [
  account({}),
  account({ id: ACC_EQUIP_PT, name: "Equipment", account_type: "expense", service_line: "performance_training" }),
  account({ id: ACC_SOFTWARE, name: "Software & Subscriptions", account_type: "expense", service_line: null }),
  account({ id: ACC_CAMP_COST, name: "Camp Supplies", account_type: "expense", service_line: "camps" }),
  account({ id: ACC_SP_EXPENSE, name: "Session Pack Supplies", account_type: "expense", service_line: "session_packs" }),
  account({ id: ACC_CONSULT, name: "Consulting", account_type: "expense", service_line: "consulting" }),
]

describe("serviceLineProfit", () => {
  it("nets direct costs per line; shared and uncategorized stay separate buckets", () => {
    const r = serviceLineProfit([
      entry({ amount_cents: 10000 }),                                              // PT income
      entry({ account_id: ACC_EQUIP_PT, direction: "expense", amount_cents: 2000 }), // PT direct cost
      entry({ account_id: ACC_SOFTWARE, direction: "expense", amount_cents: 500 }),  // shared
      entry({ account_id: null, direction: "expense", amount_cents: 300 }),          // uncategorized
    ], accounts)
    const pt = r.rows.find((row) => row.service_line === "performance_training")
    expect(pt).toMatchObject({ income_cents: 10000, direct_cost_cents: 2000, net_estimate_cents: 8000, label: "Performance Training" })
    expect(r.shared_cost_cents).toBe(500)
    expect(r.uncategorized_expense_cents).toBe(300)
    expect(r.income_total_cents).toBe(10000)
    expect(r.direct_cost_total_cents).toBe(2000)
  })

  it("a line with costs but no income still gets a row with negative net", () => {
    const r = serviceLineProfit([
      entry({ account_id: ACC_CAMP_COST, direction: "expense", amount_cents: 400 }),
    ], accounts)
    expect(r.rows.find((row) => row.service_line === "camps")).toMatchObject({
      income_cents: 0, direct_cost_cents: 400, net_estimate_cents: -400, label: "Camps & Clinics",
    })
  })

  it("income on an unknown account lands in the null 'Uncategorized' row (parity with incomeByServiceLine)", () => {
    const r = serviceLineProfit([entry({ account_id: "a0000000-0000-4000-8000-00000000dead", amount_cents: 700 })], accounts)
    expect(r.rows.find((row) => row.service_line === null)).toMatchObject({ label: "Uncategorized", income_cents: 700 })
  })

  it("expense on an unknown account counts as uncategorized expense, not shared", () => {
    const r = serviceLineProfit([entry({ account_id: "a0000000-0000-4000-8000-00000000dead", direction: "expense", amount_cents: 900 })], accounts)
    expect(r.uncategorized_expense_cents).toBe(900)
    expect(r.shared_cost_cents).toBe(0)
  })

  it("empty input → well-shaped empty result", () => {
    expect(serviceLineProfit([], accounts)).toEqual({
      rows: [], income_total_cents: 0, direct_cost_total_cents: 0, shared_cost_cents: 0, uncategorized_expense_cents: 0,
    })
  })

  it("rows sort by income desc then label as tie-breaker", () => {
    const r = serviceLineProfit([
      entry({ amount_cents: 20000 }),                                                    // PT income 20000
      entry({ account_id: ACC_CAMP_COST, direction: "income", amount_cents: 20000 }),   // Camps income 20000 (tied with PT)
      entry({ account_id: ACC_SP_EXPENSE, direction: "expense", amount_cents: 15000 }), // Session Packs costs-only (0 income)
    ], accounts)
    // Expected order: income desc (20000 first), then label asc tie-break ("Camps..." < "Performance...")
    const labels = r.rows.map((row) => row.label)
    expect(labels).toEqual(["Camps & Clinics", "Performance Training", "Session Packs"])
  })

  it("costs-only line with unrecognized service_line uses raw label fallback", () => {
    const r = serviceLineProfit([
      entry({ account_id: ACC_CONSULT, direction: "expense", amount_cents: 300 }),
    ], accounts)
    expect(r.rows.find((row) => row.service_line === "consulting")).toMatchObject({
      label: "consulting", income_cents: 0, direct_cost_cents: 300, net_estimate_cents: -300,
    })
  })
})

describe("allocateSharedCosts", () => {
  const row = (over: Partial<ServiceLineProfitRow>): ServiceLineProfitRow => ({
    service_line: "performance_training", label: "Performance Training",
    income_cents: 0, direct_cost_cents: 0, net_estimate_cents: 0, ...over,
  })
  const profit = (rows: ServiceLineProfitRow[], shared: number) => ({
    rows,
    income_total_cents: rows.reduce((s, r) => s + r.income_cents, 0),
    direct_cost_total_cents: rows.reduce((s, r) => s + r.direct_cost_cents, 0),
    shared_cost_cents: shared,
    uncategorized_expense_cents: 0,
  })

  it("100 cents over three equal lines allocates 34/33/33 — largest-remainder, not per-row rounding", () => {
    // Discriminator: naive Math.round per row gives 33/33/33 (sum 99, loses a
    // cent); round-half-up-all gives 34/34/34 (sum 102, invents cents).
    const r = allocateSharedCosts(profit([
      row({ service_line: "a", label: "A", income_cents: 1000, net_estimate_cents: 1000 }),
      row({ service_line: "b", label: "B", income_cents: 1000, net_estimate_cents: 1000 }),
      row({ service_line: "c", label: "C", income_cents: 1000, net_estimate_cents: 1000 }),
    ], 100))
    expect(r.rows.map((x) => x.allocated_shared_cents)).toEqual([34, 33, 33]) // frac tie → row order
    expect(r.allocated_total_cents).toBe(100)
  })

  it("remainder cents go to the LARGEST fractional remainder, not the first row", () => {
    // shares of 10¢ over incomes 1000/2000: raw 3.333 / 6.667 → floors 3/6,
    // leftover 1 goes to the .667 row. First-row mutation would give 4/6.
    const r = allocateSharedCosts(profit([
      row({ service_line: "a", label: "A", income_cents: 1000, net_estimate_cents: 1000 }),
      row({ service_line: "b", label: "B", income_cents: 2000, net_estimate_cents: 2000 }),
    ], 10))
    expect(r.rows.map((x) => x.allocated_shared_cents)).toEqual([3, 7])
  })

  it("allocated cents always sum EXACTLY to shared_cost_cents (odd split, 12.555-style)", () => {
    const r = allocateSharedCosts(profit([
      row({ service_line: "a", label: "A", income_cents: 12555, net_estimate_cents: 12555 }),
      row({ service_line: "b", label: "B", income_cents: 33333, net_estimate_cents: 33333 }),
      row({ service_line: "c", label: "C", income_cents: 707, net_estimate_cents: 707 }),
    ], 9999))
    // Per-row pin, not just the sum: raw shares are 2694.2257 / 7153.0565 /
    // 151.7178, so the ONE leftover cent belongs to C (largest FRACTIONAL
    // REMAINDER, spec B-4) — not to B (largest income share). Both variants
    // sum to 9999, so only this assertion discriminates them.
    expect(r.rows.map((x) => x.allocated_shared_cents)).toEqual([2694, 7153, 152])
    expect(r.rows.reduce((s, x) => s + x.allocated_shared_cents, 0)).toBe(9999)
    expect(r.allocated_total_cents).toBe(9999)
  })

  it("zero-income lines get 0 and net_after_allocated subtracts the share", () => {
    const r = allocateSharedCosts(profit([
      row({ service_line: "a", label: "A", income_cents: 5000, direct_cost_cents: 1000, net_estimate_cents: 4000 }),
      row({ service_line: "b", label: "B", income_cents: 0, direct_cost_cents: 400, net_estimate_cents: -400 }),
    ], 500))
    expect(r.rows[0].allocated_shared_cents).toBe(500)
    expect(r.rows[0].net_after_allocated_cents).toBe(3500)
    expect(r.rows[1].allocated_shared_cents).toBe(0)
    expect(r.rows[1].net_after_allocated_cents).toBe(-400)
  })

  it("income_total 0 → no allocation at all (everything stays shared)", () => {
    const r = allocateSharedCosts(profit([
      row({ service_line: "a", label: "A", income_cents: 0, direct_cost_cents: 300, net_estimate_cents: -300 }),
    ], 700))
    expect(r.rows[0].allocated_shared_cents).toBe(0)
    expect(r.allocated_total_cents).toBe(0)
  })
})
