import { describe, expect, it } from "vitest"
import { topCounterparties, type ReportEntry } from "@/lib/bookkeeping/reports"

const BOOK = "b0000000-0000-4000-8000-000000000001"

function entry(over: Partial<ReportEntry>): ReportEntry {
  return {
    book_id: BOOK,
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

describe("topCounterparties", () => {
  it("groups by normalized counterparty, sums cents, counts entries, sorts total desc", () => {
    const rows = topCounterparties(
      [
        entry({ counterparty: " Rogue  Fitness ", amount_cents: 500 }),
        entry({ counterparty: "rogue fitness", amount_cents: 400 }),
        entry({ counterparty: "Amazon", amount_cents: 800 }),
        entry({ counterparty: "Titan", amount_cents: 700 }),
      ],
      { direction: "expense", limit: 10 },
    )
    expect(rows).toEqual([
      { counterparty: "rogue fitness", total_cents: 900, entry_count: 2 },
      { counterparty: "amazon", total_cents: 800, entry_count: 1 },
      { counterparty: "titan", total_cents: 700, entry_count: 1 },
    ])
  })

  it("filters to the requested direction (income ranks payers, not vendors)", () => {
    const entries = [
      entry({ direction: "income", counterparty: "Stripe", amount_cents: 50000 }),
      entry({ counterparty: "Rogue", amount_cents: 800 }),
    ]
    expect(topCounterparties(entries, { direction: "income", limit: 10 })).toEqual([
      { counterparty: "stripe", total_cents: 50000, entry_count: 1 },
    ])
    expect(topCounterparties(entries, { direction: "expense", limit: 10 })).toEqual([
      { counterparty: "rogue", total_cents: 800, entry_count: 1 },
    ])
  })

  it("blank/whitespace counterparties group into the null bucket", () => {
    const rows = topCounterparties(
      [entry({ counterparty: null, amount_cents: 700 }), entry({ counterparty: "   ", amount_cents: 300 })],
      { direction: "expense", limit: 10 },
    )
    expect(rows).toEqual([{ counterparty: null, total_cents: 1000, entry_count: 2 }])
  })

  describe("topCounterparties — pinned invariant discrimination", () => {
    it("equal totals tie-break name asc with the null bucket last (mutation: null-first or insertion order)", () => {
      const rows = topCounterparties(
        [
          entry({ counterparty: "beta", amount_cents: 500 }),
          entry({ counterparty: null, amount_cents: 500 }),
          entry({ counterparty: "alpha", amount_cents: 500 }),
        ],
        { direction: "expense", limit: 10 },
      )
      expect(rows.map((r) => r.counterparty)).toEqual(["alpha", "beta", null])
    })

    it("limit slices AFTER sorting (mutation: slice-before-sort keeps the wrong row)", () => {
      const rows = topCounterparties(
        [entry({ counterparty: "small", amount_cents: 100 }), entry({ counterparty: "big", amount_cents: 900 })],
        { direction: "expense", limit: 1 },
      )
      expect(rows).toEqual([{ counterparty: "big", total_cents: 900, entry_count: 1 }])
    })

    it("limit 0 and negative limits yield [] (mutation: raw slice(0, -1) drops only the last row)", () => {
      const entries = [entry({ counterparty: "a" }), entry({ counterparty: "b" })]
      expect(topCounterparties(entries, { direction: "expense", limit: 0 })).toEqual([])
      expect(topCounterparties(entries, { direction: "expense", limit: -1 })).toEqual([])
    })
  })
})
