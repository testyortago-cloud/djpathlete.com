// lib/analytics/sections/coaching-daily.ts
import { listFormReviewsByStatus } from "@/lib/db/form-reviews"
import { listClientsWithoutLogSince, getAllProgress } from "@/lib/db/progress"
import { listRecentVoiceDriftFlags } from "@/lib/db/voice-drift-flags"
import type { DailyCoachingPayload } from "@/types/coach-emails"

interface Options {
  referenceDate: Date
}

const AT_RISK_THRESHOLD_DAYS = 3
const LOW_RPE_THRESHOLD = 4

export async function buildDailyCoaching(opts: Options): Promise<DailyCoachingPayload | null> {
  const yesterday = new Date(opts.referenceDate.getTime() - 24 * 60 * 60 * 1000)
  const atRiskCutoff = new Date(opts.referenceDate.getTime() - AT_RISK_THRESHOLD_DAYS * 24 * 60 * 60 * 1000)

  const [pendingReviews, silentClients, recentLogs, voiceFlags] = await Promise.all([
    listFormReviewsByStatus("pending"),
    listClientsWithoutLogSince(atRiskCutoff),
    getAllProgress(500),
    listRecentVoiceDriftFlags({ since: yesterday }),
  ])

  const formReviewsAwaiting = pendingReviews.length === 0
    ? null
    : (() => {
        // Find the oldest created_at across all pending reviews
        const oldestMs = Math.min(
          ...pendingReviews.map((r) => (r.created_at ? new Date(r.created_at).getTime() : Infinity)),
        )
        const oldestAgeHours = isFinite(oldestMs)
          ? Math.floor((opts.referenceDate.getTime() - oldestMs) / (3600 * 1000))
          : 0
        return { count: pendingReviews.length, oldestAgeHours }
      })()

  const atRiskClients = silentClients.slice(0, 5).map((c) => ({
    name: [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "Unnamed client",
    daysSinceLastLog: c.days_since_last_log,
  }))

  const yesterdayMs = yesterday.getTime()
  const lowRpeLogFlags = recentLogs.filter((p) => {
    const completedMs = p.completed_at ? new Date(p.completed_at).getTime() : 0
    if (completedMs < yesterdayMs) return false
    const rpe = (p as unknown as { rpe?: number | null }).rpe ?? null
    return rpe == null || rpe < LOW_RPE_THRESHOLD
  }).length

  const voiceDriftFlags = voiceFlags.length

  if (
    formReviewsAwaiting === null &&
    atRiskClients.length === 0 &&
    lowRpeLogFlags === 0 &&
    voiceDriftFlags === 0
  ) {
    return null
  }
  return { formReviewsAwaiting, atRiskClients, lowRpeLogFlags, voiceDriftFlags }
}
