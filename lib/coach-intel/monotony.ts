import type { DailyLoad } from "./load"

export interface WeeklyStats {
  weekStart: string
  totalLoad: number
  mean: number
  stdDev: number
  monotony: number | null
  strain: number | null
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function weeklyStats(daily: DailyLoad[], weekStart: string): WeeklyStats {
  const loads = Array.from({ length: 7 }, (_, i) => {
    const target = addDays(weekStart, i)
    return daily.find((d) => d.date === target)?.load ?? 0
  })

  const totalLoad = loads.reduce((a, b) => a + b, 0)
  const mean = totalLoad / 7
  const variance = loads.reduce((acc, v) => acc + (v - mean) ** 2, 0) / 7
  const stdDev = Math.sqrt(variance)
  const monotony = stdDev > 0 ? mean / stdDev : null
  const strain = monotony !== null ? totalLoad * monotony : null

  return { weekStart, totalLoad, mean, stdDev, monotony, strain }
}
