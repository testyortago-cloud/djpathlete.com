import { describe, expect, it } from "vitest"
import { NOT_READY_MESSAGE, closeReadiness, type CloseReadinessInput } from "@/lib/bookkeeping/close-readiness"
import type { CandidatePair } from "@/lib/bookkeeping/duplicate-scan"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const OTHER_BOOK = "b0000000-0000-4000-8000-000000000002"
const DEDUCTIBLE = "a0000000-0000-4000-8000-000000000001"
const PLAIN = "a0000000-0000-4000-8000-000000000002"

let seq = 0
function entry(over: Partial<InsightEntry> = {}): InsightEntry {
  seq++
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: BOOK,
    account_id: PLAIN,
    direction: "expense",
    amount_cents: 1000,
    occurred_on: "2026-06-15",
    counterparty: null,
    memo: null,
    source: "manual",
    business_purpose: "coaching",
    document_id: "d0000000-0000-4000-8000-000000000001",
    ...over,
  }
}

function account(over: Partial<InsightAccount> = {}): InsightAccount {
  return {
    id: PLAIN,
    book_id: BOOK,
    name: "Software",
    account_type: "expense",
    service_line: null,
    tax_category: null,
    sort_order: 1,
    is_deductible_candidate: false,
    requires_business_purpose: false,
    archived_at: null,
    ...over,
  }
}

function pair(aDate: string, bDate: string): CandidatePair {
  return {
    pair_id: `${aDate}|${bDate}`,
    fingerprint: `fp-${aDate}-${bDate}`,
    a: {
      id: `p-a-${aDate}`,
      occurred_on: aDate,
      amount_cents: 5000,
      direction: "expense",
      memo: null,
      counterparty: null,
      source: "manual",
      account_id: PLAIN,
      document_id: null,
    },
    b: {
      id: `p-b-${bDate}`,
      occurred_on: bDate,
      amount_cents: 5000,
      direction: "expense",
      memo: null,
      counterparty: null,
      source: "manual",
      account_id: PLAIN,
      document_id: null,
    },
    day_gap: 1,
    same_source: true,
    memo_similarity: "missing",
  }
}

/** A month that passes every check — each test flips exactly one thing. */
function input(over: Partial<CloseReadinessInput> = {}): CloseReadinessInput {
  return {
    period: "2026-06",
    bookId: BOOK,
    entries: [entry({ source: "statement_import" })],
    accounts: [account()],
    duplicatePairs: [],
    bookEntryDates: ["2026-06-15"],
    closedPeriods: [],
    today: "2026-07-03",
    ...over,
  }
}

function byKey(r: ReturnType<typeof closeReadiness>, key: string) {
  const found = r.checks.find((c) => c.key === key)
  if (!found) throw new Error(`no check named ${key}`)
  return found
}

describe("closeReadiness — the clean baseline", () => {
  it("a fully-fed month is ready with every check ok", () => {
    const r = closeReadiness(input())
    expect(r.ready).toBe(true)
    expect(r.blocking).toEqual([])
    expect(r.warning).toEqual([])
    expect(r.checks.every((c) => c.status === "ok")).toBe(true)
  })

  it("returns all five checks, blockers before warnings", () => {
    const r = closeReadiness(input())
    expect(r.checks.map((c) => c.key)).toEqual([
      "uncategorized",
      "duplicates",
      "substantiation",
      "statement_coverage",
      "earlier_open",
    ])
    expect(r.checks.slice(0, 2).every((c) => c.severity === "blocker")).toBe(true)
    expect(r.checks.slice(2).every((c) => c.severity === "warning")).toBe(true)
  })
})

describe("scoping — the filtering is the feature", () => {
  it("ignores entries from another book", () => {
    const r = closeReadiness(
      input({
        entries: [
          entry({ source: "statement_import" }),
          entry({ book_id: OTHER_BOOK, account_id: null }), // uncategorized, but not this book
        ],
      }),
    )
    expect(r.blocking).toEqual([])
    expect(r.totals.entry_count).toBe(1)
  })

  it("ignores entries from another month", () => {
    const r = closeReadiness(
      input({
        entries: [
          entry({ source: "statement_import" }),
          entry({ occurred_on: "2026-07-01", account_id: null }), // next month
          entry({ occurred_on: "2026-05-31", account_id: null }), // previous month
        ],
      }),
    )
    expect(r.blocking).toEqual([])
    expect(r.totals.entry_count).toBe(1)
  })

  it("month bounds are inclusive on the first and last day", () => {
    const r = closeReadiness(
      input({
        entries: [
          entry({ occurred_on: "2026-06-01", source: "statement_import" }),
          entry({ occurred_on: "2026-06-30" }),
        ],
      }),
    )
    expect(r.totals.entry_count).toBe(2)
  })
})

describe("blocker: uncategorized", () => {
  it("flags entries with no account and blocks the close", () => {
    const r = closeReadiness(
      input({
        entries: [entry({ source: "statement_import" }), entry({ account_id: null }), entry({ account_id: null })],
      }),
    )
    expect(r.ready).toBe(false)
    expect(r.blocking).toEqual(["uncategorized"])
    expect(byKey(r, "uncategorized").count).toBe(2)
    expect(byKey(r, "uncategorized").detail).toContain("2 entries")
  })

  it("singular wording for exactly one", () => {
    const r = closeReadiness(
      input({ entries: [entry({ source: "statement_import" }), entry({ account_id: null })] }),
    )
    expect(byKey(r, "uncategorized").detail).toContain("1 entry")
    expect(byKey(r, "uncategorized").detail).toContain("has no category")
  })
})

describe("blocker: duplicates", () => {
  it("flags a pair fully inside the period", () => {
    const r = closeReadiness(input({ duplicatePairs: [pair("2026-06-10", "2026-06-11")] }))
    expect(r.blocking).toEqual(["duplicates"])
    expect(byKey(r, "duplicates").count).toBe(1)
  })

  it("flags a pair that straddles the period boundary (either side counts)", () => {
    const r = closeReadiness(input({ duplicatePairs: [pair("2026-05-31", "2026-06-01")] }))
    expect(r.blocking).toEqual(["duplicates"])
  })

  it("ignores a pair entirely outside the period", () => {
    const r = closeReadiness(input({ duplicatePairs: [pair("2026-04-10", "2026-04-11")] }))
    expect(r.blocking).toEqual([])
    expect(byKey(r, "duplicates").status).toBe("ok")
  })
})

describe("warning: substantiation", () => {
  it("flags a deductible expense with no document — and never blocks", () => {
    const r = closeReadiness(
      input({
        entries: [entry({ source: "statement_import", account_id: DEDUCTIBLE, document_id: null })],
        accounts: [account({ id: DEDUCTIBLE, is_deductible_candidate: true })],
      }),
    )
    expect(r.ready).toBe(true) // warning only
    expect(r.blocking).toEqual([])
    expect(r.warning).toEqual(["substantiation"])
    expect(byKey(r, "substantiation").count).toBe(1)
  })

  it("uses a zero-day grace — a same-month expense still counts (the watchdog's 14-day window would hide it)", () => {
    const r = closeReadiness(
      input({
        today: "2026-07-01", // 1 day after the 2026-06-30 entry
        entries: [
          entry({
            occurred_on: "2026-06-30",
            source: "statement_import",
            account_id: DEDUCTIBLE,
            document_id: null,
          }),
        ],
        accounts: [account({ id: DEDUCTIBLE, is_deductible_candidate: true })],
      }),
    )
    expect(byKey(r, "substantiation").count).toBe(1)
  })

  it("stays ok when the deductible expense has its document", () => {
    const r = closeReadiness(
      input({
        entries: [entry({ source: "statement_import", account_id: DEDUCTIBLE })],
        accounts: [account({ id: DEDUCTIBLE, is_deductible_candidate: true })],
      }),
    )
    expect(byKey(r, "substantiation").status).toBe("ok")
  })
})

describe("warning: statement coverage", () => {
  it("flags a month with no statement-imported entry", () => {
    const r = closeReadiness(input({ entries: [entry({ source: "manual" })] }))
    expect(r.warning).toEqual(["statement_coverage"])
    expect(r.ready).toBe(true)
  })

  it("counts the statement rows in the ok detail", () => {
    const r = closeReadiness(
      input({ entries: [entry({ source: "statement_import" }), entry({ source: "statement_import" })] }),
    )
    expect(byKey(r, "statement_coverage").status).toBe("ok")
    expect(byKey(r, "statement_coverage").detail).toContain("2 entries")
  })

  it("an empty month flags coverage rather than reporting zero rows as fine", () => {
    const r = closeReadiness(input({ entries: [], bookEntryDates: [] }))
    expect(byKey(r, "statement_coverage").status).toBe("flagged")
    expect(r.totals).toEqual({ income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0 })
  })
})

describe("warning: earlier open months", () => {
  it("flags earlier months that have entries but no close row", () => {
    const r = closeReadiness(
      input({ bookEntryDates: ["2026-04-02", "2026-05-09", "2026-06-15"], closedPeriods: ["2026-04"] }),
    )
    expect(r.warning).toEqual(["earlier_open"])
    expect(byKey(r, "earlier_open").count).toBe(1)
    expect(byKey(r, "earlier_open").detail).toContain("2026-05")
    expect(byKey(r, "earlier_open").detail).not.toContain("2026-04")
  })

  it("never counts the period being closed, nor anything after it", () => {
    const r = closeReadiness(input({ bookEntryDates: ["2026-06-15", "2026-07-20", "2026-08-01"] }))
    expect(byKey(r, "earlier_open").status).toBe("ok")
  })

  it("dedupes many entries in the same open month down to one", () => {
    const r = closeReadiness(
      input({ bookEntryDates: ["2026-05-01", "2026-05-02", "2026-05-03", "2026-06-15"] }),
    )
    expect(byKey(r, "earlier_open").count).toBe(1)
  })

  it("lists multiple open months in chronological order", () => {
    const r = closeReadiness(input({ bookEntryDates: ["2026-05-01", "2026-03-01", "2026-06-15"] }))
    expect(byKey(r, "earlier_open").detail).toContain("2026-03, 2026-05")
  })
})

describe("totals preview", () => {
  it("matches what the close would freeze — net is income minus expense", () => {
    const r = closeReadiness(
      input({
        entries: [
          entry({ direction: "income", amount_cents: 50000, source: "statement_import" }),
          entry({ direction: "expense", amount_cents: 20000 }),
          entry({ direction: "expense", amount_cents: 10000 }),
        ],
      }),
    )
    // a sign-flip would give -30000; a signed sum without the split loses the halves
    expect(r.totals).toEqual({
      income_cents: 50000,
      expense_cents: 30000,
      net_cents: 20000,
      entry_count: 3,
    })
  })
})

describe("multiple problems at once", () => {
  it("reports every flagged blocker and warning, not just the first", () => {
    const r = closeReadiness(
      input({
        entries: [entry({ account_id: null }), entry({ account_id: null })],
        duplicatePairs: [pair("2026-06-10", "2026-06-11")],
        bookEntryDates: ["2026-05-01", "2026-06-15"],
      }),
    )
    expect(r.blocking).toEqual(["uncategorized", "duplicates"])
    expect(r.warning).toEqual(["statement_coverage", "earlier_open"])
    expect(r.ready).toBe(false)
  })
})

describe("NOT_READY_MESSAGE", () => {
  it("names the override so the gate never reads as broken", () => {
    expect(NOT_READY_MESSAGE).toContain("close it anyway")
  })
})
