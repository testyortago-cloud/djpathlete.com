# Polish proposes, and the builder gets undo/redo

**Date:** 2026-08-17
**Status:** design, approved to build autonomously (owner asleep; standing autonomy rule)
**Surfaces:** `/admin/funnels/<id>/edit/<stepId>` and `/admin/pages/<id>/edit/<stepId>` — both mount `FunnelBuilder`, so one implementation serves both.

## The report, verbatim

> "I also want a feature when i click polish, there is a button if i want to
> apply it then it will be applied something like that and also there is no undo
> and redo button in the landing page i want to make sure ctrl/cmdz ctrl r ccmd r
> is working for both funnels and landing page"

Redo is bound to **Cmd/Ctrl+Shift+Z**, not Cmd/Ctrl+R. The owner chose this when
told that Cmd+R is the browser's reload and capturing it would stop reload
working inside the builder.

---

## Part 1 — Polish proposes instead of writing

### What is wrong now

`Polish` posts `{action:"polish"}`, and `runReviewStage` writes the revised page
to the database the moment the reviser returns — `appendTurn(source:"review")`
at [build/route.ts:1583](../../../app/api/admin/funnels/steps/[stepId]/build/route.ts).
The owner's first sight of the change is a page that has already changed. The
only way back is "Go back to here" in the transcript, which is an undo of
something they never agreed to.

That was defensible for the *automatic* review — it rides on a first draft, where
every word is the model's and the owner has not invested anything yet. It is not
defensible for a button the owner presses on a page they have been editing.

### The shape

`runReviewStage` gains a `mode: "apply" | "propose"`.

- **Automatic review after a first draft keeps `mode: "apply"`.** Unchanged, including
  `emitNoChangeReview` and the silent-drop-on-lost-race rule. This feature does
  not touch the path the owner did not ask about.
- **Polish uses `mode: "propose"`.** The stage runs the critics and the reviser
  exactly as now, resolves and compiles the revised document exactly as now — so
  what the owner previews is what they would get — and then **stops before
  `appendTurn`**, emitting a new terminal event instead.

Resolving and compiling before proposing is load-bearing, for the same reason the
apply path does it: a reviser that rewrote a CTA's `ref` has introduced a name
that has never been resolved. Proposing an unresolved document and only
discovering it at Apply would show the owner a preview that does not match what
Apply produces.

### The new terminal event

```ts
{ type: "proposal", proposal: {
    baseRevision: number      // the revision the review read
    ops: SectionOp[]          // what Apply will re-apply, server-side
    doc: SectionDoc           // resolved + compiled, for the preview
    summary: string
    receipt: DiffReceipt | null
    compile: CompileSummary
    unresolved: UnresolvedCta[]
    danglingAnchors: DanglingAnchor[]
    resolutionError: string | null
} }
```

`proposal` joins `result` and `fail` as a terminal event in
`build-stream.ts` and in `readTurnStream`'s `TurnStreamOutcome`. It is terminal
because the stream's contract is "exactly one terminal event ends it" — a Polish
that ended with no terminal reads to the client as a dropped connection.

**A `mode:"propose"` run that changes nothing still terminates.** It emits
`{type:"proposal", proposal:null}` carrying the reviewer's summary, which the
client renders as "I read the page through and found nothing worth changing" —
the same sentence `emitNoChangeReview` writes today, but *not* written to the
transcript, because nothing happened and no revision moved. This is the one
behaviour change on the no-change path: today Polish burns a revision to say
"nothing changed". That was always odd; a proposal that proposes nothing should
cost nothing.

### Apply

`POST` to the same build route with `{action:"apply_polish", revision, ops}`.
Not a stream — there is no model call, so it answers like `action:"reset"` does,
as a plain `TurnResponse` JSON body.

The server **re-applies the ops to the current draft document** rather than
trusting a document from the client:

1. Load the draft. If `draft.revision !== revision`, 409 `stale_revision` with
   `currentRevision` — the owner edited while the proposal sat on screen, and
   their edit wins. Identical body to every other 409 here, so the client's
   existing `handleErrorResponse` resyncs without a new branch.
2. `applyOps(draft.doc, ops)`. Rejection is a 422, not a silent drop — the ops
   were valid against the same document a moment ago, so a rejection means the
   document moved underneath in a way the revision check did not catch.
3. Resolve, compile, `appendTurn(source:"review")` under the same
   compare-and-swap. `source` stays `"review"` so the transcript still tells the
   true story — the reviewer changed this — and "Go back to here" still separates
   the polish from the draft it polished, which is migration `00209`'s whole
   argument.

Sending `ops` rather than `doc` is what keeps the server authoritative. A client
that posted a document could post any document.

**`ops` is validated on the wire**, with the existing `opSchema` the build route
already parses model output with. An admin-only route is still a route.

### The client

`FunnelBuilder` holds `proposal: PolishProposal | null`.

While a proposal is pending:

- The **preview pane renders `proposal.doc`**, not `doc`. This is the diff the
  owner asked to see — the polished page, in place, at full size.
- A **banner over the preview**: what changed (from `receipt` — sections added,
  removed, changed), the reviewer's summary, and **Apply** / **Discard**.
- The **findings list stays on screen**, so "why" sits next to "what".
- Chat send, canvas editing, Polish, and Publish are **disabled**. A proposal is
  a question with two answers; letting an edit land underneath it would create a
  third state nobody designed. The banner is the only thing to interact with.

**Discard** is pure client state: `setProposal(null)`. Nothing was written, so
there is nothing to undo and nothing to say in the transcript.

**Apply** posts, then `applyTurn(response)` — the same function every other turn
goes through, so the revision, the preview, the publish gate and the undo stack
all move exactly as they do for any other edit.

A reload with a proposal pending loses it. That is correct and deliberate: the
proposal was never persisted, and re-running Polish costs one more review. The
alternative — persisting proposals — is a table, a lifecycle, and a garbage
collector for a thing whose whole point is that it is not saved yet.

---

## Part 2 — Undo and redo

### What exists

`revertToRevision` ([lib/db/funnel-builder.ts:421](../../../lib/db/funnel-builder.ts))
is append-only: it copies an older turn's document forward as a NEW turn. Nothing
is ever rewound or deleted. `{action:"reset", toRevision}` exposes it, and
`ChatPane`'s per-turn "Go back to here" is its only caller.

So the machinery for undo already exists and is proven. What is missing is the
*stack* — a notion of "the previous one" and "the one I just came back from" —
and the two keys.

### The stack

A client-side pointer over the doc-producing revisions, layered on top of the
existing revert. No new table, no new column, no new server concept.

```ts
history: number[]   // doc-producing revisions, oldest first
cursor: number      // index into history of what is on screen
```

- **Seeded from the server-rendered transcript** at mount, from the same
  `revision` + `producedDoc` facts `ChatPane` already derives "Go back to here"
  from. So undo works on a page the owner just opened, not only on edits made in
  this tab — which is the difference between a feature and a demo.
- **Push** on every turn that produced a document (`applyTurn` where
  `compile !== null && doc !== null`), truncating anything after `cursor` first.
  That is standard undo semantics: a new edit made after undoing abandons the
  redo future.
- **Undo** → `restore(history[cursor - 1])`, then `cursor -= 1`.
  **Redo** → `restore(history[cursor + 1])`, then `cursor += 1`.
  Neither pushes: they are navigation, not new work. The revision they *create*
  is a new number, but the position in the stack is the one they moved to.

`canUndo = cursor > 0`, `canRedo = cursor < history.length - 1`. Both false while
`busy !== "idle"` or a polish proposal is pending.

The revision the optimistic lock uses stays what it always was — whatever
`applyTurn` last set. The stack tracks *position*, never the lock.

### The keys

Bound on `document` in the builder, `keydown`:

- `(meta|ctrl) + z`, no shift → undo
- `(meta|ctrl) + shift + z` → redo

**Ignored when the event target is a text input, textarea, `contenteditable`, or
inside the canvas iframe.** Cmd+Z in the chat box must undo typing, not the page.
This is the rule most likely to be got wrong, so it gets its own tests.

The canvas iframe already installs its own `keydown` handler for inline editing
([canvas-editing.ts:338](../../../components/admin/funnels/builder/canvas-editing.ts));
keys pressed inside the iframe do not reach the parent document, so inline text
editing keeps native undo and the page-level stack does not fight it.

### The buttons

Undo and Redo, icon buttons, in the builder header beside the device switcher —
visible on both funnels and landing pages because it is one component. Disabled
states mirror `canUndo` / `canRedo`, with titles naming the shortcut.

---

## Testing

Unit, no browser, no model:

- **`review/pipeline` is untouched** — the mode split lives in the route, so the
  reviewer's own tests keep their meaning.
- **Propose does not write.** `runReviewStage({mode:"propose"})` with a changed
  review calls `appendTurn` zero times and emits one `proposal`.
- **Apply writes once, under the lock.** Stale revision → 409 with `code` and
  `currentRevision`. Rejected ops → 422. Success → one `appendTurn` with
  `source:"review"`.
- **Apply re-applies ops to the server's document**, not to a document from the
  client — asserted by making the two differ.
- **The no-change proposal moves no revision** and writes no turn.
- **`readTurnStream` returns `proposal`** as a terminal outcome, and a `proposal`
  after a `result` does not clobber the result.
- **Undo stack:** seeds from initial messages; pushes on doc-producing turns;
  truncates the redo future on a new edit; undo/redo do not push; disabled at
  both ends.
- **Keys:** Cmd+Z fires undo; Cmd+Shift+Z fires redo; **neither fires when the
  target is the chat textarea**; neither fires while busy or while a proposal is
  pending.

Every test that goes green on the first run gets the implementation mutated to
prove it can fail — the repo's standing rule, and the one that has caught the
most defects here.

## Out of scope

- The automatic post-first-draft review keeps writing directly. Not asked for,
  and its rationale is different.
- Per-finding Apply. The owner chose whole-proposal Apply/Discard.
- Persisting proposals across reload.
- The duplicate-catalogue-name blocker found in production today. Reported to the
  owner; they are fixing it in the admin UI. No code change here.
