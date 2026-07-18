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

// --- Closed-period guard primitives (D-2: consumed inside lib/db/bookkeeping.ts) ---

/** Coded error the DAL throws for closed-period writes; routes duck-type
 *  `.code === "PERIOD_CLOSED"` (the AccountScopeError precedent) and never
 *  import this class. */
export class PeriodClosedError extends Error {
  readonly code = "PERIOD_CLOSED" as const
  constructor(
    public readonly book_id: string,
    public readonly period: string,
  ) {
    super(`Period ${period} is closed for book ${book_id}`)
    this.name = "PeriodClosedError"
  }
}

/** Single-row guard: no-op when the closed set is empty. */
export function assertPeriodOpen(closed: ReadonlySet<string>, bookId: string, occurredOn: string): void {
  const period = periodOf(occurredOn)
  if (closed.has(period)) throw new PeriodClosedError(bookId, period)
}

export const REJECTED_ROW_CAP = 50

export interface RejectedClosedRow {
  occurred_on: string
  amount_cents: number
  memo: string | null
  counterparty: string | null
  source_ref: string | null
}

export interface ClosedPartition<T> {
  open: T[]
  rejected_closed: number
  rejected_closed_rows: RejectedClosedRow[]
}

/** D-4: batch rejects happen BEFORE the upsert so they are never conflated
 *  with the silent duplicate-skip. Order preserved in both halves; the row
 *  list caps at REJECTED_ROW_CAP while the count stays exact. */
export function partitionByClosedPeriods<
  T extends {
    occurred_on: string
    amount_cents: number
    memo?: string | null
    counterparty?: string | null
    source_ref?: string | null
  },
>(drafts: T[], closed: ReadonlySet<string>): ClosedPartition<T> {
  if (closed.size === 0) return { open: drafts, rejected_closed: 0, rejected_closed_rows: [] }
  const open: T[] = []
  const rejected: T[] = []
  for (const d of drafts) {
    if (closed.has(periodOf(d.occurred_on))) rejected.push(d)
    else open.push(d)
  }
  return {
    open,
    rejected_closed: rejected.length,
    rejected_closed_rows: rejected.slice(0, REJECTED_ROW_CAP).map((d) => ({
      occurred_on: d.occurred_on,
      amount_cents: d.amount_cents,
      memo: d.memo ?? null,
      counterparty: d.counterparty ?? null,
      source_ref: d.source_ref ?? null,
    })),
  }
}
