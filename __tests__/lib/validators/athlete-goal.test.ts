import { describe, it, expect } from "vitest"
import { athleteGoalFormSchema } from "@/lib/validators/athlete-goal"

const valid = {
  metric_kind: "test" as const,
  test_type: "drop_jump" as const,
  target_value: 40,
  target_unit: "cm",
  direction: "higher" as const,
  start_value: 35,
  deadline: "2026-08-01",
  notes: null,
}

describe("athleteGoalFormSchema", () => {
  it("accepts a valid test goal", () => {
    expect(athleteGoalFormSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects metric_kind='test' without test_type", () => {
    expect(
      athleteGoalFormSchema.safeParse({ ...valid, test_type: null }).success,
    ).toBe(false)
  })

  it("rejects direction='lower' for non-test metric", () => {
    expect(
      athleteGoalFormSchema.safeParse({
        ...valid,
        metric_kind: "readiness",
        test_type: null,
        direction: "lower",
      }).success,
    ).toBe(false)
  })

  it("accepts readiness goal with higher direction", () => {
    expect(
      athleteGoalFormSchema.safeParse({
        ...valid,
        metric_kind: "readiness",
        test_type: null,
        direction: "higher",
        target_unit: "score",
      }).success,
    ).toBe(true)
  })
})
