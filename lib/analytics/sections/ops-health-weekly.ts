// lib/analytics/sections/ops-health-weekly.ts
import { getGenerationLogs } from "@/lib/db/ai-generation-log"
import { listRecentVoiceDriftFlags } from "@/lib/db/voice-drift-flags"
import type { DateRange, WeeklyOpsHealthPayload } from "@/types/coach-emails"

const THRESHOLDS = {
  GEN_FAILURE_RATE_PCT: 5,
  GEN_FAILURE_MIN_ABS: 2,
} as const

interface Options { range: DateRange }

export async function buildWeeklyOpsHealth(opts: Options): Promise<WeeklyOpsHealthPayload | null> {
  const { range } = opts
  const [allLogs, voiceFlags] = await Promise.all([
    getGenerationLogs({ since: range.from }),
    listRecentVoiceDriftFlags({ since: range.from }),
  ])

  const inRange = allLogs.filter((l) => {
    const ts = new Date(l.created_at).getTime()
    return ts >= range.from.getTime() && ts < range.to.getTime()
  })
  const failed = inRange.filter((l) => l.status === "failed").length
  const ratePct = inRange.length > 0 ? Math.round((failed / inRange.length) * 100) : 0

  const generationFailureRatePct =
    failed >= THRESHOLDS.GEN_FAILURE_MIN_ABS && ratePct >= THRESHOLDS.GEN_FAILURE_RATE_PCT
      ? ratePct : null

  const voiceDriftFlagCount = voiceFlags.length

  // AI token spend + cron-skip count are noise-free placeholders for now —
  // expand once token logging is centralised. Surface only the existing two.
  if (generationFailureRatePct === null && voiceDriftFlagCount === 0) return null

  return {
    aiTokenSpendUsd: null,
    generationFailureRatePct,
    voiceDriftFlagCount,
    cronSkipCount: 0,
  }
}
