import { describe, it, expect } from "vitest"
import { filterByDifficultyLevel, filterByProgressionPhase } from "../exercise-context.js"
import type { CompressedExercise } from "../types.js"

const mk = (id: string, difficulty: string, score: number | null = null): CompressedExercise =>
  ({
    id,
    name: `ex-${id}`,
    difficulty,
    difficulty_score: score,
    movement_pattern: "push",
    primary_muscles: ["chest"],
    secondary_muscles: [],
    equipment_required: [],
    is_bodyweight: false,
    training_intent: ["build"],
    sport_tags: [],
    joints_loaded: [],
    plane_of_motion: ["sagittal"],
  }) as unknown as CompressedExercise

describe("filterByDifficultyLevel — hard exclusion", () => {
  const exercises = [
    mk("b1", "beginner"),
    mk("b2", "beginner"),
    mk("i1", "intermediate"),
    mk("i2", "intermediate"),
    mk("a1", "advanced"),
    mk("a2", "advanced"),
  ]

  it("beginner clients get ONLY beginner exercises (no intermediates)", () => {
    const result = filterByDifficultyLevel(exercises, "beginner")
    expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2"])
  })

  it("intermediate clients get beginner + intermediate, no advanced", () => {
    const result = filterByDifficultyLevel(exercises, "intermediate")
    expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2", "i1", "i2"])
  })

  it("advanced clients get all exercises", () => {
    const result = filterByDifficultyLevel(exercises, "advanced")
    expect(result.map((e) => e.id).sort()).toEqual(["a1", "a2", "b1", "b2", "i1", "i2"])
  })

  it("unknown difficulty level returns all exercises (graceful degradation)", () => {
    const result = filterByDifficultyLevel(exercises, "somethingWeird")
    expect(result).toHaveLength(6)
  })

  it("exercise with unknown difficulty is included (never strip unknowns)", () => {
    const weird = [...exercises, mk("unknown", "mystery")]
    const result = filterByDifficultyLevel(weird, "beginner")
    expect(result.map((e) => e.id)).toContain("unknown")
  })
})

describe("filterByProgressionPhase — earned progression", () => {
  const exercises = [
    mk("b1", "beginner", 2),
    mk("b2", "beginner", 3),
    mk("i_easy", "intermediate", 4),
    mk("i_hard", "intermediate", 7),
    mk("a1", "advanced", 8),
  ]

  describe("beginner client", () => {
    it("week 1: only beginner exercises", () => {
      const result = filterByProgressionPhase(exercises, "beginner", 1)
      expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2"])
    })

    it("week 2: still only beginner", () => {
      const result = filterByProgressionPhase(exercises, "beginner", 2)
      expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2"])
    })

    it("week 3+: beginner + intermediate with score <= 4", () => {
      const result = filterByProgressionPhase(exercises, "beginner", 3)
      expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2", "i_easy"])
    })

    it("week 3+: advanced exercises NEVER allowed for beginners", () => {
      const result = filterByProgressionPhase(exercises, "beginner", 4)
      expect(result.map((e) => e.id)).not.toContain("a1")
    })
  })

  describe("intermediate client", () => {
    it("week 1: beginner + intermediate, no advanced", () => {
      const result = filterByProgressionPhase(exercises, "intermediate", 1)
      expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2", "i_easy", "i_hard"])
    })

    it("week 3+: beginner + intermediate + advanced with score <= 4 (none in this set)", () => {
      const result = filterByProgressionPhase(exercises, "intermediate", 3)
      expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2", "i_easy", "i_hard"])
    })
  })

  describe("advanced/elite client", () => {
    it("all weeks: all exercises", () => {
      const result = filterByProgressionPhase(exercises, "advanced", 1)
      expect(result).toHaveLength(5)
    })
    it("elite treated like advanced", () => {
      const result = filterByProgressionPhase(exercises, "elite", 1)
      expect(result).toHaveLength(5)
    })
  })
})
