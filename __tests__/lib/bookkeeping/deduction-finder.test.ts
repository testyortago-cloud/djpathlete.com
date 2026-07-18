import { describe, expect, it } from "vitest"
import { deductionFindings } from "@/lib/bookkeeping/deduction-finder"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"

const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_OTHER = "b0000000-0000-4000-8000-000000000002"
const ACC_EQUIP = "a0000000-0000-4000-8000-000000000001" // deductible watch
const ACC_MEALS = "a0000000-0000-4000-8000-000000000002" // watch + requires purpose
const ACC_RENT = "a0000000-0000-4000-8000-000000000003" // not deductible
const ACC_ARCHIVED = "a0000000-0000-4000-8000-000000000004" // archived watch

function account(over: Partial<InsightAccount>): InsightAccount {
  return {
    id: ACC_EQUIP, book_id: BOOK_BIZ, name: "Equipment", account_type: "expense",
    service_line: null, tax_category: null, sort_order: 0,
    is_deductible_candidate: true, requires_business_purpose: false, archived_at: null,
    ...over,
  }
}

let seq = 0
function entry(over: Partial<InsightEntry>): InsightEntry {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: BOOK_BIZ, account_id: ACC_EQUIP, direction: "expense", amount_cents: 1000,
    occurred_on: "2026-03-01", counterparty: null, memo: null, source: "manual",
    business_purpose: null, document_id: null,
    ...over,
  }
}

const accounts: InsightAccount[] = [
  account({}),
  account({ id: ACC_MEALS, name: "Meals (business purpose)", is_deductible_candidate: true, requires_business_purpose: true, sort_order: 1 }),
  account({ id: ACC_RENT, name: "Rent", is_deductible_candidate: false, sort_order: 2 }),
  account({ id: ACC_ARCHIVED, name: "Old Gear", archived_at: "2026-01-01T00:00:00Z", sort_order: 3 }),
]

describe("deductionFindings — watchlist", () => {
  it("nets income against expense per watch account and lists zero-entry watch accounts", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ amount_cents: 5000, counterparty: "Rogue" }),
      entry({ amount_cents: 2000, direction: "income", counterparty: "Rogue" }), // refund subtracts
    ], accounts)
    const equip = r.watchlist.find((w) => w.account_id === ACC_EQUIP)
    expect(equip).toMatchObject({ total_cents: 3000, entry_count: 2 })
    // zero-entry watch accounts still listed
    expect(r.watchlist.map((w) => w.account_id)).toEqual(
      expect.arrayContaining([ACC_MEALS, ACC_ARCHIVED]),
    )
    expect(r.watchlist.find((w) => w.account_id === ACC_ARCHIVED)).toMatchObject({ archived: true, total_cents: 0 })
    // non-deductible account never appears
    expect(r.watchlist.find((w) => w.account_id === ACC_RENT)).toBeUndefined()
    expect(r.watchlist_total_cents).toBe(3000)
    // full sort order: total desc, then name asc — including the zero-total tie
    // between "Meals (business purpose)" and "Old Gear" (localeCompare asc).
    expect(r.watchlist.map((w) => w.name)).toEqual([
      "Equipment",
      "Meals (business purpose)",
      "Old Gear",
    ])
  })

  it("top counterparties: top 3 by total, normalized grouping, null bucket ties last", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ amount_cents: 500, counterparty: " Rogue  Fitness " }),
      entry({ amount_cents: 400, counterparty: "rogue fitness" }),
      entry({ amount_cents: 800, counterparty: "Amazon" }),
      entry({ amount_cents: 700, counterparty: "Titan" }),
      entry({ amount_cents: 100, counterparty: null }),
    ], accounts)
    const equip = r.watchlist.find((w) => w.account_id === ACC_EQUIP)!
    expect(equip.top_counterparties).toEqual([
      { counterparty: "rogue fitness", total_cents: 900, entry_count: 2 },
      { counterparty: "amazon", total_cents: 800, entry_count: 1 },
      { counterparty: "titan", total_cents: 700, entry_count: 1 },
    ])
  })

  it("top counterparties: null bucket ties a named counterparty last on total_cents", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ amount_cents: 900, counterparty: "alpha" }),
      entry({ amount_cents: 500, counterparty: "zeta" }),
      entry({ amount_cents: 500, counterparty: null }),
    ], accounts)
    const equip = r.watchlist.find((w) => w.account_id === ACC_EQUIP)!
    expect(equip.top_counterparties).toEqual([
      { counterparty: "alpha", total_cents: 900, entry_count: 1 },
      { counterparty: "zeta", total_cents: 500, entry_count: 1 },
      { counterparty: null, total_cents: 500, entry_count: 1 },
    ])
  })

  it("cross-book isolation: book B money never leaks into book A findings", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ amount_cents: 99999, book_id: BOOK_OTHER }),
      entry({ amount_cents: 100 }),
    ], accounts)
    expect(r.watchlist_total_cents).toBe(100)
  })
})

describe("deductionFindings — substantiation gaps", () => {
  it("flags null, empty, and whitespace-only purposes; filled purposes pass", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ account_id: ACC_MEALS, business_purpose: null, amount_cents: 100 }),
      entry({ account_id: ACC_MEALS, business_purpose: "", amount_cents: 200 }),
      entry({ account_id: ACC_MEALS, business_purpose: "   ", amount_cents: 300 }),
      entry({ account_id: ACC_MEALS, business_purpose: "client lunch", amount_cents: 400 }),
      entry({ account_id: ACC_EQUIP, business_purpose: null, amount_cents: 500 }), // account doesn't require purpose
    ], accounts)
    expect(r.substantiation_gaps).toHaveLength(3)
    expect(r.gap_total_cents).toBe(600)
    expect(r.substantiation_gaps[0]).toMatchObject({ account_name: "Meals (business purpose)", has_document: false })
  })

  it("includes any-direction entries and reports has_document", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ account_id: ACC_MEALS, direction: "income", business_purpose: null, amount_cents: 150, document_id: "d0000000-0000-4000-8000-000000000001" }),
    ], accounts)
    expect(r.substantiation_gaps).toHaveLength(1)
    expect(r.substantiation_gaps[0]).toMatchObject({ direction: "income", has_document: true })
  })
})

describe("deductionFindings — uncategorized sweep", () => {
  it("collects expense entries with no account, newest first; income excluded", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ account_id: null, amount_cents: 700, occurred_on: "2026-01-05" }),
      entry({ account_id: null, amount_cents: 300, occurred_on: "2026-02-01" }),
      entry({ account_id: null, direction: "income", amount_cents: 900 }),
    ], accounts)
    expect(r.uncategorized).toMatchObject({ total_cents: 1000, entry_count: 2 })
    expect(r.uncategorized.entries.map((e) => e.amount_cents)).toEqual([300, 700])
  })

  it("empty input → well-shaped empty result", () => {
    const r = deductionFindings(BOOK_BIZ, [], accounts)
    expect(r.substantiation_gaps).toEqual([])
    expect(r.uncategorized).toEqual({ total_cents: 0, entry_count: 0, entries: [] })
    expect(r.watchlist.every((w) => w.total_cents === 0)).toBe(true)
  })
})
