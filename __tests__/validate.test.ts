// @vitest-environment node
import { describe, it, expect } from "vitest"
import { normalizeEquipment, validateProgram } from "@/lib/ai/validate"
import type { ProfileAnalysis, ProgramSkeleton, ExerciseAssignment } from "@/lib/ai/types"
import type { CompressedExercise } from "@/lib/ai/exercise-context"

// ─── normalizeEquipment ─────────────────────────────────────────────────────

describe("normalizeEquipment", () => {
  describe("plural to singular", () => {
    it("normalizes 'dumbbells' to 'dumbbell'", () => {
      expect(normalizeEquipment("dumbbells")).toBe("dumbbell")
    })

    it("normalizes 'barbells' to 'barbell'", () => {
      expect(normalizeEquipment("barbells")).toBe("barbell")
    })

    it("normalizes 'kettlebells' to 'kettlebell'", () => {
      expect(normalizeEquipment("kettlebells")).toBe("kettlebell")
    })

    it("normalizes 'treadmills' to 'treadmill'", () => {
      expect(normalizeEquipment("treadmills")).toBe("treadmill")
    })

    it("normalizes 'bikes' to 'bike'", () => {
      expect(normalizeEquipment("bikes")).toBe("bike")
    })

    it("normalizes 'boxes' to 'box'", () => {
      expect(normalizeEquipment("boxes")).toBe("box")
    })

    it("does not strip 's' from 'trx' (too short)", () => {
      expect(normalizeEquipment("trx")).toBe("trx")
    })

    it("does not strip 's' from words ending in 'ss'", () => {
      expect(normalizeEquipment("press")).toBe("press")
    })
  })

  describe("common aliases", () => {
    it("maps 'cable' to 'cable_machine'", () => {
      expect(normalizeEquipment("cable")).toBe("cable_machine")
    })

    it("maps 'cables' to 'cable_machine'", () => {
      expect(normalizeEquipment("cables")).toBe("cable_machine")
    })

    it("maps 'db' to 'dumbbell'", () => {
      expect(normalizeEquipment("db")).toBe("dumbbell")
    })

    it("maps 'bb' to 'barbell'", () => {
      expect(normalizeEquipment("bb")).toBe("barbell")
    })

    it("maps 'kb' to 'kettlebell'", () => {
      expect(normalizeEquipment("kb")).toBe("kettlebell")
    })

    it("maps 'pull_up' to 'pull_up_bar'", () => {
      expect(normalizeEquipment("pull_up")).toBe("pull_up_bar")
    })

    it("maps 'pullup_bar' to 'pull_up_bar'", () => {
      expect(normalizeEquipment("pullup_bar")).toBe("pull_up_bar")
    })

    it("maps 'pullup' to 'pull_up_bar'", () => {
      expect(normalizeEquipment("pullup")).toBe("pull_up_bar")
    })

    it("maps 'chin_up_bar' to 'pull_up_bar'", () => {
      expect(normalizeEquipment("chin_up_bar")).toBe("pull_up_bar")
    })

    it("maps 'band' to 'resistance_band'", () => {
      expect(normalizeEquipment("band")).toBe("resistance_band")
    })

    it("maps 'resistance_bands' to 'resistance_band'", () => {
      expect(normalizeEquipment("resistance_bands")).toBe("resistance_band")
    })

    it("maps 'battle_rope' to 'battle_ropes'", () => {
      expect(normalizeEquipment("battle_rope")).toBe("battle_ropes")
    })

    it("maps 'smith' to 'smith_machine'", () => {
      expect(normalizeEquipment("smith")).toBe("smith_machine")
    })

    it("maps 'mat' to 'yoga_mat'", () => {
      expect(normalizeEquipment("mat")).toBe("yoga_mat")
    })

    it("maps 'med_ball' to 'medicine_ball'", () => {
      expect(normalizeEquipment("med_ball")).toBe("medicine_ball")
    })

    it("maps 'swiss_ball' to 'stability_ball'", () => {
      expect(normalizeEquipment("swiss_ball")).toBe("stability_ball")
    })

    it("maps 'rower' to 'rowing_machine'", () => {
      expect(normalizeEquipment("rower")).toBe("rowing_machine")
    })

    it("maps 'erg' to 'rowing_machine'", () => {
      expect(normalizeEquipment("erg")).toBe("rowing_machine")
    })

    it("maps 'lat_pulldown' to 'lat_pulldown_machine'", () => {
      expect(normalizeEquipment("lat_pulldown")).toBe("lat_pulldown_machine")
    })

    it("maps 'leg_curl' to 'leg_curl_machine'", () => {
      expect(normalizeEquipment("leg_curl")).toBe("leg_curl_machine")
    })

    it("maps 'plyo' to 'plyo_box'", () => {
      expect(normalizeEquipment("plyo")).toBe("plyo_box")
    })
  })

  describe("case and whitespace handling", () => {
    it("handles uppercase input", () => {
      expect(normalizeEquipment("DUMBBELLS")).toBe("dumbbell")
    })

    it("handles mixed case", () => {
      expect(normalizeEquipment("Cable_Machine")).toBe("cable_machine")
    })

    it("trims whitespace", () => {
      expect(normalizeEquipment("  dumbbell  ")).toBe("dumbbell")
    })

    it("converts spaces to underscores", () => {
      expect(normalizeEquipment("pull up bar")).toBe("pull_up_bar")
    })

    it("converts multiple spaces to single underscore", () => {
      expect(normalizeEquipment("pull  up  bar")).toBe("pull_up_bar")
    })
  })

  describe("real-world AI output matching", () => {
    it("'dumbbells' from AI matches 'dumbbell' from questionnaire", () => {
      expect(normalizeEquipment("dumbbells")).toBe(normalizeEquipment("dumbbell"))
    })

    it("'Barbells' from AI matches 'barbell' from questionnaire", () => {
      expect(normalizeEquipment("Barbells")).toBe(normalizeEquipment("barbell"))
    })

    it("'Cable' from AI matches 'cable_machine' from questionnaire", () => {
      expect(normalizeEquipment("Cable")).toBe(normalizeEquipment("cable_machine"))
    })

    it("'resistance bands' from AI matches 'resistance_band' from questionnaire", () => {
      expect(normalizeEquipment("resistance bands")).toBe(normalizeEquipment("resistance_band"))
    })
  })

  describe("fuzzy matching fallback (string-similarity)", () => {
    it("fuzzy matches 'dumbbell_set' to 'dumbbell'", () => {
      expect(normalizeEquipment("dumbbell_set")).toBe("dumbbell")
    })

    it("fuzzy matches 'barbell_rack' to 'barbell' or 'squat_rack'", () => {
      const result = normalizeEquipment("barbell_rack")
      expect(["barbell", "squat_rack"]).toContain(result)
    })

    it("fuzzy matches 'stability_balls' to 'stability_ball'", () => {
      expect(normalizeEquipment("stability_balls")).toBe("stability_ball")
    })

    it("fuzzy matches 'medicine_balls' to 'medicine_ball'", () => {
      expect(normalizeEquipment("medicine_balls")).toBe("medicine_ball")
    })

    it("fuzzy matches 'foam_rollers' to 'foam_roller'", () => {
      expect(normalizeEquipment("foam_rollers")).toBe("foam_roller")
    })

    it("fuzzy matches 'rowing machine' to 'rowing_machine'", () => {
      expect(normalizeEquipment("rowing machine")).toBe("rowing_machine")
    })

    it("fuzzy matches 'smith machine' to 'smith_machine'", () => {
      expect(normalizeEquipment("smith machine")).toBe("smith_machine")
    })

    it("fuzzy matches 'cable machine' to 'cable_machine'", () => {
      expect(normalizeEquipment("cable machine")).toBe("cable_machine")
    })

    it("fuzzy matches 'squat rack' to 'squat_rack'", () => {
      expect(normalizeEquipment("squat rack")).toBe("squat_rack")
    })

    it("returns input as-is for completely unknown equipment", () => {
      expect(normalizeEquipment("underwater_jetpack")).toBe("underwater_jetpack")
    })
  })

  describe("canonical names return themselves", () => {
    const canonicalNames = [
      "barbell", "dumbbell", "kettlebell", "cable_machine", "smith_machine",
      "resistance_band", "pull_up_bar", "bench", "squat_rack", "leg_press",
      "leg_curl_machine", "lat_pulldown_machine", "rowing_machine", "treadmill",
      "bike", "box", "plyo_box", "medicine_ball", "stability_ball", "foam_roller",
      "trx", "landmine", "sled", "battle_ropes", "agility_ladder", "cones", "yoga_mat",
    ]

    for (const name of canonicalNames) {
      it(`"${name}" normalizes to itself`, () => {
        expect(normalizeEquipment(name)).toBe(name)
      })
    }
  })
})

// ─── validateProgram ────────────────────────────────────────────────────────

// Minimal test fixtures
function makeExercise(overrides: Partial<CompressedExercise> = {}): CompressedExercise {
  return {
    id: "ex-001",
    name: "Test Exercise",
    category: ["strength"],
    muscle_group: "chest",
    difficulty: "intermediate",
    equipment_required: [],
    is_bodyweight: false,
    movement_pattern: "push",
    force_type: "push",
    laterality: "bilateral",
    primary_muscles: ["chest"],
    secondary_muscles: [],
    ...overrides,
  }
}

function makeSkeleton(
  slots: { slot_id: string; week: number; day: number }[]
): ProgramSkeleton {
  const weekMap = new Map<number, Map<number, string[]>>()
  for (const s of slots) {
    if (!weekMap.has(s.week)) weekMap.set(s.week, new Map())
    const dayMap = weekMap.get(s.week)!
    if (!dayMap.has(s.day)) dayMap.set(s.day, [])
    dayMap.get(s.day)!.push(s.slot_id)
  }

  return {
    program_name: "Test Program",
    split_type: "full_body",
    periodization: "linear",
    weeks: Array.from(weekMap.entries()).map(([weekNum, dayMap]) => ({
      week_number: weekNum,
      focus: "general",
      days: Array.from(dayMap.entries()).map(([dayNum, slotIds]) => ({
        day_of_week: dayNum,
        label: `Day ${dayNum}`,
        focus: "full_body",
        slots: slotIds.map((id, idx) => ({
          slot_id: id,
          role: "main",
          movement_pattern: "push",
          target_muscles: ["chest"],
          sets: 3,
          rep_range: "8-12",
          rest_seconds: 90,
          order: idx + 1,
        })),
      })),
    })),
  }
}

function makeAnalysis(overrides: Partial<ProfileAnalysis> = {}): ProfileAnalysis {
  return {
    recommended_split: "full_body",
    recommended_periodization: "linear",
    volume_targets: [],
    exercise_constraints: [],
    session_structure: {
      warm_up_minutes: 5,
      main_work_minutes: 40,
      cool_down_minutes: 5,
      total_exercises: 6,
      compound_count: 3,
      isolation_count: 3,
    },
    training_age_category: "intermediate",
    notes: "",
    ...overrides,
  }
}

describe("validateProgram", () => {
  describe("equipment validation with normalization", () => {
    it("passes when exercise requires 'dumbbells' and client has 'dumbbell'", () => {
      const exercise = makeExercise({
        id: "ex-001",
        name: "Dumbbell Bench Press",
        equipment_required: ["dumbbells"],
      })
      const skeleton = makeSkeleton([{ slot_id: "w1d1s1", week: 1, day: 1 }])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "ex-001", exercise_name: "Dumbbell Bench Press", notes: null },
        ],
        substitution_notes: [],
      }
      const result = validateProgram(
        skeleton, assignment, makeAnalysis(), [exercise],
        ["dumbbell", "bench"], "intermediate"
      )
      const equipmentErrors = result.issues.filter(
        (i) => i.category === "equipment_violation"
      )
      expect(equipmentErrors).toHaveLength(0)
    })

    it("fails when exercise requires equipment client doesn't have", () => {
      const exercise = makeExercise({
        id: "ex-001",
        name: "Barbell Squat",
        equipment_required: ["barbell", "squat_rack"],
      })
      const skeleton = makeSkeleton([{ slot_id: "w1d1s1", week: 1, day: 1 }])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "ex-001", exercise_name: "Barbell Squat", notes: null },
        ],
        substitution_notes: [],
      }
      const result = validateProgram(
        skeleton, assignment, makeAnalysis(), [exercise],
        ["dumbbell"], "intermediate"
      )
      const equipmentErrors = result.issues.filter(
        (i) => i.category === "equipment_violation"
      )
      expect(equipmentErrors.length).toBeGreaterThan(0)
      expect(result.pass).toBe(false)
    })

    it("skips equipment check for bodyweight exercises", () => {
      const exercise = makeExercise({
        id: "ex-001",
        name: "Push-Up",
        equipment_required: [],
        is_bodyweight: true,
      })
      const skeleton = makeSkeleton([{ slot_id: "w1d1s1", week: 1, day: 1 }])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "ex-001", exercise_name: "Push-Up", notes: null },
        ],
        substitution_notes: [],
      }
      const result = validateProgram(
        skeleton, assignment, makeAnalysis(), [exercise],
        [], "intermediate"
      )
      const equipmentErrors = result.issues.filter(
        (i) => i.category === "equipment_violation"
      )
      expect(equipmentErrors).toHaveLength(0)
    })
  })

  describe("duplicate exercise detection", () => {
    it("flags duplicate exercises on the same day", () => {
      const exercise = makeExercise({ id: "ex-001", name: "Bench Press" })
      const skeleton = makeSkeleton([
        { slot_id: "w1d1s1", week: 1, day: 1 },
        { slot_id: "w1d1s2", week: 1, day: 1 },
      ])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "ex-001", exercise_name: "Bench Press", notes: null },
          { slot_id: "w1d1s2", exercise_id: "ex-001", exercise_name: "Bench Press", notes: null },
        ],
        substitution_notes: [],
      }
      const result = validateProgram(
        skeleton, assignment, makeAnalysis(), [exercise],
        [], "intermediate"
      )
      const dupes = result.issues.filter((i) => i.category === "duplicate_exercise")
      expect(dupes).toHaveLength(1)
    })

    it("allows same exercise on different days", () => {
      const exercise = makeExercise({ id: "ex-001", name: "Bench Press" })
      const skeleton = makeSkeleton([
        { slot_id: "w1d1s1", week: 1, day: 1 },
        { slot_id: "w1d2s1", week: 1, day: 2 },
      ])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "ex-001", exercise_name: "Bench Press", notes: null },
          { slot_id: "w1d2s1", exercise_id: "ex-001", exercise_name: "Bench Press", notes: null },
        ],
        substitution_notes: [],
      }
      const result = validateProgram(
        skeleton, assignment, makeAnalysis(), [exercise],
        [], "intermediate"
      )
      const dupes = result.issues.filter((i) => i.category === "duplicate_exercise")
      expect(dupes).toHaveLength(0)
    })
  })

  describe("injury constraint detection", () => {
    it("flags exercises that use avoided movement patterns", () => {
      const exercise = makeExercise({
        id: "ex-001",
        name: "Overhead Press",
        movement_pattern: "push",
      })
      const skeleton = makeSkeleton([{ slot_id: "w1d1s1", week: 1, day: 1 }])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "ex-001", exercise_name: "Overhead Press", notes: null },
        ],
        substitution_notes: [],
      }
      const analysis = makeAnalysis({
        exercise_constraints: [
          { type: "avoid_movement", value: "push", reason: "Shoulder injury" },
        ],
      })
      const result = validateProgram(
        skeleton, assignment, analysis, [exercise],
        [], "intermediate"
      )
      const conflicts = result.issues.filter((i) => i.category === "injury_conflict")
      expect(conflicts.length).toBeGreaterThan(0)
    })

    it("flags exercises that target avoided muscles", () => {
      const exercise = makeExercise({
        id: "ex-001",
        name: "Bench Press",
        primary_muscles: ["chest", "triceps"],
      })
      const skeleton = makeSkeleton([{ slot_id: "w1d1s1", week: 1, day: 1 }])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "ex-001", exercise_name: "Bench Press", notes: null },
        ],
        substitution_notes: [],
      }
      const analysis = makeAnalysis({
        exercise_constraints: [
          { type: "avoid_muscle", value: "chest", reason: "Pec strain" },
        ],
      })
      const result = validateProgram(
        skeleton, assignment, analysis, [exercise],
        [], "intermediate"
      )
      const conflicts = result.issues.filter((i) => i.category === "injury_conflict")
      expect(conflicts.length).toBeGreaterThan(0)
    })
  })

  describe("difficulty mismatch detection", () => {
    it("warns when advanced exercise assigned to beginner", () => {
      const exercise = makeExercise({
        id: "ex-001",
        name: "Snatch",
        difficulty: "advanced",
      })
      const skeleton = makeSkeleton([{ slot_id: "w1d1s1", week: 1, day: 1 }])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "ex-001", exercise_name: "Snatch", notes: null },
        ],
        substitution_notes: [],
      }
      const result = validateProgram(
        skeleton, assignment, makeAnalysis(), [exercise],
        [], "beginner"
      )
      const mismatches = result.issues.filter((i) => i.category === "difficulty_mismatch")
      expect(mismatches).toHaveLength(1)
    })

    it("does not warn when intermediate exercise assigned to beginner", () => {
      const exercise = makeExercise({
        id: "ex-001",
        name: "Goblet Squat",
        difficulty: "intermediate",
      })
      const skeleton = makeSkeleton([{ slot_id: "w1d1s1", week: 1, day: 1 }])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "ex-001", exercise_name: "Goblet Squat", notes: null },
        ],
        substitution_notes: [],
      }
      const result = validateProgram(
        skeleton, assignment, makeAnalysis(), [exercise],
        [], "beginner"
      )
      const mismatches = result.issues.filter((i) => i.category === "difficulty_mismatch")
      expect(mismatches).toHaveLength(0)
    })
  })

  describe("missing exercise detection", () => {
    it("flags exercises not found in the library", () => {
      const skeleton = makeSkeleton([{ slot_id: "w1d1s1", week: 1, day: 1 }])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "nonexistent", exercise_name: "Fake Exercise", notes: null },
        ],
        substitution_notes: [],
      }
      const result = validateProgram(
        skeleton, assignment, makeAnalysis(), [],
        [], "intermediate"
      )
      const missing = result.issues.filter((i) => i.category === "missing_exercise")
      expect(missing).toHaveLength(1)
      expect(result.pass).toBe(false)
    })
  })

  describe("validation summary", () => {
    it("passes with no issues", () => {
      const exercise = makeExercise({ id: "ex-001", is_bodyweight: true })
      const skeleton = makeSkeleton([{ slot_id: "w1d1s1", week: 1, day: 1 }])
      const assignment: ExerciseAssignment = {
        assignments: [
          { slot_id: "w1d1s1", exercise_id: "ex-001", exercise_name: "Push-Up", notes: null },
        ],
        substitution_notes: [],
      }
      const result = validateProgram(
        skeleton, assignment, makeAnalysis(), [exercise],
        [], "intermediate"
      )
      // May have movement pattern warnings, but no errors
      const errors = result.issues.filter((i) => i.type === "error")
      expect(errors).toHaveLength(0)
      expect(result.pass).toBe(true)
    })
  })
})
