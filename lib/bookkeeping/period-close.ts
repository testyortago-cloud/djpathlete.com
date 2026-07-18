// Pure period math for the Phase-6a monthly close. Zero IO; no new Date() —
// callers inject todayIso at the edge. Integer cents; net = income − expense
// is the only subtraction (house sign discipline, see reports.ts header).
import type { LedgerDirection } from "@/types/database"

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** The one user-facing sentence for a closed-period write rejection (spec §3.3). */
export const PERIOD_CLOSED_MESSAGE =
  "That month is closed for this book. Post an adjustment entry in the current open month instead (it can reference the closed month)."

/** "2026-03-15" → "2026-03". Inputs are DATE-regex-validated at every boundary. */
export function periodOf(dateStr: string): string {
  return dateStr.slice(0, 7)
}

/** First/last calendar day of a YYYY-MM period. Date.UTC(y, m, 0) is the last
 *  day of month m (1-based) — leap-safe and Dec-rollover-safe. */
export function monthBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, "0")}` }
}

/** D-7: any month strictly before the current UTC calendar month. Zero-padded
 *  YYYY-MM strings compare correctly lexicographically. */
export function isClosablePeriod(period: string, todayIso: string): boolean {
  return PERIOD_RE.test(period) && period < periodOf(todayIso)
}

/** "2026-03" → "March 2026" (UTC-pinned so the label never rolls a month). */
export function formatPeriodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Closable-month choices for the UI: up to `count` months strictly before the
 *  current UTC month, newest first, minus already-closed periods. */
export function closableMonthOptions(todayIso: string, closed: ReadonlySet<string>, count = 24): string[] {
  const [y, m] = periodOf(todayIso).split("-").map(Number)
  const out: string[] = []
  for (let i = 1; out.length < count && i <= count + closed.size; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    if (!closed.has(period)) out.push(period)
  }
  return out
}

export interface SnapshotTotals {
  income_cents: number
  expense_cents: number
  net_cents: number
  entry_count: number
}

/** Totals frozen by a close. Integer cents; the ONLY subtraction is the net. */
export function snapshotTotals(entries: Array<{ direction: LedgerDirection; amount_cents: number }>): SnapshotTotals {
  let income = 0
  let expense = 0
  for (const e of entries) {
    if (e.direction === "income") income += e.amount_cents
    else expense += e.amount_cents
  }
  return { income_cents: income, expense_cents: expense, net_cents: income - expense, entry_count: entries.length }
}
