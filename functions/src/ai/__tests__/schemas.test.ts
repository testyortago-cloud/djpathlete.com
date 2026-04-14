import { describe, it, expect } from "vitest"
import {
  profileAnalysisSchema,
  validateSkeletonAgainstAnalysis,
  validateAssignmentAgainstCeiling,
} from "../schemas.js"

const validAnalysisBase = {
  recommended_split: "full_body" as const,
  recommended_periodization: "linear" as const,
  volume_targets: [{ muscle_group: "quads", sets_per_week: 10, priority: "high" as const }],
  exercise_constraints: [],
  session_structure: {
    warm_up_minutes: 5, main_work_minutes: 45, cool_down_minutes: 5,
    total_exercises: 5, compound_count: 2, isolation_count: 3,
  },
  training_age_category: "novice" as const,
  notes: "",
}

describe("profileAnalysisSchema — technique_plan and difficulty_ceiling", () => {
  it("accepts a valid analysis with technique_plan per week", () => {
    const input = {
      ...validAnalysisBase,
      technique_plan: [
        { week_number: 1, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "motor learning" },
        { week_number: 2, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      ],
      difficulty_ceiling: [
        { week_number: 1, max_tier: "beginner", max_score: 4 },
        { week_number: 2, max_tier: "beginner", max_score: 4 },
      ],
    }
    const result = profileAnalysisSchema.parse(input)
    expect(result.technique_plan).toHaveLength(2)
    expect(result.difficulty_ceiling[0].max_tier).toBe("beginner")
  })

  it("rejects technique_plan with unknown technique", () => {
    const input = {
      ...validAnalysisBase,
      technique_plan: [{ week_number: 1, allowed_techniques: ["fake_technique"], default_technique: "fake_technique", notes: "" }],
      difficulty_ceiling: [{ week_number: 1, max_tier: "beginner", max_score: 4 }],
    }
    expect(() => profileAnalysisSchema.parse(input)).toThrow()
  })

  it("rejects difficulty_ceiling with unknown tier", () => {
    const input = {
      ...validAnalysisBase,
      technique_plan: [{ week_number: 1, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" }],
      difficulty_ceiling: [{ week_number: 1, max_tier: "godlike", max_score: 10 }],
    }
    expect(() => profileAnalysisSchema.parse(input)).toThrow()
  })
})

describe("validateSkeletonAgainstAnalysis — technique constraint enforcement", () => {
  const analysis = profileAnalysisSchema.parse({
    ...validAnalysisBase,
    technique_plan: [
      { week_number: 1, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      { week_number: 2, allowed_techniques: ["straight_set", "superset"], default_technique: "straight_set", notes: "" },
    ],
    difficulty_ceiling: [
      { week_number: 1, max_tier: "beginner", max_score: 4 },
      { week_number: 2, max_tier: "beginner", max_score: 4 },
    ],
  })

  const baseSlot = {
    slot_id: "s1", role: "primary_compound" as const, movement_pattern: "squat" as const,
    target_muscles: ["quads"], sets: 3, reps: "8-10", rest_seconds: 120,
    rpe_target: null, tempo: null, group_tag: null, intensity_pct: null,
  }

  it("passes when every slot technique is in that week's allowed_techniques", () => {
    const skeleton = {
      weeks: [
        { week_number: 1, phase: "A", intensity_modifier: "moderate",
          days: [{ day_of_week: 1, label: "Mon", focus: "legs",
            slots: [{ ...baseSlot, technique: "straight_set" as const }] }] },
        { week_number: 2, phase: "A", intensity_modifier: "moderate",
          days: [{ day_of_week: 1, label: "Mon", focus: "legs",
            slots: [{ ...baseSlot, technique: "superset" as const }] }] },
      ],
      split_type: "full_body" as const,
      periodization: "linear" as const,
      total_sessions: 2,
      notes: "",
    }
    const result = validateSkeletonAgainstAnalysis(skeleton, analysis)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it("fails when a slot uses a technique NOT in that week's allowed_techniques", () => {
    const skeleton = {
      weeks: [
        { week_number: 1, phase: "A", intensity_modifier: "moderate",
          days: [{ day_of_week: 1, label: "Mon", focus: "legs",
            slots: [{ ...baseSlot, technique: "superset" as const }] }] },
      ],
      split_type: "full_body" as const,
      periodization: "linear" as const,
      total_sessions: 1,
      notes: "",
    }
    const result = validateSkeletonAgainstAnalysis(skeleton, analysis)
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatch(/week 1.*superset.*not allowed/i)
  })
})

describe("validateAssignmentAgainstCeiling — difficulty ceiling enforcement", () => {
  const ceiling = [
    { week_number: 1, max_tier: "beginner" as const, max_score: 4 },
    { week_number: 2, max_tier: "beginner" as const, max_score: 4 },
    { week_number: 3, max_tier: "intermediate" as const, max_score: 4 },
  ]

  const exerciseLibrary = [
    { id: "b-easy", difficulty: "beginner", difficulty_score: 2 },
    { id: "i-easy", difficulty: "intermediate", difficulty_score: 3 },
    { id: "i-hard", difficulty: "intermediate", difficulty_score: 7 },
    { id: "a-hard", difficulty: "advanced", difficulty_score: 8 },
  ]

  const slotInWeek = new Map([["s1", 1], ["s2", 2], ["s3", 3]])

  it("passes when all week 1 assignments are beginner exercises", () => {
    const assignment = { assignments: [{ slot_id: "s1", exercise_id: "b-easy", exercise_name: "b-easy", notes: null }], substitution_notes: [] }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(true)
  })

  it("fails when a week 1 slot is assigned an intermediate exercise", () => {
    const assignment = { assignments: [{ slot_id: "s1", exercise_id: "i-easy", exercise_name: "i-easy", notes: null }], substitution_notes: [] }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatch(/week 1.*ceiling.*beginner/i)
  })

  it("passes when week 3 (intermediate ceiling) uses a low-score intermediate", () => {
    const assignment = { assignments: [{ slot_id: "s3", exercise_id: "i-easy", exercise_name: "i-easy", notes: null }], substitution_notes: [] }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(true)
  })

  it("fails when week 3 uses a high-score intermediate exceeding max_score", () => {
    const assignment = { assignments: [{ slot_id: "s3", exercise_id: "i-hard", exercise_name: "i-hard", notes: null }], substitution_notes: [] }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatch(/score.*7.*exceeds/i)
  })
})
