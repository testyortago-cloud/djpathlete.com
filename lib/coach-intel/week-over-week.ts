import type { DailyLoad } from "./load"

export interface WeekSummary {
  weekStart: string
  totalLoad: number
}

export interface WeekOverWeek {
  current: WeekSummary
  previous: WeekSummary
  deltaPct: number | null
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function sumWeek(daily: DailyLoad[], start: string): number {
  const end = addDays(start, 6)
  return daily.filter((d) => d.date >= start && d.date <= end).reduce((a, b) => a + b.load, 0)
}

export function weekOverWeek(daily: DailyLoad[], currentWeekStart: string): WeekOverWeek {
  const prevStart = addDays(currentWeekStart, -7)
  const current = { weekStart: currentWeekStart, totalLoad: sumWeek(daily, currentWeekStart) }
  const previous = { weekStart: prevStart, totalLoad: sumWeek(daily, prevStart) }
  const deltaPct = previous.totalLoad > 0 ? ((current.totalLoad - previous.totalLoad) / previous.totalLoad) * 100 : null
  return { current, previous, deltaPct }
}
