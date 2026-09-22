import { describe, expect, it } from "vitest"
import {
  planStageSave,
  strandedStageProblems,
  validateStageList,
  type SavedStage,
  type StageDraft,
} from "@/lib/lead-engine/stage-list"

const open = (key: string, name = key): StageDraft => ({
  id: null, key, name, kind: "open", amberAfterDays: 3, redAfterDays: 7,
})
const won = (): StageDraft => ({ id: null, key: "won", name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null })
const lost = (): StageDraft => ({ id: null, key: "lost", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null })

describe("validateStageList", () => {
  it("accepts a board with one won, one lost and at least one open stage", () => {
    expect(validateStageList([open("enquiry"), won(), lost()])).toEqual([])
  })

  it("refuses an empty list", () => {
    expect(validateStageList([])).toEqual([{ index: null, message: "A board needs at least one stage." }])
  })

  it("refuses a board with no won stage", () => {
    const problems = validateStageList([open("enquiry"), lost()])
    expect(problems).toContainEqual({ index: null, message: "A board needs exactly one Won stage. This one has 0." })
  })

  it("refuses a board with two lost stages", () => {
    const problems = validateStageList([open("enquiry"), won(), lost(), { ...lost(), key: "lost_2" }])
    expect(problems).toContainEqual({ index: null, message: "A board needs exactly one Lost stage. This one has 2." })
  })

  it("refuses amber later than red, naming the stage index", () => {
    const problems = validateStageList([{ ...open("enquiry"), amberAfterDays: 10, redAfterDays: 3 }, won(), lost()])
    expect(problems).toContainEqual({
      index: 0,
      message: 'Stage "enquiry": the amber warning (10 days) cannot come after the red one (3 days).',
    })
  })

  it("refuses two stages sharing a key", () => {
    const problems = validateStageList([open("enquiry"), open("enquiry"), won(), lost()])
    expect(problems).toContainEqual({ index: 1, message: 'Two stages share the key "enquiry". Keys must be unique on a board.' })
  })

  it("refuses a blank name", () => {
    const problems = validateStageList([{ ...open("enquiry"), name: "  " }, won(), lost()])
    expect(problems).toContainEqual({ index: 0, message: "Every stage needs a name." })
  })

  it("allows amber or red to be absent", () => {
    expect(validateStageList([{ ...open("enquiry"), amberAfterDays: null, redAfterDays: null }, won(), lost()])).toEqual([])
  })

  // R4 (controller ruling): not written to kill a mutant -- it asserts real
  // behaviour. The production CHECK constraint on pipeline_stages is
  // `(amber_after_days IS NULL) OR (red_after_days IS NULL) OR
  // (amber_after_days <= red_after_days)`, so equality is legal and this
  // module must accept it. Without this, mutation #2 in the sweep table
  // (`>` -> `>=`) survives, because every other fixture has amber != red.
  it("allows amber equal to red", () => {
    expect(validateStageList([{ ...open("enquiry"), amberAfterDays: 5, redAfterDays: 5 }, won(), lost()])).toEqual([])
  })
})

describe("planStageSave", () => {
  const oldStages: SavedStage[] = [
    { id: "s1", key: "enquiry", position: 1, name: "Enquiry", kind: "open", amberAfterDays: 3, redAfterDays: 7 },
    { id: "s2", key: "booked", position: 2, name: "Booked", kind: "open", amberAfterDays: 3, redAfterDays: 7 },
    { id: "s3", key: "won", position: 3, name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null },
    { id: "s4", key: "lost", position: 4, name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
  ]

  it("keeps every stage when the list is only reordered", () => {
    const next: StageDraft[] = [
      { ...open("booked"), id: "s2" }, { ...open("enquiry"), id: "s1" }, { ...won(), id: "s3" }, { ...lost(), id: "s4" },
    ]
    const plan = planStageSave(oldStages, next, new Map(), new Map())
    expect(plan.removedStageIds).toEqual([])
    expect(plan.moveCards).toEqual([])
    expect(plan.keptStageIds.sort()).toEqual(["s1", "s2", "s3", "s4"])
  })

  it("removes a stage that holds no cards without moving anything", () => {
    const next: StageDraft[] = [{ ...open("enquiry"), id: "s1" }, { ...won(), id: "s3" }, { ...lost(), id: "s4" }]
    const plan = planStageSave(oldStages, next, new Map([["s2", 0]]), new Map())
    expect(plan.removedStageIds).toEqual(["s2"])
    expect(plan.moveCards).toEqual([])
  })

  it("moves the cards off a removed stage to its named destination", () => {
    const next: StageDraft[] = [{ ...open("enquiry"), id: "s1" }, { ...won(), id: "s3" }, { ...lost(), id: "s4" }]
    const plan = planStageSave(oldStages, next, new Map([["s2", 4]]), new Map([["s2", "s1"]]))
    expect(plan.removedStageIds).toEqual(["s2"])
    expect(plan.moveCards).toEqual([{ fromStageId: "s2", toStageId: "s1" }])
  })

  it("treats a stage with cards and no destination as a plan with no move — the caller refuses it", () => {
    const next: StageDraft[] = [{ ...open("enquiry"), id: "s1" }, { ...won(), id: "s3" }, { ...lost(), id: "s4" }]
    const plan = planStageSave(oldStages, next, new Map([["s2", 4]]), new Map())
    expect(plan.moveCards).toEqual([])
    expect(plan.removedStageIds).toEqual(["s2"])
  })

  it("never lists a brand-new stage as kept — it has no id yet", () => {
    const next: StageDraft[] = [
      { ...open("enquiry"), id: "s1" }, open("nurturing"), { ...won(), id: "s3" }, { ...lost(), id: "s4" },
    ]
    const plan = planStageSave(oldStages, next, new Map([["s2", 0]]), new Map())
    expect(plan.keptStageIds).not.toContain(null)
    expect(plan.keptStageIds.sort()).toEqual(["s1", "s3", "s4"])
  })

  // Found during the mutation sweep (mutation #5, `cards > 0 &&` dropped):
  // every other fixture pairs "has cards" with "has a destination" or pairs
  // "no cards" with "no destination", so nothing exercised the case where a
  // destination was named for a stage that turns out to hold nothing. A
  // caller that always sends a destination (rather than omitting it for
  // empty stages) must not produce a phantom move.
  // G29 Task 7 fix round 1, item 6. The editor holds its destination map in
  // state and hands the WHOLE map to this function on every render — including
  // an entry for a stage the coach has since put back on the board. Unreachable
  // from the screen today (there is no undo-remove), and the save-time payload
  // filters to the stranded removals anyway, so this pins the TOLERANCE rather
  // than a live path: a destination keyed to a stage that is still in the list
  // must produce no move at all, not a move off a stage that is staying.
  it("ignores a destination keyed to a stage it is not removing", () => {
    const next: StageDraft[] = [
      { ...open("enquiry"), id: "s1" },
      { ...open("booked"), id: "s2" },
      { ...won(), id: "s3" },
      { ...lost(), id: "s4" },
    ]
    const plan = planStageSave(
      oldStages,
      next,
      new Map([["s2", 4]]),
      // s2 is still on the board; this entry is a leftover.
      new Map([["s2", "s1"]]),
    )
    expect(plan.removedStageIds).toEqual([])
    expect(plan.moveCards).toEqual([])
    expect(plan.keptStageIds.sort()).toEqual(["s1", "s2", "s3", "s4"])
  })

  it("does not move phantom cards off an empty stage even when a destination was given", () => {
    const next: StageDraft[] = [{ ...open("enquiry"), id: "s1" }, { ...won(), id: "s3" }, { ...lost(), id: "s4" }]
    const plan = planStageSave(oldStages, next, new Map([["s2", 0]]), new Map([["s2", "s1"]]))
    expect(plan.moveCards).toEqual([])
    expect(plan.removedStageIds).toEqual(["s2"])
  })
})

describe("strandedStageProblems", () => {
  const oldStages: SavedStage[] = [
    { id: "s1", key: "enquiry", position: 1, name: "Enquiry", kind: "open", amberAfterDays: 3, redAfterDays: 7 },
    { id: "s2", key: "booked", position: 2, name: "Booked", kind: "open", amberAfterDays: 3, redAfterDays: 7 },
  ]

  // R16: the NAME, not the key, and real pluralisation. This string is
  // printed to a coach twice over — inline by the editor and as the route's
  // 400 — so "booked" (a grey box they cannot even type in) and "card(s)"
  // were both wrong on a screen. The fixture's name and key deliberately
  // differ so a regression to the key cannot pass by coincidence.
  it("names the stage the way the coach named it, and counts cards like a person", () => {
    const plan = { moveCards: [], removedStageIds: ["s2"], keptStageIds: ["s1"] }
    expect(strandedStageProblems(oldStages, plan, new Map([["s2", 4]]))).toEqual([
      { index: null, message: 'Stage "Booked" still has 4 cards on it. Say which stage they should move to before removing it.' },
    ])
  })

  it("says one card, not 1 cards", () => {
    const plan = { moveCards: [], removedStageIds: ["s2"], keptStageIds: ["s1"] }
    expect(strandedStageProblems(oldStages, plan, new Map([["s2", 1]]))[0].message).toBe(
      'Stage "Booked" still has 1 card on it. Say which stage they should move to before removing it.',
    )
  })

  // A name is not NOT NULL in any useful sense once a row has been edited by
  // hand, and a message naming nothing at all ("Stage \"\" still has…") is
  // worse than one naming the key.
  it("falls back to the key when a stage's name is blank", () => {
    const blankNamed: SavedStage[] = [{ ...oldStages[1], name: "   " }]
    const plan = { moveCards: [], removedStageIds: ["s2"], keptStageIds: [] }
    expect(strandedStageProblems(blankNamed, plan, new Map([["s2", 2]]))[0].message).toContain('Stage "booked"')
  })

  it("is silent when the cards were given a destination", () => {
    const plan = { moveCards: [{ fromStageId: "s2", toStageId: "s1" }], removedStageIds: ["s2"], keptStageIds: ["s1"] }
    expect(strandedStageProblems(oldStages, plan, new Map([["s2", 4]]))).toEqual([])
  })

  it("is silent when the removed stage was empty", () => {
    const plan = { moveCards: [], removedStageIds: ["s2"], keptStageIds: ["s1"] }
    expect(strandedStageProblems(oldStages, plan, new Map([["s2", 0]]))).toEqual([])
  })
})
