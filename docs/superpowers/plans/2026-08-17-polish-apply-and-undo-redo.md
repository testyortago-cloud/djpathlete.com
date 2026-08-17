# Plan — Polish proposes, and the builder gets undo/redo

Spec: `docs/superpowers/specs/2026-08-17-polish-apply-and-undo-redo-design.md`
Branch: `worktree-polish-apply-undo-redo` (isolated worktree — a peer session shares this checkout)
Base: `5ed5215e` (current `origin/main`)

TDD throughout. Any test that passes on its first run gets the implementation
mutated to prove it can fail before it is believed.

---

## Stage 1 — the wire learns to propose

**`lib/funnels/sections/build-stream.ts`**
- Add `| { type: "proposal"; proposal: unknown }` to `BuildStreamEvent`.
- Document it as the third terminal event, and why a null proposal still
  terminates.

**Tests** — `__tests__/lib/funnels/build-stream-proposal.test.ts`
- A `proposal` frame round-trips through encode → decode.
- A `proposal` split across two chunks decodes once whole.

## Stage 2 — the client can read one

**`components/admin/funnels/builder/types.ts`**
- `PolishProposal` interface, mirroring the server's payload.

**`components/admin/funnels/builder/stream.ts`**
- `TurnStreamOutcome` gains `{ type: "proposal"; proposal: PolishProposal | null }`.
- `consume` treats `proposal` as terminal; it does NOT call `onEvent` with it
  (nothing renders it mid-stream), and it must not clobber a prior `result` —
  the propose path has no `result` in front of it, so the two never co-occur,
  and a defensive ordering test pins that.

**Tests** — `__tests__/components/admin/builder/stream-proposal.test.ts`
- `readTurnStream` returns the proposal as its outcome.
- A null proposal is returned as `{type:"proposal", proposal:null}`, not `none`.
- A stream ending with no terminal is still `none`.

## Stage 3 — the server proposes

**`lib/validators/funnel.ts`**
- `buildApplyPolishRequestSchema`: `{action:"apply_polish", revision:int>=0, ops:[opSchema, …] min 1}`.
- Add to the `buildRequestSchema` union. `action` is a required literal on every
  member of the union already, so no ambiguity is introduced.

**`app/api/admin/funnels/steps/[stepId]/build/route.ts`**
- `ReviewStageArgs.standalone: boolean` → `mode: "apply" | "propose"`.
  (`standalone` was only ever read as "is this Polish"; the mode is the same
  question asked so it can have three answers later without another boolean.)
- `mode:"propose"`: after resolve+compile, emit `{type:"proposal", proposal:{…}}`
  and return. No `appendTurn`, no revision movement.
  - `review.changed === false` → `{type:"proposal", proposal:null}` carrying the
    summary in a `summary` field on the event, replacing the
    `emitNoChangeReview` call on this path only.
  - `review.error !== null` → unchanged: a `fail` event.
- `handlePolish` passes `mode:"propose"`.
- The automatic path passes `mode:"apply"` — behaviour identical to today.
- New `handleApplyPolish`: revision check → `applyOps` → resolve → compile →
  `appendTurn(source:"review")` → `TurnResponse` JSON.

**Tests** — `__tests__/app/api/admin/funnels/polish-propose-apply.test.ts`
- propose: `appendTurn` called 0 times; one `proposal` event; revision unmoved.
- propose with no change: `proposal: null`, `appendTurn` 0 times.
- propose with a reviewer error: still a `fail`, still no write.
- apply: stale revision → 409 with `code` + `currentRevision`.
- apply: ops rejected by `applyOps` → 422, no write.
- apply: success → exactly one `appendTurn`, `source:"review"`.
- apply re-applies against the SERVER's document: seed a draft doc that differs
  from anything the client could have sent and assert the stored doc derives
  from the server's.

## Stage 4 — the builder holds a proposal

**`components/admin/funnels/FunnelBuilder.tsx`**
- `proposal` state; `polish()` stores it instead of applying a turn.
- Preview renders `proposal.doc` while pending.
- `PolishProposalBanner` (new, in `builder/`): summary, receipt counts,
  Apply / Discard. Small and its own file — `FunnelBuilder` is already 2150 lines.
- Apply → POST `apply_polish` → `applyTurn`. Discard → `setProposal(null)`.
- Send, canvas commit, Polish and Publish disabled while pending.

**Tests** — `__tests__/components/admin/funnel-builder-polish.test.tsx` (extended)
- Polish no longer writes: no second fetch, revision unchanged, banner shown.
- Apply posts `{action:"apply_polish", revision, ops}` and adopts the turn.
- Discard writes nothing and restores the pre-polish preview.
- Publish and Send are disabled while a proposal is pending.
- Existing tests updated where they asserted the old auto-apply behaviour, with
  the change called out in the commit rather than deleted silently.

## Stage 5 — undo and redo

**`components/admin/funnels/builder/history.ts`** (new, pure)
- `seedHistory(messages)`, `pushRevision(state, revision)`, `undoTarget(state)`,
  `redoTarget(state)`, `canUndo/canRedo`. Pure functions, no React — so the
  semantics are testable without rendering anything.

**`components/admin/funnels/FunnelBuilder.tsx`**
- Hold the history state; push in `applyTurn` when `compile !== null && doc !== null`,
  except when the turn came from undo/redo itself.
- Undo/Redo icon buttons in the header.
- `useEffect` binding `keydown` on `document`; ignores events whose target is an
  input/textarea/contenteditable; no-ops while busy or while a proposal pends.

**Tests**
- `__tests__/components/admin/builder/history.test.ts` — the pure semantics,
  including truncation of the redo future.
- `__tests__/components/admin/funnel-builder-undo-redo.test.tsx` — buttons,
  disabled ends, both shortcuts, and the chat-textarea exemption.

## Stage 6 — verification

- Targeted suites only: the funnel/builder tests plus the review and validator
  suites. Not the full suite (standing rule).
- `npx tsc --noEmit`, compared against the 258 baseline measured at HEAD in this
  same worktree, not against the number in the journal.
- `npm run build`.
- Journal entry + memory.
- **Commit on the branch. Do not push, do not merge, do not deploy.**
