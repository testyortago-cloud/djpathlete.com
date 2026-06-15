import type { AthleteGoal } from "@/types/database"

/**
 * Progress toward a goal as a 0-100 percentage, or `null` when it can't be known.
 *
 * Needs the athlete's *current* measured value for the goal's metric — a goal row
 * alone (start + target) is not enough. Returns:
 *  - 100 when the goal is already achieved
 *  - null when the current value or start value is unknown (caller should hide the bar)
 *  - clamped 0..100 otherwise. Works for both "higher" and "lower" goals because the
 *    span (target - start) and (current - start) share sign as the athlete improves.
 */
export function goalProgressPct(goal: AthleteGoal, currentValue: number | null): number | null {
  if (goal.status === "achieved") return 100
  if (currentValue === null || goal.start_value === null) return null
  const span = goal.target_value - goal.start_value
  if (span === 0) return 100
  const pct = ((currentValue - goal.start_value) / span) * 100
  return Math.max(0, Math.min(100, pct))
}

export interface GoalMetricContext {
  /** Latest performance-test result_value keyed by test_type. */
  latestTestValueByType: Record<string, number>
  /** Latest daily-readiness score, if any. */
  latestReadiness: number | null
  /** Current-week total training load, if computable. */
  currentWeekLoad: number | null
}

/** Resolve the athlete's current measured value for a goal from already-loaded data. */
export function currentGoalValue(goal: AthleteGoal, ctx: GoalMetricContext): number | null {
  if (goal.metric_kind === "test") {
    if (!goal.test_type) return null
    return ctx.latestTestValueByType[goal.test_type] ?? null
  }
  if (goal.metric_kind === "readiness") return ctx.latestReadiness
  if (goal.metric_kind === "weekly_load") return ctx.currentWeekLoad
  return null
}

/** Build a test_type -> latest result_value map (picks the most recent test_date per type). */
export function latestTestValueByType(
  tests: { test_type: string; result_value: number; test_date: string }[],
): Record<string, number> {
  const latest: Record<string, { date: string; value: number }> = {}
  for (const t of tests) {
    const cur = latest[t.test_type]
    if (!cur || t.test_date > cur.date) {
      latest[t.test_type] = { date: t.test_date, value: t.result_value }
    }
  }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(latest)) out[k] = v.value
  return out
}
