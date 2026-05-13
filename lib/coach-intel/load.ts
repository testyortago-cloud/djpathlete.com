import { ACUTE_WINDOW_DAYS, CHRONIC_WINDOW_DAYS } from "./thresholds"

export interface SessionInput {
  date: string
  session_load: number
}

export interface DailyLoad {
  date: string
  load: number
}

export interface RollingPoint {
  date: string
  value: number
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  const start = new Date(from + "T00:00:00Z")
  const end = new Date(to + "T00:00:00Z")
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export function dailyLoads(
  sessions: SessionInput[],
  from: string,
  to: string,
): DailyLoad[] {
  const sums = new Map<string, number>()
  for (const s of sessions) {
    if (s.date >= from && s.date <= to) {
      sums.set(s.date, (sums.get(s.date) ?? 0) + s.session_load)
    }
  }
  return dateRange(from, to).map((d) => ({ date: d, load: sums.get(d) ?? 0 }))
}

export function rollingAverage(
  daily: DailyLoad[],
  windowDays: number,
): RollingPoint[] {
  return daily.map((_, i) => {
    const start = Math.max(0, i - windowDays + 1)
    const slice = daily.slice(start, i + 1)
    const sum = slice.reduce((a, b) => a + b.load, 0)
    return { date: daily[i].date, value: sum / slice.length }
  })
}

function windowMean(daily: DailyLoad[], asOf: string, windowDays: number): number {
  const end = new Date(asOf + "T00:00:00Z")
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (windowDays - 1))
  const startStr = start.toISOString().slice(0, 10)
  const slice = daily.filter((d) => d.date >= startStr && d.date <= asOf)
  if (slice.length === 0) return 0
  return slice.reduce((a, b) => a + b.load, 0) / slice.length
}

export function acuteLoad(daily: DailyLoad[], asOf: string): number {
  return windowMean(daily, asOf, ACUTE_WINDOW_DAYS)
}

export function chronicLoad(daily: DailyLoad[], asOf: string): number {
  return windowMean(daily, asOf, CHRONIC_WINDOW_DAYS)
}

export function acwr(daily: DailyLoad[], asOf: string): number | null {
  const chronic = chronicLoad(daily, asOf)
  if (chronic === 0) return null
  return acuteLoad(daily, asOf) / chronic
}
