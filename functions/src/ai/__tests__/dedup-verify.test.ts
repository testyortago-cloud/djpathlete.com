import { describe, it, expect } from "vitest"
import {
  buildPriorContextFromExistingExercises,
  dedupAssignmentsInPlace,
  verifyWithinWeekDuplicates,
} from "../dedup-verify.js"
import type { AssignedExercise, CompressedExercise, ProgramWeek, ExerciseSlot } from "../types.js"

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

function exercise(
  id: string,
  name: string,
  pattern: "push" | "pull" | "squat" | "hinge" | "lunge" | "rotation" | "isometric",
  primary: string[],
): CompressedExercise {
  return {
    id,
    name,
    category: ["strength"],
    difficulty: "intermediate",
    difficulty_score: 5,
    muscle_group: primary[0] ?? null,
    movement_pattern: pattern,
    primary_muscles: primary,
    secondary_muscles: [],
    force_type: null,
    laterality: null,
    equipment_required: [],
    is_bodyweight: true,
    training_intent: ["build"],
    sport_tags: [],
    plane_of_motion: [],
    joints_loaded: [],
  }
}

describe("dedupAssignmentsInPlace", () => {
  it("swaps a within-day duplicate for the best-scoring unused alternative", () => {
    const w = week(1, [
      {
        day_of_week: 1,
        slots: [
          slot("w1d1s1", "primary_compound", "push"),
          slot("w1d1s2", "accessory", "push"),
          slot("w1d1s3", "isolation", "push"),
        ],
      },
    ])
    const assignments = [
      assign("w1d1s1", "ex-a", "Bench Press"),
      assign("w1d1s2", "ex-b", "Cable Fly"),
      assign("w1d1s3", "ex-a", "Bench Press"), // duplicate of slot 1
    ]
    const library = [
      exercise("ex-a", "Bench Press", "push", ["chest"]),
      exercise("ex-b", "Cable Fly", "push", ["chest"]),
      exercise("ex-c", "Incline DB Press", "push", ["chest"]),
    ]
    const result = dedupAssignmentsInPlace(assignments, w, library)
    expect(result.swapped_count).toBe(1)
    expect(result.unresolved).toHaveLength(0)
    // Third slot should now hold a different exercise_id
    expect(assignments[2].exercise_id).not.toBe("ex-a")
    expect(assignments[2].exercise_id).toBe("ex-c")
    expect(assignments[2].notes).toMatch(/Auto-swapped/i)
  })

  it("leaves first occurrence untouched and only swaps later collisions", () => {
    const w = week(1, [
      {
        day_of_week: 1,
        slots: [slot("w1d1s1", "accessory", "pull"), slot("w1d1s2", "accessory", "pull")],
      },
    ])
    const assignments = [
      assign("w1d1s1", "dup", "Row"),
      assign("w1d1s2", "dup", "Row"),
    ]
    const library = [
      exercise("dup", "Row", "pull", ["upper_back"]),
      exercise("alt", "Face Pull", "pull", ["upper_back"]),
    ]
    dedupAssignmentsInPlace(assignments, w, library)
    expect(assignments[0].exercise_id).toBe("dup")
    expect(assignments[1].exercise_id).toBe("alt")
  })

  it("does not swap warm-up / cool-down anchors that legitimately repeat", () => {
    const w = week(1, [
      {
        day_of_week: 1,
        slots: [slot("w1d1s1", "warm_up"), slot("w1d1s2", "warm_up")],
      },
    ])
    const assignments = [
      assign("w1d1s1", "wu", "Cat-Cow"),
      assign("w1d1s2", "wu", "Cat-Cow"),
    ]
    const library = [exercise("wu", "Cat-Cow", "isometric", ["core"])]
    const result = dedupAssignmentsInPlace(assignments, w, library)
    expect(result.swapped_count).toBe(0)
    expect(assignments[1].exercise_id).toBe("wu")
  })

  it("swaps a cross-day duplicate within the same week (default week scope)", () => {
    const w = week(1, [
      { day_of_week: 1, slots: [slot("w1d1s1", "accessory", "pull")] },
      { day_of_week: 3, slots: [slot("w1d3s1", "accessory", "pull")] },
    ])
    const assignments = [
      assign("w1d1s1", "row", "Row"),
      assign("w1d3s1", "row", "Row"), // same exercise on a different day of the same week
    ]
    const library = [
      exercise("row", "Row", "pull", ["upper_back"]),
      exercise("face", "Face Pull", "pull", ["upper_back"]),
    ]
    const result = dedupAssignmentsInPlace(assignments, w, library)
    expect(result.swapped_count).toBe(1)
    // First occurrence stays; the day-3 repeat is swapped to a different exercise
    expect(assignments[0].exercise_id).toBe("row")
    expect(assignments[1].exercise_id).toBe("face")
    expect(result.swaps[0].day_of_week).toBe(3)
  })

  it("preserves day-only scoping when scope: 'day' is passed", () => {
    const w = week(1, [
      { day_of_week: 1, slots: [slot("w1d1s1", "accessory", "pull")] },
      { day_of_week: 3, slots: [slot("w1d3s1", "accessory", "pull")] },
    ])
    const assignments = [
      assign("w1d1s1", "row", "Row"),
      assign("w1d3s1", "row", "Row"),
    ]
    const library = [
      exercise("row", "Row", "pull", ["upper_back"]),
      exercise("face", "Face Pull", "pull", ["upper_back"]),
    ]
    const result = dedupAssignmentsInPlace(assignments, w, library, { scope: "day" })
    expect(result.swapped_count).toBe(0)
    expect(assignments[0].exercise_id).toBe("row")
    expect(assignments[1].exercise_id).toBe("row")
  })

  it("does not pull a within-week replacement that is already used on another day", () => {
    // Day 1 uses "row" and "face"; day 2 repeats "row". A week-scoped swap must
    // NOT pick "face" (already used on day 1) — that would create a new week
    // duplicate — and must land on the unused "straight" instead.
    const w = week(1, [
      { day_of_week: 1, slots: [slot("w1d1s1", "accessory", "pull"), slot("w1d1s2", "accessory", "pull")] },
      { day_of_week: 2, slots: [slot("w1d2s1", "accessory", "pull")] },
    ])
    const assignments = [
      assign("w1d1s1", "row", "Row"),
      assign("w1d1s2", "face", "Face Pull"),
      assign("w1d2s1", "row", "Row"), // week duplicate of day-1 "row"
    ]
    const library = [
      exercise("row", "Row", "pull", ["upper_back"]),
      exercise("face", "Face Pull", "pull", ["upper_back"]),
      exercise("straight", "Straight-Arm Pulldown", "pull", ["upper_back"]),
    ]
    const result = dedupAssignmentsInPlace(assignments, w, library)
    expect(result.swapped_count).toBe(1)
    expect(assignments[2].exercise_id).toBe("straight")
    // No exercise_id may appear more than once across the whole week
    const counts = new Map<string, number>()
    for (const a of assignments) counts.set(a.exercise_id, (counts.get(a.exercise_id) ?? 0) + 1)
    expect([...counts.values()].some((c) => c > 1)).toBe(false)
  })

  it("records unresolved when no suitable alternative exists in the library", () => {
    const w = week(1, [
      {
        day_of_week: 1,
        slots: [slot("w1d1s1", "accessory", "push"), slot("w1d1s2", "accessory", "push")],
      },
    ])
    const assignments = [
      assign("w1d1s1", "only", "Push-Up"),
      assign("w1d1s2", "only", "Push-Up"),
    ]
    const library = [exercise("only", "Push-Up", "push", ["chest"])]
    const result = dedupAssignmentsInPlace(assignments, w, library)
    expect(result.swapped_count).toBe(0)
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0].slot_id).toBe("w1d1s2")
    // Assignment is left in place — coach can manually fix
    expect(assignments[1].exercise_id).toBe("only")
  })

  it("does not introduce a new duplicate when swapping", () => {
    // Two slots want the same exercise, but the only alternative is already used
    // elsewhere in the same day. Should be unresolved, not swap into existing.
    const w = week(1, [
      {
        day_of_week: 1,
        slots: [
          slot("w1d1s1", "accessory", "squat"),
          slot("w1d1s2", "accessory", "squat"),
          slot("w1d1s3", "accessory", "squat"),
        ],
      },
    ])
    const assignments = [
      assign("w1d1s1", "alt", "Goblet Squat"),
      assign("w1d1s2", "dup", "Back Squat"),
      assign("w1d1s3", "dup", "Back Squat"),
    ]
    // Library only has these two — the candidate "alt" is already used in slot 1.
    const library = [
      exercise("alt", "Goblet Squat", "squat", ["quads"]),
      exercise("dup", "Back Squat", "squat", ["quads"]),
    ]
    const result = dedupAssignmentsInPlace(assignments, w, library)
    // Either unresolved, or swapped to something NOT already in the day
    expect(assignments.map((a) => a.exercise_id)).not.toContain("alt-twice")
    // Verify no exercise_id now appears twice in the day
    const counts = new Map<string, number>()
    for (const a of assignments) counts.set(a.exercise_id, (counts.get(a.exercise_id) ?? 0) + 1)
    const duplicatesAfter = [...counts.entries()].filter(([, c]) => c > 1)
    // If unresolved, the duplicate remains (coach must fix). Either way, the
    // invariant is: we never introduced a NEW duplicate by swapping into another
    // used exercise. The only acceptable duplicate is the original "dup" pair.
    for (const [id] of duplicatesAfter) {
      expect(id).toBe("dup")
    }
    expect(result.unresolved.length + result.swapped_count).toBeGreaterThan(0)
  })
})
