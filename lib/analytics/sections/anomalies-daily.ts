// lib/analytics/sections/anomalies-daily.ts
// Exception-only daily section. Each rule fires only when its threshold is
// crossed. Thresholds are module-level constants — tune in one place.
import { getDailyTotalsInRange } from "@/lib/db/google-ads-metrics"
import { getGenerationLogs } from "@/lib/db/ai-generation-log"
import type {
  DailyAnomaliesPayload,
  DailyAnomalyFlag,
  DailyRevenueFunnelPayload,
} from "@/types/coach-emails"

const THRESHOLDS = {
  CPL_SPIKE_RATIO: 1.5,
  CPL_SPIKE_MIN_CENTS: 2000,
  GENERATION_FAILURE_MIN: 3,
} as const

interface Options {
  referenceDate: Date
  dailyFunnel: DailyRevenueFunnelPayload | null
}

export async function buildDailyAnomalies(opts: Options): Promise<DailyAnomaliesPayload | null> {
  const referenceDate = opts.referenceDate
  const yesterdayStart = new Date(referenceDate)
  yesterdayStart.setHours(0, 0, 0, 0)
  yesterdayStart.setDate(yesterdayStart.getDate() - 1)

  const baselineFrom = new Date(referenceDate.getTime() - 8 * 24 * 3600 * 1000)
  const baselineTo = yesterdayStart
  const last24hFrom = new Date(referenceDate.getTime() - 24 * 3600 * 1000)

  const [adsBaseline, recentLogs] = await Promise.all([
    getDailyTotalsInRange(baselineFrom, baselineTo),
    getGenerationLogs(),
  ])

  const flags: DailyAnomalyFlag[] = []

  // 1. Ad CPL spike
  if (opts.dailyFunnel && opts.dailyFunnel.adCplCents != null && adsBaseline.conversions > 0) {
    const baselineSpendCents = Math.round(adsBaseline.cost_micros / 10_000)
    const baselineCpl = baselineSpendCents / adsBaseline.conversions
    const todayCpl = opts.dailyFunnel.adCplCents
    if (
      todayCpl >= baselineCpl * THRESHOLDS.CPL_SPIKE_RATIO &&
      todayCpl >= THRESHOLDS.CPL_SPIKE_MIN_CENTS
    ) {
      flags.push({
        label: "Ad CPL spike",
        detail: `Yesterday $${(todayCpl / 100).toFixed(2)} CPL vs $${(baselineCpl / 100).toFixed(2)} 7-day average`,
      })
    }
  }

  // 2. AI generation failures (last 24h)
  const recentFailures = recentLogs.filter((l) => {
    if (l.status !== "failed") return false
    const ts = new Date(l.created_at).getTime()
    return ts >= last24hFrom.getTime()
  })
  if (recentFailures.length >= THRESHOLDS.GENERATION_FAILURE_MIN) {
    flags.push({
      label: "AI generation failures",
      detail: `${recentFailures.length} failed generations in the last 24 hours`,
    })
  }

  if (flags.length === 0) return null
  return { flags }
}
