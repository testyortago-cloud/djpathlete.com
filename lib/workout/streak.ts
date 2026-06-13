/**
 * Pure streak computation: given a list of `YYYY-MM-DD` dates on which the
 * client completed a workout, return the count of consecutive days ending
 * today or yesterday. Dates that don't reach today/yesterday yield 0.
 *
 * Kept pure (today/yesterday passed in) so it's deterministic and testable.
 */
export function streakFromDates(uniqueDates: string[], todayStr: string, yesterdayStr: string): number {
  const set = new Set(uniqueDates)
  const sorted = Array.from(set).sort().reverse()
  if (sorted.length === 0) return 0

  let anchor: string
  if (sorted[0] === todayStr) anchor = todayStr
  else if (sorted[0] === yesterdayStr) anchor = yesterdayStr
  else return 0 // most recent workout is older than yesterday — streak broken

  const [y, m, d] = anchor.split("-").map(Number)
  const cursor = new Date(Date.UTC(y, m - 1, d))
  let streak = 0
  for (let i = 0; i < 366; i++) {
    const cs = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(
      cursor.getUTCDate(),
    ).padStart(2, "0")}`
    if (set.has(cs)) {
      streak++
      cursor.setUTCDate(cursor.getUTCDate() - 1)
    } else {
      break
    }
  }
  return streak
}
