import { describe, it, expect } from "vitest"
import { presetRange, PERIOD_PRESET_LABELS, type PeriodPreset } from "@/lib/bookkeeping/period"

describe("presetRange", () => {
  it("this_month spans the calendar month of `today`", () => {
    expect(presetRange("this_month", "2026-07-18")).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("this_month handles February in a leap year", () => {
    expect(presetRange("this_month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" })
  })
  it("this_month handles February in a non-leap year", () => {
    expect(presetRange("this_month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })
  it("last_month rolls back over a year boundary", () => {
    expect(presetRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" })
  })
  it("this_quarter for a mid-quarter month", () => {
    expect(presetRange("this_quarter", "2026-07-18")).toEqual({ from: "2026-07-01", to: "2026-09-30" })
  })
  it("this_quarter at a quarter edge (Mar 31)", () => {
    expect(presetRange("this_quarter", "2026-03-31")).toEqual({ from: "2026-01-01", to: "2026-03-31" })
  })
  it("last_quarter rolls back over a year boundary", () => {
    expect(presetRange("last_quarter", "2026-02-01")).toEqual({ from: "2025-10-01", to: "2025-12-31" })
  })
  it("this_year / last_year are full calendar years", () => {
    expect(presetRange("this_year", "2026-07-18")).toEqual({ from: "2026-01-01", to: "2026-12-31" })
    expect(presetRange("last_year", "2026-07-18")).toEqual({ from: "2025-01-01", to: "2025-12-31" })
  })
  it("labels exist for every preset", () => {
    const presets: PeriodPreset[] = ["this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year"]
    for (const p of presets) expect(PERIOD_PRESET_LABELS[p]).toBeTruthy()
  })
})
