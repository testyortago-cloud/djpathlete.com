import { describe, it, expect } from "vitest"
import {
  profileAnalysisSchema,
  validateSkeletonAgainstAnalysis,
  repairSkeletonTechniques,
  validateAssignmentAgainstCeiling,
  exerciseAssignmentSchema,
} from "../schemas.js"

const validAnalysisBase = {
  recommended_split: "full_body" as const,
  recommended_periodization: "linear" as const,
  volume_targets: [{ muscle_group: "quads", sets_per_week: 10, priority: "high" as const }],
  exercise_constraints: [],
  session_structure: {
    warm_up_minutes: 5,
    main_work_minutes: 45,
    cool_down_minutes: 5,
    total_exercises: 5,
    compound_count: 2,
    isolation_count: 3,
  },
  training_age_category: "novice" as const,
  notes: "",
}

describe("profileAnalysisSchema — technique_plan and difficulty_ceiling", () => {
  it("accepts a valid analysis with technique_plan per week", () => {
    const input = {
      ...validAnalysisBase,
      technique_plan: [
        {
          week_number: 1,
          allowed_techniques: ["straight_set"],
          default_technique: "straight_set",
          notes: "motor learning",
        },
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
      technique_plan: [
        { week_number: 1, allowed_techniques: ["fake_technique"], default_technique: "fake_technique", notes: "" },
      ],
      difficulty_ceiling: [{ week_number: 1, max_tier: "beginner", max_score: 4 }],
    }
    expect(() => profileAnalysisSchema.parse(input)).toThrow()
  })

  it("rejects difficulty_ceiling with unknown tier", () => {
    const input = {
      ...validAnalysisBase,
      technique_plan: [
        { week_number: 1, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      ],
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
      {
        week_number: 2,
        allowed_techniques: ["straight_set", "superset"],
        default_technique: "straight_set",
        notes: "",
      },
    ],
    difficulty_ceiling: [
      { week_number: 1, max_tier: "beginner", max_score: 4 },
      { week_number: 2, max_tier: "beginner", max_score: 4 },
    ],
  })

  const baseSlot = {
    slot_id: "s1",
    role: "primary_compound" as const,
    movement_pattern: "squat" as const,
    target_muscles: ["quads"],
    sets: 3,
    reps: "8-10",
    rest_seconds: 120,
    rpe_target: null,
    tempo: null,
    group_tag: null,
    intensity_pct: null,
  }

  it("passes when every slot technique is in that week's allowed_techniques", () => {
    const skeleton = {
      weeks: [
        {
          week_number: 1,
          phase: "A",
          intensity_modifier: "moderate",
          days: [
            {
              day_of_week: 1,
              label: "Mon",
              focus: "legs",
              slots: [{ ...baseSlot, technique: "straight_set" as const }],
            },
          ],
        },
        {
          week_number: 2,
          phase: "A",
          intensity_modifier: "moderate",
          days: [
            { day_of_week: 1, label: "Mon", focus: "legs", slots: [{ ...baseSlot, technique: "superset" as const }] },
          ],
        },
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
        {
          week_number: 1,
          phase: "A",
          intensity_modifier: "moderate",
          days: [
            { day_of_week: 1, label: "Mon", focus: "legs", slots: [{ ...baseSlot, technique: "superset" as const }] },
          ],
        },
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

  const slotInWeek = new Map([
    ["s1", 1],
    ["s2", 2],
    ["s3", 3],
  ])

  it("passes when all week 1 assignments are beginner exercises", () => {
    const assignment = {
      assignments: [{ slot_id: "s1", exercise_id: "b-easy", exercise_name: "b-easy", notes: null }],
      substitution_notes: [],
    }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(true)
  })

  it("fails when a week 1 slot is assigned an intermediate exercise", () => {
    const assignment = {
      assignments: [{ slot_id: "s1", exercise_id: "i-easy", exercise_name: "i-easy", notes: null }],
      substitution_notes: [],
    }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatch(/week 1.*ceiling.*beginner/i)
  })

  it("passes when week 3 (intermediate ceiling) uses a low-score intermediate", () => {
    const assignment = {
      assignments: [{ slot_id: "s3", exercise_id: "i-easy", exercise_name: "i-easy", notes: null }],
      substitution_notes: [],
    }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(true)
  })

  it("fails when week 3 uses a high-score intermediate exceeding max_score", () => {
    const assignment = {
      assignments: [{ slot_id: "s3", exercise_id: "i-hard", exercise_name: "i-hard", notes: null }],
      substitution_notes: [],
    }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatch(/score.*7.*exceeds/i)
  })

  // Without this exemption, unlocking a coach-named lift through the input
  // filters just moves the rejection to the validator: the selector picks it,
  // the ceiling flags it, all retries produce the same output, generation fails.
  it("exempts a coach-unlocked exercise from the tier ceiling", () => {
    const assignment = {
      assignments: [{ slot_id: "s1", exercise_id: "i-easy", exercise_name: "i-easy", notes: null }],
      substitution_notes: [],
    }
    expect(validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary).ok).toBe(false)
    expect(
      validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary, new Set(["i-easy"])).ok,
    ).toBe(true)
  })

  it("exempts a coach-unlocked exercise from the max_score ceiling too", () => {
    const assignment = {
      assignments: [{ slot_id: "s3", exercise_id: "i-hard", exercise_name: "i-hard", notes: null }],
      substitution_notes: [],
    }
    expect(
      validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary, new Set(["i-hard"])).ok,
    ).toBe(true)
  })

  it("still flags a non-unlocked exercise when other exercises are unlocked", () => {
    const assignment = {
      assignments: [{ slot_id: "s1", exercise_id: "i-easy", exercise_name: "i-easy", notes: null }],
      substitution_notes: [],
    }
    expect(
      validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary, new Set(["something-else"]))
        .ok,
    ).toBe(false)
  })
})

describe("exerciseAssignmentSchema fit and per_side", () => {
  it("defaults the new fields so an older-shaped answer still parses", () => {
    const parsed = exerciseAssignmentSchema.parse({
      assignments: [{ slot_id: "w1d1s1", exercise_id: "e", exercise_name: "Squat", notes: null }],
      substitution_notes: [],
    })
    expect(parsed.assignments[0]).toMatchObject({ per_side: false, fit: "close", fit_reason: null })
  })
  it("keeps what the model sent", () => {
    const parsed = exerciseAssignmentSchema.parse({
      assignments: [
        {
          slot_id: "s",
          exercise_id: "e",
          exercise_name: "n",
          notes: null,
          per_side: true,
          fit: "poor",
          fit_reason: "no squat left",
        },
      ],
      substitution_notes: [],
    })
    expect(parsed.assignments[0]).toMatchObject({ per_side: true, fit: "poor", fit_reason: "no squat left" })
  })
  it("rejects an unknown fit label", () => {
    expect(() =>
      exerciseAssignmentSchema.parse({
        assignments: [{ slot_id: "s", exercise_id: "e", exercise_name: "n", notes: null, fit: "great" }],
        substitution_notes: [],
      }),
    ).toThrow()
  })
})

describe("repairSkeletonTechniques", () => {
  const plan = [
    { week_number: 1, allowed_techniques: ["straight_set", "superset"], default_technique: "straight_set", notes: "" },
  ] as const
  function sk(technique: string) {
    return {
      weeks: [
        {
          week_number: 1,
          phase: "p",
          intensity_modifier: "m",
          days: [{ day_of_week: 1, label: "L", focus: "f", slots: [{ slot_id: "w1d1s1", technique }] }],
        },
      ],
    }
  }
  it("rewrites a disallowed technique to the week's default and reports it", () => {
    const s = sk("dropset")
    expect(repairSkeletonTechniques(s as never, [...plan] as never)).toEqual([
      { slot_id: "w1d1s1", from: "dropset", to: "straight_set" },
    ])
    expect(s.weeks[0].days[0].slots[0].technique).toBe("straight_set")
  })
  it("leaves allowed techniques and weeks without a plan alone", () => {
    expect(repairSkeletonTechniques(sk("superset") as never, [...plan] as never)).toEqual([])
    expect(repairSkeletonTechniques(sk("dropset") as never, [])).toEqual([])
  })
  it("I3: keeps a technique the coach named, and still rewrites an unnamed one", () => {
    const kept = sk("cluster_set")
    expect(repairSkeletonTechniques(kept as never, [...plan] as never, "Use cluster sets on the squat")).toEqual([])
    expect(kept.weeks[0].days[0].slots[0].technique).toBe("cluster_set")
    const fixed = sk("dropset")
    expect(repairSkeletonTechniques(fixed as never, [...plan] as never, "Use cluster sets on the squat")).toEqual([
      { slot_id: "w1d1s1", from: "dropset", to: "straight_set" },
    ])
  })
  it("I3: falls back to the first allowed technique when the default is not allowed", () => {
    const badPlan = [{ week_number: 1, allowed_techniques: ["superset"], default_technique: "straight_set" }]
    const s = sk("dropset")
    expect(repairSkeletonTechniques(s as never, badPlan)).toEqual([{ slot_id: "w1d1s1", from: "dropset", to: "superset" }])
  })
  it("I3: a slot repaired to straight_set loses its group tag", () => {
    const s = sk("giant_set")
    ;(s.weeks[0].days[0].slots[0] as { group_tag?: string | null }).group_tag = "A1"
    repairSkeletonTechniques(s as never, [...plan] as never)
    expect(s.weeks[0].days[0].slots[0]).toMatchObject({ technique: "straight_set", group_tag: null })
  })
  it("I3: the validator agrees with the repair about coach-named techniques", () => {
    const named = sk("cluster_set")
    const analysis = { technique_plan: [...plan] }
    expect(validateSkeletonAgainstAnalysis(named as never, analysis as never, "cluster sets please").ok).toBe(true)
    expect(validateSkeletonAgainstAnalysis(named as never, analysis as never).ok).toBe(false)
  })
})
