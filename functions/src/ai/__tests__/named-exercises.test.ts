import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { retainNamed } from "../exercise-filter.js"
import { buildNamedNote, specificNamedIds } from "../shared-helpers.js"

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 2026-10-02, prod job cKrLezpw (Fill Week 8, power block): the coach wrote
 * "Include: box jumps, broad jumps, med ball slams, rotational throws,
 * explosive step-ups". The library had box jumps and slams, the client had the
 * kit, and the parser MATCHED the phrases — but a named exercise was only
 * UNLOCKED. The shortlist cut protected the Preferred pool alone, and the
 * selector was never told which exercises the coach named. The instruction
 * check then failed the week for not using them, and the rebuild (same cut)
 * could not fix it.
 */

const ex = (id: string) => ({ id, name: id })

describe("retainNamed", () => {
  const candidates = ["a1", "b1", "box1", "x1", "box2", "slam1", "box3", "box4"].map(ex) // score order

  it("puts back the best-ranked members of a named group the cut dropped", () => {
    const selected = ["a1", "b1", "x1"].map(ex)
    const out = retainNamed(selected, candidates, [{ phrase: "box jumps", exercise_ids: ["box1", "box2", "box3", "box4"] }], 2)
    expect(out.map((e) => e.id)).toEqual(["a1", "b1", "x1", "box1", "box2"])
  })

  it("tops a group up only to the per-group number", () => {
    const selected = ["a1", "box3"].map(ex)
    const out = retainNamed(selected, candidates, [{ phrase: "box jumps", exercise_ids: ["box1", "box2", "box3", "box4"] }], 2)
    expect(out.map((e) => e.id)).toEqual(["a1", "box3", "box1"])
  })

  it("never brings back an exercise that is not a candidate (a ban or exclusion still holds)", () => {
    const out = retainNamed([ex("a1")], candidates, [{ phrase: "med ball throws", exercise_ids: ["throw1"] }], 3)
    expect(out.map((e) => e.id)).toEqual(["a1"])
  })

  it("keeps every group", () => {
    const out = retainNamed(
      [ex("a1")],
      candidates,
      [
        { phrase: "box jumps", exercise_ids: ["box1", "box2"] },
        { phrase: "med ball slams", exercise_ids: ["slam1"] },
      ],
      1,
    )
    expect(out.map((e) => e.id)).toEqual(["a1", "box1", "slam1"])
  })

  it("changes nothing when there are no named groups (presence control)", () => {
    const selected = [ex("a1")]
    expect(retainNamed(selected, candidates, undefined)).toBe(selected)
    expect(retainNamed(selected, candidates, [])).toBe(selected)
  })
})

describe("specificNamedIds", () => {
  it("exempts a specific request from the variety rule, not a broad word", () => {
    const broad = Array.from({ length: 20 }, (_, i) => `j${i}`)
    const ids = specificNamedIds([
      { phrase: "box jumps", exercise_ids: ["box1", "box2"] },
      { phrase: "jumps", exercise_ids: broad },
    ])
    expect(ids).toEqual(["box1", "box2"])
  })
})

describe("buildNamedNote", () => {
  const offered = [
    { id: "box1", name: "lateral box jumps_lower body" },
    { id: "slam1", name: "Single arm med ball slams_shoulder" },
    { id: "other", name: "Goblet squat" },
  ]

  it("names each group's offered exercises by id and name and asks for one of each", () => {
    const note = buildNamedNote(
      [
        { phrase: "box jumps", exercise_ids: ["box1", "box9"] },
        { phrase: "med ball slams", exercise_ids: ["slam1"] },
      ],
      offered,
      "week",
    )
    expect(note).toContain("at least one exercise from EACH group")
    expect(note).toContain("across the week")
    expect(note).toContain(`"box jumps": box1 — lateral box jumps_lower body`)
    expect(note).toContain(`"med ball slams": slam1 — Single arm med ball slams_shoulder`)
    // box9 was not offered to the selector, so it is not listed.
    expect(note).not.toContain("box9")
  })

  it("leaves out a group with nothing offered, and is empty when no group has anything", () => {
    expect(buildNamedNote([{ phrase: "broad jumps", exercise_ids: ["bj1"] }], offered, "day")).toBe("")
    expect(buildNamedNote([], offered, "day")).toBe("")
  })
})

describe("the week orchestrator wires named exercises through", () => {
  const src = readFileSync(join(HERE, "..", "week-orchestrator.ts"), "utf8")

  it("hands the named groups to the shortlist filter", () => {
    expect(src).toMatch(/const filterOptions = \{[\s\S]*?namedGroups: coachNamed,[\s\S]*?\n  \}/)
  })

  it("exempts specific named exercises from the variety history", () => {
    expect(src).toContain("withoutPoolHistory(buildDedupSourceExercises(existingExercises, newWeekNumber), historyExemptIds)")
    expect(src).toContain("...specificNamedIds(coachNamed)")
  })

  it("puts the named note in the selector's message, next to the pool note", () => {
    expect(src).toContain("${coachInstructionsSection}${poolNote}${namedNote}")
  })

  it("the check reads the same named groups the selector was given", () => {
    expect(src).toContain("namedMatches: coachNamed,")
  })
})
