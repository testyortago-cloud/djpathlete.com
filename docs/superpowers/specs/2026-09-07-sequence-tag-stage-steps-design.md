# `tag` and `stage` sequence steps — design

**Date:** 2026-09-07
**Parent:** [full-engine-scope-vs-built.md](../../full-engine-scope-vs-built.md) — gap #12
**Branch:** `feat/sequence-tag-stage-steps`, cut from `main` @ `9c366ab2`
**Status:** approved 2026-09-07

---

## 1. What this closes

`sequence_steps.kind` has allowed `tag` and `stage` since migration 00218, and
`decideStep` has advanced past both of them since the day it was written:

```ts
case "tag":
case "stage":
  return { kind: "advance", toPosition: step.position + 1, note: "unsupported_kind" }
```

— [lib/automation/sequence-tick.ts:166](../../../lib/automation/sequence-tick.ts#L166).

So a sequence cannot tag anybody and cannot move anybody's card. This design
makes both do what their name says.

It also gives `sequence_steps.config` its **first reader and first writer**.
The column is `jsonb NOT NULL DEFAULT '{}'` (read from production) and today
nothing in the repository reads it or writes it. That is where a tag name and a
stage key belong, and supplying them is most of this work.

### Measured state of production, 2026-09-07

Read through the read-only `supabase-prod` MCP, not quoted from an earlier
document. Constraint definitions come from `pg_constraint` joined to
`pg_class`, never from `information_schema`, which hides constraints the
querying role does not own.

| Fact | Value |
|---|---|
| `tag` steps in existence | **0** |
| `stage` steps in existence | **0** |
| Steps with a non-empty `config` | **0** |
| All steps | 14 email, 10 wait, 5 stop, 4 sms — 33 total, 0 branch |
| Pipelines | 1 (`coaching`), stages `consult_booked`(open,1) `consulted`(open,2) `won`(won,3) `lost`(lost,4) |
| `opportunity_stage_events` triggers ever written | `booking` ×2, `payment` ×1 |
| `sequence_steps_kind_check` | already allows `tag` and `stage` — **no migration needed for the kinds** |
| `cron_sequence_tick_enabled` | **`true`** |
| Quiz sequences | all four **`active`** |

The last two rows are drift from the 2026-09-06 ledger, which recorded the flag
as false and the quiz sequences as draft. `sequences` has **no `updated_at`
trigger**, so that column is not a change signal on this table and cannot be
used to date the flip.

The engine is therefore armed. Nothing has enrolled since 2026-08-22, but the
next enrolment executes for real, which is why every failure mode below is
specified rather than left to fall out of the code.

---

## 2. Shape: decide in the pure core, execute in the runner

`lib/automation/sequence-tick.ts` imports no database client, and that purity
is why its tests need no mocks. The `alert` kind already shows how a step with
a side effect is handled without breaking it: `decideStep` returns a distinct
`StepAction`, and `sequence-tick-runner.ts` performs the IO.

`tag` and `stage` follow that precedent exactly. Two new members of the
`StepAction` union:

```ts
| { kind: "tag"; step: SequenceStepRow; tag: string }
| { kind: "stage"; step: SequenceStepRow; pipelineKey: string | null; stageKey: string }
```

The runner performs the side effect, writes one `contact_timeline_events` row,
then calls `advanceRun`.

### The concurrency contract is preserved

The runner's header states the rule: **exactly one write-back to
`sequence_runs` per run per tick invocation**, because `advanceRun` / `deferRun`
/ `exitRun` / `completeRun` / `failRun` all clear `claimed_at`/`claimed_by`, and
a second write-back mid-batch would reopen the race `FOR UPDATE SKIP LOCKED`
exists to close.

Both new cases end in exactly one `advanceRun`, the same as `alert`. A `tag`
step followed by an `email` step therefore takes two ticks, not one. That is the
accepted cost already documented for `branch`, restated here so nobody
"optimises" it later.

---

## 3. The `config` schema

A new pure module, `lib/lead-engine/step-config.ts`.

```jsonc
// kind = "tag"
{ "tag": "warm-lead" }

// kind = "stage"
{ "stage": "consulted" }
{ "stage": "consulted", "pipeline": "coaching" }   // pipeline is optional
```

**Why a separate module and not inline in `decideStep`.** Item #11 on the gap
list is a sequence step editor. It must reject exactly what the tick would
reject, and the only way that stays true is one implementation. Putting it in
its own pure module costs nothing now and is the difference between one
validator and two that drift.

**`pipeline` is optional and defaults to `DEFAULT_PIPELINE_KEY`.** There is one
board today and item #8 adds more. Accepting the key now costs one line and
`CLAUDE.md`'s rule is to make the scalable choice when the cost is the same.
Note this is *not* a `SINGLETON_BUSINESS_ID` style shortcut: the value is a
pipeline key, resolved per business through `resolvePipeline(key, businessId)`.

### Exported surface

```ts
export type TagStepConfig = { tag: string }
export type StageStepConfig = { stageKey: string; pipelineKey: string | null }
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function parseTagConfig(config: Record<string, unknown>): ParseResult<TagStepConfig>
export function parseStageConfig(config: Record<string, unknown>): ParseResult<StageStepConfig>
```

`parseTagConfig` validates through `normaliseTag` from
`lib/contacts/tag-format.ts`. That module is already pure — the tags DAL's own
header says the rule lives there so the client-side input can share it without
importing a Supabase client — so the pure core may import it. This means a tag
that is empty, whitespace, or over `MAX_TAG_LENGTH` fails at the **decision**,
not four layers down inside `addTag`, and the parsed value is the normalised
one that will actually be stored.

`parseStageConfig` requires `stage` to be a non-empty string and accepts
`pipeline` only as a non-empty string; anything else is an error, and an absent
`pipeline` yields `pipelineKey: null`.

---

## 4. Malformed config fails the run

Consistent with `branch`, which returns `{ kind: "fail" }` when
`branch_condition` is missing rather than guessing an arm. The reasoning
transfers directly: a `tag` step with no tag has no correct default, and a
`stage` step with no stage could move a real person's card to the wrong column.

A failed run is visible in `/admin/sequences` (built in item #1) and
recoverable. A guess is neither.

### Migration 00254 — the same belt-and-braces `branch` already has

Production enforces:

```sql
sequence_steps_branch_needs_condition
  CHECK ((kind <> 'branch') OR (branch_condition IS NOT NULL))
```

00254 adds the two analogues:

```sql
ALTER TABLE public.sequence_steps
  ADD CONSTRAINT sequence_steps_tag_needs_config
  CHECK ((kind <> 'tag') OR (config ? 'tag'));

ALTER TABLE public.sequence_steps
  ADD CONSTRAINT sequence_steps_stage_needs_config
  CHECK ((kind <> 'stage') OR (config ? 'stage'));
```

Safe to add unconditionally: production holds zero `tag` and zero `stage` steps
and every `config` is `{}`, so no existing row can violate either.

**The runtime `fail` is not made redundant by the CHECK.** Migrations apply on
push to main via a path-filtered Action while Vercel builds the same push, and
nothing sequences the two — so code must tolerate the old schema for one
deploy. During that window the CHECK does not exist and the runtime check is
the only guard. Afterwards it is defence in depth, exactly as `branch` has both.

---

## 5. What a `stage` step may and may not do

**A sequence may move a card. It may not close one, and it may not reopen one.**

| Situation | Outcome |
|---|---|
| Contact has an **open** card on that board, target stage is `open`, different from current | Move it |
| Contact has no card on that board | **Skip**, timeline row, advance |
| The card is closed (`outcome` is `won` or `lost`) | **Skip**, timeline row, advance |
| The card is already on the target stage | **Skip** the write, timeline row, advance |
| Target stage key does not exist on that pipeline | **Fail the run** |
| Target stage is of kind `won` or `lost` | **Fail the run** |
| The pipeline is not configured for this business | **Defer** as a configuration fault (§7) |

**Why closing is forbidden.** `won` feeds revenue reporting, and an automated
close would let a nurture email book a sale that never happened. Refusing at the
step level rather than trusting authors is the cheaper guarantee.

**Why reopening is forbidden.** A closed card was settled by a human or by a
payment. `decideMove` already encodes the principle that "a human who ruled this
person out recently does not get overruled by a form"
([pipeline-move.ts:197](../../../lib/lead-engine/pipeline-move.ts#L197)); a nurture
email is a weaker signal than a form.

**Why "already on that stage" skips rather than writes.** A retried tick would
otherwise append a second identical `opportunity_stage_events` row and reset
`entered_stage_at`, which silently resets the staleness colouring the board uses.
Skipping makes the step idempotent.

**A missing stage key fails rather than skips** because, unlike a missing card,
it can only be an error in the sequence's own definition — nothing about the
contact can cause it. Same class as `branch` with no condition.

### The consequence for the migration

Because no branch of the table above closes a card, this path **never writes
`opportunities.closed_trigger`**. So `opportunities_closed_trigger_check` is
left alone, and 00254 alters exactly one trigger constraint.

---

## 6. The actor on a sequence-driven move

`moveOpportunityManually` is the wrong function to call, for three independent
reasons, and none of them is style:

1. It requires an `actorUserId: string`. The tick is a cron with no signed-in
   user.
2. It writes `closed_trigger = 'manual'`, and 00219's own comment says **"A
   close is FINAL exactly when `closed_trigger = 'manual'`"** — `decideMove`
   reads it to decide whether later automated moves are suppressed. A sequence
   writing `manual` would silently freeze a card against the very automation
   that is supposed to manage it.
3. It audits as `pipeline.opportunity_moved`, category `admin_write`, whose doc
   comment says that trail exists to answer *"did a coach close this deal?"*.
   Filing a cron move there corrupts the one record meant to answer it — the
   same defect that comment describes being fixed on 2026-09-04.

The automated path already answers the actor question. `applyPipelineEvent`
writes `actor_user_id: null` on the stage event and audits with
`SYSTEM_ACTOR = { id: null, email: null, role: "system" }`, letting the
`trigger` column carry provenance instead of inventing a user.

### New DAL function

```ts
// lib/db/pipeline.ts
export type SequenceMoveResult =
  | { kind: "moved"; opportunityId: string; fromStageKey: string; toStageKey: string }
  | { kind: "skipped"; reason: "no_opportunity" | "already_closed" | "already_on_stage" }
  | { kind: "invalid"; error: string }

export async function moveOpportunityBySequence(input: {
  contactId: string
  stageKey: string
  pipelineKey: string | null
  businessId: string
  sequenceRunId: string
}): Promise<SequenceMoveResult>
```

**Deterministic errors are returned, not thrown, and this is load-bearing.**
A stage key that does not exist, or that names a `won`/`lost` stage, is a defect
in the sequence's definition: it will fail identically on every retry. If it
threw, the batch-level catch would treat it as transient — deferring it,
re-running it `MAX_ATTEMPTS` times, and only then failing it, with
`TRANSIENT_ERROR_DEFER_REASON` recorded against a fault that was never
transient. So it comes back as `{ kind: "invalid" }` and the runner calls
`failRun` immediately, which is what §5's table means by "fail the run".

`PipelineNotConfiguredError` still **throws**, because it genuinely is
recoverable without touching the sequence — somebody fills in a setting and the
next tick works. That difference is the whole distinction between §7's two
paths.

It resolves the pipeline via `resolvePipeline(pipelineKey ?? DEFAULT_PIPELINE_KEY, businessId)`,
reads the card via the existing `readMostRecentOpportunity` (which already
returns `stage_kind` and `outcome`, so no new read shape is needed), applies
§5's table, and on a real move:

- updates `stage_id` and `entered_stage_at` only — no closure fields, because
  §5 forbids reaching them;
- inserts an `opportunity_stage_events` row with `trigger: 'sequence'`,
  `actor_user_id: null`, and `metadata: { sequence_run_id }`;
- records `sequence.opportunity_moved`, category `automation`, actor
  `{ id: null, role: "system" }`.

A stage key that does not resolve, or that resolves to a `won`/`lost` stage,
returns `{ kind: "invalid", error }` — the runner turns that into a failed run
per §4, in one write-back and with no retries.

### Two new audit slugs

`lib/audit/actions.ts` is a closed set. Added, both category `automation`,
beside the existing `pipeline.opportunity_created`:

- `sequence.contact_tagged` — a sequence step applied a tag
- `sequence.opportunity_moved` — a sequence step moved a pipeline card

`contact.tag_added` is **not** reused: it is category `admin_write` and means a
person clicked something.

---

## 7. Failure handling in the runner

**`tag`.** `addTag` is idempotent by unique violation and returns
`{ created: boolean }`, so a retried tick is safe. Timeline row
`sequence_tag_applied` with `{ tag, created }`. Then `advanceRun`.

**`stage`.** Call `moveOpportunityBySequence`, then:

- `moved` → timeline `sequence_stage_moved`, then `advanceRun`
- `skipped` → timeline `sequence_stage_skipped` carrying the reason, then
  `advanceRun`
- `invalid` → `failRun(error)` and **no** `advanceRun`. Still exactly one
  write-back. No timeline row: the failure is on the run, which
  `/admin/sequences` already surfaces with its plain-language explanation, and
  a contact's history should not carry an entry about the author's mistake.

**Ordering is side effect → timeline → advance** in both cases, matching
`alert`. If the side effect throws, no `advanceRun` happens and the run keeps
its position, so the batch-level catch retries it. Both side effects are
idempotent, which is what makes that retry safe.

**`PipelineNotConfiguredError` is a configuration fault, not a poison run.**
The batch catch currently classifies only `SequenceSendError`:

```ts
const isConfigFault = err instanceof SequenceSendError && classifySendFault(err) === "configuration"
```

It is widened to include `err instanceof PipelineNotConfiguredError`. This is
the single most important line in the change. A business with no pipeline is a
setting somebody has not filled in; treating it as poison would burn
`MAX_ATTEMPTS` and then destroy the run. Production has 73 runs destroyed that
way by an unverified sending domain on 2026-08-31, and deferring configuration
faults instead is exactly the change that prevents a repeat. Counting it in
`config_faults` also makes the route report the tick as failed, so it surfaces
rather than repeating silently every five minutes forever.

---

## 8. The `quiz` trigger defect, fixed in the same migration

Found while measuring the constraint this work has to widen.

`decideMove` returns `{ kind: "create", toStageKey: firstOpen.key, trigger: "quiz" }`
([pipeline-move.ts:209](../../../lib/lead-engine/pipeline-move.ts#L209)), and
`MoveTrigger` declares `"quiz"`. Production's constraint does not:

```
opportunity_stage_events_trigger_check
  CHECK (trigger = ANY (ARRAY['booking','payment','manual','reconciler','merge']))
```

So the insert raises a check violation, and
[quiz/submit/route.ts:289](../../../app/api/quiz/submit/route.ts#L289) swallows it
into `logFailure` — the quiz completes, the contact is created, and the pipeline
card silently is not. Zero rows carry that trigger, consistent with the path
never once having succeeded. One quiz has been completed on production.

The owner's call was to fix it in the same statement, since the constraint has
to be altered for `sequence` regardless:

```sql
ALTER TABLE public.opportunity_stage_events
  DROP CONSTRAINT opportunity_stage_events_trigger_check;
ALTER TABLE public.opportunity_stage_events
  ADD CONSTRAINT opportunity_stage_events_trigger_check
  CHECK (trigger IN ('booking','payment','manual','reconciler','merge','quiz','sequence'));
```

**Dropping a constraint drops its attributes** — that lesson was paid for on an
FK whose `ON DELETE CASCADE` went missing in a replacement. This is a bare
`CHECK` with no `NOT VALID`, no deferrability and no attributes to lose;
`pg_get_constraintdef` output above is the whole definition, and the new one is
asserted by test against that same output.

### The regression guard

The defect exists because a TypeScript union and a SQL `CHECK` encode the same
set in two places and nothing compared them. A test does now: it reads 00219 and
00254 off disk, extracts the constraint's allowed values, and asserts they equal
the `MoveTrigger` union. This mirrors
`__tests__/lib/lead-engine/seed-sequences.test.ts`, which reads 00218 off disk —
and which, per its own scope, would not have covered 00254.

---

## 9. Timeline labels

`contact_timeline_events.kind` has **no CHECK constraint** (verified via
`pg_constraint`), and `lib/db/contact-detail.ts` has a `default` arm that
humanises an unknown kind, so a new kind cannot render blank. It would however
render as `Sequence tag applied`, which is jargon on a screen the house standard
says must read as plain language. Hand-written labels are added for
`sequence_tag_applied`, `sequence_stage_moved` and `sequence_stage_skipped`.

---

## 10. What is deliberately NOT built

- **A sequence cannot create a pipeline card.** Decided by the owner. If item #5
  (abandoned checkout) wants a card minted from nothing, that is a follow-up
  with its own idempotency design — `applyPipelineEvent`'s create branch needs a
  metadata-matching guard against Stripe's at-least-once delivery, and a
  sequence step would need the equivalent. It must not arrive by accident.
- **A `tag` step cannot remove a tag.** `removeTag` exists and could be wired to
  a `{"remove": "..."}` key, but nothing asks for it, and a step kind that both
  adds and removes is a small language rather than a step.
- **No UI.** The step editor is item #11. This item is the execution engine, and
  there is no screen to screenshot.
- **`opportunities_closed_trigger_check` is untouched**, per §5.
- **No production data is written and no production flag is flipped.**

---

## 11. Testing

| Layer | Covers |
|---|---|
| `lib/lead-engine/step-config.ts` | every accept and reject path — pure, zero mocks |
| `decideStep` | tag/stage actions; fail on malformed config; the three existing `unsupported_kind` assertions **retargeted**, not deleted |
| `moveOpportunityBySequence` | §5's table, one case each, including both throws |
| runner | tag applied, stage moved, each skip, timeline row contents, **exactly one write-back**, `PipelineNotConfiguredError` defers and counts a config fault |
| migration 00254 | read off disk: both `sequence_steps` CHECKs present; the trigger CHECK equals the `MoveTrigger` union |

**Every test is mutated.** A green-on-first-run test in this repo has repeatedly
turned out to pin nothing — three did in item #1, found only by the final
reviewer. The mutation is applied and run, never reasoned about.

**Mocked tests cannot verify a column name.** Item #1 shipped
`contacts(full_name, email)` against a table whose column is `name`, past 29
tests and two reviews, because the fixtures were wrong in the same direction as
the code. Every column this design touches was read from the live schema and is
listed in §1 and §6; any new `.select()` string is asserted as a literal so a
mocked suite can still catch a typo.

---

## 12. Files

| File | Change |
|---|---|
| `lib/lead-engine/step-config.ts` | new — pure config parsing |
| `lib/automation/sequence-tick.ts` | two `StepAction` members; `tag`/`stage` cases replace the no-op |
| `lib/automation/sequence-tick-runner.ts` | execute both; widen the config-fault classification |
| `lib/db/pipeline.ts` | `moveOpportunityBySequence` |
| `lib/audit/actions.ts` | two slugs |
| `lib/db/contact-detail.ts` | three timeline labels |
| `supabase/migrations/00254_sequence_tag_stage_steps.sql` | three CHECK changes |

Next migration number is **00254**; 00253 is the last on disk and the last
applied. Numbers collide silently across branches — re-check before pushing.
