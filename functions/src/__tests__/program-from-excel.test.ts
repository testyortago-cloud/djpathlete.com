import { describe, it, expect } from "vitest"
import { buildProgramFromPlan } from "../program-from-excel.js"

const plan = {
  program: {
    name: "Imported Block",
    duration_weeks: 2,
    sessions_per_week: 2,
    difficulty: "intermediate",
    category: ["strength"],
    tier: "premium",
    split_type: null,
    periodization: null,
  },
  days: [
    {
      week_number: 1,
      day_of_week: 1,
      exercises: [
        { raw_name: "Back Squat", order_index: 0, sets: 4, reps: "6-8" },
        { raw_name: "Mystery Lift", order_index: 1 },
      ],
    },
  ],
  gaps_filled: ["assumed 2 weeks"],
  assumptions: [],
}

const resolved = new Map([
  [
    "back squat",
    {
      raw_name: "Back Squat",
      exercise_id: "ex-squat",
      exercise_name: "Barbell Back Squat",
      method: "semantic" as const,
      confidence: 0.8,
      created: false,
    },
  ],
  [
    "mystery lift",
    {
      raw_name: "Mystery Lift",
      exercise_id: "new-1",
      exercise_name: "Mystery Lift",
      method: "created" as const,
      confidence: 0,
      created: true,
    },
  ],
])

describe("buildProgramFromPlan", () => {
  it("builds program row, exercise rows with defaults, and a report", () => {
    const { programRow, exerciseRows, report } = buildProgramFromPlan(plan as never, resolved, {
      client_id: null,
      is_public: false,
      name_override: null,
      notify_email: null,
      requestedBy: "admin-1",
      fileName: "p.xlsx",
    })
    expect(programRow.name).toBe("Imported Block")
    expect(programRow.is_ai_generated).toBe(true)
    expect(programRow.is_public).toBe(false)
    expect((programRow.ai_generation_params as { source: string }).source).toBe("excel_import")
    expect(exerciseRows).toHaveLength(2)
    const mystery = exerciseRows.find((r) => r.exercise_id === "new-1")!
    expect(mystery.sets).toBe(3)
    expect(mystery.reps).toBe("8-12")
    expect(mystery.technique).toBe("straight_set")
    expect(mystery.week_number).toBe(1)
    expect(mystery.day_of_week).toBe(1)
    expect(report.created).toHaveLength(1)
    expect(report.matched).toHaveLength(1)
    expect(report.counts.exercises).toBe(2)
  })
  it("uses name_override when provided", () => {
    const { programRow } = buildProgramFromPlan(plan as never, resolved, {
      client_id: null,
      is_public: false,
      name_override: "Custom Name",
      notify_email: null,
      requestedBy: "a",
      fileName: "p.xlsx",
    })
    expect(programRow.name).toBe("Custom Name")
  })
})
