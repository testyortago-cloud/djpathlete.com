import { describe, it, expect } from "vitest"
import {
  runCodeChecks,
  checkStatus,
  buildComplianceFeedback,
  buildInstructionCheckWarning,
  codeOnlyCheck,
  coachNamedMatches,
  NO_TIME_FOR_AI_NOTE,
  type CheckDayRow,
  type CheckInput,
} from "../instruction-check.js"

const row = (i: number, o: Partial<CheckDayRow> = {}): CheckDayRow => ({
  day_of_week: 1,
  order: i,
  exercise_id: `ex${i}`,
  name: `Exercise ${i}`,
  movement_pattern: "push",
  primary_muscles: ["shoulders"],
  role: "accessory",
  sets: 3,
  reps: "6",
  rest_seconds: 60,
  tempo: "4-2-4",
  ...o,
})
const base = (o: Partial<CheckInput> = {}): CheckInput => ({
  scope: "day",
  instructions: "12 exercises\n2-4 sets\n4-8 reps\n30-90sec rest\n4-2-4 tempo",
  rows: Array.from({ length: 12 }, (_, i) => row(i)),
  pool: null,
  namedMatches: [],
  bannedIds: [],
  nameById: {},
  ...o,
})
const find = (items: ReturnType<typeof runCodeChecks>, s: string) => items.find((i) => i.instruction.includes(s))

describe("runCodeChecks", () => {
  it("passes Darren's usual block on a matching day", () => {
    const items = runCodeChecks(base())
    expect(items.map((i) => i.instruction)).toEqual([
      "12 exercises",
      "2-4 sets",
      "4-8 reps",
      "30-90 sec rest",
      "4-2-4 tempo",
    ])
    expect(items.every((i) => i.met && i.source === "code")).toBe(true)
    expect(find(items, "12 exercises")!.detail).toBe("12 in the day")
  })

  it("fails the count and names the actual number", () => {
    const it2 = find(runCodeChecks(base({ rows: [row(0), row(1)] })), "12 exercises")!
    expect(it2.met).toBe(false)
    expect(it2.detail).toBe("the day has 2")
  })

  it("does not check a count in week scope", () => {
    expect(find(runCodeChecks(base({ scope: "week" })), "exercises")).toBeUndefined()
  })

  it("names the first exercise outside a range", () => {
    const items = runCodeChecks(
      base({
        rows: [...Array.from({ length: 11 }, (_, i) => row(i)), row(11, { name: "Banded press", rest_seconds: 120 })],
      }),
    )
    const rest = find(items, "rest")!
    expect(rest.met).toBe(false)
    expect(rest.detail).toBe("“Banded press” rests 120 s")
  })

  it("treats 4.2.4 as the same tempo as 4-2-4", () => {
    const items = runCodeChecks(base({ rows: Array.from({ length: 12 }, (_, i) => row(i, { tempo: "4.2.4" })) }))
    expect(find(items, "tempo")!.met).toBe(true)
  })

  it("never fails holds or warm-up / cool-down rows on a prescription", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => row(i)),
      row(10, { reps: "30s hold", sets: 1, rest_seconds: 10, tempo: null }),
      row(11, { role: "cool_down", reps: "12", sets: 1, rest_seconds: 0, tempo: "slow" }),
    ]
    const items = runCodeChecks(base({ rows }))
    expect(items.filter((i) => !i.met)).toEqual([])
  })

  it("produces no reps line when the coach wrote a second reps prescription", () => {
    const items = runCodeChecks(base({ instructions: "12 exercises\n2-4 sets\n4-8 reps\nPOWER: Low reps (3-5)" }))
    expect(find(items, "reps")).toBeUndefined()
  })

  describe("Exercise Pool", () => {
    const pool = (o: Partial<NonNullable<CheckInput["pool"]>> = {}) => ({
      ids: ["p1", "p2", "p3"],
      mode: "preferred" as const,
      offeredIds: ["p1", "p2", "p3"],
      ...o,
    })
    const nameById = { p1: "Ab squats", p2: "Bench hip abductions", p3: "Ballerina bulgarians" }

    it("passes when every offered pool exercise is used", () => {
      const rows = [row(0, { exercise_id: "p1" }), row(1, { exercise_id: "p2" }), row(2, { exercise_id: "p3" })]
      const item = find(runCodeChecks(base({ instructions: null, rows, pool: pool(), nameById })), "Exercise Pool")!
      expect(item).toMatchObject({ met: true, detail: "all 3 used" })
    })

    it("fails and names the unused ones", () => {
      const rows = [row(0, { exercise_id: "p1" }), row(1)]
      const item = find(runCodeChecks(base({ instructions: null, rows, pool: pool(), nameById })), "Exercise Pool")!
      expect(item.met).toBe(false)
      expect(item.detail).toBe("not used: Bench hip abductions, Ballerina bulgarians")
    })

    it("passes when the day is smaller than the pool and every slot is a pool exercise", () => {
      const rows = [row(0, { exercise_id: "p1" }), row(1, { exercise_id: "p3" })]
      const item = find(runCodeChecks(base({ instructions: null, rows, pool: pool(), nameById })), "Exercise Pool")!
      expect(item.met).toBe(true)
    })

    it("does not count pool exercises that were never offered (blocked, injury)", () => {
      const rows = [row(0, { exercise_id: "p1" }), row(1, { exercise_id: "p2" })]
      const item = find(
        runCodeChecks(base({ instructions: null, rows, pool: pool({ offeredIds: ["p1", "p2"] }), nameById })),
        "Exercise Pool",
      )!
      expect(item.met).toBe(true)
    })

    it("ignores warm-up and cool-down rows (preferred)", () => {
      const rows = [
        row(0, { name: "Arm circles", role: "warm_up" }),
        row(1, { exercise_id: "p1" }),
        row(2, { exercise_id: "p3" }),
      ]
      const item = find(runCodeChecks(base({ instructions: null, rows, pool: pool(), nameById })), "Exercise Pool")!
      expect(item.met).toBe(true)
    })

    it("ignores warm-up and cool-down rows (strict)", () => {
      const rows = [
        row(0, { name: "Arm circles", role: "warm_up" }),
        row(1, { exercise_id: "p1" }),
        row(2, { exercise_id: "p2" }),
      ]
      const item = find(
        runCodeChecks(base({ instructions: null, rows, pool: pool({ mode: "strict" }), nameById })),
        "Exercise Pool",
      )!
      expect(item).toMatchObject({ met: true, detail: "every exercise is from your pool" })
    })

    it("strict: fails on any exercise outside the pool", () => {
      const rows = [row(0, { exercise_id: "p1" }), row(1, { name: "Other" })]
      const item = find(
        runCodeChecks(base({ instructions: null, rows, pool: pool({ mode: "strict" }), nameById })),
        "Exercise Pool",
      )!
      expect(item).toMatchObject({ met: false, detail: "not from your pool: Other" })
    })
  })

  it("checks named and ruled-out exercises", () => {
    const rows = [
      row(0, { exercise_id: "lm1", name: "Landmine press" }),
      row(1, { exercise_id: "bad", name: "Burpee" }),
    ]
    const items = runCodeChecks(
      base({
        instructions: "include landmine press, no burpees",
        rows,
        namedMatches: [{ phrase: "landmine press", exercise_ids: ["lm1", "lm2"] }],
        bannedIds: ["bad"],
      }),
    )
    expect(find(items, "landmine press")).toMatchObject({ met: true, detail: "Landmine press is in" })
    expect(find(items, "ruled out")).toMatchObject({ met: false, detail: "Burpee is in" })
  })
})

describe("tempo compares the digits, not the punctuation (M2)", () => {
  it.each(["4-2-4", "4.2.4", "4:2:4", "424", "4-2-4-0", " 4 - 2 - 4 "])("%j meets a 4-2-4 instruction", (tempo) => {
    const items = runCodeChecks(base({ rows: Array.from({ length: 12 }, (_, i) => row(i, { tempo })) }))
    expect(find(items, "tempo")!.met).toBe(true)
  })

  it.each(["3-1-1", "4-2-4-1", "4-2-x", "slow"])("%j does not meet a 4-2-4 instruction", (tempo) => {
    const rows = [...Array.from({ length: 11 }, (_, i) => row(i)), row(11, { name: "Off tempo", tempo })]
    const item = find(runCodeChecks(base({ rows })), "tempo")!
    expect(item).toMatchObject({ met: false, detail: `“Off tempo” has ${tempo}` })
  })
})

describe("copy for things that were not there (T2)", () => {
  it("an empty-string tempo reads 'no tempo'", () => {
    const rows = [...Array.from({ length: 11 }, (_, i) => row(i)), row(11, { name: "Plain", tempo: "" })]
    expect(find(runCodeChecks(base({ rows })), "tempo")!.detail).toBe("“Plain” has no tempo")
  })

  it("a null tempo reads 'no tempo' too (presence control)", () => {
    const rows = [...Array.from({ length: 11 }, (_, i) => row(i)), row(11, { name: "Plain", tempo: null })]
    expect(find(runCodeChecks(base({ rows })), "tempo")!.detail).toBe("“Plain” has no tempo")
  })

  it("a Preferred pool with nothing offered gets no pool line at all", () => {
    const items = runCodeChecks(
      base({
        instructions: null,
        rows: [row(0), row(1)],
        pool: { ids: ["p1", "p2"], mode: "preferred", offeredIds: [] },
      }),
    )
    expect(find(items, "Exercise Pool")).toBeUndefined()
  })

  it("a Preferred pool with something offered still gets its line (presence control)", () => {
    const items = runCodeChecks(
      base({
        instructions: null,
        rows: [row(0, { exercise_id: "p1" })],
        pool: { ids: ["p1", "p2"], mode: "preferred", offeredIds: ["p1"] },
      }),
    )
    expect(find(items, "Exercise Pool")).toMatchObject({ met: true, detail: "all 1 used" })
  })
})

describe("codeOnlyCheck with nothing to show (M4)", () => {
  it("says the instructions could not be checked, not that only exact checks are shown", () => {
    const check = codeOnlyCheck(base({ instructions: "mainly shoulders", pool: null }), NO_TIME_FOR_AI_NOTE)
    expect(check.items).toEqual([])
    expect(check.status).toBe("unchecked")
    expect(check.note).toBe("Couldn't check your instructions this time.")
  })

  it("keeps the exact-checks note when there ARE exact checks (presence control)", () => {
    const check = codeOnlyCheck(base(), NO_TIME_FOR_AI_NOTE)
    expect(check.items.length).toBeGreaterThan(0)
    expect(check.note).toBe(NO_TIME_FOR_AI_NOTE)
  })
})

describe("coachNamedMatches (I1 + M7)", () => {
  const matched = [
    { phrase: "landmine press", exercise_ids: ["lm1", "lm2"] },
    // From the studio's coach policy, appended to the parser's text — the coach never typed it.
    { phrase: "Nordic curls", exercise_ids: ["nc1"] },
    { phrase: "trap bar deadlift", exercise_ids: ["tb1", "tb2"] },
  ]

  it("keeps a match the coach typed and drops one that came from policy only", () => {
    const kept = coachNamedMatches(matched, "Include a Landmine Press, 12 exercises", [])
    expect(kept).toEqual([{ phrase: "landmine press", exercise_ids: ["lm1", "lm2"] }])
  })

  it("drops banned ids from a kept match, and the match when none remain", () => {
    const kept = coachNamedMatches(matched, "landmine press and trap bar deadlift", ["lm2", "tb1", "tb2"])
    expect(kept).toEqual([{ phrase: "landmine press", exercise_ids: ["lm1"] }])
  })

  it("keeps nothing when the coach wrote nothing", () => {
    expect(coachNamedMatches(matched, null, [])).toEqual([])
    expect(coachNamedMatches(matched, "   ", [])).toEqual([])
  })
})

describe("status, feedback and warning", () => {
  const met = { instruction: "a", met: true, detail: "ok", source: "code" as const }
  const miss = { instruction: "Exercise Pool", met: false, detail: "not used: X", source: "code" as const }

  it("status", () => {
    expect(checkStatus([])).toBe("unchecked")
    expect(checkStatus([met])).toBe("passed")
    expect(checkStatus([met, miss])).toBe("failed")
  })

  it("feedback lists unmet items only", () => {
    expect(buildComplianceFeedback([met, miss])).toBe(
      "PREVIOUS ATTEMPT MISSED THESE COACH INSTRUCTIONS — fix every one:\n- Exercise Pool: not used: X",
    )
    expect(buildComplianceFeedback([met])).toBe("")
  })

  it("warning line counts unmet items", () => {
    const check = { status: "failed" as const, items: [met, miss], rebuilt: true, rebuild_reason: null, note: null }
    expect(buildInstructionCheckWarning(check)).toEqual([
      "1 of your instructions wasn't fully met — see “Your instructions, checked”.",
    ])
    expect(buildInstructionCheckWarning({ ...check, items: [met] })).toEqual([])
  })
})
