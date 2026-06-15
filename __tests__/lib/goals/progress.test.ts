import { describe, it, expect } from "vitest"
import {
  goalProgressPct,
  currentGoalValue,
  latestTestValueByType,
} from "@/lib/goals/progress"
import type { AthleteGoal } from "@/types/database"

function goal(overrides: Partial<AthleteGoal>): AthleteGoal {
  return {
    id: "g",
    client_user_id: "u",
    metric_kind: "test",
    test_type: "drop_jump",
    target_value: 50,
    target_unit: "cm",
    direction: "higher",
    start_value: 40,
    deadline: null,
    status: "active",
    achieved_at: null,
    notes: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  }
}

describe("goalProgressPct", () => {
  it("is 100 when achieved", () => {
    expect(goalProgressPct(goal({ status: "achieved" }), null)).toBe(100)
  })

  it("is null when current value unknown", () => {
    expect(goalProgressPct(goal({}), null)).toBeNull()
  })

  it("is null when start value unknown", () => {
    expect(goalProgressPct(goal({ start_value: null }), 45)).toBeNull()
  })

  it("computes partial progress for a higher goal (40->50, now 45 = 50%)", () => {
    expect(goalProgressPct(goal({}), 45)).toBe(50)
  })

  it("computes partial progress for a lower goal (2.2->2.0s, now 2.1 = 50%)", () => {
    const g = goal({ direction: "lower", start_value: 2.2, target_value: 2.0, test_type: "sprint_10m" })
    expect(goalProgressPct(g, 2.1)).toBeCloseTo(50)
  })

  it("clamps above target to 100", () => {
    expect(goalProgressPct(goal({}), 60)).toBe(100)
  })

  it("clamps regression below start to 0", () => {
    expect(goalProgressPct(goal({}), 30)).toBe(0)
  })

  it("is 100 when span is zero (target equals start)", () => {
    expect(goalProgressPct(goal({ start_value: 50, target_value: 50 }), 50)).toBe(100)
  })
})

describe("currentGoalValue", () => {
  const ctx = {
    latestTestValueByType: { drop_jump: 47, sprint_10m: 1.9 },
    latestReadiness: 7,
    currentWeekLoad: 1800,
  }

  it("resolves a test goal from the latest value of its type", () => {
    expect(currentGoalValue(goal({ test_type: "drop_jump" }), ctx)).toBe(47)
  })

  it("returns null for a test goal with no recorded test of that type", () => {
    expect(currentGoalValue(goal({ test_type: "broad_jump" }), ctx)).toBeNull()
  })

  it("resolves a readiness goal", () => {
    expect(currentGoalValue(goal({ metric_kind: "readiness", test_type: null }), ctx)).toBe(7)
  })

  it("resolves a weekly_load goal", () => {
    expect(currentGoalValue(goal({ metric_kind: "weekly_load", test_type: null }), ctx)).toBe(1800)
  })
})

describe("latestTestValueByType", () => {
  it("picks the most recent value per type regardless of input order", () => {
    const map = latestTestValueByType([
      { test_type: "drop_jump", result_value: 40, test_date: "2026-01-01" },
      { test_type: "drop_jump", result_value: 46, test_date: "2026-03-01" },
      { test_type: "drop_jump", result_value: 43, test_date: "2026-02-01" },
      { test_type: "sprint_10m", result_value: 2.0, test_date: "2026-01-15" },
    ])
    expect(map).toEqual({ drop_jump: 46, sprint_10m: 2.0 })
  })

  it("returns an empty map for no tests", () => {
    expect(latestTestValueByType([])).toEqual({})
  })
})
