import type { SessionCheckin } from "@/types/database"
import type { ArrangementWithUser } from "@/lib/db/attendance-arrangements"

/** `YYYY-MM` → the inclusive date bounds of that calendar month. */
export function monthBounds(month: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) throw new Error(`Invalid month: ${month}`)
  const year = Number(m[1])
  const mon = Number(m[2])
  if (mon < 1 || mon > 12) throw new Error(`Invalid month: ${month}`)
  // Day 0 of the NEXT month is the last day of this one — correct for leap
  // Februaries and 30/31-day months alike, with no calendar table.
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${pad(lastDay)}` }
}

/** The month `date` (a Date or `YYYY-MM-DD`) falls in, as `YYYY-MM`. */
export function monthOf(date: Date | string): string {
  const iso = typeof date === "string" ? date : date.toISOString().slice(0, 10)
  return iso.slice(0, 7)
}

export interface AttendanceMonthRow {
  arrangementId: string
  clientUserId: string
  name: string
  label: string | null
  status: string
  sessions: number
}

export interface AttendanceMonthView {
  rows: AttendanceMonthRow[]
  total: number
}

/**
 * Sessions per arrangement for one month, plus the grand total the coach checks
 * against the facility's invoice.
 *
 * Every supplied arrangement gets a row even at zero sessions: a client who was
 * expected and did not show is information, and dropping them would make the
 * list silently shorter rather than visibly zero.
 */
export function rollUpAttendance(
  arrangements: ArrangementWithUser[],
  checkins: SessionCheckin[],
): AttendanceMonthView {
  const counts = new Map<string, number>()
  // Plain walk, not a dedupe helper: two check-ins on the same arrangement are
  // two sessions, and anything that collapses by a shared value loses one.
  for (const c of checkins) {
    if (!c.arrangement_id || c.voided) continue
    counts.set(c.arrangement_id, (counts.get(c.arrangement_id) ?? 0) + 1)
  }

  const rows: AttendanceMonthRow[] = arrangements.map((a) => {
    const u = a.users
    const name = u ? `${u.first_name} ${u.last_name}`.trim() : "Unknown client"
    return {
      arrangementId: a.id,
      clientUserId: a.client_user_id,
      name,
      label: a.label,
      status: a.status,
      sessions: counts.get(a.id) ?? 0,
    }
  })

  rows.sort((x, y) => y.sessions - x.sessions || x.name.localeCompare(y.name))
  // Summed from the ROWS, so the total can never disagree with the list above
  // it — a check-in whose arrangement is missing would otherwise inflate a
  // total that nothing on screen accounts for.
  return { rows, total: rows.reduce((n, r) => n + r.sessions, 0) }
}
