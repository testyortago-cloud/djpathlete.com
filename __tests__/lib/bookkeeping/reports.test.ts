import { describe, it, expect } from "vitest"
import {
  incomeByServiceLine, profitAndLossByCategory, perBookSummary,
  type ReportEntry, type ReportAccount,
} from "@/lib/bookkeeping/reports"
import type { BookkeepingBook } from "@/types/database"

const BOOK_A = "b0000000-0000-4000-8000-000000000001"
const BOOK_B = "b0000000-0000-4000-8000-000000000002"
const ACC_PT = "a0000000-0000-4000-8000-000000000001" // income, performance_training
const ACC_NOLINE = "a0000000-0000-4000-8000-000000000002" // income, service_line null
const ACC_EQUIP = "a0000000-0000-4000-8000-000000000003" // expense, Equipment, tax hint

const accounts: ReportAccount[] = [
  { id: ACC_PT, book_id: BOOK_A, name: "Performance Training — Sports", account_type: "income", service_line: "performance_training", tax_category: null, sort_order: 0 },
  { id: ACC_NOLINE, book_id: BOOK_A, name: "Legacy Income", account_type: "income", service_line: null, tax_category: null, sort_order: 1 },
  { id: ACC_EQUIP, book_id: BOOK_A, name: "Equipment", account_type: "expense", service_line: null, tax_category: "Schedule C Line 22", sort_order: 2 },
]

function entry(over: Partial<ReportEntry>): ReportEntry {
  return {
    book_id: BOOK_A, account_id: ACC_PT, direction: "income", amount_cents: 1000,
    occurred_on: "2026-07-01", counterparty: null, memo: null, source: "manual", ...over,
  }
}

const books = [
  { id: BOOK_A, name: "Darren — DJP Athlete", book_kind: "business", sort_order: 0 },
  { id: BOOK_B, name: "Spouse — Business", book_kind: "business", sort_order: 1 },
] as BookkeepingBook[]

describe("incomeByServiceLine", () => {
  it("sums income per service line and ignores expenses", () => {
    const r = incomeByServiceLine([
      entry({ amount_cents: 1000 }),
      entry({ amount_cents: 500 }),
      entry({ direction: "expense", account_id: ACC_EQUIP, amount_cents: 99999 }),
    ], accounts)
    expect(r.total_cents).toBe(1500)
    expect(r.rows).toEqual([
      { service_line: "performance_training", label: "Performance Training", total_cents: 1500, entry_count: 2 },
    ])
  })
  it("folds an account without a service line into 'other'", () => {
    const r = incomeByServiceLine([entry({ account_id: ACC_NOLINE })], accounts)
    expect(r.rows[0].service_line).toBe("other")
  })
  it("buckets entries with no account (or unknown account) as Uncategorized", () => {
    const r = incomeByServiceLine([
      entry({ account_id: null }),
      entry({ account_id: "a0000000-0000-4000-8000-00000000dead" }),
    ], accounts)
    expect(r.rows).toEqual([
      { service_line: null, label: "Uncategorized", total_cents: 2000, entry_count: 2 },
    ])
  })
  it("empty period → zero rows, zero total", () => {
    expect(incomeByServiceLine([], accounts)).toEqual({ rows: [], total_cents: 0 })
  })
})

describe("profitAndLossByCategory", () => {
  it("splits sides by entry.direction and computes net", () => {
    const r = profitAndLossByCategory([
      entry({ amount_cents: 5000 }),
      entry({ direction: "expense", account_id: ACC_EQUIP, amount_cents: 2000 }),
      entry({ direction: "expense", account_id: null, amount_cents: 100 }),
    ], accounts)
    expect(r.income_total_cents).toBe(5000)
    expect(r.expense_total_cents).toBe(2100)
    expect(r.net_cents).toBe(2900)
    expect(r.expense).toEqual([
      { account_id: ACC_EQUIP, name: "Equipment", tax_category: "Schedule C Line 22", total_cents: 2000, entry_count: 1 },
      { account_id: null, name: "Uncategorized", tax_category: null, total_cents: 100, entry_count: 1 },
    ])
  })
  it("net can go negative", () => {
    const r = profitAndLossByCategory([entry({ direction: "expense", account_id: ACC_EQUIP, amount_cents: 700 })], accounts)
    expect(r.net_cents).toBe(-700)
  })
  it("an entry whose direction disagrees with its account's type lands on the ENTRY's side (direction is sign truth)", () => {
    const r = profitAndLossByCategory([entry({ direction: "income", account_id: ACC_EQUIP, amount_cents: 300 })], accounts)
    expect(r.income).toEqual([
      { account_id: ACC_EQUIP, name: "Equipment", tax_category: "Schedule C Line 22", total_cents: 300, entry_count: 1 },
    ])
    expect(r.expense).toEqual([])
  })
  it("zero-amount entries count toward entry_count without moving totals", () => {
    const r = profitAndLossByCategory([entry({ amount_cents: 0 })], accounts)
    expect(r.income[0]).toMatchObject({ total_cents: 0, entry_count: 1 })
  })
  it("empty period → empty sides, zero net", () => {
    expect(profitAndLossByCategory([], accounts)).toEqual({
      income: [], expense: [], income_total_cents: 0, expense_total_cents: 0, net_cents: 0,
    })
  })
})

describe("perBookSummary", () => {
  it("every book appears even with zero entries (spouse empty-state contract)", () => {
    const r = perBookSummary([entry({ amount_cents: 800 })], books)
    expect(r).toEqual([
      { book_id: BOOK_A, name: "Darren — DJP Athlete", book_kind: "business", income_cents: 800, expense_cents: 0, net_cents: 800, entry_count: 1 },
      { book_id: BOOK_B, name: "Spouse — Business", book_kind: "business", income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0 },
    ])
  })
  it("entries for a book not in the list are ignored (archived-book edge, no archive UI exists)", () => {
    const r = perBookSummary([entry({ book_id: "b0000000-0000-4000-8000-00000000dead" })], books)
    expect(r.every((s) => s.entry_count === 0)).toBe(true)
  })
})
