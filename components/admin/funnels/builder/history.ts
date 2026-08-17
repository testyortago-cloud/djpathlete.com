// components/admin/funnels/builder/history.ts — undo/redo as a pointer over the
// revisions that produced a document.
//
// ---------------------------------------------------------------------------
// THERE IS NO NEW STORAGE HERE, AND THAT IS THE DESIGN.
// ---------------------------------------------------------------------------
// `funnel_step_turns` already keeps a FULL document per turn, and
// `revertToRevision` already copies an older one forward as a new turn —
// append-only, never rewinding. "Go back to here" in the transcript has been
// driving that for a while. What was missing was not the machinery but the
// STACK: a notion of "the previous one" and "the one I just came back from".
//
// So this file is a pointer, and undo is `restore(previous)`. Nothing is
// persisted, nothing is deleted, and an undo is itself an ordinary turn in the
// transcript — which means the owner can undo their undo from either the
// keyboard or the chat, and the two cannot disagree about what happened.
//
// Pure on purpose: every rule below is a decision about what undo MEANS, and
// those are worth testing without mounting a component.

import type { BuilderMessage } from "./types"

export interface HistoryState {
  /**
   * Revisions that produced a document, oldest first.
   *
   * Only doc-producing turns are here. A user message and a turn the model
   * declined both advance the transcript without changing the page, and
   * stepping onto one would be an undo that visibly does nothing — the single
   * most common way a home-grown undo stack feels broken.
   */
  revisions: number[]
  /** Index into `revisions` of what is currently on screen. `-1` when empty. */
  cursor: number
}

export const EMPTY_HISTORY: HistoryState = { revisions: [], cursor: -1 }

/**
 * The stack as it stands when the builder mounts.
 *
 * SEEDED FROM THE SERVER-RENDERED TRANSCRIPT, not left empty to fill up as the
 * owner works. An undo stack that only knows about edits made in this tab is a
 * stack that does nothing on a page you just opened — which is precisely when
 * an owner reaches for Cmd+Z after seeing what the reviewer did to their page.
 *
 * Reads the same two facts `ChatPane` derives "Go back to here" from, so the
 * button and the shortcut can never offer different sets of restore points.
 */
export function seedHistory(messages: BuilderMessage[]): HistoryState {
  const revisions: number[] = []
  for (const message of messages) {
    if (!("producedDoc" in message)) continue
    if (message.producedDoc !== true) continue
    if (typeof message.revision !== "number") continue
    // Defensive rather than expected: two turns cannot share a revision, but a
    // duplicate would put two identical entries in the stack and cost the owner
    // a keypress that appears to do nothing.
    if (revisions.includes(message.revision)) continue
    revisions.push(message.revision)
  }
  revisions.sort((a, b) => a - b)
  return { revisions, cursor: revisions.length - 1 }
}

/**
 * A new edit lands.
 *
 * TRUNCATES THE REDO FUTURE. Undoing twice and then typing something new
 * abandons what you undid — standard everywhere undo exists, and the
 * alternative (keeping a branch you can no longer reach from the keyboard) is a
 * stack whose Redo button restores something the owner cannot predict.
 */
export function pushRevision(state: HistoryState, revision: number): HistoryState {
  const kept = state.revisions.slice(0, state.cursor + 1)
  // The same revision arriving twice is a no-op rather than a second entry.
  if (kept[kept.length - 1] === revision) return { revisions: kept, cursor: kept.length - 1 }
  const revisions = [...kept, revision]
  return { revisions, cursor: revisions.length - 1 }
}

export function canUndo(state: HistoryState): boolean {
  return state.cursor > 0
}

export function canRedo(state: HistoryState): boolean {
  return state.cursor >= 0 && state.cursor < state.revisions.length - 1
}

/** The revision undo should restore, or null when there is nothing behind. */
export function undoTarget(state: HistoryState): number | null {
  return canUndo(state) ? state.revisions[state.cursor - 1] : null
}

/** The revision redo should restore, or null when there is nothing ahead. */
export function redoTarget(state: HistoryState): number | null {
  return canRedo(state) ? state.revisions[state.cursor + 1] : null
}

/**
 * Move the pointer after an undo or a redo has been restored.
 *
 * NOT `pushRevision`. Restoring appends a turn and therefore mints a NEW
 * revision number, but the owner has not made new work — they have travelled to
 * an existing point. Pushing the minted revision would truncate the redo future
 * on the way past, so a single undo would make redo impossible, which is the
 * bug this function exists to not have.
 */
export function moveCursor(state: HistoryState, delta: -1 | 1): HistoryState {
  const next = state.cursor + delta
  if (next < 0 || next >= state.revisions.length) return state
  return { ...state, cursor: next }
}
