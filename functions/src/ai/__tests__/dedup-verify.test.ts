import { describe, it, expect } from "vitest"
import { buildPriorContextFromExistingExercises, verifyWithinWeekDuplicates } from "../dedup-verify.js"
import type { AssignedExercise, ProgramWeek, ExerciseSlot } from "../types.js"

function slot(
  slot_id: string,
  role: ExerciseSlot["role"],
  pattern: ExerciseSlot["movement_pattern"] = "push",
): ExerciseSlot {
  return {
    slot_id,
    role,
    movement_pattern: pattern,
    target_muscles: ["chest"],
    sets: 3,
    reps: "10",
    rest_seconds: 60,
    rpe_target: null,
    tempo: null,
    group_tag: null,
    technique: "straight_set",
    intensity_pct: null,
  }
}

function week(weekNum: number, days: { day_of_week: number; slots: ExerciseSlot[] }[]): ProgramWeek {
  return {
    week_number: weekNum,
    phase: "Hypertrophy",
    intensity_modifier: "moderate",
    days: days.map((d) => ({ day_of_week: d.day_of_week, label: "Day", focus: "Focus", slots: d.slots })),
  }
}

function assign(slot_id: string, exercise_id: string, exercise_name: string): AssignedExercise {
  return { slot_id, exercise_id, exercise_name, notes: null }
}

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

describe("verifyWithinWeekDuplicates", () => {
  it("passes when every working slot has a unique exercise", () => {
    const w = week(1, [
      { day_of_week: 1, slots: [slot("w1d1s1", "primary_compound"), slot("w1d1s2", "accessory")] },
      { day_of_week: 2, slots: [slot("w1d2s1", "primary_compound"), slot("w1d2s2", "isolation")] },
    ])
    const assignments = [
      assign("w1d1s1", "ex-1", "Bench Press"),
      assign("w1d1s2", "ex-2", "Cable Fly"),
      assign("w1d2s1", "ex-3", "Squat"),
      assign("w1d2s2", "ex-4", "Lateral Raise"),
    ]
    const result = verifyWithinWeekDuplicates(assignments, w)
    expect(result.pass).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it("flags an error when the same exercise appears multiple times on the same day", () => {
    const w = week(1, [
      {
        day_of_week: 1,
        slots: [slot("w1d1s1", "accessory"), slot("w1d1s2", "accessory"), slot("w1d1s3", "isolation")],
      },
    ])
    const assignments = [
      assign("w1d1s1", "cuban", "Cuban Rotation"),
      assign("w1d1s2", "cuban", "Cuban Rotation"),
      assign("w1d1s3", "cuban", "Cuban Rotation"),
    ]
    const result = verifyWithinWeekDuplicates(assignments, w)
    expect(result.pass).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].exercise_id).toBe("cuban")
    expect(result.issues[0].severity).toBe("error")
    expect(result.issues[0].message).toMatch(/multiple times on the same day/i)
  })

  it("flags an error when the same exercise appears on multiple working days in one week", () => {
    const w = week(1, [
      { day_of_week: 1, slots: [slot("w1d1s1", "primary_compound")] },
      { day_of_week: 3, slots: [slot("w1d3s1", "primary_compound")] },
    ])
    const assignments = [
      assign("w1d1s1", "rot", "Cuban Rotation"),
      assign("w1d3s1", "rot", "Cuban Rotation"),
    ]
    const result = verifyWithinWeekDuplicates(assignments, w)
    expect(result.pass).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].days).toEqual([1, 3])
    expect(result.issues[0].message).toMatch(/multiple working slots in the same week/i)
  })

  it("does not flag warm-up or cool-down repeats across days", () => {
    const w = week(1, [
      { day_of_week: 1, slots: [slot("w1d1s1", "warm_up"), slot("w1d1s2", "cool_down")] },
      { day_of_week: 2, slots: [slot("w1d2s1", "warm_up"), slot("w1d2s2", "cool_down")] },
    ])
    const assignments = [
      assign("w1d1s1", "wu", "Cat-Cow"),
      assign("w1d1s2", "cd", "Pigeon Stretch"),
      assign("w1d2s1", "wu", "Cat-Cow"),
      assign("w1d2s2", "cd", "Pigeon Stretch"),
    ]
    const result = verifyWithinWeekDuplicates(assignments, w)
    expect(result.pass).toBe(true)
    expect(result.issues).toHaveLength(0)
  })
})
