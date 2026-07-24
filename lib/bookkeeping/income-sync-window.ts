// Watermark window for the nightly income-sync cron (spec D2). Pure, zero IO.
// from = latest posted platform-import date − 14d overlap (late-settling rows,
// pending→paid flips); no watermark → 90d lookback. Re-scanning overlap is free:
// insertImportedEntries is idempotent. No span cap — a long-dark cron heals the
// whole gap on its next run.
const FALLBACK_LOOKBACK_DAYS = 90
const OVERLAP_MARGIN_DAYS = 14

function minusDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
}

export function computeSyncWindow(
  latestPlatformImportDate: string | null,
  today: string,
): { from: string; to: string } {
  const from = latestPlatformImportDate == null
    ? minusDays(today, FALLBACK_LOOKBACK_DAYS)
    : minusDays(latestPlatformImportDate, OVERLAP_MARGIN_DAYS)
  return { from: from > today ? today : from, to: today }
}
