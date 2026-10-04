import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  appendComplianceFeedback,
  buildCheckRows,
  generateWithCompliance,
  type WeekAttempt,
} from "../week-orchestrator.js"
import type { CheckInput, InstructionCheck } from "../instruction-check.js"
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
            slot("w3d3s1", { role: "primary_compound", sets: 4, reps: "6", rest_seconds: 120, tempo: "3-1-1-0", rpe_target: 8 }),
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
        rpe: null,
        intent: [],
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
        rpe: null,
        intent: [],
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
        rpe: 8,
        intent: [],
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
  })

  it("the feedback is named in exactly two places: the parameter, and the one call that appends it", () => {
    // Any other use — `request.admin_instructions + complianceFeedback` into the
    // enricher or the parser — adds an occurrence and fails here.
    expect(src.match(/\bcomplianceFeedback\b/g)).toHaveLength(2)
    expect(src).toMatch(/\n  complianceFeedback: string \| null,\n\): Promise<WeekAttempt>/)
    expect(src).toContain("appendComplianceFeedback(agentInstructions, complianceFeedback)")
  })

  it("the planning agents read plannedInstructions", () => {
    expect(src).toContain("const plannedInstructions = appendComplianceFeedback(agentInstructions, complianceFeedback)")
    expect(src).not.toMatch(/analyzerInstructions/)
    expect(src).toContain("buildCoachInstructionsSection(plannedInstructions)")
  })

  it("the rebuild gate and the judge both leave the save its reserve", () => {
    expect(src).toContain("deadline ? deadline.remainingMs() - SAVE_RESERVE_MS : null")
    expect(src).toContain("checkWithinBudget(input, deadline, { keepOnTimeout: isFirst })")
  })

  // I1: the parser reads the studio's coach policy too, so its raw matches would
  // turn policy text into "named exercise" lines the coach never wrote.
  it("the checker's named matches are only the ones the coach typed, without banned ids", () => {
    // Since 2026-10-02 one `coachNamed` list feeds the cut, the selector note and
    // the check, so it is computed once and the check reads it.
    expect(src).toMatch(
      /const coachNamed = coachNamedMatches\(\s*intentResolution\.matched,\s*request\.admin_instructions,\s*intentResolution\.bannedIds,?\s*\)/,
    )
    expect(src).toContain("namedMatches: coachNamed,")
    expect(src).not.toContain("namedMatches: intentResolution.matched")
  })
})

// ── The wrapper: build → check → maybe rebuild → save exactly one attempt ──

const RESULT = {
  new_week_number: 4,
  exercises_added: 0,
  token_usage: { architect: 0, selector: 0, total: 0, cache_creation: 0, cache_read: 0 },
  duration_ms: 1,
  warnings: [],
  instructions_used: null,
  instruction_check: null,
}

const checkOf = (met: boolean): InstructionCheck => ({
  status: met ? "passed" : "failed",
  items: [{ instruction: "12 exercises", met, detail: met ? "12 in the day" : "the day has 11", source: "code" }],
  rebuilt: false,
  rebuild_reason: null,
  note: null,
})

function attempt(id: number) {
  const save = vi.fn(async (check: InstructionCheck | null) => ({
    ...RESULT,
    exercises_added: id,
    instruction_check: check,
  }))
  const cancelled = vi.fn(() => ({ ...RESULT, exercises_added: -id }))
  const a: WeekAttempt = {
    durationMs: 1000,
    earlyResult: null,
    save,
    cancelled,
    checkInput: {
      scope: "day",
      instructions: `attempt ${id}`,
      rows: [],
      pool: null,
      namedMatches: [],
      bannedIds: [],
      nameById: {},
    },
  }
  return { a, save, cancelled }
}

function deps(over: Partial<Parameters<typeof generateWithCompliance>[0]> = {}) {
  const one = attempt(1)
  const two = attempt(2)
  const build = vi.fn(async (fb: string | null) => (fb === null ? one.a : two.a))
  const runCheck = vi.fn(async (input: CheckInput, _isFirst: boolean) => checkOf(input.instructions === "attempt 2"))
  const progress = vi.fn(async (_detail: string) => {})
  const d = {
    build,
    needsCheck: true,
    runCheck,
    remainingMs: () => null,
    isCancelled: vi.fn(async () => false),
    progress,
    ...over,
  }
  return { d, one, two, build, runCheck, progress }
}

describe("generateWithCompliance", () => {
  it("nothing to check -> saves the first attempt with no check and no model call", async () => {
    const { d, one } = deps({ needsCheck: false })
    const r = await generateWithCompliance(d)
    expect(d.runCheck).not.toHaveBeenCalled()
    expect(one.save).toHaveBeenCalledTimes(1)
    expect(one.save).toHaveBeenCalledWith(null)
    expect(r.instruction_check).toBeNull()
  })

  it("a cancelled first attempt is returned as-is: nothing checked, nothing saved", async () => {
    const early = { durationMs: 5, earlyResult: { ...RESULT, exercises_added: 99 } } as WeekAttempt
    const { d } = deps({ build: vi.fn(async () => early) })
    const r = await generateWithCompliance(d)
    expect(r.exercises_added).toBe(99)
    expect(d.runCheck).not.toHaveBeenCalled()
  })

  it("passes -> saves attempt 1 once, with its check", async () => {
    const { d, one, two } = deps({ runCheck: vi.fn(async () => checkOf(true)) })
    const r = await generateWithCompliance(d)
    expect(d.build).toHaveBeenCalledTimes(1)
    expect(one.save).toHaveBeenCalledTimes(1)
    expect(one.save).toHaveBeenCalledWith(checkOf(true))
    expect(two.save).not.toHaveBeenCalled()
    expect(r.instruction_check?.status).toBe("passed")
  })

  it("misses -> rebuilds once and saves ONLY the kept attempt", async () => {
    const { d, one, two, build } = deps()
    const r = await generateWithCompliance(d)
    expect(build).toHaveBeenCalledTimes(2)
    expect(build.mock.calls[1][0]).toContain("12 exercises: the day has 11")
    expect(one.save).not.toHaveBeenCalled()
    expect(two.save).toHaveBeenCalledTimes(1)
    expect(r.instruction_check).toMatchObject({ status: "passed", rebuilt: true })
  })

  it("tells the check whether it is the first attempt's", async () => {
    const { d, runCheck } = deps()
    await generateWithCompliance(d)
    expect(runCheck.mock.calls.map((c) => c[1])).toEqual([true, false])
  })

  it("says what it is doing, in the attempt's own scope", async () => {
    const { d, progress } = deps()
    await generateWithCompliance(d)
    expect(progress.mock.calls.map((c) => c[0])).toEqual([
      "Checking the day against your instructions",
      "Rebuilding to follow your instructions",
      "Checking the day against your instructions",
    ])
  })

  it("cancelled right before the save -> the cancellation result, nothing saved", async () => {
    const { d, one } = deps({ runCheck: vi.fn(async () => checkOf(true)), isCancelled: vi.fn(async () => true) })
    const r = await generateWithCompliance(d)
    expect(one.save).not.toHaveBeenCalled()
    expect(one.cancelled).toHaveBeenCalledTimes(1)
    expect(r.exercises_added).toBe(-1)
  })
})
