# Full Engine Phase 4 — four pipeline boards, created from a screen

**Status:** design, not yet approved
**Date:** 2026-09-01
**Branch:** `feat/pipeline-boards` (not created)
**Parent:** [docs/full-engine-scope-vs-built.md](../../full-engine-scope-vs-built.md) §3
**Closes scope lines:** "Four boards — Coaching, Assessment, Camps & Clinics,
Programs & Products — each with stages matched to how that particular sale
actually works"
**Owner decision, 2026-09-01:** build the editor, not a migration per board.

---

## 1. What this is

The multi-board machinery is already there and has never been used.

Migration 00219 says it plainly in its own seed comment — *"machinery for N
boards, exactly one seeded"* — and the code agrees: `applyPipelineEvent` takes an
optional `pipelineKey` that falls back to
`DEFAULT_PIPELINE_KEY = "coaching"`
([lib/db/pipeline.ts:34](../../../lib/db/pipeline.ts#L34), `:479`).

**No caller anywhere passes it.** So every booking, every payment, every quiz
result and every manual move in the system lands on the Coaching board. A camp
registration and a coaching enquiry are the same card in the same column.

This phase is therefore two things that sound like one:

1. **A screen** to create boards and shape their stages.
2. **Routing** — deciding which board a given event belongs on. This is the
   harder half, and it is the half that does not exist in any form.

---

## 2. What is true today

`pipelines` and `pipeline_stages` (00219), with three constraints that shape the
editor more than anything in the UI:

```sql
CONSTRAINT pipeline_stages_key_per_pipeline      UNIQUE (pipeline_id, key)
CONSTRAINT pipeline_stages_position_per_pipeline UNIQUE (pipeline_id, position)
CONSTRAINT pipeline_stages_thresholds_ordered    -- amber <= red
```

The Coaching board's stages:

| key | name | position | kind | amber | red |
|---|---|---|---|---|---|
| `consult_booked` | Consult Booked | 1 | open | 3 | 7 |
| `consulted` | Consulted | 2 | open | 5 | 14 |
| `won` | Won | 3 | won | – | – |
| `lost` | Lost | 4 | lost | – | – |

`decideMove` ([pipeline-move.ts](../../../lib/lead-engine/pipeline-move.ts))
**looks up a stage of kind `won` by key** to close a card on payment. A board
without exactly one `won` and one `lost` stage is a board where auto-move throws
at runtime, not at build time.

RLS is on all four tables since migration 00231. `lib/db/pipeline.ts` is the only
module issuing `.from()` against them, and its `getClient()` is service-role.
Keep both properties true.

---

## 3. Routing — the half that does not exist

Every event that reaches `applyPipelineEvent` has to be assigned a board. Today
that decision is a default. After this phase it is a rule.

**Recommended rules**, derived from the sources already being written:

| Event | Board |
|---|---|
| `booking` (consult) | Coaching |
| `event_signup`, and payments for an `events` row | Camps & Clinics |
| `inquiry` with `service_type = 'assessment'` | Assessment |
| `quiz` result | Coaching |
| `purchase` of a shop item or a priced programme | Programs & Products |
| anything unmatched | Coaching (the existing default) |

**Keep the fallback.** An event whose board cannot be determined must land on
Coaching, not throw and not vanish. `PipelineNotConfigured` already exists for
the genuinely-broken case (no board for a key, or a board with no stages); an
unroutable event is a different, softer thing.

Put the rules in one pure function — `routeToPipeline(event): string` — with no
database access, so the whole table above is a unit test rather than an
integration test.

### A caution about the Programs & Products board

Of 18 priced programmes on production, exactly **one** is a catalogue product.
The other seventeen are bespoke plans named after the athlete they were built
for, each with its own subscription. That is the business, not a data problem.

A "Programs & Products" board that fills with seventeen one-off personal plans is
not a sales pipeline, it is a client list with stages. **Decide before building
whether that board is for catalogue products only** — and if so, `routeToPipeline`
needs the same `stripe_price_id`-plus-catalogue predicate, not just "was priced".

---

## 4. What to build

### 4.1 The editor

`/admin/pipeline/settings`:

- create a board (name → slugified key, uniqueness checked server-side)
- rename a board
- add, rename, reorder and remove stages
- set `kind` per stage, and `amber_after_days` / `red_after_days`
- archive a board (never hard-delete one with opportunities on it)

Routes, all `withAudit()`:

| Route | Method |
|---|---|
| `/api/admin/pipeline/boards` | POST, PATCH |
| `/api/admin/pipeline/boards/[id]/stages` | POST, PATCH, DELETE |

New audit slugs:

```ts
{ slug: "pipeline.board_created",  category: "admin_write", description: "Pipeline board created" },
{ slug: "pipeline.board_updated",  category: "admin_write", description: "Pipeline board renamed or archived" },
{ slug: "pipeline.stage_created",  category: "admin_write", description: "Pipeline stage added" },
{ slug: "pipeline.stage_updated",  category: "admin_write", description: "Pipeline stage renamed, reordered or re-thresholded" },
{ slug: "pipeline.stage_removed",  category: "admin_write", description: "Pipeline stage removed" },
```

### 4.2 Server-side invariants the editor must enforce

The database cannot express these, so the route has to. Each one is a real way to
brick a board from a screen:

1. **Exactly one `won` stage and one `lost` stage per board.** `decideMove`
   requires both. Refuse the edit that would leave zero or two.
2. **A stage with opportunities on it cannot be removed** without naming a
   destination stage for them. Move first, then delete, in one transaction.
3. **`amber_after_days <= red_after_days`** — the constraint exists; catch it in
   the route and return a readable message rather than a Postgres error.
4. **`key` is immutable once created.** The name is editable; the key is what
   `decideMove` and every stored `opportunity_stage_events` row refer to.

### 4.3 Reordering, which is harder than it looks

`UNIQUE (pipeline_id, position)` means you cannot swap two stages with two
`UPDATE`s — the first one collides with the row you have not moved yet.

Three ways out, in order of preference:

1. **Renumber the whole board in one statement** from the submitted order —
   `UPDATE … SET position = v.pos FROM (VALUES …) v` — inside a transaction.
   One round trip, no temporary values, and the submitted array *is* the intent.
2. Make the constraint `DEFERRABLE INITIALLY DEFERRED` (a migration) and swap
   freely inside a transaction.
3. Park a row at a sentinel position and shuffle. Avoid; it leaves debris when
   it fails halfway.

Take option 1. It needs no migration and it fails atomically.

### 4.4 Seeding the three boards

**By migration, not by hand through the new screen.** The editor is the feature;
the three boards are configuration that every environment must share. Creating
them by clicking on production leaves dev and prod with different board keys, and
`routeToPipeline` returns keys — so they would silently route to nothing on one
of the two.

Proposed starting stages, all editable afterwards:

| Board | Stages |
|---|---|
| Assessment | Enquiry → Booked → Completed → Won / Lost |
| Camps & Clinics | Enquiry → Registered → Paid → Attended / Cancelled |
| Programs & Products | Interested → Purchased → Delivered / Refunded |

The last two columns of each are the `won` / `lost` pair under different names.
That is fine and it is the point of `kind` being separate from `name`.

### 4.5 The board screen picks a board

`/admin/pipeline` gains a board selector. The current page reads one board and
renders its columns; it becomes the same page with a `?board=` param, defaulting
to Coaching so every existing link keeps working.

---

## 5. Traps

- **Widening an enum makes every exhaustive two-branch conditional a latent
  bug.** This repo has been caught by exactly this before: a "publish is safe"
  ruling that checked the list button and not the editor button. Grep for every
  place that assumes one pipeline — `DEFAULT_PIPELINE_KEY`, the reconciler, the
  grant flow, the quiz result handler — and decide each one deliberately.
- **A guard on the client path is not a guard.** The editor's disabled buttons
  are not the invariant; §4.2 in the route is.
- **Renumbering must be transactional.** A half-applied reorder leaves a board
  with duplicate positions, which the unique constraint will have rejected —
  meaning the failure mode is a 500 mid-edit with the board in its old state.
  That is the *good* outcome; make sure it is the one that happens.
- **The board is empty in production.** Every screenshot and every manual test
  will need cards created first. Create them through the real routes, not by
  INSERT — a fixture proves render, not origination.
- **Migration numbers collide silently.** Two branches both claim the next number
  and git merges it clean. Renumbering is free only before the push.
- **Do not put staleness in the database.** It is computed at read time by
  `stalenessOf` and stored nowhere. An editor that writes a `staleness` column
  because it is convenient breaks that property permanently.

---

## 6. Tasks

1. `routeToPipeline` as a pure function, with the §3 table as its test.
2. Decide the Programs & Products question in §3, in writing, in this file.
3. Migration `002xx_pipeline_boards_seed.sql` — three boards, stages, thresholds.
   Applied to the dev clone and read back.
4. `lib/db/pipeline.ts` gains board/stage CRUD. It stays the only module touching
   these four tables.
5. The four §4.2 invariants, tested at the route, each mutated.
6. Reorder by whole-board renumber, in a transaction.
7. Board + stage routes with `withAudit` and five new slugs.
8. `/admin/pipeline/settings` screen.
9. `/admin/pipeline?board=` selector; existing links keep working.
10. Pass `pipelineKey` from every `applyPipelineEvent` caller — the booking
    webhooks (both, after Phase 2), the Stripe webhook, the quiz handler, the
    reconciler.
11. Screenshot all four boards with real cards, plus the editor mid-reorder.

**Verification:** targeted vitest plus `tsc --noEmit` against the 251 baseline.
A falling error count hides new errors too — compare the number, do not just
check it went down.

---

## 7. Out of scope

- Per-board permissions. One coach.
- Custom fields on an opportunity.
- Automations per board ("when a card enters X, send Y"). Sequences already do
  this from the contact side; wiring them to stages is its own design.
- Reporting per board beyond what `/admin/insights/campaign-revenue` already does.
