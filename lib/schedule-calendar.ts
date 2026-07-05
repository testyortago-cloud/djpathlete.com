// Pure calendar math for the /admin/schedule views. All date arithmetic works
// on ISO (YYYY-MM-DD) strings at UTC midnight — no Date.now(), no local
// timezone — matching how scheduled_sessions stores naive dates/times.

export type ScheduleView = "month" | "week" | "list"

const DAY_MS = 86_400_000

function toUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDaysISO(iso: string, days: number): string {
  return toISO(toUTC(iso) + days * DAY_MS)
}

/** Shift by whole months, clamping the day to the target month's last day. */
export function shiftMonthISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return toISO(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay)))
}

/** The Sunday starting the week that contains `iso` (0=Sun..6=Sat, like day_of_week). */
export function weekStartOf(iso: string): string {
  const ms = toUTC(iso)
  return toISO(ms - new Date(ms).getUTCDay() * DAY_MS)
}

/** The 7 dates of the containing week, Sunday first. */
export function weekDays(iso: string): string[] {
  const start = toUTC(weekStartOf(iso))
  return Array.from({ length: 7 }, (_, i) => toISO(start + i * DAY_MS))
}

export interface MonthCell {
  date: string
  inMonth: boolean
}

/** Full padded weeks (Sun..Sat) covering the anchor's month. */
export function monthGrid(iso: string): MonthCell[][] {
  const [y, m] = iso.split("-").map(Number)
  const monthPrefix = `${y}-${String(m).padStart(2, "0")}`
  const firstOfMonth = toISO(Date.UTC(y, m - 1, 1))
  const lastOfMonth = toISO(Date.UTC(y, m, 0))
  let d = toUTC(weekStartOf(firstOfMonth))
  const end = toUTC(addDaysISO(weekStartOf(lastOfMonth), 6))
  const weeks: MonthCell[][] = []
  while (d <= end) {
    const week: MonthCell[] = []
    for (let i = 0; i < 7; i++, d += DAY_MS) {
      const date = toISO(d)
      week.push({ date, inMonth: date.startsWith(monthPrefix) })
    }
    weeks.push(week)
  }
  return weeks
}

/** Inclusive [from, to] date range each view shows for a given anchor date. */
export function calendarRange(view: ScheduleView, anchor: string): { from: string; to: string } {
  if (view === "week") {
    const from = weekStartOf(anchor)
    return { from, to: addDaysISO(from, 6) }
  }
  if (view === "month") {
    const grid = monthGrid(anchor)
    return { from: grid[0][0].date, to: grid[grid.length - 1][6].date }
  }
  return { from: anchor, to: addDaysISO(anchor, 13) }
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + (m || 0)
}

interface TimedSession {
  start_time: string
  duration_minutes: number
}

/** Visible hour span for the week grid: 6..19 by default, expanded to fit sessions. */
export function hourRange(sessions: TimedSession[]): { startHour: number; endHour: number } {
  let startHour = 6
  let endHour = 19
  for (const s of sessions) {
    const start = timeToMinutes(s.start_time)
    startHour = Math.min(startHour, Math.floor(start / 60))
    endHour = Math.max(endHour, Math.ceil((start + s.duration_minutes) / 60))
  }
  return { startHour, endHour }
}

export interface LaneAssignment {
  lane: number
  lanes: number
}

/**
 * Side-by-side lane assignment for overlapping sessions within one day.
 * Sessions in the same overlap cluster share a `lanes` count; each takes the
 * first lane free at its start time (a community-gym slot often has several
 * clients at the same start time, so this is the common case).
 */
export function assignLanes(sessions: Array<TimedSession & { id: string }>): Map<string, LaneAssignment> {
  const sorted = [...sessions].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
  const result = new Map<string, LaneAssignment>()
  let cluster: Array<{ id: string; lane: number }> = []
  let laneEnds: number[] = []
  let clusterEnd = -1

  const flush = () => {
    for (const c of cluster) result.set(c.id, { lane: c.lane, lanes: laneEnds.length })
    cluster = []
    laneEnds = []
    clusterEnd = -1
  }

  for (const s of sorted) {
    const start = timeToMinutes(s.start_time)
    const end = start + s.duration_minutes
    if (cluster.length > 0 && start >= clusterEnd) flush()
    let lane = laneEnds.findIndex((e) => e <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }
    cluster.push({ id: s.id, lane })
    clusterEnd = Math.max(clusterEnd, end)
  }
  flush()
  return result
}
