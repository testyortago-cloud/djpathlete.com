// lib/ads/agent/signals.ts
// Gathers the unified snapshot the reasoning step consumes:
// 0. Preflight (data-quality gate)
// 1. Raw inputs (added in Task 10)
// 2. Derived cross-channel signals (added in Task 11)
// 3. Learning layer (added in Task 11)

import * as T from "./thresholds"
import type { PreflightResult } from "./types"

const HOURS = 3_600_000

export interface PreflightInput {
  mostRecentConversionAt: Date | null
  ga4SyncedAt: Date | null
  gscSyncedAt: Date | null
  tokensValid: { googleAds: boolean; ga4: boolean; gsc: boolean }
  activeCampaignClicks7d: number
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const now = Date.now()
  const reasons: string[] = []

  if (!input.mostRecentConversionAt) {
    reasons.push("Conversion tracking stale: no conversions on record.")
  } else {
    const ageHours = (now - input.mostRecentConversionAt.getTime()) / HOURS
    if (ageHours > T.CONVERSION_FRESHNESS_HOURS) {
      reasons.push(
        `Conversion tracking stale: most recent conversion is ${ageHours.toFixed(1)}h old (threshold ${T.CONVERSION_FRESHNESS_HOURS}h).`,
      )
    }
  }

  if (input.activeCampaignClicks7d < T.MIN_RECENT_CLICKS) {
    reasons.push(
      `Insufficient clicks: ${input.activeCampaignClicks7d} clicks across active campaigns in last ${T.RECENT_CLICKS_WINDOW_DAYS}d (threshold ${T.MIN_RECENT_CLICKS}).`,
    )
  }

  if (!input.tokensValid.googleAds) reasons.push("Google Ads OAuth token invalid or missing.")
  if (!input.tokensValid.ga4) reasons.push("GA4 OAuth token invalid or missing.")
  if (!input.tokensValid.gsc) reasons.push("GSC OAuth token invalid or missing.")

  if (input.ga4SyncedAt) {
    const ga4Lag = (now - input.ga4SyncedAt.getTime()) / HOURS
    if (ga4Lag > T.SYNC_FRESHNESS_HOURS) {
      reasons.push(`GA4 sync lag ${ga4Lag.toFixed(1)}h exceeds ${T.SYNC_FRESHNESS_HOURS}h.`)
    }
  }
  if (input.gscSyncedAt) {
    const gscLag = (now - input.gscSyncedAt.getTime()) / HOURS
    if (gscLag > T.SYNC_FRESHNESS_HOURS) {
      reasons.push(`GSC sync lag ${gscLag.toFixed(1)}h exceeds ${T.SYNC_FRESHNESS_HOURS}h.`)
    }
  }

  return { ok: reasons.length === 0, reasons }
}
