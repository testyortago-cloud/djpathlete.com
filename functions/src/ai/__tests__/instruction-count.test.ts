import { describe, it, expect } from "vitest"
import { statesExerciseCount, statedExerciseTotal, parsePrescription } from "../instruction-count.js"

/**
 * 2026-10-01, Chris H: "using the exercise pool / 2-4 sets / 4-8 reps / 30-90 sec rest / 4-2-4 tempo"
 * planned a 2-slot Monday. The day directive told the architect the instructions set the count
 * whenever ANY instructions existed, so it took one from "2-4 sets". The directive now asks this
 * function whether the coach actually stated a count.
 */
describe("statesExerciseCount", () => {
  it.each([
    "12 exercises\n2-4 sets\n4-8 reps",
    "12 exercises that are shoulder focused",
    "12 exercises total",
    "• 12 exercises total",
    "HINGE BLOCK (3 exercises):",
    "3 hinge-focused primary_compound movements",
    "2 power exercises",
    "10-12 exercises",
    "1 exercise only",
    "8 movements, mostly lower body",
  ])("reads a count in %j", (text) => {
    expect(statesExerciseCount(text)).toBe(true)
  })

  it.each([
    // The reported run, verbatim.
    "using the exercise pool\n2-4 sets\n4-8 reps\n30-90 sec rest\n4-2-4 tempo",
    "strict use of the exercise pool\n2-4 sets\n4-8 reps\n30-90sec rest\n4-2-4 tempo",
    // A number on one line must not pair with "exercises" on the next.
    "2-4 sets\n4-8 reps\n30-90sec rest\n4-2-4 tempo\nFocus on shoulder exercises",
    "3 sets per exercise",
    "4 x 8 each exercise",
    "rest 90 seconds between exercises",
    "Limit eccentric-heavy exercises to 2 per session",
    "",
  ])("finds no count in %j", (text) => {
    expect(statesExerciseCount(text)).toBe(false)
  })

  it("treats missing instructions as no count", () => {
    expect(statesExerciseCount(undefined)).toBe(false)
  })
})

describe("limits, per-block counts and selections are not a stated count", () => {
  it.each([
    "Include at least 2 compound exercises",
    "Max 3 isolation exercises",
    "no more than 2 exercises",
    "Total time 45 min, 3 exercises per block",
    "3 exercises per block",
    "Pick 5 exercises from the pool",
  ])("statesExerciseCount is false and statedExerciseTotal null for %j", (text) => {
    expect(statesExerciseCount(text)).toBe(false)
    expect(statedExerciseTotal(text)).toBeNull()
  })

  it.each([
    ["12 exercises per day", 12],
    ["12 exercises per session", 12],
    ["10 exercises per workout", 10],
    ["12 exercises per training day", 12],
    ["admin note: 12 exercises", 12],
    ["admin: 12 exercises", 12],
  ])("%j is the day's count", (text, n) => {
    expect(statesExerciseCount(text)).toBe(true)
    expect(statedExerciseTotal(text)).toBe(n)
  })

  it.each(["2 exercises per area", "3 exercises per side", "3 exercises per round", "3 exercises per superset"])(
    "%j is a per-unit count, not the day's",
    (text) => {
      expect(statesExerciseCount(text)).toBe(false)
      expect(statedExerciseTotal(text)).toBeNull()
    },
  )

  it("a 'to' range is a stated count but not a single total", () => {
    expect(statesExerciseCount("10 to 12 exercises")).toBe(true)
    expect(statedExerciseTotal("10 to 12 exercises")).toBeNull()
  })

  it("'total' counts only when attached to the number", () => {
    expect(statedExerciseTotal("12 exercises\n3 exercises total")).toBe(3)
    expect(statedExerciseTotal("total of 10 exercises\nHINGE (3 exercises):")).toBe(10)
    expect(statedExerciseTotal("Total: 9 exercises\nHINGE (3 exercises):")).toBe(9)
    expect(statedExerciseTotal("10 total exercises\nHINGE (3 exercises):")).toBe(10)
  })
})

describe("statedExerciseTotal", () => {
  it.each([
    ["12 exercises\n2-4 sets", 12],
    ["12 exercises that are shoulder focused", 12],
    ["• 12 exercises total\nHINGE BLOCK (3 exercises):\nUPPER (3 exercises):", 12],
    ["8 movements, mostly lower body", 8],
  ])("reads the total in %j", (text, n) => {
    expect(statedExerciseTotal(text)).toBe(n)
  })

  it.each([
    "using the exercise pool\n2-4 sets\n4-8 reps",
    "HINGE BLOCK (3 exercises):\nPOWER BLOCK (2 exercises):", // per-area only, no total line
    "10-12 exercises", // a range is not one total
    "",
  ])("returns null for %j", (text) => {
    expect(statedExerciseTotal(text)).toBeNull()
  })
})

describe("parsePrescription", () => {
  it("reads Darren's usual block", () => {
    expect(parsePrescription("12 exercises\n2-4 sets\n4-8 reps\n30-90sec rest\n4-2-4 tempo")).toEqual({
      sets: [2, 4],
      reps: [4, 8],
      restSeconds: [30, 90],
      tempo: "4-2-4",
    })
  })

  it("reads single values, minutes and the 'rest 60 seconds' order", () => {
    expect(parsePrescription("3 sets\n10 reps\nrest 2 min")).toEqual({
      sets: [3, 3],
      reps: [10, 10],
      restSeconds: [120, 120],
    })
    expect(parsePrescription("Tempo: 3.1.1")).toEqual({ tempo: "3-1-1" })
  })

  it("leaves a field out when the coach mentions it more than once (a second prescription)", () => {
    const p = parsePrescription(
      "12 exercises\n2-4 sets\n4-8 reps\n30-90sec rest\nPOWER: Low reps (3-5), full recovery (120-180s rest)",
    )
    expect(p.sets).toEqual([2, 4])
    expect(p.reps).toBeUndefined()
    expect(p.restSeconds).toBeUndefined()
  })

  it("returns nothing for prose with no prescription", () => {
    expect(parsePrescription("Focus on shoulders")).toEqual({})
    expect(parsePrescription(undefined)).toEqual({})
  })
})
