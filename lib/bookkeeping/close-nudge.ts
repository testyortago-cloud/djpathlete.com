// Pure "you have months waiting to be closed" detector for the monthly nudge
// cron. Zero IO, `today` injected, integer cents.
//
// A month is nudge-worthy when it is (a) strictly before the current UTC month
// — the same closable rule the close route enforces, (b) inside the lookback
// window, (c) has at least one entry, and (d) has no close row. Empty months
// are never nudged: nothing happened, so there is nothing to freeze.
import type { LedgerDirection } from "@/types/database"
import { isClosablePeriod, periodOf, snapshotTotals } from "./period-close"

/** How far back the nudge looks. Bounded so a coach who starts closing today is
 *  not nagged forever about pre-history they will never go back and close. */
export const NUDGE_LOOKBACK_MONTHS = 12

/** Rows listed in the email per book; the count stays honest above the cap. */
export const NUDGE_MONTH_CAP = 6

export interface NudgeEntry {
  book_id: string
  occurred_on: string
  direction: LedgerDirection
  amount_cents: number
}

export interface OpenMonth {
  period: string
  income_cents: number
  expense_cents: number
  net_cents: number
  entry_count: number
}

export interface BookNudge {
  book_id: string
  book_name: string
  /** Newest first, capped at NUDGE_MONTH_CAP. */
  open_months: OpenMonth[]
  /** Uncapped count of open months — never the length of the list above. */
  total_open: number
}

/** The period exactly `months` before `period`, e.g. ("2026-08", 12) → "2025-08". */
function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 - months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** The ledger read window the cron needs: the first day of the oldest month the
 *  nudge could name, through today. Kept here so the read and the filter can
 *  never disagree about how far back "lookback" reaches. */
export function nudgeWindow(today: string, lookbackMonths = NUDGE_LOOKBACK_MONTHS): { from: string; to: string } {
  return { from: `${shiftPeriod(periodOf(today), lookbackMonths)}-01`, to: today }
}

export function closeNudgeTargets(input: {
  books: readonly { id: string; name: string }[]
  entries: readonly NudgeEntry[]
  closedPeriods: readonly { book_id: string; period: string }[]
  today: string
  lookbackMonths?: number
}): BookNudge[] {
  const lookback = input.lookbackMonths ?? NUDGE_LOOKBACK_MONTHS
  const earliest = shiftPeriod(periodOf(input.today), lookback)

  const closed = new Set(input.closedPeriods.map((c) => `${c.book_id}|${c.period}`))

  // book_id → period → entries
  const byBook = new Map<string, Map<string, NudgeEntry[]>>()
  for (const e of input.entries) {
    const period = periodOf(e.occurred_on)
    if (period < earliest) continue
    if (!isClosablePeriod(period, input.today)) continue
    if (closed.has(`${e.book_id}|${period}`)) continue
    let periods = byBook.get(e.book_id)
    if (!periods) {
      periods = new Map()
      byBook.set(e.book_id, periods)
    }
    const bucket = periods.get(period)
    if (bucket) bucket.push(e)
    else periods.set(period, [e])
  }

  const out: BookNudge[] = []
  for (const book of input.books) {
    const periods = byBook.get(book.id)
    if (!periods || periods.size === 0) continue
    const open_months = [...periods.entries()]
      .sort((a, b) => b[0].localeCompare(a[0])) // newest first
      .map(([period, entries]) => ({ period, ...snapshotTotals(entries) }))
    out.push({
      book_id: book.id,
      book_name: book.name,
      open_months: open_months.slice(0, NUDGE_MONTH_CAP),
      total_open: open_months.length,
    })
  }
  return out
}
