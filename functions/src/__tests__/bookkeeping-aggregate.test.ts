import { describe, expect, it } from "vitest"
import {
  incomeByServiceLine,
  perBookSummary,
  topCounterparties,
  type AggAccount,
  type AggEntry,
} from "../lib/bookkeeping-aggregate.js"

const BOOK_A = "b0000000-0000-4000-8000-000000000001"
const BOOK_B = "b0000000-0000-4000-8000-000000000002"
const BOOK_DEAD = "b0000000-0000-4000-8000-00000000dead"
const ACC_PT = "a0000000-0000-4000-8000-000000000001" // income, performance_training
const ACC_NOLINE = "a0000000-0000-4000-8000-000000000002" // income, no service line → "other"

const books = [
  { id: BOOK_A, name: "Darren — DJP Athlete", book_kind: "business" },
  { id: BOOK_B, name: "Household & Personal", book_kind: "household" },
]
const accounts: AggAccount[] = [
  { id: ACC_PT, service_line: "performance_training" },
  { id: ACC_NOLINE, service_line: null },
]

function entry(over: Partial<AggEntry>): AggEntry {
  return { book_id: BOOK_A, account_id: null, direction: "expense", amount_cents: 1000, counterparty: null, ...over }
}

describe("perBookSummary (twin)", () => {
  it("nets income − expense per book, skips unlisted books, zero-fills empty books", () => {
    const r = perBookSummary(
      [
        entry({ direction: "income", amount_cents: 500 }),
        entry({ direction: "expense", amount_cents: 200 }),
        entry({ book_id: BOOK_DEAD, amount_cents: 99999 }), // not in books → skipped
      ],
      books,
    )
    // mutation discriminators: sign-flip (net −300 or 700) and dropped skip (count 3)
    expect(r).toEqual([
      { book_id: BOOK_A, name: "Darren — DJP Athlete", book_kind: "business", income_cents: 500, expense_cents: 200, net_cents: 300, entry_count: 2 },
      { book_id: BOOK_B, name: "Household & Personal", book_kind: "household", income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0 },
    ])
  })
})

describe("incomeByServiceLine (twin)", () => {
  it("income only; no-line account folds into 'other'; unknown/null account is the null Uncategorized bucket; sorts total desc", () => {
    const r = incomeByServiceLine(
      [
        entry({ direction: "income", account_id: ACC_PT, amount_cents: 50000 }),
        entry({ direction: "income", account_id: ACC_NOLINE, amount_cents: 20000 }),
        entry({ direction: "income", account_id: "a0000000-0000-4000-8000-00000000dead", amount_cents: 700 }),
        entry({ direction: "expense", account_id: ACC_PT, amount_cents: 99999 }), // excluded
      ],
      accounts,
    )
    expect(r).toEqual({
      rows: [
        { service_line: "performance_training", label: "Performance Training", total_cents: 50000, entry_count: 1 },
        { service_line: "other", label: "Other", total_cents: 20000, entry_count: 1 },
        { service_line: null, label: "Uncategorized", total_cents: 700, entry_count: 1 },
      ],
      total_cents: 70700,
    })
  })
})

describe("topCounterparties (twin)", () => {
  it("normalized merge + tie-break (name asc, null last) + post-sort clamped limit", () => {
    const rows = topCounterparties(
      [
        entry({ counterparty: " Rogue  Fitness ", amount_cents: 500 }),
        entry({ counterparty: "rogue fitness", amount_cents: 400 }),
        entry({ counterparty: "beta", amount_cents: 800 }),
        entry({ counterparty: null, amount_cents: 800 }),
        entry({ counterparty: "alpha", amount_cents: 800 }),
      ],
      { direction: "expense", limit: 4 },
    )
    expect(rows).toEqual([
      { counterparty: "rogue fitness", total_cents: 900, entry_count: 2 },
      { counterparty: "alpha", total_cents: 800, entry_count: 1 },
      { counterparty: "beta", total_cents: 800, entry_count: 1 },
      { counterparty: null, total_cents: 800, entry_count: 1 },
    ])
    expect(topCounterparties([entry({})], { direction: "expense", limit: -1 })).toEqual([])
  })
})
