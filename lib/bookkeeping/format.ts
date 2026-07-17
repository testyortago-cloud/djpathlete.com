/** occurred_on is a plain YYYY-MM-DD date (no time) — parse as local parts to
 *  avoid the UTC-midnight-rolls-back-a-day bug. Shared by ledger + import UIs. */
export function formatOccurredOn(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  if (!y || !m || !d) return dateStr
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
