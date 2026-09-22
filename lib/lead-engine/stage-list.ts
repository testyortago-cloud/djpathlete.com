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
    if (stage.key.trim().length === 0) {
      problems.push({ index, message: "Every stage needs a key." })
    } else if (seenKeys.has(stage.key)) {
      problems.push({
        index,
        message: `Two stages share the key "${stage.key}". Keys must be unique on a board.`,
      })
    } else {
      seenKeys.set(stage.key, index)
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
 * The stages a removal would strand, in English. [] means the save is safe.
 *
 * Separate from `planStageSave` so the route can ask the question without
 * building a plan, and so the message lives beside the other messages.
 */
export function strandedStageProblems(
  oldStages: SavedStage[],
  plan: StageSavePlan,
  cardCountByStageId: Map<string, number>,
): StageProblem[] {
  const keyOf = new Map(oldStages.map((s) => [s.id, s.key]))
  const moved = new Set(plan.moveCards.map((m) => m.fromStageId))
  return plan.removedStageIds
    .filter((id) => (cardCountByStageId.get(id) ?? 0) > 0 && !moved.has(id))
    .map((id) => ({
      index: null,
      message: `Stage "${keyOf.get(id) ?? id}" still has ${cardCountByStageId.get(id)} card(s) on it. Say which stage they should move to before removing it.`,
    }))
}
