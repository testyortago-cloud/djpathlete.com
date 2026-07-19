import { describe, expect, it } from "vitest"
import {
  depreciationAsOf,
  depreciationSchedule,
  type DepreciableAsset,
} from "@/lib/bookkeeping/depreciation"

function asset(over: Partial<DepreciableAsset>): DepreciableAsset {
  return {
    basis_cents: 10000,
    salvage_cents: 0,
    in_service_on: "2024-01-15",
    method: "straight_line",
    convention: "full_month",
    recovery_years: 3,
    ...over,
  }
}

const depSum = (r: { years: { depreciation_cents: number }[] }) =>
  r.years.reduce((s, y) => s + y.depreciation_cents, 0)

describe("depreciationSchedule — pinned spec fixtures", () => {
  it("10000¢/3yr full-month January: 3333/3333/3334 — the final year is the remainder", () => {
    // A naive round-every-year implementation yields 3333×3 = 9999 and never sums to base.
    const r = depreciationSchedule(asset({}), 2026)
    expect(r.years).toEqual([
      { year: 2024, depreciation_cents: 3333, accumulated_cents: 3333, remaining_cents: 6667 },
      { year: 2025, depreciation_cents: 3333, accumulated_cents: 6666, remaining_cents: 3334 },
      { year: 2026, depreciation_cents: 3334, accumulated_cents: 10000, remaining_cents: 0 },
    ])
    expect(r.fully_depreciated_in).toBe(2026)
    expect(depSum(r)).toBe(10000)
  })

  it("mid-year in-service (April) discriminates month-proration from half-year", () => {
    // full_month April = 9/12 of annual in year 1 (2500); a half-year impl would give 1667.
    const fm = depreciationSchedule(asset({ in_service_on: "2024-04-01" }), 2030)
    expect(fm.years.map((y) => y.depreciation_cents)).toEqual([2500, 3333, 3333, 834])
    expect(fm.fully_depreciated_in).toBe(2027)
    expect(depSum(fm)).toBe(10000)
    // half_year on the SAME asset: 6/12 in year 1 regardless of month.
    const hy = depreciationSchedule(asset({ in_service_on: "2024-04-01", convention: "half_year" }), 2030)
    expect(hy.years.map((y) => y.depreciation_cents)).toEqual([1667, 3333, 3333, 1667])
    expect(hy.fully_depreciated_in).toBe(2027)
    expect(depSum(hy)).toBe(10000)
  })

  it("December full-month in-service = 1/12 of annual in year 1 (spec sentence pinned)", () => {
    const r = depreciationSchedule(asset({ in_service_on: "2024-12-05" }), 2030)
    expect(r.years.map((y) => y.depreciation_cents)).toEqual([278, 3333, 3333, 3056])
    expect(depSum(r)).toBe(10000)
  })

  it("Math.round (not trunc) at the defined points: 10001¢/2yr January → 5001 then 5000", () => {
    // annual = 5000.5; trunc would give [5000, 5001] — inverted.
    const r = depreciationSchedule(asset({ basis_cents: 10001, recovery_years: 2 }), 2025)
    expect(r.years.map((y) => y.depreciation_cents)).toEqual([5001, 5000])
    expect(depSum(r)).toBe(10001)
  })

  it("salvage > 0 shrinks the base — remaining lands on 0, never −salvage", () => {
    // base = 90000, annual = 30000 exact; a salvage-ignoring impl gives 33333/33333/33334.
    const r = depreciationSchedule(asset({ basis_cents: 100000, salvage_cents: 10000 }), 2026)
    expect(r.years.map((y) => y.depreciation_cents)).toEqual([30000, 30000, 30000])
    expect(r.years[2].remaining_cents).toBe(0)
    expect(depSum(r)).toBe(90000)
  })

  it("throughYear truncates rows but never changes fully_depreciated_in", () => {
    const a = asset({})
    const before = depreciationSchedule(a, 2023)
    expect(before.years).toEqual([])
    expect(before.fully_depreciated_in).toBe(2026)
    const mid = depreciationSchedule(a, 2025)
    expect(mid.years).toHaveLength(2)
    expect(mid.years[1]).toMatchObject({ accumulated_cents: 6666, remaining_cents: 3334 })
    const after = depreciationSchedule(a, 2030)
    expect(after.years).toHaveLength(3)
  })

  it("recovery_years 1: January is a single-year schedule; March spans two (10/12 then remainder)", () => {
    const jan = depreciationSchedule(asset({ recovery_years: 1 }), 2030)
    expect(jan.years).toEqual([
      { year: 2024, depreciation_cents: 10000, accumulated_cents: 10000, remaining_cents: 0 },
    ])
    const mar = depreciationSchedule(asset({ recovery_years: 1, in_service_on: "2024-03-20" }), 2030)
    expect(mar.years.map((y) => y.depreciation_cents)).toEqual([8333, 1667])
    expect(mar.fully_depreciated_in).toBe(2025)
  })

  it("basis === salvage → all-zero schedule that still spans the recovery life", () => {
    const r = depreciationSchedule(asset({ basis_cents: 5000, salvage_cents: 5000 }), 2030)
    expect(r.years.every((y) => y.depreciation_cents === 0)).toBe(true)
    expect(r.fully_depreciated_in).toBe(2026)
  })
})

describe("depreciationAsOf — the pack's per-year lens", () => {
  const a = asset({}) // 3333/3333/3334 over 2024-2026
  it("before in-service: nothing depreciated, full base remaining", () => {
    expect(depreciationAsOf(a, 2023)).toEqual({ year_cents: 0, accumulated_cents: 0, remaining_cents: 10000 })
  })
  it("during: that year's charge + running accumulated", () => {
    expect(depreciationAsOf(a, 2025)).toEqual({ year_cents: 3333, accumulated_cents: 6666, remaining_cents: 3334 })
    expect(depreciationAsOf(a, 2026)).toEqual({ year_cents: 3334, accumulated_cents: 10000, remaining_cents: 0 })
  })
  it("after exhaustion: zero charge, fully accumulated", () => {
    expect(depreciationAsOf(a, 2028)).toEqual({ year_cents: 0, accumulated_cents: 10000, remaining_cents: 0 })
  })
  it("salvage asset ends at base, not basis", () => {
    const s = asset({ basis_cents: 100000, salvage_cents: 10000 })
    expect(depreciationAsOf(s, 2028)).toEqual({ year_cents: 0, accumulated_cents: 90000, remaining_cents: 0 })
  })
})
