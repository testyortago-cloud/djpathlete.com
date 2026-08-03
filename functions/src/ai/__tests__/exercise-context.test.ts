import { describe, it, expect } from "vitest"
import {
  filterByDifficultyLevel,
  filterByDifficultyScore,
  filterByProgressionPhase,
  filterByAvailableEquipment,
} from "../exercise-context.js"
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

/** Build a compressed exercise with specific equipment / bodyweight settings. */
const mkEquip = (id: string, equipment_required: string[], is_bodyweight = false): CompressedExercise =>
  ({
    ...mk(id, "beginner"),
    equipment_required,
    is_bodyweight,
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

describe("filterByAvailableEquipment — hard exclusion", () => {
  const exercises = [
    mkEquip("none", []), // no equipment required
    mkEquip("bw", ["dumbbell"], true), // bodyweight (kept despite listing equipment)
    mkEquip("db", ["dumbbell"]),
    mkEquip("band", ["resistance_band"]),
    mkEquip("cable", ["cable_machine"]),
    mkEquip("multi_ok", ["dumbbell", "bench"]),
    mkEquip("multi_partial", ["dumbbell", "barbell"]),
  ]

  it("excludes exercises requiring unavailable equipment", () => {
    const result = filterByAvailableEquipment(exercises, ["dumbbell", "bench"])
    expect(result.map((e) => e.id).sort()).toEqual(["bw", "db", "multi_ok", "none"])
  })

  it("requires ALL listed equipment to be available (partial match excluded)", () => {
    const result = filterByAvailableEquipment(exercises, ["dumbbell"])
    expect(result.map((e) => e.id)).not.toContain("multi_partial")
  })

  it("always keeps bodyweight and no-equipment exercises even with empty equipment", () => {
    const result = filterByAvailableEquipment(exercises, [])
    expect(result.map((e) => e.id).sort()).toEqual(["bw", "none"])
  })

  it("normalizes equipment aliases (plural/short forms) before comparing", () => {
    // client selected "dumbbells" (plural) — should still match "dumbbell" exercises
    const result = filterByAvailableEquipment(exercises, ["dumbbells", "bands"])
    expect(result.map((e) => e.id).sort()).toEqual(["band", "bw", "db", "none"])
  })

  it("skips filtering entirely for a full-gym client (>= threshold items)", () => {
    const fullGym = Array.from({ length: 25 }, (_, i) => `eq_${i}`)
    const result = filterByAvailableEquipment(exercises, fullGym)
    expect(result).toHaveLength(exercises.length)
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

// ─── Coach-instruction unlocks ──────────────────────────────────────────────
// Reproduces the production failure: no client profile, so availableEquipment
// is [] and clientDifficulty defaults to "beginner". A barbell/intermediate
// lift the coach explicitly named is cut twice over unless it is unlocked.

describe("unlockedIds bypass for coach-named exercises", () => {
  const BACK_SQUAT = {
    ...mk("bs", "intermediate", 6),
    equipment_required: ["barbell"],
  } as unknown as CompressedExercise
  const PUSH_UP = {
    ...mk("pu", "beginner", 2),
    equipment_required: [],
    is_bodyweight: true,
  } as unknown as CompressedExercise
  const LIB = [BACK_SQUAT, PUSH_UP]
  const UNLOCKED = new Set(["bs"])

  it("equipment filter drops the named lift without an unlock", () => {
    expect(filterByAvailableEquipment(LIB, []).map((e) => e.id)).toEqual(["pu"])
  })

  it("equipment filter keeps the named lift when unlocked", () => {
    expect(filterByAvailableEquipment(LIB, [], UNLOCKED).map((e) => e.id)).toEqual(["bs", "pu"])
  })

  it("difficulty-tier filter drops the named lift without an unlock", () => {
    expect(filterByDifficultyLevel(LIB, "beginner").map((e) => e.id)).toEqual(["pu"])
  })

  it("difficulty-tier filter keeps the named lift when unlocked", () => {
    expect(filterByDifficultyLevel(LIB, "beginner", UNLOCKED).map((e) => e.id)).toEqual(["bs", "pu"])
  })

  it("per-week progression filter keeps the named lift in week 1", () => {
    expect(filterByProgressionPhase(LIB, "beginner", 1).map((e) => e.id)).toEqual(["pu"])
    expect(filterByProgressionPhase(LIB, "beginner", 1, UNLOCKED).map((e) => e.id)).toEqual(["bs", "pu"])
  })

  it("assessment score filter is NOT bypassable — it is measured evidence", () => {
    // There is deliberately no unlockedIds parameter on filterByDifficultyScore:
    // a coach-named lift above the client's ASSESSED ceiling must still be cut.
    expect(filterByDifficultyScore(LIB, 4).map((e) => e.id)).toEqual(["pu"])
    expect(filterByDifficultyScore).toHaveLength(2)
  })
})
