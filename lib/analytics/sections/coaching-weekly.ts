// lib/analytics/sections/coaching-weekly.ts
import {
  countSessionsInRange,
  countActiveClientsInRange,
  listClientsWithoutLogSince,
} from "@/lib/db/progress"
import { getDeliveredFormReviewStats } from "@/lib/db/form-reviews"
import { getProgramCompletionRate } from "@/lib/db/programs"
import type { DateRange, WeeklyCoachingPayload } from "@/types/coach-emails"

interface Options {
  range: DateRange
  previousRange: DateRange
}

const SILENT_THRESHOLD_DAYS = 14

export async function buildWeeklyCoaching(opts: Options): Promise<WeeklyCoachingPayload | null> {
  const { range, previousRange } = opts
  const silentCutoff = new Date(range.to.getTime() - SILENT_THRESHOLD_DAYS * 24 * 3600 * 1000)

  const [
    activeCurrent,
    activePrev,
    sessionsCurrent,
    sessionsPrev,
    completionCurrent,
    completionPrev,
    fmtCurrent,
    fmtPrev,
    silent,
  ] = await Promise.all([
    countActiveClientsInRange(range.from, range.to),
    countActiveClientsInRange(previousRange.from, previousRange.to),
    countSessionsInRange(range.from, range.to),
    countSessionsInRange(previousRange.from, previousRange.to),
    getProgramCompletionRate(range.from, range.to),
    getProgramCompletionRate(previousRange.from, previousRange.to),
    getDeliveredFormReviewStats(range.from, range.to),
    getDeliveredFormReviewStats(previousRange.from, previousRange.to),
    listClientsWithoutLogSince(silentCutoff),
  ])

  if (activeCurrent === 0 && activePrev === 0) return null

  return {
    activeClients: { current: activeCurrent, previous: activePrev },
    sessionsCompleted: { current: sessionsCurrent, previous: sessionsPrev },
    programCompletionRatePct: { current: completionCurrent, previous: completionPrev },
    formReviewsDelivered: { current: fmtCurrent.count, previous: fmtPrev.count },
    avgFormReviewResponseHours: {
      current: fmtCurrent.avgResponseHours,
      previous: fmtPrev.avgResponseHours,
    },
    silentClients: silent.length,
  }
}
