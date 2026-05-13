import type { DailyLoad } from "./load"

export function currentStreak(daily: DailyLoad[], today: string): number {
  const byDate = new Map(daily.map((d) => [d.date, d.load]))
  let streak = 0
  const cursor = new Date(today + "T00:00:00Z")
  while (true) {
    const iso = cursor.toISOString().slice(0, 10)
    const load = byDate.get(iso) ?? 0
    if (load <= 0) break
    streak += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return streak
}

export function longestStreak(daily: DailyLoad[]): number {
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
  let longest = 0
  let run = 0
  let prevDate: string | null = null
  for (const d of sorted) {
    const isConsecutive =
      prevDate !== null &&
      new Date(d.date + "T00:00:00Z").getTime() - new Date(prevDate + "T00:00:00Z").getTime() === 86_400_000
    if (d.load > 0) {
      run = isConsecutive ? run + 1 : 1
      longest = Math.max(longest, run)
    } else {
      run = 0
    }
    prevDate = d.date
  }
  return longest
}
