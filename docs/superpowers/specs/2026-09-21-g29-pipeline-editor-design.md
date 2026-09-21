# G29 — the board editor, and the card a coach makes by hand

**Date:** 2026-09-21 · **Ledger row:** G29 in `docs/lead-engine-gaps-to-ship-2026-09-19.md` (**L**) ·
**Branch:** `worktree-g29-pipeline-editor` · **Base:** `main` @ `7727bc70`

**Supersedes** `docs/superpowers/specs/2026-09-01-full-engine-phase4-pipeline-boards-design.md` §4 for
everything it still covers. That document was written before the boards were seeded and before the
board selector shipped; three of its eleven tasks are already done. It remains the reference for §3
routing and §5 traps. Where the two disagree, this one is current.

---

## 1. What is already true, measured not remembered

Read from production 2026-09-21 18:00 UTC.

| Fact | Value |
|---|---|
| Boards | 3 — `coaching` (4 cards), `camps_clinics` (0), `assessment` (0) |
| Stages | 4 per board: two `open`, one `won`, one `lost`; positions start at **1** |
| `pipelines.status` | exists, `NOT NULL DEFAULT 'active'` — **archive needs no migration** |
| Board selector | shipped (`b52e0a6e`); `/admin/pipeline?board=` validates against this tenant's own boards |
| Highest migration on `main` | `00275` → **next free is `00276`**, re-check before commit |

Constraints that shape everything below, read from `pg_indexes` and `pg_constraint` rather than from a
migration file:

- `opportunities_one_open_per_contact_pipeline` — `UNIQUE (contact_id, pipeline_id) WHERE outcome IS NULL`.
  **One open card per person per board.**
- `pipeline_stages_position_per_pipeline` — `UNIQUE (pipeline_id, position)`, **not** deferrable. You
  cannot swap two stages with two `UPDATE`s.
- `pipeline_stages_key_per_pipeline` — `UNIQUE (pipeline_id, key)`.
- `opportunities.contact_id` is `NOT NULL` → **a hand-made card cannot exist without a contact.**
- `opportunities_closed_trigger_check` already permits `'manual'`.

## 2. What this builds

Approach **C**, decided with the owner: ordinary per-operation routes where the objects genuinely are
independent (boards), and one whole-list atomic save where they are not (a board's stages).

### 2.1 The stage list is one object

A board's stage list is only ever valid *as a whole*: "exactly one `won` and one `lost`" cannot be
checked on a single stage. Under per-operation routes, deleting Lost and adding a replacement leaves a
window — between two HTTP requests, in production — where the board has no `lost` stage and
`decideMove` throws on every card move on it.

So the stage editor submits the **entire ordered array**, and that also makes reordering fall out for
free: the submitted array *is* the order, so positions are renumbered wholesale. No `DEFERRABLE`
migration, no sentinel shuffle.

**This repo has already solved this exact problem once.** `save_sequence_steps`
(`supabase/migrations/00256_sequence_management.sql`) is a whole-list atomic save whose header says
*"TypeScript decides, this writes"* — validation lives in `lib/lead-engine/step-list.ts` and the plan is
passed in, so the rules cannot drift into a second home. It also carries a survivor row-count `RAISE`
for a submitted id that does not belong to the parent, a case its header notes is reachable with
"nothing more exotic than one coach with two tabs open". **Mirror it; do not reinvent it.**

### 2.2 Files

| File | New? | Purpose |
|---|---|---|
| `lib/lead-engine/stage-list.ts` | new | Pure. `validateStageList`, `planStageSave`. Sibling of `step-list.ts` |
| `supabase/migrations/00276_save_pipeline_stages.sql` | new | One function, atomic, with the survivor `RAISE` |
| `lib/db/pipeline.ts` | edit | Board CRUD + `savePipelineStages` + `createOpportunityManually`. Stays the only module touching these tables |
| `app/api/admin/pipeline/boards/route.ts` | new | `POST` create |
| `app/api/admin/pipeline/boards/[id]/route.ts` | new | `PATCH` rename / archive |
| `app/api/admin/pipeline/boards/[id]/stages/route.ts` | new | `PUT` whole-list save |
| `app/api/admin/pipeline/opportunities/route.ts` | new | `POST` the hand-made card |
| `app/(admin)/admin/pipeline/settings/page.tsx` | new | The editor screen |
| `components/admin/pipeline-settings.tsx` | new | Client component |
| `components/admin/new-card-dialog.tsx` | new | The hand-made card dialog |
| `lib/audit/actions.ts` | edit | Four new slugs (§2.3) |
| `lib/db/contacts.ts` | edit | `ContactEventSource` gains `manual_card`; `IS_PURCHASE_SOURCE` decides it |
| `lib/lead-engine/enroll.ts` | edit | `IS_SUPERSEDING_SOURCE` decides `manual_card` |

### 2.3 Routes

All `withAudit()`, all `requirePermission("contacts")` — matching `/admin/pipeline` and the existing
move route. **Not a new permission key:** `CLAUDE.md`'s invariant says do not elaborate that system
further, and a coach who can move a card is already trusted with the board.

| Route | Method | Audit slug |
|---|---|---|
| `/api/admin/pipeline/boards` | POST | `pipeline.board_created` |
| `/api/admin/pipeline/boards/[id]` | PATCH | `pipeline.board_updated` |
| `/api/admin/pipeline/boards/[id]/stages` | PUT | `pipeline.stages_saved` |
| `/api/admin/pipeline/opportunities` | POST | `pipeline.opportunity_created_manually` |

The old design proposed five stage slugs (`stage_created`, `stage_updated`, `stage_removed`, …). **One
save is one audit row**, because one save is one atomic act; the metadata carries the before/after
stage list. Five slugs would describe a transaction that does not exist.

## 3. The invariants, and where each one lives

The database cannot express these. Each is a real way to brick a board from a screen.

| # | Invariant | Enforced in |
|---|---|---|
| 1 | Exactly one `won` and exactly one `lost` stage | `validateStageList` **and** the SQL function |
| 2 | A removed stage holding cards must name a destination; move then delete, one transaction | `planStageSave` + SQL |
| 3 | `amber_after_days <= red_after_days`, as readable English | `validateStageList` |
| 4 | `key` is immutable once created; `name` is editable | SQL (survivor update matches on id, never writes `key`) |
| 5 | Submitted stage ids must belong to THIS board | SQL survivor row-count `RAISE` |
| 6 | The board `DEFAULT_PIPELINE_KEY` names cannot be archived | route |

**Invariant 6 is not in the 2026-09-01 design and it matters.** `DEFAULT_PIPELINE_KEY` is `'coaching'`.
The read path survives its archival — `/admin/pipeline` falls back to `boards[0]` — but the **write**
path has no such fallback: `routeToPipeline` returns keys, and a routed event naming an archived board
has nowhere to land. Refusing the archive is the small, honest fix. Making the default per-tenant is
G31/G32 territory and is deliberately **not** widened into this row.

**A guard on the client path is not a guard.** The editor's disabled buttons are not the invariant; the
route and the SQL are. Every one of the six gets a test that calls the route directly.

## 4. The hand-made card

### 4.1 It must not enrol anyone, and that is structural

Owner's decision: a hand-made card **never** enrols the person in a sequence. You already spoke to them
— that is why you are adding them — and filing ten old leads onto a board on a Sunday must not send ten
emails.

**This is enforced by never calling the function that enrols, not by a flag.** Enrolment lives in
`recordContactEvent` (`lib/db/contacts.ts:775`), which calls `enrollIfTriggered`. So the hand-made card
does not call `recordContactEvent` at all:

| Case | Path | Enrols? |
|---|---|---|
| Existing contact chosen | `recordEventForExistingContact` | no — it never touches identity or enrolment |
| New person typed | `upsertContactIdentity` + an explicit timeline write | no — its doc comment says it "never calls `enrollIfTriggered`" |

**There is a precedent for exactly this shape.** `importGhlContact` (`lib/lead-engine/import.ts`) is
already a deliberate non-enrolling caller, because "an imported row is history arriving today, not a
lead". A hand-made card is the same kind of thing: a card being *filed*, not a lead *arriving*.

A boolean like `enrol: false` was considered and rejected — a flag can be passed wrong, and the next
person to add a caller inherits a default. Not calling the enrolling function cannot be passed wrong.

### 4.2 Who the card is for

Search-or-create, decided with the owner. The dialog searches existing contacts by name, email or
phone; the coach picks one, or fills in a new person inline. A new person goes through
`upsertContactIdentity`, which already owns this repo's matching and merge rules, so a typo'd repeat
resolves to the existing contact instead of quietly becoming a second Dana Reyes.

`ContactEventSource` gains **`manual_card`**. That widening is deliberate: two
`Record<ContactEventSource, boolean>` maps (`IS_PURCHASE_SOURCE`, `IS_SUPERSEDING_SOURCE`) are exhaustive
over the union, so tsc turns the new member into a decision rather than a default. Both are **`false`**
— a hand-made card is not a purchase, and it must never supersede somebody's active sequence run.

### 4.3 What the card looks like

- Lands in the chosen board's **position-1 stage**, `outcome` null, `entered_stage_at = now()`.
- `value_cents` optional.
- `source_event_id` stays null — there is no upstream event.
- A collision on `opportunities_one_open_per_contact_pipeline` gets a **readable refusal naming where
  they already are** ("Dana Reyes is already on Coaching, in Consulted"), never a 500 and never a second
  card. The check is a read-then-write and is therefore racy; the unique index is the real guard, so the
  route catches `23505` and returns the same readable message. Both paths are tested.

## 5. Testing

The ledger's rule: the named test must fail on `main` first.

| What | Test |
|---|---|
| `validateStageList` — all six invariants, each one mutated | `__tests__/lib/lead-engine/stage-list.test.ts` |
| `planStageSave` — reorder, insert, remove-with-cards, remove-empty | same |
| Whole-list save is atomic; a bad id `RAISE`s | `__tests__/migrations/00276.test.ts` (live DB) |
| Each route: 401, 403, invariant refusals, success | `__tests__/app/api/admin/pipeline/*.test.ts` |
| Archiving the default board is refused | route test |
| **The hand-made card enrols nobody** | `__tests__/app/api/admin/pipeline/opportunities.test.ts` — asserts `enrollIfTriggered` was never called, with a **presence control**: the same fixture through `recordContactEvent` DOES call it |
| Duplicate open card → readable refusal, both the pre-check and the `23505` race | same |

**The enrolment test needs its presence control or it is worthless.** "`enrollIfTriggered` was not
called" passes just as well when the mock is wired wrong, the import path is stale, or the test never
reached the code. The control proves the spy can fire.

**Verification gates:** targeted vitest, then the whole suite before calling a task done (a suite
selection has hidden a red test three times in this ledger's history); `tsc --noEmit` at the **238
errors / 54 files** baseline with an identical per-file set; `npm run build` exit 0.

## 6. Traps, carried forward and new

- **Widening `ContactEventSource` needs its consumers' suites**, not just the two Record maps — run the
  contacts and enrol suites, not only the new ones.
- **Renumbering must be transactional.** A half-applied reorder that the unique index rejects should
  leave the board in its old state and 500. That is the *good* outcome; make sure it is the one.
- **Do not put staleness in the database.** It is computed at read time by `stalenessOf` and stored
  nowhere. An editor that writes a `staleness` column because it is convenient breaks that permanently.
- **Migration numbers collide silently.** `00276` is free as of 18:00 UTC on 2026-09-21 with four peer
  Claude sessions running. Re-check immediately before commit.
- **The two new boards have no cards.** Every screenshot needs cards created first, and they must be
  created **through the real route** — a fixture proves render, not origination.
- **`position` starts at 1, not 0**, on all three seeded boards. An editor that renumbers from 0 moves
  every card's stage silently.

## 7. Out of scope, deliberately

- Per-board permissions. One coach per tenant.
- Custom fields on an opportunity.
- Per-stage automations ("when a card enters X, send Y"). Sequences already do this from the contact
  side; wiring them to stages is its own design.
- Making `DEFAULT_PIPELINE_KEY` per-tenant — G31/G32.
- Editing a stage's `key` after creation. Every stored `opportunity_stage_events` row references it.
