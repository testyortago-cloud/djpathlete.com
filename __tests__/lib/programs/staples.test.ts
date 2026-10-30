import { describe, it, expect } from "vitest"
import { keyLiftExercises, staplesFromParams } from "@/lib/programs/staples"

const SQUAT = "11111111-1111-4111-8111-111111111111"
const BENCH = "22222222-2222-4222-8222-222222222222"
const ROW = "33333333-3333-4333-8333-333333333333"
const CURL = "44444444-4444-4444-8444-444444444444"

describe("staplesFromParams", () => {
  it("reads the staples saved with the program's request", () => {
    const params = {
      request: {
        goals: ["strength"],
        staple_exercises: [
          { exercise_id: SQUAT, every_weeks: 1 },
          { exercise_id: BENCH, every_weeks: 3 },
        ],
      },
      validation: { pass: true },
    }
    expect(staplesFromParams(params)).toEqual([
      { exercise_id: SQUAT, every_weeks: 1 },
      { exercise_id: BENCH, every_weeks: 3 },
    ])
  })

  it.each([
    ["null (a program that was not AI-generated)", null],
    ["undefined", undefined],
    ["a string", "staples"],
    ["an import report with no request", { rows: 12, token_usage: null }],
    ["a request with no staples", { request: { goals: ["strength"] } }],
    ["staple_exercises that is not an array", { request: { staple_exercises: { exercise_id: SQUAT } } }],
  ])("returns [] for %s", (_label, params) => {
    expect(staplesFromParams(params)).toEqual([])
  })

  it("keeps the good entries and drops malformed ones", () => {
    const params = {
      request: {
        staple_exercises: [
          null,
          "squat",
          { exercise_id: 42, every_weeks: 1 },
          { exercise_id: BENCH },
          { exercise_id: ROW, every_weeks: 0 },
          { exercise_id: ROW, every_weeks: 1.5 },
          { exercise_id: SQUAT, every_weeks: 2 },
        ],
      },
    }
    expect(staplesFromParams(params)).toEqual([{ exercise_id: SQUAT, every_weeks: 2 }])
  })
})

describe("keyLiftExercises", () => {
  const programNames = new Map([
    [SQUAT, "Back Squat"],
    [BENCH, "Bench Press"],
    [ROW, "Barbell Row"],
  ])

  it("puts the staples first, then the tracked exercises, each exercise once", () => {
    const lifts = keyLiftExercises(
      [
        { exercise_id: SQUAT, every_weeks: 1 },
        { exercise_id: BENCH, every_weeks: 2 },
      ],
      programNames,
      [
        { exerciseId: CURL, exerciseName: "Biceps Curl" },
        { exerciseId: BENCH, exerciseName: "Bench Press" },
      ],
    )
    expect(lifts).toEqual([
      { exerciseId: SQUAT, exerciseName: "Back Squat", staple: true },
      { exerciseId: BENCH, exerciseName: "Bench Press", staple: true },
      { exerciseId: CURL, exerciseName: "Biceps Curl", staple: false },
    ])
  })

  it("leaves out a staple that is not in the program", () => {
    const lifts = keyLiftExercises(
      [
        { exercise_id: CURL, every_weeks: 1 },
        { exercise_id: ROW, every_weeks: 1 },
      ],
      programNames,
      [],
    )
    expect(lifts).toEqual([{ exerciseId: ROW, exerciseName: "Barbell Row", staple: true }])
  })

  it("is the tracked exercises alone when the program has no staples", () => {
    const tracked = [
      { exerciseId: CURL, exerciseName: "Biceps Curl" },
      { exerciseId: SQUAT, exerciseName: "Back Squat" },
    ]
    expect(keyLiftExercises([], programNames, tracked)).toEqual([
      { exerciseId: CURL, exerciseName: "Biceps Curl", staple: false },
      { exerciseId: SQUAT, exerciseName: "Back Squat", staple: false },
    ])
  })
})
