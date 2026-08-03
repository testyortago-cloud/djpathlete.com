import { describe, expect, it } from "vitest"
import {
  NUDGE_LOOKBACK_MONTHS,
  NUDGE_MONTH_CAP,
  closeNudgeTargets,
  nudgeWindow,
  type NudgeEntry,
} from "@/lib/bookkeeping/close-nudge"

const BOOK_A = "b0000000-0000-4000-8000-00000000000a"
const BOOK_B = "b0000000-0000-4000-8000-00000000000b"
const BOOKS = [
  { id: BOOK_A, name: "Darren — DJP Athlete" },
  { id: BOOK_B, name: "Side book" },
]
const TODAY = "2026-08-03"

function e(occurred_on: string, over: Partial<NudgeEntry> = {}): NudgeEntry {
  return { book_id: BOOK_A, occurred_on, direction: "expense", amount_cents: 1000, ...over }
}

function run(over: Partial<Parameters<typeof closeNudgeTargets>[0]> = {}) {
  return closeNudgeTargets({
    books: BOOKS,
    entries: [e("2026-07-15")],
    closedPeriods: [],
    today: TODAY,
    ...over,
  })
}

describe("closeNudgeTargets — what counts as nudge-worthy", () => {
  it("nudges a past month that has entries and no close row", () => {
    const r = run()
    expect(r).toHaveLength(1)
    expect(r[0].book_id).toBe(BOOK_A)
    expect(r[0].open_months.map((m) => m.period)).toEqual(["2026-07"])
    expect(r[0].total_open).toBe(1)
  })

  it("never nudges the current month — it isn't closable yet", () => {
    expect(run({ entries: [e("2026-08-01")] })).toEqual([])
  })

  it("never nudges a future month", () => {
    expect(run({ entries: [e("2026-09-01")] })).toEqual([])
  })

  it("never nudges a month that is already closed", () => {
    expect(run({ closedPeriods: [{ book_id: BOOK_A, period: "2026-07" }] })).toEqual([])
  })

  it("a close on ANOTHER book does not silence this book", () => {
    const r = run({ closedPeriods: [{ book_id: BOOK_B, period: "2026-07" }] })
    expect(r).toHaveLength(1)
    expect(r[0].book_id).toBe(BOOK_A)
  })

  it("never nudges an empty month — nothing happened, nothing to freeze", () => {
    expect(run({ entries: [] })).toEqual([])
  })

  it("drops months older than the lookback window but keeps the boundary month", () => {
    const r = run({
      entries: [e("2024-01-15"), e("2025-08-10"), e("2026-07-15")],
      lookbackMonths: 12, // earliest kept = 2025-08
    })
    expect(r[0].open_months.map((m) => m.period)).toEqual(["2026-07", "2025-08"])
  })
})

describe("closeNudgeTargets — grouping and shape", () => {
  it("splits open months per book and names each book", () => {
    const r = run({ entries: [e("2026-07-15"), e("2026-06-02", { book_id: BOOK_B })] })
    expect(r.map((b) => [b.book_id, b.open_months.map((m) => m.period)])).toEqual([
      [BOOK_A, ["2026-07"]],
      [BOOK_B, ["2026-06"]],
    ])
    expect(r[1].book_name).toBe("Side book")
  })

  it("orders open months newest first", () => {
    const r = run({ entries: [e("2026-04-01"), e("2026-07-15"), e("2026-05-20")] })
    expect(r[0].open_months.map((m) => m.period)).toEqual(["2026-07", "2026-05", "2026-04"])
  })

  it("caps the listed months while total_open stays honest", () => {
    const months = ["2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01", "2025-12"]
    const r = run({ entries: months.map((m) => e(`${m}-10`)) })
    expect(r[0].open_months).toHaveLength(NUDGE_MONTH_CAP)
    expect(r[0].total_open).toBe(months.length) // NOT the capped length
    expect(NUDGE_MONTH_CAP).toBe(6)
  })

  it("skips a book with no open months entirely rather than emitting an empty row", () => {
    const r = run({ entries: [e("2026-07-15")] })
    expect(r.map((b) => b.book_id)).not.toContain(BOOK_B)
  })

  it("ignores entries whose book is not in the books list", () => {
    const r = run({ entries: [e("2026-07-15", { book_id: "b0000000-0000-4000-8000-0000000000ff" })] })
    expect(r).toEqual([])
  })
})

describe("closeNudgeTargets — per-month totals", () => {
  it("sums per direction; net is income minus expense", () => {
    const r = run({
      entries: [
        e("2026-07-01", { direction: "income", amount_cents: 90000 }),
        e("2026-07-02", { direction: "expense", amount_cents: 25000 }),
        e("2026-07-03", { direction: "expense", amount_cents: 5000 }),
      ],
    })
    // a sign flip would give -60000; a merged sum would lose the halves
    expect(r[0].open_months[0]).toEqual({
      period: "2026-07",
      income_cents: 90000,
      expense_cents: 30000,
      net_cents: 60000,
      entry_count: 3,
    })
  })

  it("keeps each month's totals separate", () => {
    const r = run({
      entries: [
        e("2026-07-01", { direction: "income", amount_cents: 10000 }),
        e("2026-06-01", { direction: "income", amount_cents: 70000 }),
      ],
    })
    expect(r[0].open_months.map((m) => m.income_cents)).toEqual([10000, 70000])
  })

  it("does not leak another book's amounts into this book's totals", () => {
    const r = run({
      entries: [
        e("2026-07-01", { direction: "income", amount_cents: 10000 }),
        e("2026-07-02", { book_id: BOOK_B, direction: "income", amount_cents: 999999 }),
      ],
    })
    expect(r[0].open_months[0].income_cents).toBe(10000)
  })
})

describe("nudgeWindow — the read window matches the filter", () => {
  it("starts on the first day of the oldest month the filter would keep", () => {
    expect(nudgeWindow("2026-08-03", 12)).toEqual({ from: "2025-08-01", to: "2026-08-03" })
  })

  it("rolls back across the year boundary", () => {
    expect(nudgeWindow("2026-01-03", 12)).toEqual({ from: "2025-01-01", to: "2026-01-03" })
  })

  it("defaults to the module's lookback constant", () => {
    expect(nudgeWindow("2026-08-03")).toEqual(nudgeWindow("2026-08-03", NUDGE_LOOKBACK_MONTHS))
    expect(NUDGE_LOOKBACK_MONTHS).toBe(12)
  })

  it("reaches back far enough to include every month the filter keeps", () => {
    const { from } = nudgeWindow("2026-08-03", 12)
    // the boundary month (2025-08) must be inside the window, or the cron would
    // read a window narrower than the filter and silently under-report
    const r = closeNudgeTargets({
      books: BOOKS,
      entries: [e("2025-08-01")],
      closedPeriods: [],
      today: "2026-08-03",
      lookbackMonths: 12,
    })
    expect(from <= "2025-08-01").toBe(true)
    expect(r[0].open_months.map((m) => m.period)).toEqual(["2025-08"])
  })
})

describe("closeNudgeTargets — year boundary", () => {
  it("December is nudge-worthy on January 3rd", () => {
    const r = closeNudgeTargets({
      books: BOOKS,
      entries: [e("2025-12-20")],
      closedPeriods: [],
      today: "2026-01-03",
    })
    expect(r[0].open_months.map((m) => m.period)).toEqual(["2025-12"])
  })

  it("the lookback window rolls back across the year boundary", () => {
    const r = closeNudgeTargets({
      books: BOOKS,
      entries: [e("2024-12-20"), e("2025-01-20")],
      closedPeriods: [],
      today: "2026-01-03",
      lookbackMonths: 12, // earliest kept = 2025-01
    })
    expect(r[0].open_months.map((m) => m.period)).toEqual(["2025-01"])
  })
})
