import { describe, expect, it } from "vitest"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"
import { MIN_AGE_DAYS, receiptWatchdogFindings } from "@/lib/bookkeeping/receipt-watchdog"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_DOC = "a0000000-0000-4000-8000-000000000001"     // deductible-candidate ONLY
const ACC_PURPOSE = "a0000000-0000-4000-8000-000000000002" // purpose-required ONLY
const ACC_BOTH = "a0000000-0000-4000-8000-000000000003"    // both flags
const ACC_NEITHER = "a0000000-0000-4000-8000-000000000004" // unwatched

const TODAY = "2026-07-18"
const OLD = "2026-01-15" // comfortably aged relative to TODAY

function account(over: Partial<InsightAccount>): InsightAccount {
  return {
    id: ACC_DOC, book_id: BOOK, name: "Equipment", account_type: "expense",
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
    book_id: BOOK, account_id: ACC_DOC, direction: "expense", amount_cents: 1000,
    occurred_on: OLD, counterparty: null, memo: null, source: "manual",
    business_purpose: null, document_id: null,
    ...over,
  }
}
const accounts: InsightAccount[] = [
  account({}),
  account({ id: ACC_PURPOSE, name: "Meals", is_deductible_candidate: false, requires_business_purpose: true, sort_order: 1 }),
  account({ id: ACC_BOTH, name: "Travel", is_deductible_candidate: true, requires_business_purpose: true, sort_order: 2 }),
  account({ id: ACC_NEITHER, name: "Rent", is_deductible_candidate: false, requires_business_purpose: false, sort_order: 3 }),
]
const opts = { today: TODAY, minAgeDays: MIN_AGE_DAYS }

describe("receiptWatchdogFindings — reason discrimination (pinned)", () => {
  it("doc-null-but-purpose-PRESENT on a deductible-only account → no_document ONLY", () => {
    // a wrong impl that checks the purpose regardless of the account flag adds no_purpose here
    const r = receiptWatchdogFindings([entry({ business_purpose: "client demo day" })], accounts, opts)
    expect(r).toHaveLength(1)
    expect(r[0].reasons).toEqual(["no_document"])
    expect(r[0]).toMatchObject({ book_id: BOOK, account_id: ACC_DOC, account_name: "Equipment", amount_cents: 1000 })
  })
  it("doc-null with BLANK purpose on a purpose-only account → no_purpose ONLY (doc plays no role there)", () => {
    // a wrong impl that fires no_document off document_id alone fails here (account is NOT deductible-candidate)
    const r = receiptWatchdogFindings([entry({ account_id: ACC_PURPOSE, business_purpose: "  " })], accounts, opts)
    expect(r).toHaveLength(1)
    expect(r[0].reasons).toEqual(["no_purpose"])
  })
  it("purpose-only account with a filled purpose is clean even with no document", () => {
    expect(
      receiptWatchdogFindings([entry({ account_id: ACC_PURPOSE, business_purpose: "team meal" })], accounts, opts),
    ).toEqual([])
  })
  it("both-flags account missing both → both reasons in pinned order", () => {
    const r = receiptWatchdogFindings([entry({ account_id: ACC_BOTH })], accounts, opts)
    expect(r[0].reasons).toEqual(["no_document", "no_purpose"])
  })
  it("a documented, purposed entry on a watched account is clean", () => {
    expect(
      receiptWatchdogFindings(
        [entry({ account_id: ACC_BOTH, document_id: "d0000000-0000-4000-8000-000000000001", business_purpose: "cert course" })],
        accounts, opts,
      ),
    ).toEqual([])
  })
})

describe("receiptWatchdogFindings — exclusions (pinned)", () => {
  it("income entries excluded even on watched accounts with no document", () => {
    expect(receiptWatchdogFindings([entry({ direction: "income" })], accounts, opts)).toEqual([])
  })
  it("unwatched accounts and uncategorized (account null) entries excluded", () => {
    expect(
      receiptWatchdogFindings([entry({ account_id: ACC_NEITHER }), entry({ account_id: null })], accounts, opts),
    ).toEqual([])
  })
  it("archived watched accounts are still watched (watchlist precedent)", () => {
    const archived = accounts.map((a) => (a.id === ACC_DOC ? { ...a, archived_at: "2026-01-01T00:00:00Z" } : a))
    expect(receiptWatchdogFindings([entry({})], archived, opts)).toHaveLength(1)
  })
})

describe("receiptWatchdogFindings — age boundary + sort (pinned)", () => {
  it("MIN_AGE_DAYS is pinned at 14", () => {
    expect(MIN_AGE_DAYS).toBe(14)
  })
  it("exactly 14 days old is IN; 13 days old is OUT (>= vs > discriminator)", () => {
    const r = receiptWatchdogFindings(
      [
        entry({ occurred_on: "2026-07-04" }), // 14 days before 2026-07-18
        entry({ occurred_on: "2026-07-05" }), // 13 days
      ],
      accounts, opts,
    )
    expect(r).toHaveLength(1)
    expect(r[0].occurred_on).toBe("2026-07-04")
  })
  it("sorts amount desc (an inverted sort fails)", () => {
    const r = receiptWatchdogFindings(
      [entry({ amount_cents: 500 }), entry({ amount_cents: 9000 }), entry({ amount_cents: 1200 })],
      accounts, opts,
    )
    expect(r.map((f) => f.amount_cents)).toEqual([9000, 1200, 500])
  })
  it("tie-breaks: equal amount sorts by occurred_on desc, then entry_id asc (id pinned against call order)", () => {
    // Three entries share amount_cents=4000 so the amount sort alone can't separate them.
    // A is the odd one out on date (older). B and C share BOTH amount and date, so only the
    // entry_id tie-break can order them — and C's explicit id is lexicographically FIRST
    // despite being constructed LAST, inverting call/array order. A dropped or inverted
    // occurred_on tie-break, or a dropped/inverted entry_id tie-break, each produce a
    // different (wrong) order than asserted below.
    const A = entry({ amount_cents: 4000, occurred_on: "2026-01-10" })
    const B = entry({ amount_cents: 4000, occurred_on: "2026-02-20" })
    const C = entry({
      amount_cents: 4000,
      occurred_on: "2026-02-20",
      id: "e0000000-0000-4000-8000-000000000000", // smallest possible id, created last
    })
    const r = receiptWatchdogFindings([A, B, C], accounts, opts)
    expect(r.map((f) => f.occurred_on)).toEqual(["2026-02-20", "2026-02-20", "2026-01-10"])
    expect(r[0].entry_id).toBe("e0000000-0000-4000-8000-000000000000")
    expect(r[1].entry_id).toBe(B.id)
    expect(r[2].entry_id).toBe(A.id)
  })
})
