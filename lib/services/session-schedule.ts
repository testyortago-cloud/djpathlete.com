// Recurring in-person session scheduling. Pure helpers live at the top (unit
// tested, no DB, no Date.now()); orchestration that touches DALs is appended in
// task A4. Naive session_date + start_time are interpreted as UTC for the
// no-show comparison — the buffer absorbs the resulting slack.

const DAY_MS = 86_400_000

/** ISO (YYYY-MM-DD) dates in [from, to] inclusive whose UTC weekday matches. */
export function datesForSlot(slot: { day_of_week: number }, from: Date, to: Date): string[] {
  const out: string[] = []
  // Normalize to UTC midnight so DST/time-of-day can't skip or double a day.
  let d = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  for (; d <= end; d += DAY_MS) {
    const day = new Date(d)
    if (day.getUTCDay() === slot.day_of_week) out.push(day.toISOString().slice(0, 10))
  }
  return out
}

export interface ScanSession {
  id: string
  session_date: string
  start_time: string
  duration_minutes: number
  status: string
}

/** Ids of still-`scheduled` sessions whose end time + buffer is already past. */
export function scanNoShows(sessions: ScanSession[], now: Date, bufferMinutes: number): string[] {
  const cutoff = now.getTime()
  const out: string[] = []
  for (const s of sessions) {
    if (s.status !== "scheduled") continue
    const start = new Date(`${s.session_date}T${s.start_time}Z`).getTime()
    if (Number.isNaN(start)) continue
    const overAt = start + (s.duration_minutes + bufferMinutes) * 60_000
    if (overAt < cutoff) out.push(s.id)
  }
  return out
}
