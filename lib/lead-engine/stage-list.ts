// lib/lead-engine/stage-list.ts — the rules a board's stage list must satisfy,
// and what an edit does to the cards already sitting on it.
//
// Pure on purpose, exactly like its sibling `step-list.ts`: the SQL function
// `save_pipeline_stages` (migration 00276) WRITES, this DECIDES. Keeping the
// rules here means they cannot drift into a second home in plpgsql where the
// route's copy and the database's copy slowly disagree.

export type StageKind = "open" | "won" | "lost"

/**
 * The two length caps a stage list is held to. ONE home, two readers: the
 * PUT route's Zod schema (app/api/admin/pipeline/boards/[id]/stages/route.ts)
 * and the editor screen (components/admin/pipeline-settings.tsx).
 *
 * They live here rather than in the route because the editor cannot import a
 * route module (it would drag the server-only half of the app into the client
 * bundle), and a second copy of the number in the editor is exactly how a
 * coach ends up typing a name the box accepted and the route refused. The
 * refusal MESSAGES are built from these constants on both sides too, so they
 * cannot drift apart either.
 *
 * Deliberately NOT enforced by `validateStageList`: these are transport
 * limits, not board invariants, and the six things that function checks are
 * the things that can brick a board. A 201-character stage name is merely
 * too long.
 */
export const MAX_STAGE_NAME_LENGTH = 200
export const MAX_STAGE_KEY_LENGTH = 100

export type StageDraft = {
  /** null means a stage that does not exist yet. */
  id: string | null
  key: string
  name: string
  kind: StageKind
  amberAfterDays: number | null
  redAfterDays: number | null
}

export type StageProblem = { index: number | null; message: string }

/**
 * Every problem with a stage list, in the order a person would read them.
 *
 * Returns [] for a valid list. `index` is the position in the submitted array
 * for a problem with one stage, and null for a problem with the board as a
 * whole -- the editor puts the first against a field and the second at the top.
 */
export function validateStageList(stages: StageDraft[]): StageProblem[] {
  const problems: StageProblem[] = []

  if (stages.length === 0) {
    return [{ index: null, message: "A board needs at least one stage." }]
  }

  const seenKeys = new Map<string, number>()
  stages.forEach((stage, index) => {
    if (stage.name.trim().length === 0) {
      problems.push({ index, message: "Every stage needs a name." })
    }
    // ONE key value through all three branches (whole-branch review, small
    // item 6). This used to test emptiness on `stage.key.trim()` and then
    // dedupe on the RAW `stage.key`, so `"enquiry"` and `" enquiry"` read as
    // two different keys to this function while the database's
    // `pipeline_stages_key_per_pipeline` unique index — and the SQL, which
    // stores whatever it is handed — would have to decide between them.
    // Unreachable through the route or the editor (both `.trim()` on the way
    // in), so this is the function's own contract being made consistent
    // rather than a live bug: a checker that half-trims is a checker whose
    // answer depends on which half a future caller happens to hit.
    const key = stage.key.trim()
    if (key.length === 0) {
      problems.push({ index, message: "Every stage needs a key." })
    } else if (seenKeys.has(key)) {
      problems.push({
        index,
        message: `Two stages share the key "${key}". Keys must be unique on a board.`,
      })
    } else {
      seenKeys.set(key, index)
    }

    // Both present, or the comparison is meaningless. The CHECK constraint on
    // pipeline_stages says the same thing; this exists so the refusal arrives
    // as English before the write rather than as a Postgres error after it.
    if (stage.amberAfterDays !== null && stage.redAfterDays !== null && stage.amberAfterDays > stage.redAfterDays) {
      problems.push({
        index,
        message: `Stage "${stage.key}": the amber warning (${stage.amberAfterDays} days) cannot come after the red one (${stage.redAfterDays} days).`,
      })
    }
  })

  // The two rules SQL cannot state. `decideMove` requires BOTH a won and a
  // lost stage to exist; a board missing either cannot close a card at all,
  // and a board with two of either cannot say which one closing means.
  for (const kind of ["won", "lost"] as const) {
    const count = stages.filter((s) => s.kind === kind).length
    if (count !== 1) {
      const label = kind === "won" ? "Won" : "Lost"
      problems.push({ index: null, message: `A board needs exactly one ${label} stage. This one has ${count}.` })
    }
  }

  return problems
}

// R2 (controller ruling): widened from {id,key,position} so Task 7's editor
// screen can render name/kind/thresholds from the same row it saves back.
// `planStageSave` below still reads only id/key/position -- the widening
// costs this module nothing.
export type SavedStage = {
  id: string
  key: string
  position: number
  name: string
  kind: StageKind
  amberAfterDays: number | null
  redAfterDays: number | null
}

export type StageSavePlan = {
  /** Cards on a removed stage, and where they were told to go. */
  moveCards: Array<{ fromStageId: string; toStageId: string }>
  removedStageIds: string[]
  keptStageIds: string[]
}

/**
 * What an edit does to the cards already on the board.
 *
 * Matched on STAGE ID, never key or position -- ids survive a renumber and
 * positions are exactly what a renumber changes.
 *
 * A stage being removed that still holds cards needs somewhere for them to go.
 * This function REPORTS that ( `removedStageIds` without a matching `moveCards`
 * entry ); it does not decide whether that is allowed. The caller refuses,
 * because the caller is the one that can say it in English.
 */
export function planStageSave(
  oldStages: SavedStage[],
  newStages: StageDraft[],
  cardCountByStageId: Map<string, number>,
  destinationByRemovedStageId: Map<string, string>,
): StageSavePlan {
  const submittedIds = new Set<string>()
  for (const stage of newStages) {
    if (stage.id !== null) submittedIds.add(stage.id)
  }

  const plan: StageSavePlan = { moveCards: [], removedStageIds: [], keptStageIds: [] }

  for (const old of oldStages) {
    if (submittedIds.has(old.id)) {
      plan.keptStageIds.push(old.id)
      continue
    }
    plan.removedStageIds.push(old.id)
    const cards = cardCountByStageId.get(old.id) ?? 0
    const destination = destinationByRemovedStageId.get(old.id)
    if (cards > 0 && destination !== undefined) {
      plan.moveCards.push({ fromStageId: old.id, toStageId: destination })
    }
  }

  return plan
}

/**
 * Every card-move that would land CLOSED cards on an OPEN stage, in English.
 * [] means no settled deal disappears.
 *
 * THE RULE: cards moved off a `won` or `lost` stage that is being removed
 * must not be sent to a stage that will be `open` after the save.
 *
 * WHY THIS EXISTS SEPARATELY (re-review, Important residual). It is the state
 * `kindChangeVisibilityProblems` below was written to prevent, reached
 * through the OTHER door — and neither of the two checks either side of it
 * can see it:
 *
 *   * `invalidDestinationProblems` asks only whether the destination
 *     SURVIVES. An open stage that survives passes.
 *   * `kindChangeVisibilityProblems` inspects only SURVIVING stages' kinds. A
 *     stage being removed is not in the submitted list at all, so it never
 *     looks at it; and the destination's own kind is not changing.
 *
 * So: add a replacement Won row, remove the old Won stage, send its cards to
 * an open stage. Three clicks, no refusal, and every settled deal on it now
 * carries `outcome != null` on a stage `readBoard` filters `outcome == null`
 * — in the database, in the revenue figures, on no screen. Identical damage,
 * different route in.
 *
 * KEYED ON THE KIND THE DESTINATION WILL HAVE, not the one it has today: the
 * same save can re-kind it, and what matters is the board that exists
 * afterwards. Read from the SUBMITTED draft, therefore, never from
 * `oldStages`.
 *
 * A FROM-STAGE THAT IS ALREADY `open` IS NOT REFUSED, even when it holds
 * closed cards. Those cards are invisible already, so no move can make them
 * more so — and refusing would block the one edit that REPAIRS them (sending
 * them to a Won stage). Only the direction that newly hides a row is refused,
 * the same rule `kindChangeVisibilityProblems` follows.
 *
 * `index: null`: a destination is chosen in the "these cards need somewhere
 * to go" block, which belongs to the board rather than to one table row.
 */
export function movedClosedCardProblems(
  oldStages: SavedStage[],
  newStages: StageDraft[],
  plan: StageSavePlan,
  closedCardCountByStageId: Map<string, number>,
): StageProblem[] {
  const oldById = new Map(oldStages.map((s) => [s.id, s]))
  const submittedById = new Map(
    newStages.filter((s): s is StageDraft & { id: string } => s.id !== null).map((s) => [s.id, s]),
  )

  return plan.moveCards
    .flatMap((move) => {
      const from = oldById.get(move.fromStageId)
      if (!from || from.kind === "open") return []

      const closed = closedCardCountByStageId.get(move.fromStageId) ?? 0
      if (closed === 0) return []

      // A destination that is not in the submitted list is not surviving, and
      // `invalidDestinationProblems` already refuses it in its own words.
      // Saying it twice, differently, is worse than saying it once.
      const to = submittedById.get(move.toStageId)
      if (!to || to.kind !== "open") return []

      const fromLabel = from.name.trim() || from.key
      const toLabel = to.name.trim() || to.key
      const one = closed === 1
      return [
        {
          index: null,
          message:
            `Stage "${fromLabel}" holds ${closed} ${one ? "card that is" : "cards that are"} already won or lost. ` +
            `Moving ${one ? "it" : "them"} to "${toLabel}", which is still open, would take ` +
            `${one ? "it" : "them"} off the board, where nobody would find ${one ? "it" : "them"}. ` +
            `Send ${one ? "it" : "them"} to a Won or Lost stage instead.`,
        },
      ]
    })
}

/**
 * Every stage whose `kind` change would take cards OFF the board, in English.
 * [] means no card disappears.
 *
 * THE RULE: a stage that is `won` or `lost` today and `open` in the submitted
 * list must not still be holding CLOSED cards.
 *
 * WHY (whole-branch review, Important 2; controller ruling R19). `readBoard`
 * (lib/db/pipeline.ts) renders an `open` column as
 * `outcome == null ? show : hide`, and a `won`/`lost` column as "show
 * everything". Its doc comment used to justify that asymmetry by saying won
 * and lost stages "are only ever reached through a close, so their cards
 * always carry a matching outcome" — true until THIS branch put a free `kind`
 * dropdown on every row of the editor. Flip a Won stage to "still open" and
 * every settled deal on it fails the `outcome == null` filter: still in the
 * database, still counted in revenue, on no screen anywhere. Not lost —
 * INVISIBLE, which is worse than lost, because nobody goes looking.
 *
 * REFUSED, NOT WARNED. A warning on the editor is not a guard: the route and
 * the DAL are, which is why this is a pure function both of them call rather
 * than a sentence rendered in a component.
 *
 * THE OTHER DIRECTION IS DELIBERATELY NOT REFUSED. `open -> won` makes
 * outcome-null cards show up in the Won column as deals nobody won — wrong,
 * but VISIBLE and reversible: the coach can see them and change the kind
 * back. Only the direction that hides rows gets a refusal, because only that
 * direction produces a state the screen cannot show a coach at all.
 *
 * `index` is the position in the SUBMITTED array, so the editor renders it
 * against the row whose dropdown caused it.
 */
export function kindChangeVisibilityProblems(
  oldStages: SavedStage[],
  newStages: StageDraft[],
  closedCardCountByStageId: Map<string, number>,
): StageProblem[] {
  const oldById = new Map(oldStages.map((s) => [s.id, s]))
  const problems: StageProblem[] = []

  newStages.forEach((stage, index) => {
    if (stage.id === null) return
    const before = oldById.get(stage.id)
    if (!before) return
    if (before.kind === "open" || stage.kind !== "open") return

    const closed = closedCardCountByStageId.get(stage.id) ?? 0
    if (closed === 0) return

    const label = before.name.trim() || before.key
    problems.push({
      index,
      message:
        `Stage "${label}" holds ${closed} ${closed === 1 ? "card that is" : "cards that are"} already won or lost. ` +
        `Changing it to a stage that is still open would take ${closed === 1 ? "it" : "them"} off the board, ` +
        `where nobody would find ${closed === 1 ? "it" : "them"}. ` +
        `Move ${closed === 1 ? "that card" : "those cards"} to another stage first.`,
    })
  })

  return problems
}

/**
 * Every card-move in the plan that points somewhere the save will not leave
 * standing. [] means every destination survives.
 *
 * WHY THIS IS SEPARATE FROM `planStageSave`. That function REPORTS what an
 * edit does; it does not decide what is allowed — the same division
 * `strandedStageProblems` above sits on. It happily emits
 * `{fromStageId: "s2", toStageId: "s3"}` for a save whose `removedStageIds`
 * contains BOTH, because nothing asked it not to.
 *
 * WHAT THAT COST, before this existed (whole-branch review, Important 1).
 * Three clicks reach it: remove a stage holding cards, pick a second stage as
 * their destination, then remove that second stage too. `validateStageList`
 * sees a perfectly legal list; `strandedStageProblems` sees a removal WITH a
 * destination and says nothing; the editor's Save button stays enabled. The
 * SQL then moves the cards onto a stage it is about to DELETE, and the whole
 * save dies on `opportunities_stage_id_fkey` — a raw Postgres string on a
 * coach's screen, for an edit the screen invited them to make.
 *
 * TWO DIFFERENT WRONG DESTINATIONS, and they get different sentences because
 * they are different mistakes. A destination that is BEING REMOVED is a
 * coach's ordinary slip. A destination that is not a stage on this board at
 * all cannot be produced by the editor — it means a crafted request, and the
 * honest sentence for it does not claim the stage is being removed.
 *
 * `index: null` on both: a destination is chosen in the "these cards need
 * somewhere to go" block, which belongs to the board rather than to one row
 * of the stage table.
 */
export function invalidDestinationProblems(oldStages: SavedStage[], plan: StageSavePlan): StageProblem[] {
  const labelOf = new Map(oldStages.map((s) => [s.id, s.name.trim() || s.key]))
  const kept = new Set(plan.keptStageIds)
  const known = new Set(oldStages.map((s) => s.id))

  return plan.moveCards
    .filter((move) => !kept.has(move.toStageId))
    .map((move) => {
      const from = labelOf.get(move.fromStageId) ?? move.fromStageId
      const to = labelOf.get(move.toStageId) ?? move.toStageId
      return {
        index: null,
        message: known.has(move.toStageId)
          ? `The stage you chose for the cards on "${from}" ("${to}") is being removed too. Pick one that is staying.`
          : `The stage you chose for the cards on "${from}" is not a stage on this board. Pick one that is staying.`,
      }
    })
}

/**
 * The stages a removal would strand, in English. [] means the save is safe.
 *
 * Separate from `planStageSave` so the route can ask the question without
 * building a plan, and so the message lives beside the other messages.
 *
 * NAMES THE STAGE THE WAY THE COACH NAMED IT, and counts cards the way a
 * person would (controller ruling R16). It used to say
 * `Stage "consulted" still has 2 card(s) on it` — the stored KEY, which the
 * editor renders as an unchangeable grey box a coach never types, and
 * `card(s)`, which nobody says out loud. Both the route (as a 400) and the
 * editor (inline) print this exact string, so it is read by a coach on a
 * screen, not by a developer in a log. `name` has been on `SavedStage` since
 * R2 widened it for the editor; the key and then the id remain as fallbacks
 * for a row whose name is somehow blank, because a message that silently
 * names nothing is worse than one naming a key.
 */
export function strandedStageProblems(
  oldStages: SavedStage[],
  plan: StageSavePlan,
  cardCountByStageId: Map<string, number>,
): StageProblem[] {
  const labelOf = new Map(oldStages.map((s) => [s.id, s.name.trim() || s.key]))
  const moved = new Set(plan.moveCards.map((m) => m.fromStageId))
  return plan.removedStageIds
    .filter((id) => (cardCountByStageId.get(id) ?? 0) > 0 && !moved.has(id))
    .map((id) => {
      const cards = cardCountByStageId.get(id) ?? 0
      return {
        index: null,
        message:
          `Stage "${labelOf.get(id) ?? id}" still has ${cards} ${cards === 1 ? "card" : "cards"} on it. ` +
          `Say which stage they should move to before removing it.`,
      }
    })
}
