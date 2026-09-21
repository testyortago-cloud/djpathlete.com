import { describe, it, expect } from "vitest"
import { findEquipmentViolations, buildEquipmentWarnings } from "../shared-helpers.js"
import type { CompressedExercise } from "../types.js"

const ex = (id: string, name: string, equipment_required: string[], is_bodyweight = false): CompressedExercise =>
  ({
    id,
    name,
    difficulty: "intermediate",
    difficulty_score: null,
    movement_pattern: "push",
    primary_muscles: ["chest"],
    secondary_muscles: [],
    equipment_required,
    is_bodyweight,
    training_intent: ["build"],
    sport_tags: [],
    joints_loaded: [],
    plane_of_motion: ["sagittal"],
  }) as unknown as CompressedExercise

/** The real week-3 rows that shipped to a client in a hotel room (2026-09-21). */
const library = [
  ex("trx", "Hamstring TRX glides_Hamstring", ["trx"], true),
  ex("cable", "Rotator stretch forward lean_Back", ["cable_machine"], true),
  ex("db", "Offset dumbbell squat_Quadriceps", ["dumbbell"]),
  ex("pushup", "Push up_Chest", [], true),
  ex("multi", "Rotation Chest press", ["dumbbell", "bench"]),
]

const assign = (slot_id: string, exercise_id: string) => ({
  slot_id,
  exercise_id,
  exercise_name: library.find((e) => e.id === exercise_id)?.name ?? exercise_id,
  notes: null,
})

describe("findEquipmentViolations", () => {
  it("reports nothing when every assigned exercise fits the available kit", () => {
    const violations = findEquipmentViolations([assign("w3d1s0", "pushup")], library, [])
    expect(violations).toEqual([])
  })

  it("catches a bodyweight-FLAGGED exercise that still needs unavailable kit", () => {
    const violations = findEquipmentViolations([assign("w3d1s3", "trx")], library, [])
    expect(violations).toEqual([
      { slot_id: "w3d1s3", exercise_name: "Hamstring TRX glides_Hamstring", missing: ["trx"] },
    ])
  })

  it("lists only the MISSING items when an exercise needs several", () => {
    const violations = findEquipmentViolations([assign("w3d4s5", "multi")], library, ["dumbbell"])
    expect(violations).toEqual([{ slot_id: "w3d4s5", exercise_name: "Rotation Chest press", missing: ["bench"] }])
  })

  it("normalizes aliases before comparing, so 'dumbbells' covers 'dumbbell'", () => {
    const violations = findEquipmentViolations([assign("w3d1s0", "db")], library, ["dumbbells"])
    expect(violations).toEqual([])
  })

  it("reports every offending slot, not just the first", () => {
    const violations = findEquipmentViolations(
      [assign("a", "trx"), assign("b", "cable"), assign("c", "pushup")],
      library,
      [],
    )
    expect(violations.map((v) => v.slot_id)).toEqual(["a", "b"])
  })

  it("ignores an assignment whose exercise is not in the library", () => {
    const violations = findEquipmentViolations([assign("w3d1s0", "ghost")], library, [])
    expect(violations).toEqual([])
  })
})

describe("buildEquipmentWarnings", () => {
  it("returns no warning when there are no violations", () => {
    expect(buildEquipmentWarnings([], [])).toEqual([])
  })

  it("names the equipment, the count and an example slot the coach can find", () => {
    const violations = findEquipmentViolations([assign("w3d1s3", "trx"), assign("w3d6s4", "cable")], library, [])
    const warnings = buildEquipmentWarnings(violations, [])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("2 exercise")
    expect(warnings[0]).toContain("trx")
    expect(warnings[0]).toContain("cable_machine")
    expect(warnings[0]).toContain("Hamstring TRX glides_Hamstring")
  })

  it("states what WAS available, so the coach can tell a typo from a real gap", () => {
    const violations = findEquipmentViolations([assign("w3d1s3", "trx")], library, ["yoga_mat"])
    const warnings = buildEquipmentWarnings(violations, ["yoga_mat"])
    expect(warnings[0]).toContain("yoga_mat")
  })

  it("says 'no equipment at all' rather than printing an empty list", () => {
    const violations = findEquipmentViolations([assign("w3d1s3", "trx")], library, [])
    const warnings = buildEquipmentWarnings(violations, [])
    expect(warnings[0]).toContain("no equipment at all")
  })
})
