import { describe, expect, it } from "vitest"
import {
  SERVICE_LINE_LABELS,
  incomeByServiceLine,
  perBookSummary,
  topCounterparties,
  type ReportAccount,
  type ReportEntry,
} from "@/lib/bookkeeping/reports"
import type { BookkeepingBook } from "@/types/database"
// Direct relative import of the functions/ twin — bookkeeping-aggregate.ts imports
// NOTHING, so it loads cleanly under the root vitest config even though functions/
// is otherwise an isolated package (the statement-schema-parity precedent:
// __tests__/lib/bookkeeping/statement-schema-parity.test.ts).
import {
  SERVICE_LINE_LABELS as twinLabels,
  incomeByServiceLine as twinIncomeByServiceLine,
  perBookSummary as twinPerBookSummary,
  topCounterparties as twinTopCounterparties,
} from "../../../functions/src/lib/bookkeeping-aggregate"

const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_HH = "b0000000-0000-4000-8000-000000000002"
const BOOK_DEAD = "b0000000-0000-4000-8000-00000000dead"
const ACC_PT = "a0000000-0000-4000-8000-000000000001" // income, performance_training
const ACC_SHOP = "a0000000-0000-4000-8000-000000000002" // income, service_line null → "other"
const ACC_EQ = "a0000000-0000-4000-8000-000000000003" // expense, no line
const ACC_UNKNOWN = "a0000000-0000-4000-8000-00000000dead" // never in accounts

const books = [
  { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true },
  { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false },
] as BookkeepingBook[]

const accounts: ReportAccount[] = [
  { id: ACC_PT, book_id: BOOK_BIZ, name: "Performance Training", account_type: "income", service_line: "performance_training", tax_category: null, sort_order: 0 },
  { id: ACC_SHOP, book_id: BOOK_BIZ, name: "Shop Sales", account_type: "income", service_line: null, tax_category: null, sort_order: 1 },
  { id: ACC_EQ, book_id: BOOK_BIZ, name: "Equipment", account_type: "expense", service_line: null, tax_category: null, sort_order: 2 },
]

function entry(over: Partial<ReportEntry>): ReportEntry {
  return {
    book_id: BOOK_BIZ,
    account_id: null,
    direction: "expense",
    amount_cents: 1000,
    occurred_on: "2026-03-01",
    counterparty: null,
    memo: null,
    source: "manual",
    ...over,
  }
}

// ONE shared fixture set exercising: normalized merge, tie-break, null bucket,
// "other" fold vs null Uncategorized, cross-book isolation, unlisted-book skip.
const entries: ReportEntry[] = [
  entry({ direction: "income", account_id: ACC_PT, amount_cents: 50000, counterparty: "Stripe" }),
  entry({ direction: "income", account_id: ACC_SHOP, amount_cents: 20000, counterparty: "Shopify" }),
  entry({ direction: "income", account_id: ACC_UNKNOWN, amount_cents: 700, counterparty: "Venmo" }),
  entry({ account_id: ACC_EQ, amount_cents: 12500, counterparty: " Rogue  Fitness " }),
  entry({ account_id: ACC_EQ, amount_cents: 400, counterparty: "rogue fitness" }),
  entry({ amount_cents: 800, counterparty: "Titan" }),
  entry({ amount_cents: 800, counterparty: "Amazon" }),
  entry({ amount_cents: 100, counterparty: null }),
  entry({ book_id: BOOK_HH, amount_cents: 200000, counterparty: "Landlord" }),
  entry({ book_id: BOOK_DEAD, amount_cents: 300, counterparty: "Ghost Gym" }), // unlisted book
]

describe("chat-tools twin parity (lib/bookkeeping/reports.ts vs functions/src/lib/bookkeeping-aggregate.ts)", () => {
  it("SERVICE_LINE_LABELS are byte-identical", () => {
    expect(twinLabels).toEqual(SERVICE_LINE_LABELS)
  })

  it("perBookSummary: identical fixtures → deep-equal outputs, pinned absolutes", () => {
    const lib = perBookSummary(entries, books)
    const twin = twinPerBookSummary(entries, books)
    expect(twin).toEqual(lib)
    // Absolute pins (deep-equal alone passes if both sides drift identically):
    expect(lib).toEqual([
      { book_id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", income_cents: 70700, expense_cents: 14600, net_cents: 56100, entry_count: 8 },
      { book_id: BOOK_HH, name: "Household & Personal", book_kind: "household", income_cents: 0, expense_cents: 200000, net_cents: -200000, entry_count: 1 },
    ])
  })

  it("incomeByServiceLine: deep-equal + pinned 'other' fold and null Uncategorized bucket", () => {
    const lib = incomeByServiceLine(entries, accounts)
    const twin = twinIncomeByServiceLine(entries, accounts)
    expect(twin).toEqual(lib)
    expect(lib).toEqual({
      rows: [
        { service_line: "performance_training", label: "Performance Training", total_cents: 50000, entry_count: 1 },
        { service_line: "other", label: "Other", total_cents: 20000, entry_count: 1 },
        { service_line: null, label: "Uncategorized", total_cents: 700, entry_count: 1 },
      ],
      total_cents: 70700,
    })
  })

  it("topCounterparties expense: deep-equal + pinned merge/tie/limit (amazon beats titan on the 800 tie; titan cut by limit)", () => {
    const opts = { direction: "expense" as const, limit: 3 }
    const lib = topCounterparties(entries, opts)
    const twin = twinTopCounterparties(entries, opts)
    expect(twin).toEqual(lib)
    expect(lib).toEqual([
      { counterparty: "landlord", total_cents: 200000, entry_count: 1 },
      { counterparty: "rogue fitness", total_cents: 12900, entry_count: 2 },
      { counterparty: "amazon", total_cents: 800, entry_count: 1 },
    ])
  })

  it("topCounterparties income + clamped limit: deep-equal both ways", () => {
    const incomeOpts = { direction: "income" as const, limit: 10 }
    expect(twinTopCounterparties(entries, incomeOpts)).toEqual(topCounterparties(entries, incomeOpts))
    expect(topCounterparties(entries, incomeOpts)).toEqual([
      { counterparty: "stripe", total_cents: 50000, entry_count: 1 },
      { counterparty: "shopify", total_cents: 20000, entry_count: 1 },
      { counterparty: "venmo", total_cents: 700, entry_count: 1 },
    ])
    const clamped = { direction: "expense" as const, limit: -1 }
    expect(twinTopCounterparties(entries, clamped)).toEqual(topCounterparties(entries, clamped))
    expect(topCounterparties(entries, clamped)).toEqual([])
  })
})
