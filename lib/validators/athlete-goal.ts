import { z } from "zod"
import { TEST_TYPES } from "./performance-test"

export const GOAL_METRIC_KINDS = ["test", "readiness", "weekly_load"] as const
export const GOAL_DIRECTIONS = ["higher", "lower"] as const
export const GOAL_STATUSES = ["active", "achieved", "missed", "archived"] as const

export const GOAL_METRIC_KIND_LABELS: Record<(typeof GOAL_METRIC_KINDS)[number], string> = {
  test: "Performance test",
  readiness: "Daily readiness score",
  weekly_load: "Weekly training load",
}

export const athleteGoalFormSchema = z
  .object({
    metric_kind: z.enum(GOAL_METRIC_KINDS),
    test_type: z.enum(TEST_TYPES).nullable(),
    target_value: z.number(),
    target_unit: z.string().min(1).max(20),
    direction: z.enum(GOAL_DIRECTIONS),
    start_value: z.number().nullable(),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    notes: z.string().max(1000).nullable(),
  })
  .refine((d) => !(d.metric_kind === "test" && !d.test_type), {
    message: "test_type required when metric_kind='test'",
    path: ["test_type"],
  })
  .refine((d) => !(d.direction === "lower" && d.metric_kind !== "test"), {
    message: "lower direction is only valid for test metric_kind",
    path: ["direction"],
  })

export type AthleteGoalFormData = z.infer<typeof athleteGoalFormSchema>
