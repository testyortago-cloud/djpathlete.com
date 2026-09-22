import { describe, expect, it } from "vitest"
import {
  invalidDestinationProblems,
  kindChangeVisibilityProblems,
  movedClosedCardProblems,
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

// ---------------------------------------------------------------------------
// WHOLE-BRANCH REVIEW, IMPORTANT 1. A destination the same save is removing.
// ---------------------------------------------------------------------------

describe("invalidDestinationProblems", () => {
  const oldStages: SavedStage[] = [
    { id: "s1", key: "enquiry", position: 1, name: "Enquiry", kind: "open", amberAfterDays: 3, redAfterDays: 7 },
    { id: "s2", key: "consulted", position: 2, name: "Consulted", kind: "open", amberAfterDays: 3, redAfterDays: 7 },
    { id: "s3", key: "proposal", position: 3, name: "Proposal", kind: "open", amberAfterDays: 3, redAfterDays: 7 },
  ]

  it("refuses a destination that is also being removed, naming both stages", () => {
    const plan = {
      moveCards: [{ fromStageId: "s2", toStageId: "s3" }],
      removedStageIds: ["s2", "s3"],
      keptStageIds: ["s1"],
    }
    expect(invalidDestinationProblems(oldStages, plan)).toEqual([
      {
        index: null,
        message:
          'The stage you chose for the cards on "Consulted" ("Proposal") is being removed too. Pick one that is staying.',
      },
    ])
  })

  // A different sentence for a different mistake: a destination that is not a
  // stage on this board cannot honestly be described as "being removed too".
  it("refuses a destination that is not a stage on this board, without claiming it is being removed", () => {
    const plan = {
      moveCards: [{ fromStageId: "s2", toStageId: "another-boards-stage" }],
      removedStageIds: ["s2"],
      keptStageIds: ["s1", "s3"],
    }
    const problems = invalidDestinationProblems(oldStages, plan)
    expect(problems).toEqual([
      {
        index: null,
        message: 'The stage you chose for the cards on "Consulted" is not a stage on this board. Pick one that is staying.',
      },
    ])
    expect(problems[0].message).not.toContain("being removed too")
  })

  // THE PRESENCE CONTROL. Without it a function that refused EVERY move would
  // pass both tests above.
  it("is silent when the destination is a stage that stays", () => {
    const plan = {
      moveCards: [{ fromStageId: "s2", toStageId: "s1" }],
      removedStageIds: ["s2"],
      keptStageIds: ["s1", "s3"],
    }
    expect(invalidDestinationProblems(oldStages, plan)).toEqual([])
  })

  it("is silent when there is nothing to move", () => {
    expect(
      invalidDestinationProblems(oldStages, { moveCards: [], removedStageIds: ["s2"], keptStageIds: ["s1", "s3"] }),
    ).toEqual([])
  })

  it("falls back to the key when the stage being emptied has a blank name", () => {
    const blank: SavedStage[] = [{ ...oldStages[1], name: "  " }, oldStages[2]]
    const plan = { moveCards: [{ fromStageId: "s2", toStageId: "s3" }], removedStageIds: ["s2", "s3"], keptStageIds: [] }
    expect(invalidDestinationProblems(blank, plan)[0].message).toContain('cards on "consulted"')
  })
})

// ---------------------------------------------------------------------------
// WHOLE-BRANCH REVIEW, IMPORTANT 2 (controller ruling R19). A `kind` change
// that takes settled deals off the board.
// ---------------------------------------------------------------------------

describe("kindChangeVisibilityProblems", () => {
  const oldStages: SavedStage[] = [
    { id: "s1", key: "enquiry", position: 1, name: "Enquiry", kind: "open", amberAfterDays: null, redAfterDays: null },
    { id: "s2", key: "won", position: 2, name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null },
    { id: "s3", key: "lost", position: 3, name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
  ]
  const draft = (id: string | null, key: string, name: string, kind: "open" | "won" | "lost"): StageDraft => ({
    id,
    key,
    name,
    kind,
    amberAfterDays: null,
    redAfterDays: null,
  })

  it("refuses turning a won stage open while it holds closed cards, at that row's index", () => {
    const problems = kindChangeVisibilityProblems(
      oldStages,
      [draft("s1", "enquiry", "Enquiry", "open"), draft("s2", "won", "Won", "open"), draft("s3", "lost", "Lost", "lost")],
      new Map([["s2", 4]]),
    )
    expect(problems).toEqual([
      {
        index: 1,
        message:
          'Stage "Won" holds 4 cards that are already won or lost. Changing it to a stage that is still open ' +
          "would take them off the board, where nobody would find them. Move those cards to another stage first.",
      },
    ])
  })

  it("says one card, not 1 cards", () => {
    const problems = kindChangeVisibilityProblems(
      oldStages,
      [draft("s1", "enquiry", "Enquiry", "open"), draft("s2", "won", "Won", "open"), draft("s3", "lost", "Lost", "lost")],
      new Map([["s2", 1]]),
    )
    expect(problems[0].message).toBe(
      'Stage "Won" holds 1 card that is already won or lost. Changing it to a stage that is still open ' +
        "would take it off the board, where nobody would find it. Move that card to another stage first.",
    )
  })

  it("refuses the LOST stage on the same rule, not only the won one", () => {
    const problems = kindChangeVisibilityProblems(
      oldStages,
      [draft("s1", "enquiry", "Enquiry", "open"), draft("s2", "won", "Won", "won"), draft("s3", "lost", "Lost", "open")],
      new Map([["s3", 2]]),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0].index).toBe(2)
    expect(problems[0].message).toContain('Stage "Lost"')
  })

  // THE PRESENCE CONTROL: the same stage, the same closed cards, no kind
  // change. Renaming Won while it holds settled deals is the ORDINARY thing a
  // coach does, and refusing it would make the board uneditable.
  it("allows renaming a won stage that holds closed cards, because nothing disappears", () => {
    expect(
      kindChangeVisibilityProblems(
        oldStages,
        [draft("s1", "enquiry", "Enquiry", "open"), draft("s2", "won", "Closed won", "won"), draft("s3", "lost", "Lost", "lost")],
        new Map([["s2", 4]]),
      ),
    ).toEqual([])
  })

  // The other half of the same guard. A stage that is ALREADY open cannot
  // hide anything by staying open, whatever the count says.
  it("allows an open stage to stay open, whatever its closed count", () => {
    expect(
      kindChangeVisibilityProblems(
        oldStages,
        [draft("s1", "enquiry", "Enquiry", "open"), draft("s2", "won", "Won", "won"), draft("s3", "lost", "Lost", "lost")],
        new Map([["s1", 3]]),
      ),
    ).toEqual([])
  })

  // Deliberately NOT refused — see the function's own doc comment. `open ->
  // won` puts outcome-null cards in the Won column, which is wrong but
  // VISIBLE, and a coach can undo it by looking at it.
  it("allows an open stage to become won, which mislabels cards but hides none", () => {
    expect(
      kindChangeVisibilityProblems(
        oldStages,
        [draft("s1", "enquiry", "Enquiry", "won"), draft("s2", "won", "Won", "open"), draft("s3", "lost", "Lost", "lost")],
        new Map([["s1", 3]]),
      ),
    ).toEqual([])
  })

  it("says nothing about a stage holding no closed cards", () => {
    expect(
      kindChangeVisibilityProblems(
        oldStages,
        [draft("s1", "enquiry", "Enquiry", "open"), draft("s2", "won", "Won", "open"), draft("s3", "lost", "Lost", "lost")],
        new Map(),
      ),
    ).toEqual([])
  })

  it("ignores a brand-new stage, which has no cards and no previous kind", () => {
    expect(
      kindChangeVisibilityProblems(
        oldStages,
        [draft(null, "new", "New", "open"), draft("s2", "won", "Won", "won"), draft("s3", "lost", "Lost", "lost")],
        new Map([["s2", 4]]),
      ),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// WHOLE-BRANCH REVIEW, small item 6. `validateStageList` tested emptiness on
// the TRIMMED key and deduped on the RAW one.
// ---------------------------------------------------------------------------

describe("validateStageList — the key is trimmed consistently", () => {
  it("sees two stages whose keys differ only in whitespace as the same key", () => {
    const problems = validateStageList([open("enquiry"), { ...open("x"), key: " enquiry " }, won(), lost()])
    expect(problems).toContainEqual({
      index: 1,
      message: 'Two stages share the key "enquiry". Keys must be unique on a board.',
    })
  })

  // THE PRESENCE CONTROL: two genuinely different keys, one of them padded,
  // must still be fine — the fix must not turn every padded key into a clash.
  it("still accepts two different keys when one of them is padded", () => {
    expect(validateStageList([open("enquiry"), { ...open("x"), key: " consulted " }, won(), lost()])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// RE-REVIEW, IMPORTANT RESIDUAL. The state Important 2 was raised to prevent,
// reached through the other door: closed cards MOVED off a won/lost stage
// that is being removed, onto a stage that is still open.
// ---------------------------------------------------------------------------

describe("movedClosedCardProblems", () => {
  const oldStages: SavedStage[] = [
    { id: "s1", key: "enquiry", position: 1, name: "Enquiry", kind: "open", amberAfterDays: null, redAfterDays: null },
    { id: "s2", key: "won", position: 2, name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null },
    { id: "s3", key: "lost", position: 3, name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
  ]
  const draft = (id: string | null, key: string, name: string, kind: "open" | "won" | "lost"): StageDraft => ({
    id,
    key,
    name,
    kind,
    amberAfterDays: null,
    redAfterDays: null,
  })

  /** The reachable edit: a replacement Won row, the old Won stage removed, its cards sent to an open stage. */
  const submittedWithReplacementWon: StageDraft[] = [
    draft("s1", "enquiry", "Enquiry", "open"),
    draft(null, "won_2", "Won", "won"),
    draft("s3", "lost", "Lost", "lost"),
  ]
  const removeWonPlan = {
    moveCards: [{ fromStageId: "s2", toStageId: "s1" }],
    removedStageIds: ["s2"],
    keptStageIds: ["s1", "s3"],
  }

  it("refuses sending finished deals to a stage that will still be open, naming both stages", () => {
    expect(
      movedClosedCardProblems(oldStages, submittedWithReplacementWon, removeWonPlan, new Map([["s2", 2]])),
    ).toEqual([
      {
        index: null,
        message:
          'Stage "Won" holds 2 cards that are already won or lost. Moving them to "Enquiry", which is still open, ' +
          "would take them off the board, where nobody would find them. Send them to a Won or Lost stage instead.",
      },
    ])
  })

  // THE TEST THE BRIEF ASKED FOR, stated as an assertion rather than as a
  // claim: NEITHER of the two checks either side of this one can see this
  // edit. `invalidDestinationProblems` asks only whether the destination
  // survives, and "Enquiry" does. `kindChangeVisibilityProblems` only ever
  // looks at SURVIVING stages' kinds, and the stage at risk is the one being
  // removed. So if either half of the pair were missing, the save would go
  // through — which is exactly how this got past the first fix wave.
  it("is the ONLY one of the three checks that sees this edit", () => {
    expect(invalidDestinationProblems(oldStages, removeWonPlan)).toEqual([])
    expect(kindChangeVisibilityProblems(oldStages, submittedWithReplacementWon, new Map([["s2", 2]]))).toEqual([])
    expect(
      movedClosedCardProblems(oldStages, submittedWithReplacementWon, removeWonPlan, new Map([["s2", 2]])),
    ).toHaveLength(1)
  })

  it("says one card, not 1 cards", () => {
    expect(
      movedClosedCardProblems(oldStages, submittedWithReplacementWon, removeWonPlan, new Map([["s2", 1]]))[0].message,
    ).toBe(
      'Stage "Won" holds 1 card that is already won or lost. Moving it to "Enquiry", which is still open, ' +
        "would take it off the board, where nobody would find it. Send it to a Won or Lost stage instead.",
    )
  })

  // THE PRESENCE CONTROL: the identical removal, sent somewhere the cards stay
  // visible. Without it, a function that refused every move off a Won stage
  // would pass every assertion above.
  it("allows the same cards to move to a stage that will be won or lost", () => {
    expect(
      movedClosedCardProblems(
        oldStages,
        submittedWithReplacementWon,
        { ...removeWonPlan, moveCards: [{ fromStageId: "s2", toStageId: "s3" }] },
        new Map([["s2", 2]]),
      ),
    ).toEqual([])
  })

  // THE KIND THE DESTINATION WILL HAVE, not the one it has today. Here the
  // open stage is being re-kinded to `lost` in the SAME save, so the cards
  // stay visible and nothing is refused — reading `oldStages` for the
  // destination's kind would wrongly refuse this.
  it("reads the destination's SUBMITTED kind, so a stage being re-kinded in the same save counts as its new kind", () => {
    const reKinded: StageDraft[] = [
      draft("s1", "enquiry", "Enquiry", "lost"),
      draft(null, "won_2", "Won", "won"),
      draft("s3", "lost", "Lost", "open"),
    ]
    expect(movedClosedCardProblems(oldStages, reKinded, removeWonPlan, new Map([["s2", 2]]))).toEqual([])
  })

  // And the converse, so the lookup cannot pass by always reading `oldStages`:
  // a destination that is `won` today but `open` in this save IS refused.
  it("refuses a destination that is being turned open by the same save", () => {
    const reKinded: StageDraft[] = [
      draft("s1", "enquiry", "Enquiry", "open"),
      draft("s3", "lost", "Lost", "open"),
      draft(null, "won_2", "Won", "won"),
      draft(null, "lost_2", "Lost", "lost"),
    ]
    const plan = {
      moveCards: [{ fromStageId: "s2", toStageId: "s3" }],
      removedStageIds: ["s2"],
      keptStageIds: ["s1", "s3"],
    }
    expect(movedClosedCardProblems(oldStages, reKinded, plan, new Map([["s2", 2]]))[0].message).toContain(
      'Moving them to "Lost", which is still open',
    )
  })

  it("says nothing when the stage being emptied holds no finished deals", () => {
    expect(movedClosedCardProblems(oldStages, submittedWithReplacementWon, removeWonPlan, new Map())).toEqual([])
  })

  // An OPEN stage's closed cards are already invisible, so no move can make
  // them more so — and refusing would block the one edit that repairs them.
  it("says nothing about closed cards moving off an already-open stage", () => {
    const plan = {
      moveCards: [{ fromStageId: "s1", toStageId: "s3" }],
      removedStageIds: ["s1"],
      keptStageIds: ["s2", "s3"],
    }
    const submitted = [draft("s2", "won", "Won", "won"), draft("s3", "lost", "Lost", "open")]
    expect(movedClosedCardProblems(oldStages, submitted, plan, new Map([["s1", 3]]))).toEqual([])
  })

  // `invalidDestinationProblems` already refuses a destination that is not
  // surviving, in its own words. Two different sentences about one mistake is
  // worse than one.
  it("stays quiet about a destination that is not surviving, which another check already names", () => {
    const plan = {
      moveCards: [{ fromStageId: "s2", toStageId: "s1" }],
      removedStageIds: ["s1", "s2"],
      keptStageIds: ["s3"],
    }
    const submitted = [draft("s3", "lost", "Lost", "lost"), draft(null, "won_2", "Won", "won")]
    expect(movedClosedCardProblems(oldStages, submitted, plan, new Map([["s2", 2]]))).toEqual([])
    // And the check that DOES own that message is speaking.
    expect(invalidDestinationProblems(oldStages, plan)).toHaveLength(1)
  })
})
