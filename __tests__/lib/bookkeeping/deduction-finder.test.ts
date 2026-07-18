import { describe, expect, it } from "vitest"
import { deductionFindings, homeOfficeCandidate, HOME_OFFICE_ACCOUNT_NAMES } from "@/lib/bookkeeping/deduction-finder"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"
import type { BookkeepingBook } from "@/types/database"

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

const BOOK_HH = "b0000000-0000-4000-8000-000000000003"
const ACC_HH_RENT = "a0000000-0000-4000-8000-000000000010"
const ACC_HH_UTIL = "a0000000-0000-4000-8000-000000000011"
const ACC_HH_INS = "a0000000-0000-4000-8000-000000000012"
const ACC_HH_GROC = "a0000000-0000-4000-8000-000000000013"
const ACC_HH_INTERNET = "a0000000-0000-4000-8000-000000000014"

const books = [
  { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true },
  { id: BOOK_OTHER, name: "Spouse — Business", book_kind: "business", is_primary: false },
  { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false },
] as BookkeepingBook[]

const hhAccounts: InsightAccount[] = [
  account({ id: ACC_HH_RENT, book_id: BOOK_HH, name: "Rent", is_deductible_candidate: false }),
  account({ id: ACC_HH_UTIL, book_id: BOOK_HH, name: "  utilities ", is_deductible_candidate: false }),
  account({ id: ACC_HH_INS, book_id: BOOK_HH, name: "Renter's Insurance", is_deductible_candidate: false }),
  account({ id: ACC_HH_GROC, book_id: BOOK_HH, name: "Groceries", is_deductible_candidate: false }),
]

describe("homeOfficeCandidate", () => {
  it("matches allowlist names case/whitespace-insensitively, nets income, excludes the rest", () => {
    const r = homeOfficeCandidate([
      entry({ book_id: BOOK_HH, account_id: ACC_HH_RENT, amount_cents: 200000 }),
      entry({ book_id: BOOK_HH, account_id: ACC_HH_UTIL, amount_cents: 15000 }),
      entry({ book_id: BOOK_HH, account_id: ACC_HH_UTIL, direction: "income", amount_cents: 3000 }), // utility credit
      entry({ book_id: BOOK_HH, account_id: ACC_HH_GROC, amount_cents: 40000 }), // excluded
      entry({ book_id: BOOK_HH, account_id: null, amount_cents: 500 }),          // excluded (uncategorized)
      entry({ book_id: BOOK_BIZ, amount_cents: 77777 }),                          // business book — ignored entirely
    ], [...accounts, ...hhAccounts], books, 25)
    expect(r.target_book_id).toBe(BOOK_BIZ)
    expect(r.household_books).toEqual([{ id: BOOK_HH, name: "Household & Personal" }])
    expect(r.input_total_cents).toBe(212000)
    expect(r.inputs.find((i) => i.account_id === ACC_HH_RENT)).toMatchObject({ total_cents: 200000, proposed_cents: 50000 })
    expect(r.inputs.find((i) => i.account_id === ACC_HH_UTIL)).toMatchObject({ total_cents: 12000, proposed_cents: 3000 })
    expect(r.proposed_total_cents).toBe(53000)
    expect(r.excluded_household_expense_cents).toBe(40500)
    // matched-but-empty allowlist accounts still itemized (Renter's Insurance)
    expect(r.inputs.find((i) => i.account_id === ACC_HH_INS)).toMatchObject({ total_cents: 0, entry_count: 0, proposed_cents: 0 })
    // non-matched Groceries never becomes an input
    expect(r.inputs.find((i) => i.account_id === ACC_HH_GROC)).toBeUndefined()
  })

  it("percent null → itemized inputs with null proposals", () => {
    const r = homeOfficeCandidate([entry({ book_id: BOOK_HH, account_id: ACC_HH_RENT, amount_cents: 100000 })], [...accounts, ...hhAccounts], books, null)
    expect(r.percent).toBeNull()
    expect(r.proposed_total_cents).toBeNull()
    expect(r.inputs.find((i) => i.account_id === ACC_HH_RENT)?.proposed_cents).toBeNull()
  })

  it("pins Math.round at awkward boundaries: 33.33% of odd cents; negative half-cent rounds toward +∞", () => {
    const r = homeOfficeCandidate([
      entry({ book_id: BOOK_HH, account_id: ACC_HH_RENT, amount_cents: 10001 }),
      entry({ book_id: BOOK_HH, account_id: ACC_HH_UTIL, direction: "income", amount_cents: 99 }), // net −99
    ], [...accounts, ...hhAccounts], books, 33.33)
    expect(r.inputs.find((i) => i.account_id === ACC_HH_RENT)?.proposed_cents).toBe(3333) // 3333.3333 → 3333
    // −99 × 50% would be −49.5 → −49; here −99 × 33.33% = −32.9967 → −33
    expect(r.inputs.find((i) => i.account_id === ACC_HH_UTIL)?.proposed_cents).toBe(-33)
    expect(r.proposed_total_cents).toBe(3300) // sum of rounded inputs, NOT round of sum
  })

  it("Math.round(−49.5) rounds toward +∞ (pinned)", () => {
    const r = homeOfficeCandidate([
      entry({ book_id: BOOK_HH, account_id: ACC_HH_UTIL, direction: "income", amount_cents: 99 }),
    ], [...accounts, ...hhAccounts], books, 50)
    expect(r.inputs.find((i) => i.account_id === ACC_HH_UTIL)?.proposed_cents).toBe(-49)
  })

  it("no business book → target null; household 'Vehicles' never matches business 'Vehicle' semantics", () => {
    const hhOnly = [{ id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false }] as BookkeepingBook[]
    const r = homeOfficeCandidate([], hhAccounts, hhOnly, 20)
    expect(r.target_book_id).toBeNull()
    expect(HOME_OFFICE_ACCOUNT_NAMES).not.toContain("vehicles")
  })

  it("pins sum-of-rounded-inputs (not round-of-sum) when the two diverge", () => {
    const r = homeOfficeCandidate([
      entry({ book_id: BOOK_HH, account_id: ACC_HH_RENT, amount_cents: 101 }),
      entry({ book_id: BOOK_HH, account_id: ACC_HH_UTIL, amount_cents: 101 }),
    ], [...accounts, ...hhAccounts], books, 50)
    // Each input rounds independently: Math.round(101 * 50 / 100) = Math.round(50.5) = 51 (JS half-up).
    expect(r.inputs.find((i) => i.account_id === ACC_HH_RENT)?.proposed_cents).toBe(51)
    expect(r.inputs.find((i) => i.account_id === ACC_HH_UTIL)?.proposed_cents).toBe(51)
    // Sum-of-rounds = 51 + 51 = 102. Round-of-sum would be Math.round(202 * 50 / 100) = Math.round(101) = 101.
    // The two diverge here — proposed_total_cents must be the SUM OF ROUNDED INPUTS (102), not round-of-sum (101).
    expect(r.proposed_total_cents).toBe(102)
  })

  it("no primary business book, two business books → target is the first business book in array order; equal-total inputs tie-break name asc", () => {
    const booksNoPrimary = [
      { id: BOOK_OTHER, name: "Spouse — Business", book_kind: "business", is_primary: false },
      { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: false },
      { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false },
    ] as BookkeepingBook[]
    const internetAccount = account({ id: ACC_HH_INTERNET, book_id: BOOK_HH, name: "Internet", is_deductible_candidate: false })
    const r = homeOfficeCandidate([
      entry({ book_id: BOOK_HH, account_id: ACC_HH_RENT, amount_cents: 500 }),
      entry({ book_id: BOOK_HH, account_id: ACC_HH_INTERNET, amount_cents: 500 }),
    ], [...accounts, ...hhAccounts, internetAccount], booksNoPrimary, 25)
    // Neither business book is is_primary → fallback is businessBooks[0], the first business
    // book in `books` array order (BOOK_OTHER is listed before BOOK_BIZ here).
    expect(r.target_book_id).toBe(BOOK_OTHER)
    // "Internet" and "Rent" net to the same total_cents (500) — tie-break must be name asc.
    expect(r.inputs.filter((i) => i.total_cents === 500).map((i) => i.name)).toEqual(["Internet", "Rent"])
  })
})
