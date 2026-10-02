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

  // Prod, 2026-10-02: the warning fired on nearly every run. 77 of the library's
  // 167 "isometric" exercises are not holds — stretches, foam rolls and moves
  // like these, for which a rep count is right. Only a NAME that says hold counts.
  it("does not flag a rep exercise filed as isometric", () => {
    const misfiled = [
      ex("ff", "90 90 foot lifts", "isometric"),
      ex("toe", "Toe lifts_Ankle", "isometric"),
      ex("wall", "Plate wall sliders_shoulders", "isometric"),
      ex("sphl", "Side plank hip lift_Core", "isometric"),
      ex("dead", "Prone hang deadbug_core", "isometric"),
    ]
    const issues = findIsometricRepsIssues(
      misfiled.map((e, i) => ({ slot_id: `s${i}`, exercise_id: e.id })),
      misfiled,
      new Map(misfiled.map((_, i) => [`s${i}`, "4 each side"])),
    )
    expect(issues).toEqual([])
  })

  it("still flags a named hold given reps (presence control)", () => {
    const holds = [
      ex("h1", "Seated shoulder flexion holds", "isometric"),
      ex("h2", "Side plank_Core", "isometric"),
      ex("h3", "Wall sit_Quadricep", "isometric"),
    ]
    const issues = findIsometricRepsIssues(
      holds.map((e, i) => ({ slot_id: `s${i}`, exercise_id: e.id })),
      holds,
      new Map(holds.map((_, i) => [`s${i}`, "6"])),
    )
    expect(issues.map((i) => i.exercise_name)).toEqual([
      "Seated shoulder flexion holds",
      "Side plank_Core",
      "Wall sit_Quadricep",
    ])
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

  // Production warnings, 2026-10-02. The library names exercises "Name_BodyPart",
  // so two different movements filed under the same body part shared tokens
  // ("all body full"), and so did two movements on the same machine ("all cable
  // pulley"). A family is a MOVEMENT: neither the filing suffix nor the
  // equipment says what the body does.
  it("does not group two movements because they are filed under the same body part", () => {
    expect(
      findRepeatedMovementFamilies([
        "Iso split squat with jumps_Full body",
        "3 step hop_Full body",
        "Rotating high med balls slams_Full body",
      ]),
    ).toEqual([])
  })

  it("does not group two movements because they use the same equipment", () => {
    expect(
      findRepeatedMovementFamilies(["Cable pulley step up_Quadricep", "Cable pulley dumbbell rotation pulls_Shoulder"]),
    ).toEqual([])
    expect(
      findRepeatedMovementFamilies(["Laying cable internal rotation_Shoulder", "single arm cross cable pull_shoulder"]),
    ).toEqual([])
  })

  // The photo's own pair. "(posterior delts)" names the TARGET muscle, not the
  // movement: a row and a pull-across are two movements for the rear delts.
  it("does not group two movements because a bracketed note names the same target", () => {
    expect(
      findRepeatedMovementFamilies([
        "Banded cable rows (posterior delts)_Shoulder",
        "Cable pull across (posterior delts)_Shoulder",
      ]),
    ).toEqual([])
  })

  // Replay, 2026-10-02: a pull and a tricep exercise were "(all bench supported)".
  it("does not group two movements because both are done on the same support", () => {
    expect(
      findRepeatedMovementFamilies(["Cable bench supported mid back pulls_back", "Bench supported tricep drop downs_Tricep"]),
    ).toEqual([])
  })

  it("still groups the same movement on different equipment (presence control)", () => {
    const groups = findRepeatedMovementFamilies(["Cable hip bridge_Glute", "Banded hip bridge march_Hip"])
    expect(groups).toHaveLength(1)
    expect(groups[0].family).toEqual(["bridge", "hip"])
  })
})

describe("warning text", () => {
  // 2026-10-02: the coach read "(slot w8d2s9)" — an internal id the coach cannot find
  // anywhere on screen. Name the day instead; never the slot id.
  it("names the exercise, its prescription and the day — not the slot id", () => {
    const [w] = buildIsometricWarning(
      [{ slot_id: "w3d1s1", exercise_name: "reverse shoulder plank", reps: "12-15" }],
      (slotId) => (slotId === "w3d1s1" ? "Monday" : null),
    )
    expect(w).toContain("reverse shoulder plank")
    expect(w).toContain("12-15")
    expect(w).toContain("on Monday")
    expect(w).not.toContain("w3d1s1")
    expect(w).not.toMatch(/\bslot\b/)
  })

  it("leaves the day out rather than printing an id when it cannot name one", () => {
    const [w] = buildIsometricWarning([{ slot_id: "w3d1s1", exercise_name: "reverse shoulder plank", reps: "12-15" }])
    expect(w).toContain("reverse shoulder plank")
    expect(w).not.toContain("w3d1s1")
    expect(w).not.toMatch(/\bslot\b/)
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
