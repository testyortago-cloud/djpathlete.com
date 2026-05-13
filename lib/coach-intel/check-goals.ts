import { getActive, markAchieved } from "@/lib/db/athlete-goals"
import type { AthleteGoal, TestType } from "@/types/database"

export interface GoalContext {
  testType?: TestType
  testValue?: number
  readinessScore?: number
  weeklyLoad?: number
}

function isSatisfied(goal: AthleteGoal, ctx: GoalContext): boolean {
  if (goal.metric_kind === "test") {
    if (!ctx.testType || ctx.testValue === undefined) return false
    if (goal.test_type !== ctx.testType) return false
    return goal.direction === "higher" ? ctx.testValue >= goal.target_value : ctx.testValue <= goal.target_value
  }
  if (goal.metric_kind === "readiness") {
    if (ctx.readinessScore === undefined) return false
    return ctx.readinessScore >= goal.target_value
  }
  if (goal.metric_kind === "weekly_load") {
    if (ctx.weeklyLoad === undefined) return false
    return ctx.weeklyLoad >= goal.target_value
  }
  return false
}

export async function checkGoals(
  clientUserId: string,
  ctx: GoalContext,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<AthleteGoal[]> {
  const active = await getActive(clientUserId)
  const achieved: AthleteGoal[] = []
  for (const g of active) {
    if (isSatisfied(g, ctx)) {
      const updated = await markAchieved(g.id, today)
      achieved.push(updated)
    }
  }
  return achieved
}
