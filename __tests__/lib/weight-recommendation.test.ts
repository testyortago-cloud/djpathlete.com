import { describe, it, expect } from "vitest"
import { getWeightRecommendation } from "@/lib/weight-recommendation"
import type { ExerciseProgress } from "@/types/database"

/**
 * The bug these pin: the athlete's workout card showed the engine's own guess
 * ahead of the weight the coach typed. Coach set 30 lbs on Banded Bulgaria
 * Split Squat; the athlete saw 104.72 lbs, a body-weight estimate
 * (59.42 kg x 0.45 hinge x 1.75 elite = 47.5 kg). Every athlete with no log
 * for an exercise, a Coach DJP next weight, or a past logged weight got the
 * engine's number instead of the coach's.
 */

const exercise = {
  is_bodyweight: false,
  training_intent: ["build", "shape"],
  movement_pattern: "hinge",
  name: "Banded Bulgaria Split Squat",
  category: ["strength"],
} as Parameters<typeof getWeightRecommendation>[1]

const eliteMale = { weight_kg: 59.42, gender: "male" as const, experience_level: "elite" as const }

const coach30lbs = { sets: 3, reps: "8", intensity_pct: null, rpe_target: 7, suggested_weight_kg: 13.607787 }
const noCoachWeight = { ...coach30lbs, suggested_weight_kg: null }

function log(partial: Partial<ExerciseProgress>): ExerciseProgress {
  return {
    weight_kg: null,
    rpe: null,
    reps_completed: "8",
    set_details: null,
    ai_next_weight_kg: null,
    completed_at: "2026-10-19T19:00:00Z",
    ...partial,
  } as ExerciseProgress
}

describe("getWeightRecommendation — the coach's weight wins", () => {
  it("no history: returns the coach's weight, not the body-weight estimate", () => {
    const rec = getWeightRecommendation([], exercise, coach30lbs, eliteMale)
    expect(rec.recommended_kg).toBe(13.607787)
  })

  it("Coach DJP left a next weight: still returns the coach's weight", () => {
    const rec = getWeightRecommendation(
      [log({ weight_kg: 40, ai_next_weight_kg: 45 })],
      exercise,
      coach30lbs,
      eliteMale,
    )
    expect(rec.recommended_kg).toBe(13.607787)
  })

  it("past log with an easy RPE: still returns the coach's weight", () => {
    const rec = getWeightRecommendation([log({ weight_kg: 40, rpe: 6 })], exercise, coach30lbs, eliteMale)
    expect(rec.recommended_kg).toBe(13.607787)
  })

  it("intensity % with a known 1RM: still returns the coach's weight", () => {
    const rec = getWeightRecommendation(
      [log({ weight_kg: 60, rpe: 8 })],
      exercise,
      { ...coach30lbs, intensity_pct: 75 },
      eliteMale,
    )
    expect(rec.recommended_kg).toBe(13.607787)
  })

  // Presence controls: the engine still fills in when the coach left it blank,
  // so the tests above are not passing because the engine went silent.
  it("coach left it blank, no history: falls back to the profile estimate", () => {
    const rec = getWeightRecommendation([], exercise, noCoachWeight, eliteMale)
    expect(rec.recommended_kg).toBe(47.5)
  })

  it("coach left it blank, easy last session: progresses from the last weight", () => {
    const rec = getWeightRecommendation([log({ weight_kg: 40, rpe: 6 })], exercise, noCoachWeight, eliteMale)
    expect(rec.recommended_kg).toBe(45)
  })

  it("bodyweight exercise: no weight even if the coach typed one", () => {
    const rec = getWeightRecommendation([], { ...exercise, is_bodyweight: true }, coach30lbs, eliteMale)
    expect(rec.recommended_kg).toBeNull()
  })
})
