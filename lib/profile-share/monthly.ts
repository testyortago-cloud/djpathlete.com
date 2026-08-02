export interface MonthlyTraining {
  /** "2026-03" — stable sort key. */
  month: string
  /** "Mar" / "Jan '26" (January carries the year so year boundaries read). */
  label: string
  sessions: number
  volumeKg: number
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * Buckets completed-session summaries into a fixed trailing window of calendar
 * months (zero-filled — a quiet month shows as 0, it is not dropped). Returns
 * [] when every month is empty so the chart can self-hide.
 */
export function buildMonthlyTraining(
  rows: { session_date: string; volume_load_kg: number | null }[],
  { monthsBack = 9, now = new Date() }: { monthsBack?: number; now?: Date } = {},
): MonthlyTraining[] {
  const buckets = new Map<string, { sessions: number; volumeKg: number }>()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1))
    buckets.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, { sessions: 0, volumeKg: 0 })
  }

  for (const r of rows) {
    const key = r.session_date?.slice(0, 7)
    const b = key ? buckets.get(key) : undefined
    if (!b) continue
    b.sessions += 1
    b.volumeKg += r.volume_load_kg ?? 0
  }

  const out = [...buckets.entries()].map(([month, b]) => {
    const monthIdx = Number(month.slice(5)) - 1
    const label = monthIdx === 0 ? `Jan '${month.slice(2, 4)}` : MONTH_SHORT[monthIdx]
    return { month, label, sessions: b.sessions, volumeKg: Math.round(b.volumeKg) }
  })
  return out.some((b) => b.sessions > 0) ? out : []
}
