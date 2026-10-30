import { describe, it, expect } from "vitest"
import { placeStaples, stapleNote, staplesDueInWeek, staplesFromParams, withoutStaples } from "../staples.js"
import type { AssignedExercise, CompressedExercise, ExerciseSlot, ProgramWeek } from "../types.js"

/**
 * The coach (2026-10-30 meeting): "four up to six exercises ... pull-ups every third week" so the
 * client can see their progress. The generator works against repetition everywhere, so a staple
 * is due on a schedule, exempt from that history, and put in place if the AI left it out.
 */
const ex = (id: string, movement_pattern: string | null, primary_muscles: string[] = []) =>
  ({ id, name: `Ex ${id}`, movement_pattern, primary_muscles }) as unknown as CompressedExercise
const slot = (slot_id: string, role: string, movement_pattern: string, target_muscles: string[] = []) =>
  ({ slot_id, role, movement_pattern, target_muscles }) as unknown as ExerciseSlot
const pick = (slot_id: string, exercise_id: string): AssignedExercise => ({
  slot_id,
  exercise_id,
  exercise_name: `Ex ${exercise_id}`,
  notes: "old note",
})
const week = (...slots: ExerciseSlot[]): ProgramWeek =>
  ({ week_number: 4, days: [{ day_of_week: 1, slots }] }) as unknown as ProgramWeek

const pullUp = ex("pull-up", "vertical_pull", ["lats"])
const library = [pullUp, ex("row", "horizontal_pull", ["lats"]), ex("squat", "squat", ["quads"])]

describe("staplesDueInWeek", () => {
  const staples = [
    { exercise_id: "a", every_weeks: 1 },
    { exercise_id: "b", every_weeks: 3 },
  ]
  it("every 3 weeks is weeks 1, 4, 7 and 10", () => {
    const due = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((w) =>
      staplesDueInWeek(staples, w).some((s) => s.exercise_id === "b"),
    )
    expect(due).toEqual([1, 4, 7, 10])
  })
  it("every week is every week", () => {
    expect(staplesDueInWeek(staples, 2).map((s) => s.exercise_id)).toEqual(["a"])
  })
  it("no staples, nothing due", () => {
    expect(staplesDueInWeek(undefined, 1)).toEqual([])
  })
})

describe("placeStaples", () => {
  const due = [{ exercise_id: "pull-up", every_weeks: 3 }]

  it("puts a staple the AI left out into the slot planned for its movement pattern", () => {
    const assignments = [pick("s1", "squat"), pick("s2", "row-alt")]
    const w = week(slot("s1", "primary_compound", "squat"), slot("s2", "secondary_compound", "vertical_pull"))
    expect(placeStaples(assignments, w, due, library)).toEqual({ placed: ["pull-up"], unplaced: [] })
    expect(assignments.map((a) => a.exercise_id)).toEqual(["squat", "pull-up"])
    expect(assignments[1].notes).toBeNull() // the old exercise's coaching note does not carry over
  })
  it("falls back to a slot aimed at one of its primary muscles", () => {
    const assignments = [pick("s1", "squat"), pick("s2", "row")]
    const w = week(
      slot("s1", "primary_compound", "squat", ["quads"]),
      slot("s2", "accessory", "horizontal_pull", ["lats"]),
    )
    placeStaples(assignments, w, due, library)
    expect(assignments.map((a) => a.exercise_id)).toEqual(["squat", "pull-up"])
  })
  it("never uses a warm-up or cool-down slot", () => {
    const assignments = [pick("w", "band")]
    const w = week(slot("w", "warm_up", "vertical_pull", ["lats"]))
    expect(placeStaples(assignments, w, due, library).unplaced).toEqual(["pull-up"])
    expect(assignments[0].exercise_id).toBe("band")
  })
  it("leaves the week alone when the AI already used the staple", () => {
    const assignments = [pick("s1", "pull-up"), pick("s2", "row")]
    const w = week(slot("s1", "primary_compound", "vertical_pull"), slot("s2", "accessory", "vertical_pull"))
    expect(placeStaples(assignments, w, due, library)).toEqual({ placed: [], unplaced: [] })
    expect(assignments.map((a) => a.exercise_id)).toEqual(["pull-up", "row"])
  })
  it("does not push out another staple that is due", () => {
    const twoDue = [...due, { exercise_id: "squat", every_weeks: 1 }]
    const assignments = [pick("s1", "squat")]
    const w = week(slot("s1", "primary_compound", "vertical_pull"))
    expect(placeStaples(assignments, w, twoDue, library).unplaced).toEqual(["pull-up"])
    expect(assignments[0].exercise_id).toBe("squat")
  })
  it("does not place a staple that is not in the library it may use (blocked or ruled out)", () => {
    const assignments = [pick("s1", "row")]
    const w = week(slot("s1", "primary_compound", "vertical_pull"))
    expect(placeStaples(assignments, w, due, [ex("row", "horizontal_pull")]).unplaced).toEqual(["pull-up"])
    expect(assignments[0].exercise_id).toBe("row")
  })
})

describe("withoutStaples", () => {
  it("drops staples from prior weeks so repeating one is not repetition", () => {
    const prior = [{ week_number: 1, assignments: [pick("a", "pull-up"), pick("b", "row")] }]
    const out = withoutStaples(prior, [{ exercise_id: "pull-up", every_weeks: 3 }])
    expect(out[0].assignments.map((a) => a.exercise_id)).toEqual(["row"])
    expect(prior[0].assignments).toHaveLength(2) // the real history is untouched
  })
})

describe("staplesFromParams", () => {
  it("reads the staples saved with the program's request", () => {
    const params = { request: { staple_exercises: [{ exercise_id: "pull-up", every_weeks: 3 }] } }
    expect(staplesFromParams(params)).toEqual([{ exercise_id: "pull-up", every_weeks: 3 }])
  })
  it("is empty for a program with no request, or a malformed one", () => {
    expect(staplesFromParams(null)).toEqual([])
    expect(staplesFromParams({ request: { staple_exercises: "x" } })).toEqual([])
    expect(staplesFromParams({ request: { staple_exercises: [{ exercise_id: 1, every_weeks: 0 }] } })).toEqual([])
  })
})

describe("stapleNote", () => {
  it("names each due staple with its id", () => {
    const note = stapleNote([{ exercise_id: "pull-up", every_weeks: 3 }], library)
    expect(note).toContain("Ex pull-up (exercise_id pull-up)")
    expect(note).toContain("NOT repetition")
  })
  it("is empty when nothing is due", () => {
    expect(stapleNote([], library)).toBe("")
  })
})
