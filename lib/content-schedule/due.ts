// lib/content-schedule/due.ts
// Pure partitioner for scheduled content. No I/O, no DAL, no clock of its
// own — `now` is always passed in, which is what makes the 24-hour boundary
// exhaustively testable.

/** The window inside which a late item still goes out. */
export const MISSED_GRACE_MS = 24 * 60 * 60 * 1000

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * Formats an ISO timestamp for a non-technical coach reading the admin list —
 * "Wed 19 Aug 2026 at 7:00 AM UTC" instead of the raw ISO string. Deterministic
 * and locale-free on purpose: it reads off the UTC fields directly rather than
 * calling `toLocaleString()`, which would make this function's output depend
 * on the machine running it (and this file has to stay pure — no ambient
 * clock or locale, `now` and everything else is always passed in).
 */
function formatMissedTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso

  const day = DAY_NAMES[d.getUTCDay()]
  const date = d.getUTCDate()
  const month = MONTH_NAMES[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  const minutes = String(d.getUTCMinutes()).padStart(2, "0")
  const hours24 = d.getUTCHours()
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  const ampm = hours24 >= 12 ? "PM" : "AM"

  return `${day} ${date} ${month} ${year} at ${hours12}:${minutes} ${ampm} UTC`
}

export interface SchedulableRow {
  id: string
  scheduled_at: string | null
}

export interface DuePartition<T> {
  /** Due now, and late by less than the grace window. */
  fire: T[]
  /** Late by at least the grace window, or unusable. Never fired. */
  missed: Array<{ row: T; reason: string }>
  /** Still in the future. */
  waiting: T[]
}

/**
 * Splits scheduled rows three ways against `now`.
 *
 * The grace window exists because the checker runs every five minutes and can
 * itself be down. A two-hour outage should not cost you the post; a newsletter
 * armed for a week must not land in inboxes the moment service returns. The
 * boundary is `>=` — exactly 24h late is missed.
 */
export function partitionDue<T extends SchedulableRow>(rows: T[], now: Date): DuePartition<T> {
  const out: DuePartition<T> = { fire: [], missed: [], waiting: [] }
  const nowMs = now.getTime()

  for (const row of rows) {
    if (!row.scheduled_at) {
      out.missed.push({ row, reason: "Had no scheduled time — reschedule it to send." })
      continue
    }

    const whenMs = new Date(row.scheduled_at).getTime()
    if (Number.isNaN(whenMs)) {
      out.missed.push({ row, reason: "Had no scheduled time we could read — reschedule it to send." })
      continue
    }

    if (whenMs > nowMs) {
      out.waiting.push(row)
      continue
    }

    if (nowMs - whenMs >= MISSED_GRACE_MS) {
      out.missed.push({
        row,
        reason: `Missed its slot — it was set for ${formatMissedTime(row.scheduled_at)} and that is more than 24 hours ago. Pick a new time.`,
      })
      continue
    }

    out.fire.push(row)
  }

  return out
}
