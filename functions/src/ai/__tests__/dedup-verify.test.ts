import { describe, it, expect } from "vitest"
import { buildPriorContextFromExistingExercises } from "../dedup-verify.js"

describe("buildPriorContextFromExistingExercises with slot_role", () => {
  it("uses provided role over inference when slot_role is set", () => {
    const ctx = buildPriorContextFromExistingExercises([
      { exercise_id: "ex-a", exercise_name: "A", week_number: 1, role: "isolation",
        slot_group: "isolation|rotation|obliques" },
    ])
    // 'isolation' is a VARIETY role → should be in used_accessory_exercises, not anchors
    expect(ctx.anchor_exercises.has("ex-a")).toBe(false)
    expect(ctx.used_accessory_exercises.get("isolation|rotation|obliques")?.has("ex-a")).toBe(true)
  })

  it("treats warm_up role as anchor (may repeat)", () => {
    const ctx = buildPriorContextFromExistingExercises([
      { exercise_id: "ex-w", exercise_name: "Warm A", week_number: 1, role: "warm_up",
        slot_group: "warm_up|push|chest" },
    ])
    expect(ctx.anchor_exercises.has("ex-w")).toBe(true)
  })

  it("falls back to default 'accessory' role when role is undefined", () => {
    const ctx = buildPriorContextFromExistingExercises([
      { exercise_id: "ex-x", exercise_name: "X", week_number: 1 },
    ])
    // Without explicit role, falls back to 'accessory' (default behavior preserved)
    expect(ctx.exercise_week_map.has("ex-x")).toBe(true)
    expect(ctx.anchor_exercises.has("ex-x")).toBe(false)
  })

  it("exposes flat excluded_exercise_ids set scoped to variety roles", () => {
    const ctx = buildPriorContextFromExistingExercises([
      { exercise_id: "ex-a", exercise_name: "A", week_number: 1, role: "primary_compound",
        slot_group: "primary_compound|squat|quads" },
      { exercise_id: "ex-w", exercise_name: "W", week_number: 1, role: "warm_up",
        slot_group: "warm_up|push|chest" },
    ])
    expect(ctx.excluded_exercise_ids.has("ex-a")).toBe(true)
    expect(ctx.excluded_exercise_ids.has("ex-w")).toBe(false)
  })
})
