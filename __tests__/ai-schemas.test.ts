// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  exerciseAssignmentSchema,
  profileAnalysisSchema,
  programSkeletonSchema,
  validationResultSchema,
} from "@/lib/ai/schemas"

describe("exerciseAssignmentSchema", () => {
  const validAssignment = {
    assignments: [
      {
        slot_id: "w1d1s1",
        exercise_id: "550e8400-e29b-41d4-a716-446655440000",
        exercise_name: "Barbell Back Squat",
        notes: null,
      },
    ],
    substitution_notes: [],
  }

  it("accepts standard UUID v4 exercise IDs", () => {
    const result = exerciseAssignmentSchema.safeParse(validAssignment)
    expect(result.success).toBe(true)
  })

  it("accepts seed-style UUIDs (non-RFC-4122 version bits)", () => {
    const seedAssignment = {
      assignments: [
        {
          slot_id: "w1d1s1",
          exercise_id: "10000000-0000-0000-0000-000000000018",
          exercise_name: "Cone Drill - 5-10-5",
          notes: null,
        },
        {
          slot_id: "w1d1s2",
          exercise_id: "10000000-0000-0000-0000-000000000001",
          exercise_name: "Barbell Back Squat",
          notes: null,
        },
      ],
      substitution_notes: ["Substituted for client preference"],
    }
    const result = exerciseAssignmentSchema.safeParse(seedAssignment)
    expect(result.success).toBe(true)
  })

  it("rejects non-UUID strings", () => {
    const bad = {
      assignments: [
        {
          slot_id: "w1d1s1",
          exercise_id: "not-a-uuid",
          exercise_name: "Test",
          notes: null,
        },
      ],
      substitution_notes: [],
    }
    const result = exerciseAssignmentSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("rejects empty exercise_id", () => {
    const bad = {
      assignments: [
        {
          slot_id: "w1d1s1",
          exercise_id: "",
          exercise_name: "Test",
          notes: null,
        },
      ],
      substitution_notes: [],
    }
    const result = exerciseAssignmentSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("rejects UUID with wrong length", () => {
    const bad = {
      assignments: [
        {
          slot_id: "w1d1s1",
          exercise_id: "550e8400-e29b-41d4-a716-44665544",
          exercise_name: "Test",
          notes: null,
        },
      ],
      substitution_notes: [],
    }
    const result = exerciseAssignmentSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("requires at least one assignment", () => {
    const bad = { assignments: [], substitution_notes: [] }
    const result = exerciseAssignmentSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("accepts notes as string or null", () => {
    const withNotes = {
      assignments: [
        {
          slot_id: "w1d1s1",
          exercise_id: "10000000-0000-0000-0000-000000000001",
          exercise_name: "Squat",
          notes: "Go slow on eccentric",
        },
      ],
      substitution_notes: [],
    }
    const result = exerciseAssignmentSchema.safeParse(withNotes)
    expect(result.success).toBe(true)
  })
})

describe("profileAnalysisSchema", () => {
  const validAnalysis = {
    recommended_split: "upper_lower",
    recommended_periodization: "linear",
    volume_targets: [{ muscle_group: "quads", sets_per_week: 16, priority: "high" }],
    exercise_constraints: [],
    session_structure: {
      warm_up_minutes: 5,
      main_work_minutes: 45,
      cool_down_minutes: 5,
      total_exercises: 6,
      compound_count: 3,
      isolation_count: 3,
    },
    training_age_category: "intermediate",
    notes: "Focus on progressive overload",
  }

  it("accepts valid profile analysis", () => {
    const result = profileAnalysisSchema.safeParse(validAnalysis)
    expect(result.success).toBe(true)
  })

  it("accepts exercise constraints", () => {
    const withConstraints = {
      ...validAnalysis,
      exercise_constraints: [
        {
          type: "avoid_movement",
          value: "overhead_press",
          reason: "Shoulder impingement",
        },
      ],
    }
    const result = profileAnalysisSchema.safeParse(withConstraints)
    expect(result.success).toBe(true)
  })
})

describe("validationResultSchema", () => {
  it("accepts passing validation", () => {
    const result = validationResultSchema.safeParse({
      pass: true,
      issues: [],
      summary: "All checks passed",
    })
    expect(result.success).toBe(true)
  })

  it("accepts failing validation with issues", () => {
    const result = validationResultSchema.safeParse({
      pass: false,
      issues: [
        {
          type: "error",
          category: "exercise_selection",
          message: "Exercise not found in library",
          slot_ref: "w1d1s1",
        },
        {
          type: "warning",
          category: "volume",
          message: "Low chest volume",
        },
      ],
      summary: "2 issues found",
    })
    expect(result.success).toBe(true)
  })
})
