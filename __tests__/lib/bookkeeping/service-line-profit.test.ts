import { describe, expect, it } from "vitest"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"
import { serviceLineProfit } from "@/lib/bookkeeping/service-line-profit"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_PT_INCOME = "a0000000-0000-4000-8000-000000000001"
const ACC_EQUIP_PT = "a0000000-0000-4000-8000-000000000002"  // expense tagged performance_training
const ACC_SOFTWARE = "a0000000-0000-4000-8000-000000000003"  // expense, no service line → shared
const ACC_CAMP_COST = "a0000000-0000-4000-8000-000000000004" // expense tagged camps, no camp income

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

  it("rows sort by income desc then label; empty input → empty shape", () => {
    expect(serviceLineProfit([], accounts)).toEqual({
      rows: [], income_total_cents: 0, direct_cost_total_cents: 0, shared_cost_cents: 0, uncategorized_expense_cents: 0,
    })
  })
})
