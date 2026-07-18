import { describe, expect, it } from "vitest"
import { yearEndFlags, type YearEndInputs } from "@/lib/bookkeeping/year-end-flags"

function input(over: Partial<YearEndInputs>): YearEndInputs {
  return {
    today: "2026-06-15", from: "2026-01-01", to: "2026-12-31",
    gap_count: 0, uncategorized_expense_count: 0,
    home_office_percent_set: true, home_office_input_total_cents: 0,
    ...over,
  }
}

describe("yearEndFlags", () => {
  it("q4_timing boundary: Sep 30 off, Oct 1 on (same year)", () => {
    expect(yearEndFlags(input({ today: "2026-09-30" })).map((f) => f.id)).not.toContain("q4_timing")
    expect(yearEndFlags(input({ today: "2026-10-01" })).map((f) => f.id)).toContain("q4_timing")
    expect(yearEndFlags(input({ today: "2026-12-31" })).map((f) => f.id)).toContain("q4_timing")
  })
  it("q4_timing suppressed when the window ends in a different year", () => {
    expect(yearEndFlags(input({ today: "2026-11-01", to: "2025-12-31" })).map((f) => f.id)).not.toContain("q4_timing")
  })
  it("substantiation and uncategorized flags fire on counts > 0 with the count in the title", () => {
    const flags = yearEndFlags(input({ gap_count: 3, uncategorized_expense_count: 1 }))
    expect(flags.find((f) => f.id === "substantiation_gaps")?.title).toContain("3")
    expect(flags.find((f) => f.id === "uncategorized_expenses")?.title).toContain("1")
  })
  it("substantiation_gaps pluralizes: 1 → 'entry is', 2 → 'entries are'", () => {
    expect(yearEndFlags(input({ gap_count: 1 })).find((f) => f.id === "substantiation_gaps")?.title).toContain(
      "entry is",
    )
    expect(yearEndFlags(input({ gap_count: 2 })).find((f) => f.id === "substantiation_gaps")?.title).toContain(
      "entries are",
    )
  })
  it("uncategorized_expenses pluralizes: 1 → 'entry has', 2 → 'entries have'", () => {
    expect(
      yearEndFlags(input({ uncategorized_expense_count: 1 })).find((f) => f.id === "uncategorized_expenses")?.title,
    ).toContain("entry has")
    expect(
      yearEndFlags(input({ uncategorized_expense_count: 2 })).find((f) => f.id === "uncategorized_expenses")?.title,
    ).toContain("entries have")
  })
  it("home_office_unset fires only when percent unset AND household tenancy spend exists", () => {
    expect(yearEndFlags(input({ home_office_percent_set: false, home_office_input_total_cents: 5000 })).map((f) => f.id)).toContain("home_office_unset")
    expect(yearEndFlags(input({ home_office_percent_set: false, home_office_input_total_cents: 0 })).map((f) => f.id)).not.toContain("home_office_unset")
    expect(yearEndFlags(input({ home_office_percent_set: true, home_office_input_total_cents: 5000 })).map((f) => f.id)).not.toContain("home_office_unset")
  })
  it("quiet period → zero flags", () => {
    expect(yearEndFlags(input({}))).toEqual([])
  })
})
