import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { appendComplianceFeedback, buildCheckRows } from "../week-orchestrator.js"
import type { AssignedExercise, CompressedExercise, ExerciseSlot, ProgramWeek } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))

function slot(slot_id: string, overrides: Partial<ExerciseSlot> = {}): ExerciseSlot {
  return {
    slot_id,
    role: "accessory",
    movement_pattern: "push",
    target_muscles: [],
    sets: 3,
    reps: "10",
    rest_seconds: 60,
    rpe_target: null,
    tempo: null,
    group_tag: null,
    technique: "straight_set",
    ...overrides,
  }
}

function exercise(
  id: string,
  name: string,
  movement_pattern: CompressedExercise["movement_pattern"],
  primary_muscles: string[],
) {
  return {
    id,
    name,
    category: [],
    difficulty: "intermediate",
    difficulty_score: null,
    muscle_group: null,
    movement_pattern,
    primary_muscles,
    secondary_muscles: [],
    force_type: null,
    laterality: null,
    equipment_required: [],
    is_bodyweight: false,
    training_intent: [],
    sport_tags: [],
    plane_of_motion: [],
    joints_loaded: [],
  } satisfies CompressedExercise
}

function assigned(slot_id: string, exercise_id: string, exercise_name = "from-selector"): AssignedExercise {
  return { slot_id, exercise_id, exercise_name, notes: null }
}

describe("appendComplianceFeedback", () => {
  it("returns the coach's instructions unchanged when there is no feedback", () => {
    expect(appendComplianceFeedback("coach words", null)).toBe("coach words")
  })

  it("puts the feedback AFTER the coach's words, keeping both", () => {
    const out = appendComplianceFeedback("coach words", "PREVIOUS ATTEMPT MISSED: 12 exercises")
    expect(out).toContain("coach words")
    expect(out).toContain("PREVIOUS ATTEMPT MISSED: 12 exercises")
    expect(out!.indexOf("coach words")).toBeLessThan(out!.indexOf("PREVIOUS ATTEMPT MISSED"))
  })

  it("carries the feedback when the coach wrote nothing (a pool-only generation)", () => {
    expect(appendComplianceFeedback(undefined, "fb")).toContain("fb")
  })

  it("stays undefined when there is neither", () => {
    expect(appendComplianceFeedback(undefined, null)).toBeUndefined()
  })
})

describe("buildCheckRows", () => {
  const weeks: ProgramWeek[] = [
    {
      week_number: 3,
      phase: "build",
      intensity_modifier: "moderate",
      days: [
        // Wednesday listed before Monday on purpose: rows follow the calendar.
        {
          day_of_week: 3,
          label: "Wed",
          focus: "pull",
          slots: [
            slot("w3d3s1", { role: "primary_compound", sets: 4, reps: "6", rest_seconds: 120, tempo: "3-1-1-0" }),
          ],
        },
        {
          day_of_week: 1,
          label: "Mon",
          focus: "push",
          slots: [
            slot("w3d1s1", { role: "warm_up", sets: 1, reps: "30s hold", rest_seconds: 0 }),
            slot("w3d1s2", { role: "primary_compound", sets: 5, reps: "5", rest_seconds: 180, tempo: "2-0-1-0" }),
          ],
        },
      ],
    },
  ]
  const library = [
    exercise("bench", "Bench Press", "push", ["chest", "triceps"]),
    exercise("plank", "Plank", "isometric", ["core"]),
    exercise("row", "Barbell Row", "pull", ["upper back"]),
  ]

  it("orders rows by day then slot, names and patterns from the library, prescription from the slot", () => {
    // Assignments arrive out of order, as merged day-chunks do.
    const rows = buildCheckRows(
      weeks,
      [assigned("w3d3s1", "row"), assigned("w3d1s2", "bench"), assigned("w3d1s1", "plank")],
      library,
    )

    expect(rows).toEqual([
      {
        day_of_week: 1,
        order: 0,
        exercise_id: "plank",
        name: "Plank",
        movement_pattern: "isometric",
        primary_muscles: ["core"],
        role: "warm_up",
        sets: 1,
        reps: "30s hold",
        rest_seconds: 0,
        tempo: null,
      },
      {
        day_of_week: 1,
        order: 1,
        exercise_id: "bench",
        name: "Bench Press",
        movement_pattern: "push",
        primary_muscles: ["chest", "triceps"],
        role: "primary_compound",
        sets: 5,
        reps: "5",
        rest_seconds: 180,
        tempo: "2-0-1-0",
      },
      {
        day_of_week: 3,
        order: 0,
        exercise_id: "row",
        name: "Barbell Row",
        movement_pattern: "pull",
        primary_muscles: ["upper back"],
        role: "primary_compound",
        sets: 4,
        reps: "6",
        rest_seconds: 120,
        tempo: "3-1-1-0",
      },
    ])
  })

  it("skips an assignment whose slot is not in the skeleton", () => {
    const rows = buildCheckRows(weeks, [assigned("w3d1s2", "bench"), assigned("w3d9s9", "row")], library)
    expect(rows.map((r) => r.exercise_id)).toEqual(["bench"])
  })

  it("falls back to the selector's name when the exercise is not in the library", () => {
    const rows = buildCheckRows(weeks, [assigned("w3d1s2", "ghost", "Ghost Press")], library)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      exercise_id: "ghost",
      name: "Ghost Press",
      movement_pattern: null,
      primary_muscles: [],
    })
  })
})

/**
 * Compliance feedback must reach the PLANNING agents only. The instruction
 * parser turns the coach's words into unlock/ban sets, and the enricher rewrites
 * them — feeding either the rebuild feedback would let a pipeline message unlock
 * or ban exercises. Neither call is reachable from a unit test without the full
 * Supabase harness, so this is a structural guard on the source.
 */
describe("compliance feedback never reaches the instruction parser or the enricher", () => {
  const src = readFileSync(join(HERE, "..", "week-orchestrator.ts"), "utf8")

  it("the parser reads combinedInstructions, built from the coach's own words", () => {
    expect(src).toContain("extractInstructionIntent(combinedInstructions)")
    expect(src).toMatch(/const combinedInstructions = \[request\.admin_instructions, policyInstructions\]/)
    expect(src).not.toMatch(/extractInstructionIntent\([^)]*plannedInstructions/)
  })

  it("the enricher reads request.admin_instructions", () => {
    expect(src).toContain("enrichCoachInstructions(\n    request.admin_instructions")
    expect(src).not.toMatch(/enrichCoachInstructions\(\s*plannedInstructions/)
  })

  it("the planning agents read plannedInstructions", () => {
    expect(src).toContain("const plannedInstructions = appendComplianceFeedback(agentInstructions, complianceFeedback)")
    expect(src).toMatch(/const analyzerInstructions = \[plannedInstructions, policyInstructions\]/)
    expect(src).toContain("buildCoachInstructionsSection(plannedInstructions)")
  })
})
