import { describe, it, expect } from "vitest"
import { filterByProgressionPhase } from "../exercise-context.js"
import { applyUsagePenalty } from "../exercise-filter.js"
import { validateSkeletonAgainstAnalysis, profileAnalysisSchema } from "../schemas.js"
import type { CompressedExercise, ProgramSkeleton, ProfileAnalysis } from "../types.js"

const mkEx = (id: string, difficulty: string, score: number, pattern: string, muscles: string[]): CompressedExercise => ({
  id, name: id, difficulty, difficulty_score: score,
  movement_pattern: pattern, primary_muscles: muscles, secondary_muscles: [],
  equipment_required: [], is_bodyweight: false,
  training_intent: ["build"], sport_tags: [], joints_loaded: [],
  plane_of_motion: ["sagittal"],
} as unknown as CompressedExercise)

describe("Integration: full filter pipeline for two beginners", () => {
  const library: CompressedExercise[] = [
    mkEx("squat-bw", "beginner", 1, "squat", ["quads"]),
    mkEx("squat-goblet", "beginner", 3, "squat", ["quads"]),
    mkEx("squat-box", "beginner", 2, "squat", ["quads"]),
    mkEx("squat-wall", "beginner", 1, "squat", ["quads"]),
    mkEx("squat-barbell", "intermediate", 5, "squat", ["quads"]),
    mkEx("squat-front", "advanced", 8, "squat", ["quads"]),
    mkEx("push-dbbp", "beginner", 3, "push", ["chest"]),
    mkEx("push-db-shoulder", "beginner", 2, "push", ["shoulders"]),
    mkEx("push-bw-pushup", "beginner", 1, "push", ["chest"]),
  ]

  it("different beginner clients under the same coach get materially different exercises", () => {
    const client1Usage = new Map<string, number>()
    const client2Usage = new Map<string, number>()
    const coachUsageAfterClient1 = new Map<string, number>([
      ["squat-bw", 1], ["squat-goblet", 1], ["squat-box", 1], ["push-dbbp", 1],
    ])

    const scores1 = library.map((ex) => ({
      id: ex.id,
      score: applyUsagePenalty(50, ex.id, new Map(), client1Usage),
    }))
    const top1 = [...scores1].sort((a, b) => b.score - a.score).slice(0, 4).map((s) => s.id)

    const scores2 = library.map((ex) => ({
      id: ex.id,
      score: applyUsagePenalty(50, ex.id, coachUsageAfterClient1, client2Usage),
    }))
    const top2 = [...scores2].sort((a, b) => b.score - a.score).slice(0, 4).map((s) => s.id)

    const overlap = top1.filter((id) => top2.includes(id))
    expect(overlap.length).toBeLessThan(top1.length / 2)
  })
})

describe("Integration: progression across weeks for a beginner", () => {
  const library: CompressedExercise[] = [
    mkEx("b1", "beginner", 2, "squat", ["quads"]),
    mkEx("b2", "beginner", 3, "squat", ["quads"]),
    mkEx("i-easy", "intermediate", 4, "squat", ["quads"]),
    mkEx("i-hard", "intermediate", 7, "squat", ["quads"]),
    mkEx("a", "advanced", 8, "squat", ["quads"]),
  ]

  it("week 1: no intermediate or advanced for a beginner", () => {
    const r = filterByProgressionPhase(library, "beginner", 1)
    expect(r.map((e) => e.id).sort()).toEqual(["b1", "b2"])
  })

  it("week 3: low-score intermediate becomes eligible", () => {
    const r = filterByProgressionPhase(library, "beginner", 3)
    expect(r.map((e) => e.id).sort()).toEqual(["b1", "b2", "i-easy"])
  })

  it("never allows advanced for a beginner, any week", () => {
    for (let w = 1; w <= 12; w++) {
      const r = filterByProgressionPhase(library, "beginner", w)
      expect(r.map((e) => e.id)).not.toContain("a")
    }
  })
})

describe("Integration: technique_plan enforcement in skeleton validation", () => {
  const analysis = profileAnalysisSchema.parse({
    recommended_split: "full_body",
    recommended_periodization: "linear",
    volume_targets: [{ muscle_group: "quads", sets_per_week: 10, priority: "high" }],
    exercise_constraints: [],
    session_structure: { warm_up_minutes: 5, main_work_minutes: 45, cool_down_minutes: 5, total_exercises: 5, compound_count: 2, isolation_count: 3 },
    training_age_category: "novice",
    technique_plan: [
      { week_number: 1, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      { week_number: 2, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      { week_number: 3, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      { week_number: 4, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
    ],
    difficulty_ceiling: [
      { week_number: 1, max_tier: "beginner", max_score: 4 },
      { week_number: 2, max_tier: "beginner", max_score: 4 },
      { week_number: 3, max_tier: "beginner", max_score: 6 },
      { week_number: 4, max_tier: "beginner", max_score: 6 },
    ],
    notes: "",
  }) as ProfileAnalysis

  const baseSlot = {
    slot_id: "s1", role: "primary_compound" as const, movement_pattern: "squat" as const,
    target_muscles: ["quads"], sets: 3, reps: "8-10", rest_seconds: 120,
    rpe_target: null, tempo: null, group_tag: null, intensity_pct: null,
  }

  it("rejects a novice beginner skeleton that uses supersets anywhere", () => {
    const skeleton: ProgramSkeleton = {
      weeks: [1, 2, 3, 4].map((wk) => ({
        week_number: wk, phase: "A", intensity_modifier: "moderate",
        days: [{
          day_of_week: 1, label: "Mon", focus: "legs",
          slots: [{ ...baseSlot, slot_id: `s-${wk}`, technique: wk === 3 ? "superset" as const : "straight_set" as const }],
        }],
      })),
      split_type: "full_body", periodization: "linear", total_sessions: 4, notes: "",
    }
    const result = validateSkeletonAgainstAnalysis(skeleton, analysis)
    expect(result.ok).toBe(false)
    expect(result.violations.join(" ")).toMatch(/week 3.*superset/i)
  })

  it("passes when every week uses only straight_set", () => {
    const skeleton: ProgramSkeleton = {
      weeks: [1, 2, 3, 4].map((wk) => ({
        week_number: wk, phase: "A", intensity_modifier: "moderate",
        days: [{
          day_of_week: 1, label: "Mon", focus: "legs",
          slots: [{ ...baseSlot, slot_id: `s-${wk}`, technique: "straight_set" as const }],
        }],
      })),
      split_type: "full_body", periodization: "linear", total_sessions: 4, notes: "",
    }
    const result = validateSkeletonAgainstAnalysis(skeleton, analysis)
    expect(result.ok).toBe(true)
  })
})
