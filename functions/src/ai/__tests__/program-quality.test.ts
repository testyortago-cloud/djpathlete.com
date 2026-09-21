import { describe, it, expect } from "vitest"
import {
  looksLikeDuration,
  findIsometricRepsIssues,
  findRepeatedMovementFamilies,
  buildIsometricWarning,
  buildMovementFamilyWarning,
  buildHallucinatedIdWarning,
} from "../program-quality.js"
import type { CompressedExercise } from "../types.js"

const ex = (id: string, name: string, movement_pattern: string): CompressedExercise =>
  ({
    id,
    name,
    movement_pattern,
    difficulty: "intermediate",
    difficulty_score: null,
    primary_muscles: [],
    secondary_muscles: [],
    equipment_required: [],
    is_bodyweight: true,
    training_intent: ["build"],
    sport_tags: [],
    joints_loaded: [],
    plane_of_motion: [],
  }) as unknown as CompressedExercise

describe("looksLikeDuration", () => {
  it.each(["30 sec", "40s", "5 min", "30s each side", "1:30", "35 seconds", "5 min total", "30s per position"])(
    "reads %j as a duration",
    (reps) => expect(looksLikeDuration(reps)).toBe(true),
  )

  it.each(["10", "8-10", "10 each side", "6 walkouts", "12-15", "6-8 each side", "AMRAP"])(
    "reads %j as a rep count",
    (reps) => expect(looksLikeDuration(reps)).toBe(false),
  )

  it("treats a missing prescription as not-a-duration rather than throwing", () => {
    expect(looksLikeDuration(null)).toBe(false)
    expect(looksLikeDuration(undefined)).toBe(false)
  })
})

describe("findIsometricRepsIssues", () => {
  // Real prescriptions from the 2026-09-21 benchmark, both models.
  const library = [
    ex("iso_rdl", "Isometric SL RDL_hamstrings", "isometric"),
    ex("gate", "Opening the gate hip isometrics_Hip", "isometric"),
    ex("iso_split", "ISo Split squat", "isometric"),
    ex("plank", "reverse shoulder plank", "isometric"),
    ex("sl_squat", "Single Leg Squat", "squat"),
  ]

  it("flags a hold prescribed with reps", () => {
    const issues = findIsometricRepsIssues(
      [{ slot_id: "w3d1s1", exercise_id: "iso_rdl" }],
      library,
      new Map([["w3d1s1", "6 each side"]]),
    )
    expect(issues).toEqual([{ slot_id: "w3d1s1", exercise_name: "Isometric SL RDL_hamstrings", reps: "6 each side" }])
  })

  it("does NOT flag a hold prescribed with a time", () => {
    const issues = findIsometricRepsIssues(
      [{ slot_id: "s", exercise_id: "iso_split" }],
      library,
      new Map([["s", "40 sec"]]),
    )
    expect(issues).toEqual([])
  })

  it("ignores non-isometric exercises given rep counts", () => {
    // A squat with "10" reps is correct and must never be warned about.
    const issues = findIsometricRepsIssues([{ slot_id: "s", exercise_id: "sl_squat" }], library, new Map([["s", "10"]]))
    expect(issues).toEqual([])
  })

  it("catches the both-conventions-in-one-session case the benchmark found", () => {
    // Fable's day 1: two holds given reps, two given seconds, same session.
    const issues = findIsometricRepsIssues(
      [
        { slot_id: "s1", exercise_id: "iso_rdl" },
        { slot_id: "s2", exercise_id: "gate" },
        { slot_id: "s3", exercise_id: "iso_split" },
        { slot_id: "s4", exercise_id: "plank" },
      ],
      library,
      new Map([
        ["s1", "6 each side"],
        ["s2", "10 each side"],
        ["s3", "40 sec"],
        ["s4", "12-15"],
      ]),
    )
    expect(issues.map((i) => i.slot_id)).toEqual(["s1", "s2", "s4"])
  })

  it("skips an exercise that is not in the library", () => {
    const issues = findIsometricRepsIssues([{ slot_id: "s", exercise_id: "ghost" }], library, new Map([["s", "10"]]))
    expect(issues).toEqual([])
  })
})

describe("findRepeatedMovementFamilies", () => {
  it("catches the three hip bridges the dedup check passes at 0%", () => {
    const groups = findRepeatedMovementFamilies([
      "Double leg hip bridge_Hip",
      "Side hip bridge leg lift",
      "hip bridge long lever",
      "Single Leg Squat",
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].family).toEqual(["bridge", "hip"])
    expect(groups[0].exercise_names).toHaveLength(3)
  })

  it("catches the same movement named slightly differently", () => {
    const groups = findRepeatedMovementFamilies(["Through the needle_Core", "Through the needle"])
    expect(groups).toHaveLength(1)
    expect(groups[0].exercise_names).toHaveLength(2)
  })

  it("does NOT flag genuinely different movements", () => {
    expect(
      findRepeatedMovementFamilies(["Single Leg Squat", "Pause push ups_Chest", "Cossack squats", "Side plank"]),
    ).toEqual([])
  })

  it("ignores variant words, so left/right and seated/standing are not a family", () => {
    // Without the stopword list these share "leg"/"single" and would group.
    expect(findRepeatedMovementFamilies(["Single leg calf raise", "Single leg toe tap"])).toEqual([])
  })

  it("returns nothing for a session with one exercise", () => {
    expect(findRepeatedMovementFamilies(["Push up"])).toEqual([])
  })
})

describe("warning text", () => {
  it("names the exercise, its prescription and the slot", () => {
    const [w] = buildIsometricWarning([{ slot_id: "w3d1s1", exercise_name: "reverse shoulder plank", reps: "12-15" }])
    expect(w).toContain("reverse shoulder plank")
    expect(w).toContain("12-15")
    expect(w).toContain("w3d1s1")
  })

  it("explains WHY the duplicate check did not catch the repeat", () => {
    const [w] = buildMovementFamilyWarning("Monday", [{ family: ["hip", "bridge"], exercise_names: ["A", "B", "C"] }])
    expect(w).toContain("Monday")
    expect(w).toContain("duplicate check passes")
  })

  it("says the day is SHORT, not merely that something was removed", () => {
    const [w] = buildHallucinatedIdWarning(1, "Monday")
    expect(w).toContain("shorter than planned")
    expect(w).toContain("Monday")
  })

  it("stays silent when there is nothing wrong", () => {
    expect(buildIsometricWarning([])).toEqual([])
    expect(buildMovementFamilyWarning("Monday", [])).toEqual([])
    expect(buildHallucinatedIdWarning(0, "Monday")).toEqual([])
  })
})
