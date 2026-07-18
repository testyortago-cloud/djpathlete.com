import { describe, expect, it } from "vitest"
import {
  PERIOD_CLOSED_MESSAGE,
  PERIOD_RE,
  closableMonthOptions,
  formatPeriodLabel,
  isClosablePeriod,
  monthBounds,
  periodOf,
  snapshotTotals,
} from "@/lib/bookkeeping/period-close"

describe("periodOf", () => {
  it("slices YYYY-MM-DD to YYYY-MM", () => {
    expect(periodOf("2026-03-15")).toBe("2026-03")
  })
  it("Dec→Jan boundary: last day of Dec stays Dec, first day of Jan is Jan", () => {
    // discriminates any month-arithmetic implementation from the slice
    expect(periodOf("2026-12-31")).toBe("2026-12")
    expect(periodOf("2027-01-01")).toBe("2027-01")
  })
})

describe("PERIOD_RE", () => {
  it("accepts 01-12, rejects 00/13 and date strings", () => {
    expect(PERIOD_RE.test("2026-01")).toBe(true)
    expect(PERIOD_RE.test("2026-12")).toBe(true)
    expect(PERIOD_RE.test("2026-00")).toBe(false)
    expect(PERIOD_RE.test("2026-13")).toBe(false)
    expect(PERIOD_RE.test("2026-03-15")).toBe(false)
  })
})

describe("monthBounds", () => {
  it("leap February: 2024-02 ends on the 29th, 2026-02 on the 28th", () => {
    expect(monthBounds("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" })
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })
  it("December year-rollover in the last-day math", () => {
    // discriminates Date.UTC(y, 12, 0) handling (naive m+1 without rollover breaks here)
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" })
  })
  it("30-day month", () => {
    expect(monthBounds("2026-04")).toEqual({ from: "2026-04-01", to: "2026-04-30" })
  })
})

describe("isClosablePeriod — strictly before the current UTC month", () => {
  it("past month closable; current month not; future month not", () => {
    expect(isClosablePeriod("2026-06", "2026-07-01")).toBe(true)
    expect(isClosablePeriod("2026-07", "2026-07-15")).toBe(false) // equal month — strict
    expect(isClosablePeriod("2026-08", "2026-07-31")).toBe(false)
  })
  it("Dec→Jan boundary: December closable on Jan 1", () => {
    expect(isClosablePeriod("2025-12", "2026-01-01")).toBe(true)
  })
  it("malformed period is never closable", () => {
    expect(isClosablePeriod("2026-13", "2026-07-01")).toBe(false)
    expect(isClosablePeriod("2026-06-15", "2026-07-01")).toBe(false)
  })
})

describe("formatPeriodLabel", () => {
  it("month-index discriminator: 2026-03 is March, 2026-12 is December", () => {
    expect(formatPeriodLabel("2026-03")).toBe("March 2026")
    expect(formatPeriodLabel("2026-12")).toBe("December 2026")
  })
})

describe("closableMonthOptions", () => {
  it("starts at the previous month with Dec→Jan rollover; never includes the current month", () => {
    const opts = closableMonthOptions("2026-01-15", new Set())
    expect(opts[0]).toBe("2025-12")
    expect(opts[1]).toBe("2025-11")
    expect(opts).not.toContain("2026-01")
  })
  it("skips already-closed months and still returns the requested count", () => {
    const opts = closableMonthOptions("2026-07-18", new Set(["2026-06"]), 3)
    expect(opts).toEqual(["2026-05", "2026-04", "2026-03"])
  })
})

describe("snapshotTotals", () => {
  it("mixed directions: net is income − expense (sign-flip discriminator)", () => {
    const r = snapshotTotals([
      { direction: "income", amount_cents: 5000 },
      { direction: "expense", amount_cents: 2000 },
      { direction: "expense", amount_cents: 1000 },
    ])
    // an inverted subtraction yields −2000; a signed-sum-without-split loses the per-direction totals
    expect(r).toEqual({ income_cents: 5000, expense_cents: 3000, net_cents: 2000, entry_count: 3 })
  })
  it("expense-heavy month: net goes negative, magnitudes stay positive", () => {
    const r = snapshotTotals([
      { direction: "income", amount_cents: 100 },
      { direction: "expense", amount_cents: 900 },
    ])
    expect(r).toEqual({ income_cents: 100, expense_cents: 900, net_cents: -800, entry_count: 2 })
  })
  it("empty month closes to a well-shaped zero snapshot (D-7)", () => {
    expect(snapshotTotals([])).toEqual({ income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0 })
  })
})

describe("PERIOD_CLOSED_MESSAGE", () => {
  it("is the spec's exact user sentence", () => {
    expect(PERIOD_CLOSED_MESSAGE).toBe(
      "That month is closed for this book. Post an adjustment entry in the current open month instead (it can reference the closed month).",
    )
  })
})
