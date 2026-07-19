/** Pure input types + tiny pure helpers for the Phase-5 insight finders.
 *  InsightEntry/InsightAccount widen the slim Phase-4 report projections with the
 *  columns the finders need; widening ReportEntry itself would churn Phase-4 fixtures. */
import type { ReportAccount, ReportEntry } from "./reports"

export interface InsightEntry extends ReportEntry {
  id: string
  business_purpose: string | null
  document_id: string | null
}

export interface InsightAccount extends ReportAccount {
  is_deductible_candidate: boolean
  requires_business_purpose: boolean
  archived_at: string | null
}

/** trim + lowercase + collapse whitespace runs; empty/null → null (ungroupable). */
export function normalizeCounterparty(raw: string | null): string | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ")
  return normalized === "" ? null : normalized
}

/** system_settings stores jsonb — defend against hand-edited junk on every read. */
export function coerceHomeOfficePercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100
    ? value
    : null
}

/** Same junk-defense as coerceHomeOfficePercent, for the flat effective tax rate
 *  (bookkeeping_tax_rate_percent). Kept as its own function so the two settings can
 *  diverge without cross-contamination. */
export function coerceTaxRatePercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100
    ? value
    : null
}

/** Blank-business-purpose predicate. Extracted (Phase 6b) from the Phase-5 deduction
 *  finder so the receipt watchdog shares ONE definition of "blank" — null / empty /
 *  whitespace-only. Behavior is byte-identical to the finder's old local isBlank. */
export function isBlankPurpose(value: string | null): boolean {
  return value === null || value.trim() === ""
}
