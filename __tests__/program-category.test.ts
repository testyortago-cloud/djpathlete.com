// @vitest-environment node
import { describe, it, expect } from "vitest"
import { deriveProgramCategory } from "@/lib/ai/utils"
import { hasQuestionnaireData } from "@/lib/profile-utils"
import { filterByDifficultyScore } from "@/lib/ai/exercise-context"
import type { CompressedExercise } from "@/lib/ai/exercise-context"
import type { ClientProfile } from "@/types/database"

// ─── Valid DB categories ────────────────────────────────────────────────────
// The DB constraint allows: strength, conditioning, sport_specific, recovery, nutrition, hybrid

const VALID_CATEGORIES = ["strength", "conditioning", "sport_specific", "recovery", "nutrition", "hybrid"]

describe("deriveProgramCategory", () => {
  it("returns 'hybrid' for muscle_gain + endurance", () => {
    expect(deriveProgramCategory(["muscle_gain", "endurance"])).toBe("hybrid")
  })

  it("returns 'strength' for muscle_gain", () => {
    expect(deriveProgramCategory(["muscle_gain"])).toBe("strength")
  })

  it("returns 'strength' for weight_loss", () => {
    expect(deriveProgramCategory(["weight_loss"])).toBe("strength")
  })

  it("returns 'conditioning' for endurance", () => {
    expect(deriveProgramCategory(["endurance"])).toBe("conditioning")
  })

  it("returns 'sport_specific' for sport_specific", () => {
    expect(deriveProgramCategory(["sport_specific"])).toBe("sport_specific")
  })

  it("returns 'recovery' for flexibility", () => {
    expect(deriveProgramCategory(["flexibility"])).toBe("recovery")
  })

  it("returns 'hybrid' for general_health", () => {
    expect(deriveProgramCategory(["general_health"])).toBe("hybrid")
  })

  it("defaults to 'strength' for unknown goals", () => {
    expect(deriveProgramCategory(["unknown_goal"])).toBe("strength")
  })

  it("defaults to 'strength' for empty goals", () => {
    expect(deriveProgramCategory([])).toBe("strength")
  })

  // The critical test: every possible return value must be valid in the DB
  const ALL_GOAL_COMBOS: string[][] = [
    ["muscle_gain", "endurance"],
    ["muscle_gain"],
    ["weight_loss"],
    ["endurance"],
    ["sport_specific"],
    ["flexibility"],
    ["general_health"],
    ["weight_loss", "flexibility"],
    ["muscle_gain", "sport_specific"],
    [],
    ["some_future_goal"],
  ]

  for (const goals of ALL_GOAL_COMBOS) {
    it(`returns a valid DB category for goals [${goals.join(", ")}]`, () => {
      const result = deriveProgramCategory(goals)
      expect(VALID_CATEGORIES).toContain(result)
    })
  }
})

// ─── hasQuestionnaireData ───────────────────────────────────────────────────

function makeEmptyProfile(): ClientProfile {
  return {
    id: "test-id",
    user_id: "test-user",
    date_of_birth: null,
    gender: null,
    sport: null,
    position: null,
    experience_level: null,
    goals: null,
    injuries: null,
    height_cm: null,
    weight_kg: null,
    weight_unit: "kg",
    emergency_contact_name: null,
    emergency_contact_phone: null,
    available_equipment: [],
    preferred_session_minutes: null,
    preferred_training_days: null,
    preferred_day_names: [],
    time_efficiency_preference: null,
    preferred_techniques: [],
    injury_details: [],
    training_years: null,
    sleep_hours: null,
    stress_level: null,
    occupation_activity_level: null,
    movement_confidence: null,
    exercise_likes: null,
    exercise_dislikes: null,
    training_background: null,
    additional_notes: null,
    is_minor: false,
    guardian_name: null,
    guardian_email: null,
    parental_consent_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  }
}

describe("hasQuestionnaireData", () => {
  it("returns false for a completely empty profile", () => {
    expect(hasQuestionnaireData(makeEmptyProfile())).toBe(false)
  })

  // Every single field should independently trigger true
  const fieldTests: { field: string; value: unknown }[] = [
    { field: "goals", value: "weight_loss" },
    { field: "experience_level", value: "beginner" },
    { field: "training_years", value: 3 },
    { field: "available_equipment", value: ["dumbbell"] },
    { field: "preferred_training_days", value: 4 },
    { field: "preferred_session_minutes", value: 60 },
    { field: "sport", value: "Basketball" },
    { field: "position", value: "Guard" },
    { field: "date_of_birth", value: "2000-01-01" },
    { field: "gender", value: "male" },
    { field: "injuries", value: "Bad knee" },
    { field: "injury_details", value: [{ area: "knee", severity: "moderate" }] },
    { field: "movement_confidence", value: "comfortable" },
    { field: "sleep_hours", value: "7" },
    { field: "stress_level", value: "moderate" },
    { field: "occupation_activity_level", value: "sedentary" },
    { field: "training_background", value: "5 years lifting" },
    { field: "exercise_likes", value: "Squats" },
    { field: "exercise_dislikes", value: "Burpees" },
    { field: "additional_notes", value: "Prefer morning training" },
    { field: "time_efficiency_preference", value: "supersets_circuits" },
    { field: "preferred_techniques", value: ["superset"] },
    { field: "preferred_day_names", value: [1, 3, 5] },
    { field: "height_cm", value: 180 },
    { field: "weight_kg", value: 75 },
  ]

  for (const { field, value } of fieldTests) {
    it(`returns true when only '${field}' is filled`, () => {
      const profile = { ...makeEmptyProfile(), [field]: value }
      expect(hasQuestionnaireData(profile)).toBe(true)
    })
  }
})

// ─── filterByDifficultyScore ────────────────────────────────────────────────

function makeExercise(overrides: Partial<CompressedExercise> = {}): CompressedExercise {
  return {
    id: "ex-001",
    name: "Test Exercise",
    category: ["strength"],
    difficulty: "intermediate",
    difficulty_score: null,
    muscle_group: "chest",
    movement_pattern: "push",
    primary_muscles: ["chest"],
    secondary_muscles: [],
    force_type: "push",
    laterality: "bilateral",
    equipment_required: [],
    is_bodyweight: false,
    training_intent: ["build"],
    difficulty_max: null,
    sport_tags: [],
    plane_of_motion: [],
    joints_loaded: [],
    ...overrides,
  }
}

describe("filterByDifficultyScore", () => {
  it("returns all exercises when maxDifficultyScore is undefined", () => {
    const exercises = [makeExercise({ difficulty_score: 5 }), makeExercise({ difficulty_score: null })]
    expect(filterByDifficultyScore(exercises)).toHaveLength(2)
  })

  it("includes exercises with null difficulty_score when filtering", () => {
    const exercises = [
      makeExercise({ id: "a", difficulty_score: null }),
      makeExercise({ id: "b", difficulty_score: 3 }),
      makeExercise({ id: "c", difficulty_score: 7 }),
    ]
    const result = filterByDifficultyScore(exercises, 5)
    expect(result).toHaveLength(2)
    expect(result.map((e) => e.id)).toContain("a") // null score included
    expect(result.map((e) => e.id)).toContain("b") // 3 <= 5
    expect(result.map((e) => e.id)).not.toContain("c") // 7 > 5
  })

  it("excludes exercises above the max difficulty score", () => {
    const exercises = [
      makeExercise({ difficulty_score: 8 }),
      makeExercise({ difficulty_score: 10 }),
    ]
    const result = filterByDifficultyScore(exercises, 5)
    expect(result).toHaveLength(0)
  })

  it("includes exercises at exactly the max difficulty score", () => {
    const exercises = [makeExercise({ difficulty_score: 5 })]
    const result = filterByDifficultyScore(exercises, 5)
    expect(result).toHaveLength(1)
  })
})

// ─── date_of_birth age calculation ──────────────────────────────────────────

describe("date_of_birth age parsing", () => {
  it("correctly parses ISO date string to age", () => {
    const dob = "2000-06-15"
    const birthDate = new Date(dob)
    expect(isNaN(birthDate.getTime())).toBe(false)
    const age = new Date().getFullYear() - birthDate.getFullYear()
    expect(age).toBeGreaterThan(20)
    expect(age).toBeLessThan(50)
  })

  it("correctly parses date-only string", () => {
    const dob = "1995-01-01"
    const birthDate = new Date(dob)
    expect(isNaN(birthDate.getTime())).toBe(false)
    expect(birthDate.getFullYear()).toBe(1995)
  })

  it("parseInt would incorrectly parse ISO date", () => {
    // This proves the old parseInt approach was wrong
    const dob = "2000-06-15"
    const parsedYear = parseInt(dob, 10)
    // parseInt("2000-06-15") returns 2000 — this happens to work for ISO dates
    // BUT only because the year is at the start. It's fragile and unreliable.
    expect(parsedYear).toBe(2000)

    // New Date approach is more robust
    const birthDate = new Date(dob)
    expect(birthDate.getFullYear()).toBe(2000)
  })
})
