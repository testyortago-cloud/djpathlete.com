// Pure straight-line depreciation schedule (Phase 6d, design §6.2 / D-13).
// Zero IO, zero imports. Integer cents. Math.round at EXACTLY two points
// (first-year proration, whole middle years); the FINAL span year is the
// remainder base − accumulated, so every schedule sums to base EXACTLY.
// (Per spec §6.2's framing: each individual year is rounded at most ONCE —
// never re-rounded — these two branches are simply the two places in the
// code where that single per-year rounding can happen.)
// Inputs are DB-validated (CHECKs + Zod) — this module trusts them.
// Depreciation is tracked, not decided: report-layer only, never a ledger row (D-12).

export interface DepreciableAsset {
  basis_cents: number
  salvage_cents: number
  in_service_on: string // YYYY-MM-DD
  method: "straight_line"
  convention: "full_month" | "half_year"
  recovery_years: number
}

export interface DepreciationYear {
  year: number
  depreciation_cents: number
  accumulated_cents: number
  remaining_cents: number
}

export interface DepreciationScheduleResult {
  years: DepreciationYear[]
  fully_depreciated_in: number
}

export function depreciationSchedule(asset: DepreciableAsset, throughYear: number): DepreciationScheduleResult {
  const base = asset.basis_cents - asset.salvage_cents
  const startYear = Number(asset.in_service_on.slice(0, 4))
  const startMonth = Number(asset.in_service_on.slice(5, 7)) // 1-12
  const annual = base / asset.recovery_years // float — rounded per-year below, never here

  // Months credited to the first calendar year: the in-service month counts
  // (January = 12, December = 1); half_year is a flat 6 regardless of month.
  const firstYearMonths = asset.convention === "half_year" ? 6 : 13 - startMonth
  const totalMonths = asset.recovery_years * 12
  const spanYears = 1 + Math.ceil((totalMonths - firstYearMonths) / 12)
  const finalYear = startYear + spanYears - 1

  const years: DepreciationYear[] = []
  let accumulated = 0
  for (let y = startYear; y <= finalYear; y++) {
    let dep: number
    if (y === finalYear) {
      dep = base - accumulated // remainder — the exact-sum guarantee
    } else if (y === startYear) {
      dep = Math.round((annual * firstYearMonths) / 12)
    } else {
      dep = Math.round(annual)
    }
    accumulated += dep
    if (y <= throughYear) {
      years.push({ year: y, depreciation_cents: dep, accumulated_cents: accumulated, remaining_cents: base - accumulated })
    }
  }
  return { years, fully_depreciated_in: finalYear }
}

/** One year's view for the pack/print: that year's charge + accumulated through it. */
export function depreciationAsOf(
  asset: DepreciableAsset,
  year: number,
): { year_cents: number; accumulated_cents: number; remaining_cents: number } {
  const { years } = depreciationSchedule(asset, year)
  const last = years[years.length - 1]
  if (!last) {
    return { year_cents: 0, accumulated_cents: 0, remaining_cents: asset.basis_cents - asset.salvage_cents }
  }
  return {
    year_cents: last.year === year ? last.depreciation_cents : 0,
    accumulated_cents: last.accumulated_cents,
    remaining_cents: last.remaining_cents,
  }
}
