// Watermark window for the nightly Stripe payout-sync cron (Track A §1.3).
// Pure, zero IO. Steady state: arrival_date >= latest stored arrival − 14d
// (late arrivals + status flips ride the overlap; the route's eligibility arm
// additionally re-pulls stored non-terminal payouts by id every run, so a
// flip can never strand outside this window). Cold start (no stored payouts):
// NULL lower bound = FULL history (Decision A-4 — the YTD report needs fees
// back to January; a solo-coach payout list is tiny). Re-scanning overlap is
// free: upsertPayouts/upsertPayoutLines are idempotent merge-upserts.
const OVERLAP_MARGIN_DAYS = 14

function minusDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
}

export interface PayoutSyncWindow {
  /** YYYY-MM-DD lower bound; null = no bound (cold start → full history). */
  fromDate: string | null
  /** fromDate at 00:00:00 UTC in epoch SECONDS (Stripe arrival_date.gte); null = no bound. */
  fromEpochSeconds: number | null
  /** Informational upper bound = today (the Stripe listing needs no upper bound). */
  to: string
}

export function computePayoutSyncWindow(
  latestArrivalDate: string | null,
  today: string,
): PayoutSyncWindow {
  if (latestArrivalDate == null) return { fromDate: null, fromEpochSeconds: null, to: today }
  const rewound = minusDays(latestArrivalDate, OVERLAP_MARGIN_DAYS)
  const fromDate = rewound > today ? today : rewound
  return { fromDate, fromEpochSeconds: Date.parse(`${fromDate}T00:00:00Z`) / 1000, to: today }
}
