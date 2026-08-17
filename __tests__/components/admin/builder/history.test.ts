// __tests__/components/admin/builder/history.test.ts
//
// The undo stack's semantics, with no React in sight. Every case here is a
// decision about what undo MEANS in a builder whose storage is append-only:
// which turns are steppable, what a new edit does to the redo future, and why
// travelling is not the same as working.

import { describe, it, expect } from "vitest"
import {
  EMPTY_HISTORY,
  canRedo,
  canUndo,
  moveCursor,
  pushRevision,
  redoTarget,
  seedHistory,
  undoTarget,
} from "@/components/admin/funnels/builder/history"
import type { BuilderMessage } from "@/components/admin/funnels/builder/types"

function builderTurn(revision: number, producedDoc: boolean): BuilderMessage {
  return { id: `m${revision}`, role: "builder", text: "…", revision, producedDoc }
}

describe("seedHistory", () => {
  it("takes its restore points from the server-rendered transcript", () => {
    // MUTANT: returning EMPTY_HISTORY. Undo would do nothing on a page the
    // owner just opened — which is exactly when they reach for it, having just
    // seen what the reviewer did to their page.
    const state = seedHistory([builderTurn(2, true), builderTurn(4, true), builderTurn(6, true)])

    expect(state.revisions).toEqual([2, 4, 6])
    expect(state.cursor).toBe(2)
  })

  it("skips turns that produced no document", () => {
    // A user message and a turn the model declined both advance the transcript
    // without changing the page. MUTANT: including them. Undo would land on a
    // revision with nothing to restore and appear to do nothing.
    const state = seedHistory([
      { id: "u1", role: "owner", text: "build me a page", revision: 1, producedDoc: false },
      builderTurn(2, true),
      builderTurn(3, false),
      builderTurn(4, true),
    ])

    expect(state.revisions).toEqual([2, 4])
  })

  it("ignores messages that carry no revision at all", () => {
    // `problems` and `pages` entries are publish refusals — chat furniture with
    // no document behind them.
    const state = seedHistory([
      { id: "p1", role: "problems", text: "Cannot publish", problems: ["no content"] },
      builderTurn(2, true),
    ])

    expect(state.revisions).toEqual([2])
  })

  it("starts empty for a page with no history", () => {
    expect(seedHistory([])).toEqual(EMPTY_HISTORY)
    expect(canUndo(seedHistory([]))).toBe(false)
    expect(canRedo(seedHistory([]))).toBe(false)
  })
})

describe("the ends of the stack", () => {
  it("cannot undo past the first revision", () => {
    const state = seedHistory([builderTurn(2, true)])
    expect(canUndo(state)).toBe(false)
    expect(undoTarget(state)).toBeNull()
  })

  it("cannot redo from the head", () => {
    const state = seedHistory([builderTurn(2, true), builderTurn(4, true)])
    expect(canRedo(state)).toBe(false)
    expect(redoTarget(state)).toBeNull()
  })

  it("offers the revision immediately behind, not the oldest one", () => {
    // MUTANT: `revisions[0]`. Undo would jump to the very first draft, throwing
    // away every edit at once instead of stepping back one.
    const state = seedHistory([builderTurn(2, true), builderTurn(4, true), builderTurn(6, true)])
    expect(undoTarget(state)).toBe(4)
  })
})

describe("travelling versus working", () => {
  it("a new edit appends and becomes the head", () => {
    const state = pushRevision(seedHistory([builderTurn(2, true)]), 3)
    expect(state.revisions).toEqual([2, 3])
    expect(state.cursor).toBe(1)
  })

  it("undo then redo returns to where it started", () => {
    // THE BUG THIS FILE EXISTS TO PREVENT. Restoring appends a turn and mints a
    // NEW revision, so an implementation that pushed that number would truncate
    // the redo future on the way past — making a single undo permanent.
    //
    // MUTANT: `moveCursor` implemented as `pushRevision(state, minted)`.
    const start = seedHistory([builderTurn(2, true), builderTurn(4, true), builderTurn(6, true)])

    const undone = moveCursor(start, -1)
    expect(undone.cursor).toBe(1)
    expect(canRedo(undone)).toBe(true)
    expect(redoTarget(undone)).toBe(6)

    const redone = moveCursor(undone, 1)
    expect(redone).toEqual(start)
  })

  it("a new edit after undoing abandons the redo future", () => {
    // Standard undo semantics. MUTANT: appending without truncating — Redo
    // would then restore a document from a branch the owner can no longer see,
    // which is worse than not offering redo at all.
    const start = seedHistory([builderTurn(2, true), builderTurn(4, true), builderTurn(6, true)])
    const undone = moveCursor(start, -1)

    const edited = pushRevision(undone, 7)

    expect(edited.revisions).toEqual([2, 4, 7])
    expect(canRedo(edited)).toBe(false)
  })

  it("refuses to step off either end", () => {
    const state = seedHistory([builderTurn(2, true), builderTurn(4, true)])
    expect(moveCursor(state, 1)).toEqual(state)
    expect(moveCursor({ ...state, cursor: 0 }, -1)).toEqual({ ...state, cursor: 0 })
  })

  it("does not record the same revision twice in a row", () => {
    const state = pushRevision(pushRevision(seedHistory([]), 3), 3)
    expect(state.revisions).toEqual([3])
  })
})
