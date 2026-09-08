# Sequence management — an on/off switch and a step editor (gap #11)

**Date:** 2026-09-08
**Gap:** #11 of `docs/full-engine-scope-vs-built.md`
**Branch:** `feat/sequence-management`, cut from `main` @ `ce6f2aba`
**Parent:** `docs/full-engine-scope-vs-built.md` §4 item 11

Builds on `/admin/sequences`, the read-only reporting screen shipped 2026-09-07
(gap #4). That screen answers *what happened*. This one lets the coach *change
what happens next* — without a script.

---

## 1. Why this is first

Two things are live-but-off on production and only the owner can flip them.
Both need `scripts/activate-sequence.mjs` today:

1. The four `quiz_*` sequences are **paused** at 8 steps each. Migration `00255`
   added seven steps and paused them in the same statement so unread copy could
   not reach an athlete.
2. Three sequences are **draft**: `abandoned_checkout`,
   `service_application_received`, `camp_clinic_deadline`.

This screen turns both into a click.

It is also the **missing writer for `tag` and `stage` steps**. Migration `00255`
seeded exactly one `tag` step, so one row exists in all of production's history
(`abandoned_checkout` position 2, `{"tag": "abandoned-checkout"}` — verified by
counting `config <> '{}'`, because `config` DEFAULTS to `{}` and a
`config IS NOT NULL` count returns every step). Nothing in the product can
create another.

---

## 2. Two discoveries that shaped this design

Both were measured against production on 2026-09-08, not inherited from a
status document.

### 2.1 Pausing a sequence does not stop the people already in it

`claim_sequence_runs` (plpgsql, read from production with `pg_get_functiondef`)
selects runs `WHERE s.business_id = ... AND s.status = 'active'` — that is
**`sequence_runs.status`, the run's own status**. It never joins `sequences`.
`loadRunContext` does read the `sequences` row, but selects **only
`trigger_source`**. Nothing else on the tick path
(route → runner → `claimDueRuns` → `loadRunContext` → `decideStep`) reads a
sequence's status.

Both status checks that exist — `enrollIfTriggered` and `enrolContactManually` —
are **enrolment-time only**.

So today: **pausing stops new people entering. Everyone already inside keeps
receiving messages on schedule.**

This is harmless right now *only* because production has **zero** active runs
(all 73 are terminal `failed`). It means the reassurance that the quiz sequences
are "paused so unread copy cannot reach an athlete" holds by an empty table, not
by a mechanism. An off switch that does not stop the people already inside is a
switch that lies, and this screen is what puts that switch in front of a coach.

### 2.2 Deleting a step destroys the record of what it sent

`sequence_messages_step_id_fkey` is
`FOREIGN KEY (step_id) REFERENCES sequence_steps(id) ON DELETE CASCADE`.

Deleting a step **cascades and destroys every `sequence_messages` row that step
ever produced** — the record of real messages sent to real people. This rules
out "delete every step and re-insert the new list" as a save strategy, which is
otherwise the obvious way to avoid the unique-index problem in §4.4.

---

## 3. Decisions taken by the owner, 2026-09-08

Presented with the trade-offs, the owner chose:

1. **Off means off for everyone.** Turning a sequence off also holds anyone
   already partway through. Turning it back on resumes them where they were.
2. **When steps change, re-point where possible and exit the rest, showing the
   count first.** A person who can be kept on the same step is carried across;
   one who cannot is exited with a recorded reason, never silently reported as
   having reached the end.
3. **Scope is the toggle plus the step editor, on the sequences that already
   exist.** No creating a sequence from scratch, no deleting one.

---

## 4. Design

### 4.1 The off switch (`00256`, part 1)

Migration `00256` replaces `claim_sequence_runs` so it claims a run only when
its sequence is `active`.

**The gate must be inside the RPC, before the claim.** The claiming UPDATE does
`attempts = r.attempts + 1`. The runner destroys a run at `MAX_ATTEMPTS`. So
filtering *after* the claim would increment `attempts` on every tick for every
held run and destroy all of them within a few ticks — a rerun of the 73-run
incident, caused by the safety feature. Post-claim filtering is not an
acceptable alternative and must not be "simplified" to one later.

**Resume falls out for free.** A held run is simply not selected. `next_run_at`
stays where it was, so on re-activation the run is claimable on the very next
tick and resumes at its existing `current_position`. No new column, no new
state, nothing to reconcile.

**Stated honestly, because it is a real consequence:** a run held for weeks
resumes immediately on re-activation, and may send a message whose context has
aged. Quiet hours and the daily cap still apply, so it cannot blast. The screen
says this in words before the coach turns a sequence back on.

**Status mapping.** `sequences.status` has four values. The toggle is binary:

| Toggle | Writes | Shown as |
|---|---|---|
| On | `active` | "On" |
| Off | `paused` | "Off" |

`draft` and `archived` are read as "off" and are never written by the toggle.
The list distinguishes them in words — a `draft` sequence reads **"Never turned
on"**, a `paused` one reads **"Turned off"** — because that difference is real
and useful to a coach, even though the switch treats them the same.

### 4.2 What the step editor saves

The editor `PUT`s the **whole step list**. Existing steps carry their `id`; new
steps do not. Identity is explicit, which is what makes §4.5 possible.

Positions are **owned by the editor, never typed**. The operator drags to
reorder; the list is renumbered `0..n-1` contiguously on save.

### 4.3 Validation is shared with the tick, not re-implemented

`lib/lead-engine/step-config.ts` already states the requirement in its own
header:

> *The sequence step editor is a later item, and it has to reject exactly what
> the tick rejects. One implementation is the only way that stays true; two
> validators drift, and the operator learns about it when a saved step fails
> silently at 3am.*

So the editor calls `parseTagConfig` and `parseStageConfig` directly. It does
not grow its own copy of those rules.

A new **pure** module `lib/lead-engine/step-list.ts` holds what is genuinely
new. Pure for the same reason `step-config.ts` is: `sequence-tick.ts` may import
no IO, and these rules must be testable with zero mocks.

`validateStepList(steps)` mirrors every database CHECK, so the operator gets a
sentence instead of a `23514`:

| Rule | Mirrors |
|---|---|
| `kind` is one of the eight | `sequence_steps_kind_check` |
| email has a subject and a body | `sequence_steps_email_needs_body` |
| text has a body | `sequence_steps_sms_body_check` |
| wait has minutes, and they are above zero | `sequence_steps_wait_needs_minutes` (the "above zero" half is ours) |
| branch has a condition, and it is a predicate the engine knows | `sequence_steps_branch_needs_condition` |
| a label step parses via `parseTagConfig` | `sequence_steps_tag_needs_config` |
| a card-move step parses via `parseStageConfig` | `sequence_steps_stage_needs_config` |
| positions are contiguous from 0 | `sequence_steps_position_uniq` |

Mirroring a CHECK is not redundancy — the constraint is the last line and stays;
this layer exists so the failure arrives as English, before the write.

### 4.4 The rule the database cannot express: every branch arm must terminate

**This is the most important assertion in the feature.** A branch target is the
engine's only jump — every other step advances by `position + 1`. So an arm that
runs off its own end falls straight into the *other* arm's steps and the person
receives both endings. That design error was already made once, on the spec for
`00255`, and was caught by hand rather than by a test.

`validateStepList` walks it. For a branch at position `p` with targets
`on_true_position` and `on_false_position`:

- Walk forward from each target, following `position + 1`, recursing through any
  branch encountered inside the arm.
- The walk **terminates** on reaching a `stop`, or on running past the last step
  (`decideStep` returns `{ kind: "complete" }` when no step matches that
  position, so this is a correct if implicit ending).
- The walk is **cycle-guarded**: a branch that points backwards can loop
  forever, and a validator that loops is worse than the bug.

Two conditions are **errors**:

1. The walk from one arm reaches the other arm's entry position — the
   fall-through that sends both endings.
2. The walk revisits a position — a cycle.

The test must **walk each arm**, not merely check that targets resolve to a real
position. `__tests__/migrations/00255_sequence_content_and_branching.test.ts` is
the pattern; deleting an arm's `stop` is the mutation that proves the walk works.

### 4.5 People who are partway through when the steps change

`decideStep` resolves a run with
`steps.find(s => s.position === run.current_position)` and, on no match, returns
`{ kind: "complete" }`. So today an edit that renumbers steps can leave a live
run pointing at nothing, and that run is recorded as **"Reached the end"** —
indistinguishable, on the reporting screen, from genuinely finishing.

`planStepSave(oldSteps, newSteps, runs)` — pure, in `step-list.ts` — decides
per run, using **step ids**, which survive a renumber:

| The old step at the run's position | What happens |
|---|---|
| still present in the new list | run is re-pointed to that step's new position |
| removed from the new list | run is **exited** with `exit_reason = 'sequence_edited'` |
| did not exist (run was already past the end) | left alone; it completes as it would have |

**The count is shown before saving**, in words a coach can act on: *"4 people
are partway through this sequence. 3 will carry on where they are. 1 will be
stopped, because the step they were on has been removed."*

`sequence_edited` is a new exit reason. `bucketForRun` buckets it as **`other`**
— deliberately not `finished`, because reporting an edit as a completed
follow-up is the exact lie this section exists to prevent. The detail page names
it per person: **"Stopped because the sequence was edited"**.

### 4.6 Deleting a step that has already been sent

Because of §2.2, removing a step destroys the send history it produced.

**v1 refuses to remove a step that has ever sent a message.** The coach is told
why, in plain words: *"This step has already been sent to 12 people, so it
cannot be removed. You can change what it says, or turn the whole sequence
off."* Changing the copy of such a step stays allowed; so does moving it.

The guard lives in **two places on purpose**, and they are not redundant:

- the API pre-checks so the message is a sentence rather than a 500;
- the plpgsql function `RAISE`s, so the rule cannot be bypassed by any future
  caller.

Because two guards can mask each other under mutation, each is pinned by its own
test that disables the other. A mutation that survives here is a finding, not
something to hide.

### 4.7 Atomicity, and the unique index

The save touches `sequence_steps` (update, insert, delete) and `sequence_runs`
(re-point, exit). Supabase's client has no transactions, and a half-applied save
leaves a sequence that sends real email in a shape nobody designed. So the write
goes through one plpgsql function, `save_sequence_steps`, added by `00256`.

The split is deliberate: **TypeScript decides, plpgsql writes.** All validation
and the re-point plan are computed by the pure functions in §4.3–4.5 and passed
in; the function performs the mechanical write atomically and enforces §4.6 as
its last line. Business rules do not get a second home in SQL where they can
drift from the tick's copy.

`sequence_steps_position_uniq UNIQUE (sequence_id, position)` is a **bare unique
index**, not a constraint (so it does not appear in `pg_constraint` at all — use
`pg_indexes`), and it is not deferrable. Renumbering in place therefore collides
mid-statement. The function renumbers in **two phases**: every surviving step is
first moved to `position = -1 - <new position>`, which cannot collide with any
value in `0..n-1`, and then flipped to its final positive value. Verified
against production's `pg_constraint`: there is no `position >= 0` CHECK, so the
negative interim is legal.

### 4.8 Permission

Viewing stays on the `contacts` permission, as `/admin/sequences` already is.

**Turning a sequence on or off, and editing its steps, are admin-only.** This
follows the precedent `app/api/admin/sequences/enrol/route.ts` states in its own
header — enrolling someone causes email to be sent to a real member of the
public in the business's name, which is not a "leads"-shaped permission.
Activating a sequence is the same act with a wider blast radius: it does that
for everybody who enters from now on.

### 4.9 Audit

Two new slugs in `lib/audit/actions.ts`, each with a writer in this branch
(a registered slug with no writer is the labelling gap `CLAUDE.md` forbids):

| Slug | Category | Written by |
|---|---|---|
| `sequence.status_changed` | `admin_write` | the toggle route |
| `sequence.steps_edited` | `admin_write` | the step save route |

Metadata carries the sequence key and counts — how many steps, how many runs
re-pointed, how many exited. **No contact ids, no email addresses, no phone
numbers**, matching the rule the enrol route states for its own row.

### 4.10 Tenancy

`sequences` and `sequence_steps` both already carry `business_id`. Every read
and every write in this branch is scoped by it, including both plpgsql
functions, which take `p_business_id` and filter on it. No new
`SINGLETON_BUSINESS_ID` reference is introduced anywhere.

---

## 5. The screen

`/admin/sequences` (list) gains, per row: the status in words, and the on/off
switch. Turning one **on** asks for confirmation first, because it starts
sending to real people — the dialog says what will happen, including the §4.1
note about held runs resuming.

`/admin/sequences/[key]` (detail) keeps its existing tally and person list, and
gains the same switch plus the step editor.

**Every list on both screens uses `components/ui/data-table.tsx`.** Never a
hand-rolled `<table>`. `DataTableEmpty` renders its own `<tr>` and `DataTable`
emits no `<tbody>`. Admin UI is light-only.

### Copy rules

These strings reach a coach, and `run.last_error` reaches one raw on the contact
detail page. So: no "opportunity", no "pipeline stage", no "config", no
"position", no "branch", no backticks, no jargon.

The step kinds are named for what they do:

| Stored `kind` | On screen |
|---|---|
| `email` | Send an email |
| `sms` | Send a text |
| `wait` | Wait |
| `branch` | Split the path |
| `tag` | Add a label |
| `stage` | Move their card |
| `alert` | Tell the coach |
| `stop` | End here |

"Split the path" gets a sentence under it explaining that each side needs its own
ending, because that is the one rule a coach can break without seeing it.

---

## 6. Testing

Targeted suites only. `source ~/.nvm/nvm.sh && nvm use` (Node 24) first; route
suites pin `--environment node`.

- `step-list.ts` is pure — tested with zero mocks. Arm walking gets its own
  describe block, including the fall-through case, the cycle case, and the
  legal "runs off the end" case.
- `planStepSave` is pure — tested against every row of the §4.5 table.
- The migration gets a test that reads `00256` off disk.
  `__tests__/lib/lead-engine/seed-sequences.test.ts` reads `00218` via a
  **hardcoded path** and will not cover a new migration; this is the equivalent,
  modelled on the `00255` test.
- Route suites cover: admin-only refusal, tenant scoping, the §4.6 delete
  refusal, and the audit row.
- **Mutate every test that passes on the first run, and mutate each conjunct of
  a compound condition separately.** Report the actual per-test vitest output,
  never what a mutation "should" have broken.

`npm run build` is the separate compilation gate — two new API routes are
exactly what it catches. `tsc --noEmit` baseline is **238 errors across 54
files** at `ce6f2aba`, measured from a detached worktree and stored in
`.claude/baselines/`. Diff the per-file error **set**, never the count.

---

## 7. Deploy safety

Migrations apply on push to `main` through a path-filtered Action that races the
Vercel build, and nothing sequences the two. So the code must tolerate the old
schema for one deploy.

`00256` only replaces two function bodies and adds one new function. No column
is added, no signature changes.

| | Behaviour |
|---|---|
| Old code, new functions | Fine. `claim_sequence_runs` gains the gate; nothing calls `save_sequence_steps` yet. Paused sequences stop ticking, which is the intended behaviour arriving early. |
| New code, old functions | Fine. The toggle still writes `status`; the gate is simply not enforced yet. The step editor's save fails loudly with a missing-function error rather than writing anything partial. |

Safe in both orders.

---

## 8. Non-goals, stated so they are not mistaken for oversights

- **No creating or deleting sequences.** The owner scoped v1 to the twelve that
  exist. Deleting would also have to answer what happens to `sequence_runs`
  history; archiving is the likelier answer when it is asked for.
- **No lost-update protection between two simultaneous editors.** The save is
  atomic, but last-write-wins between two admins. One coach per tenant is the
  current invariant and the screen is admin-only. Recoverable by re-editing.
  Not described as airtight.
- **`stage` steps stay forward-only.** `moveOpportunityBySequence` refuses a
  backwards move with `{ kind: "skipped", reason: "would_move_backwards" }`.
  That was the owner's decision on 2026-09-08 and is not "restored" here.
- **`description` stays unrendered.** All twelve production descriptions are
  developer notes; one names two source files. Deliberate, from gap #4.
- **No change to what a `stop` step means**, and no resume/retry action for a
  failed run. Failed is terminal, as it is today.

---

## 9. Appendix — schema facts, read from production on 2026-09-08

Read with `pg_constraint` / `pg_index` / `pg_get_functiondef`, never
`information_schema`, which hides constraints the querying role does not own and
has already reported zero foreign keys for a table with three. Do not re-derive
these; do re-check any you are about to depend on.

**`sequence_steps`** — `id`, `business_id`, `sequence_id`, `position`, `kind`,
`wait_minutes`, `subject`, `body`, `branch_condition`, `on_true_position`,
`on_false_position`, `config`, `created_at`, `updated_at`.

- `config` is `jsonb NOT NULL DEFAULT '{}'`. A `config IS NOT NULL` count returns
  **every** step. Count `config <> '{}'` — which gives **one** row in all of
  production's history.
- `sequence_steps_position_uniq` is a **bare unique index** on
  `(sequence_id, position)`. It is not in `pg_constraint` at all. Not deferrable.
- There is **no** `position >= 0` CHECK, so the negative interim in §4.7 is legal.
- `sequence_steps_kind_check` allows eight kinds, `alert` among them.

**`sequences`** — `id`, `business_id`, `key`, `name`, `description`,
`trigger_source`, `trigger_filter`, `status`, `created_at`, `updated_at`.

- `sequences_status_check` allows `draft | active | paused | archived`.
- `sequences_business_key_uniq` is `UNIQUE (business_id, key)` — `key` is unique
  per tenant, not globally.
- Beware: `information_schema.columns` filtered only on `table_name='sequences'`
  also matches `information_schema.sequences`, the view, and returns its columns
  (`start_value`, `cycle_option`, …) as if they were the table's. Scope to
  `table_schema='public'`.

**`sequence_runs`** — `status` is CHECKed to
`active | completed | exited | failed`. **`exit_reason` has no CHECK at all**, so
adding `sequence_edited` needs no migration. (`exitRun` takes a plain `string`,
and `sequence-tick.ts` already writes `suppressed`, a fifth value the
`SequenceExitReason` union does not declare.)

- `sequence_runs_one_active_per_sequence` is
  `UNIQUE (business_id, sequence_id, contact_id) WHERE status = 'active'`.
- `sequence_runs_due_idx` is partial on `WHERE status = 'active'`.

**Foreign keys that matter here:**

- `sequence_messages.step_id → sequence_steps(id) ON DELETE CASCADE` — the §2.2
  history-destroying cascade.
- `sequence_runs.sequence_id → sequences(id) ON DELETE CASCADE`.

**Branch predicates the engine actually knows** (`evaluateBranch`):
`has_phone`, `has_user`, `has_consent` (with `channel` of `email` or `sms`),
`source_is` (with a `value`). An unknown predicate **fails the run** rather than
guessing an arm — the editor must therefore offer only these four.

**Production state, 2026-09-08:** twelve sequences; zero active runs (all 73 are
terminal `failed`); one pipeline, four stages; 170 contacts; zero consent rows.
So every behaviour in §4.1 and §4.5 ships with **no live effect** — which is
exactly what makes this a safe moment to build it, and exactly why the tests have
to carry the proof instead of production.
