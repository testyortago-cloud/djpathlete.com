/** Trims trailing zeros so 45.70 reads 45.7 and 140.00 reads 140. */
export function num(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * A test date, the way the report prints it: 4 Aug 2026.
 *
 * Forced to UTC. Test dates are calendar dates with no time component, so letting
 * the viewer's timezone apply would shift a date across midnight and print the day
 * before for anyone west of UTC.
 */
export function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}
