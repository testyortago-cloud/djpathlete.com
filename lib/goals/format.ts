import { GOAL_METRIC_KIND_LABELS } from "@/lib/validators/athlete-goal"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { AthleteGoal, TestType } from "@/types/database"

/** Human label for a goal: the test name for test goals, else the metric-kind label. */
export function goalLabel(g: AthleteGoal): string {
  if (g.metric_kind === "test" && g.test_type) {
    return TEST_TYPE_LABELS[g.test_type as TestType] ?? g.test_type
  }
  return GOAL_METRIC_KIND_LABELS[g.metric_kind]
}
