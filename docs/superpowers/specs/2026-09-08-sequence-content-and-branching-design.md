# Sequence content and branching — design

**Date:** 2026-09-08
**Parent:** [full-engine-scope-vs-built.md](../../full-engine-scope-vs-built.md) — gaps #5, #6, #7
**Branch:** `feat/sequence-content`, cut from `main` @ `82ba10f7`
**Status:** approved 2026-09-08

---

## 1. What this closes

Three gaps from §4 of the scope ledger, which are one piece of work because they
share a migration and the same body of copy:

- **#5** — three sequences the quotation names and that do not exist at all:
  abandoned checkout, service application received, camp or clinic deadline.
- **#6** — the four quiz sequences are **one email long**. One send, then done.
- **#7** — **branching is unused.** `branch_condition`, `on_true_position` and
  `on_false_position` are real columns, `evaluateBranch` works and is tested,
  and zero sequences use any of it.

It also gives `sequence_steps.config` its **first writer**. Item #2 of this build
(gap #12, merged as `799d6afc`) gave the column a reader and shipped dormant
because nothing writes it. The seed migration here is the first thing in the
repository to write `config`, and therefore the first thing that can create a
working `tag` or `stage` step.

---

## 2. Measured state of production, 2026-09-08

Read through the read-only `supabase-prod` MCP (project `epzuvzkokzqtzomeyoha`),
not quoted from an earlier document. Constraint definitions come from
`pg_constraint` joined to `pg_class`, never from `information_schema`, which
hides constraints the querying role does not own.

| Sequence | Status | Steps | Placeholder bodies | Branch steps |
|---|---|---|---|---|
| `cold_lead_re_engagement` | draft | 6 | 0 | 0 |
| `lead_magnet_delivery` | paused | 7 | 0 | 0 |
| `new_lead_nurture` | active | 8 | 0 | 0 |
| `newsletter_welcome` | paused | 6 | 0 | 0 |
| `quiz_aspiring_pro` | **active** | **1** | 0 | 0 |
| `quiz_ceiling_breaker` | **active** | **1** | 0 | 0 |
| `quiz_parent_coach` | **active** | **1** | 0 | 0 |
| `quiz_rebuilder` | **active** | **1** | 0 | 0 |
| `sms_repermission` | active | 2 | 0 | 0 |

This confirms the 2026-09-06 ledger on every count: nine sequences, zero
placeholders, **zero branch steps anywhere**, and the four quiz sequences one
step each and active.

**One thing the ledger does not say, and it matters.** Migration `00229` seeded
the quiz copy as explicitly-marked placeholder text, and migration `00253`
replaced it. So the migration files on disk are **not** the source of truth for
what production sends — `00253` is the current copy and `00229` is history. Any
new quiz step must be added by a new migration, not by editing `00229`.

### Constraints that shape the migration

| Constraint | Definition | Consequence here |
|---|---|---|
| `sequence_steps_kind_check` | allows `email, sms, wait, branch, tag, stage, alert, stop` | `branch` steps are insertable today; no migration needed for the kind |
| `sequence_steps_branch_needs_condition` | `kind <> 'branch' OR branch_condition IS NOT NULL` | a malformed branch step is rejected at insert |
| `sequence_steps_email_needs_body` | `kind <> 'email' OR (subject AND body NOT NULL)` | an email step with no subject fails the migration |
| `sequence_steps_wait_needs_minutes` | `kind <> 'wait' OR wait_minutes IS NOT NULL` | — |
| `sequences_status_check` | `draft, active, paused, archived` | `paused` is a legal status to write |
| `contact_timeline_events.source` | **no CHECK constraint at all** | a new `ContactEventSource` member costs **no migration** |
| `00254`'s `..._tag_needs_config` / `..._stage_needs_config` | dev only | a tag/stage step missing its config key is rejected at insert |

`sequence_runs` has **no metadata column** (17 columns, verified). This is the
fact behind §7.

---

## 3. Decisions taken by the owner, 2026-09-08

| # | Question | Decision |
|---|---|---|
| 1 | A `stage` step can drag a card backwards | **Forward-only.** Add the guard. |
| 2 | What "camp or clinic deadline" means | **Chase the unpaid** — fires on registered interest, not on payment. |
| 3 | Which checkouts "abandoned checkout" covers | **Coaching and programs only.** Not the shop. |
| 4 | The four quiz sequences are live | **Pause them in the migration**; the owner re-activates after reading the copy. |

---

## 4. The three new sequences, and what actually fires them

Enrolment is entirely event-driven: `recordContactEvent` → `enrollIfTriggered`,
which selects `status='active'` sequences whose `trigger_source` equals the
event's source and whose `trigger_filter` matches the event metadata by exact
key equality. There is no scheduled or date-driven enrolment anywhere.

### 4.1 `abandoned_checkout` — trigger `checkout_abandoned`

`checkout.session.expired` is **already a case in the Stripe webhook**
([route.ts:317](<../../../app/api/stripe/webhook/route.ts#L317>)); it currently
does one thing, reaping an unpaid session pack. Stripe expires a Checkout
session roughly 24 hours after it is created, so this is the only abandonment
signal available without building a poller, and the first email necessarily
arrives about a day later. That is a property of Stripe, not a choice.

This design adds a `captureLead` call beside the existing pack logic, gated on
the **existing** `NON_COACHING_CHECKOUT_TYPES` set (`shop_order`,
`event_signup`, `save_card`). Reusing that constant rather than enumerating
coaching types is deliberate and is what its own comment asks for: a new
coaching checkout that forgets to set `metadata.type` must still be treated as
coaching. It also means "a coaching sale" has exactly one definition in this
route — the same one that decides whether a completed checkout wins a pipeline
card.

**A new `ContactEventSource` member, `checkout_abandoned`.** Not
`funnel_checkout`. `funnel_checkout` must keep meaning "bought through a
funnel"; spending it on an abandonment would make the label mean the opposite
of its name, and would leave gap #14 unclosable in its own terms.
**Gap #14 remains fully open** — this closes none of it.

### 4.2 `service_application_received` — trigger `inquiry`

**No code change at all.** `/api/inquiry` already writes a contact event with
source `inquiry` (or `step_up` for the one Step-Up form), and the six service
pages' enquiry form redirects to `/application-received` — the product already
calls this an application.

The double-send question, asked the way `00229`'s header asks it: does anything
already email the *applicant* at this moment? **No.** `sendInquiryEmail` is
addressed to `SALES_EMAIL` with `cc: ADMIN_CC` and `replyTo` the applicant —
it notifies the business, and the applicant receives nothing. So an immediate
first step is safe, and this sequence opens with one.

Its `trigger_filter` is `{}` (match everything with source `inquiry`), which
deliberately excludes Step-Up submissions: those resolve to source `step_up`.

### 4.3 `camp_clinic_deadline` — trigger `event_signup`, filter `{"signup_type": "interest"}`

**This sequence is impossible to build correctly today, and that is the finding
in this section.** Both the interest route and the paid checkout route call
`captureLead({ source: "event_signup", … })` with **no metadata**:

- `app/api/events/[id]/signup/route.ts:78` — registers interest
- `app/api/events/[id]/checkout/route.ts:102` — has paid

`enrollIfTriggered` therefore sees `metadata = {}` for both, and a
`trigger_filter` cannot separate them. A sequence triggered on `event_signup`
as it stands would chase people who **have already paid** — the single worst
outcome available in this whole item.

The fix is to pass metadata at the interest site:
`{ signup_type: "interest", event_type, event_slug }`. `captureLead` already
accepts a `metadata` bag, and its own doc comment names `trigger_filter` as
that bag's reader, so this is the seam working as intended rather than a new
mechanism. The paid route is left alone: adding `signup_type: "paid"` there
would be a column with no reader.

### 4.4 The exact step lists

Pinned here so the implementation is not left to invent them. Every sequence
ends in a `stop` step, matching all nine existing ones.

**`abandoned_checkout`** — 8 steps. The only sequence with a `has_consent`
branch and the only new one with a `tag` step.

| Pos | Kind | Detail |
|---|---|---|
| 0 | email | They left it behind. No pressure, one clear way back. |
| 1 | wait | 2 days |
| 2 | tag | `config: {"tag": "abandoned-checkout"}` — before the split, so both arms get it |
| 3 | branch | `has_consent{sms}` → true **4**, false **6** |
| 4 | sms | Short text, same job as position 6 |
| 5 | stop | ends the texted arm |
| 6 | email | Second email, for those who may not be texted |
| 7 | stop | ends the emailed arm |

**`service_application_received`** — 6 steps.

| Pos | Kind | Detail |
|---|---|---|
| 0 | email | Immediate. We have your application, here is what happens next. |
| 1 | wait | 2 days |
| 2 | email | What the first conversation covers |
| 3 | wait | 4 days |
| 4 | email | Last nudge, easy to say no |
| 5 | stop | |

**`camp_clinic_deadline`** — 8 steps, four touches over ten days.

| Pos | Kind | Detail |
|---|---|---|
| 0 | email | Immediate. What the camp covers and who it suits. |
| 1 | wait | 2 days |
| 2 | email | What a day there actually looks like |
| 3 | wait | 4 days |
| 4 | email | Spots are limited — the deadline nudge |
| 5 | wait | 4 days |
| 6 | email | Last call |
| 7 | stop | |

The `tag` step at `abandoned_checkout` position 2 is the **first
`sequence_steps.config` write in the repository's history**, and the thing that
takes gap #12 from dormant to live. Migration `00254`'s
`sequence_steps_tag_needs_config` constraint rejects it if the `tag` key is
missing, so a malformed seed fails the migration rather than shipping silently.

No `stage` step is seeded. A stage step moves a card on the coaching pipeline,
and none of these three sequences is about a coaching deal in progress — adding
one to demonstrate the feature would move real cards for a reason the copy does
not support. The forward-only guard in §8 is still built and tested; it is
simply not exercised by seeded content yet.

---

## 5. The four quiz sequences (gap #6)

Each goes from 1 step to 8 (positions 0–7). The arc is the same in all four; only the voice
changes, and the voice is already established by the `00253` copy and by each
sequence's `description`, which says who the reader is (an athlete, a hurt
athlete, a young athlete who may be read aloud to at a kitchen table, or a
parent/coach enquiring on someone else's behalf).

| Position | Kind | Purpose |
|---|---|---|
| 0 | email | **Exists already.** Their result, sent immediately. Not rewritten. |
| 1 | wait | 2 days |
| 2 | email | The one thing their result implies they should change first |
| 3 | branch | `has_user` → true **6**, false **4** |
| 4 | email | Prospect arm: an invitation to talk it through |
| 5 | stop | ends the prospect arm |
| 6 | email | Client arm: bring it to your next session, no sales ask |
| 7 | stop | ends the client arm |

**Each arm ends in its own `stop`, and that is not a stylistic choice.** A
branch target is the engine's only jump: every other step advances to
`position + 1`. An arm that does not terminate falls straight through into the
*other* arm's steps, so a prospect would receive the client email as well. This
design error was made and caught while writing this spec; the migration test in
§9 asserts every arm terminates.

Position 0 is **not touched**. It is live, reviewed copy that `00253` put there,
and rewriting it would discard the owner's own pass over the wording.

### The go-live safety net, restored

`00218` and `00229` both state the rule: nothing reaches a real person until a
human flips a row. That net is currently **down** for these four — they are
`active`, so new steps would begin sending the moment the migration deploys.
Per decision #4 the migration therefore sets all four to `paused` in the same
statement that adds the steps. Pausing does not touch anyone mid-flight:
`enrollIfTriggered` reads `status='active'` so no new run starts, and there are
zero runs in existence to strand.

---

## 6. Branching (gap #7)

Two conditions, each chosen because the two arms differ in **content**, not
merely in channel.

**`has_user` — in all four quiz sequences.** An existing client must not be
asked to "book a free intro call"; they already bought. The prospect arm invites
a conversation, the client arm says bring it to your next session. Without the
branch, one of those two groups gets a message that reads as though nobody knows
who they are.

**`has_consent{channel: "sms"}` — in `abandoned_checkout`.** If they may be
texted, a short text; if not, a second email doing the same job. This is not
redundant with `decideStep`'s existing SMS handling: `decideStep` *skips* an SMS
step when there is no phone or no consent, so without a branch the un-consented
person receives **nothing** at that position. The branch is what makes the
CONSENT-based split treat both groups equally — it is not a guarantee that
every run in the true arm actually gets texted. `hasSmsConsent` is computed
from consent alone, with no phone predicate, so a contact can take the true
arm (consent: yes) and still have no `phone_e164` on file, or hit a deployment
with Twilio unconfigured; either way `decideStep` advances the SMS step
straight to its `stop` (position 5) with nothing sent. That person ends up
with one email total against the false arm's two — a real, reachable gap this
branch does not close, not a hypothetical.

**Deliberately not used:** `has_phone` and `source_is`. A `has_phone` branch
would duplicate the skip `decideStep` already performs, and `source_is` only
earns its place in a sequence with more than one trigger, which none of these
are. Adding either to say gap #7 is "fully exercised" would be decoration.

### The one real hazard in branch authoring

`on_true_position` and `on_false_position` are raw integers with no foreign key
and no constraint tying them to a step that exists. Two ways to get it wrong,
and **both are silent**:

1. **A target with no step.** `decideStep` finds no step at that position and
   returns `complete` — the run ends mid-sequence and looks like a normal
   finish on the reporting screen.
2. **An arm that does not terminate.** Every non-branch step advances to
   `position + 1`, and a branch target is the only jump the engine has. So an
   arm which runs off its own end falls through into the *other* arm's steps
   and the person receives both. This is a real error made while writing this
   spec, not a hypothetical.

The migration test in §9 asserts both: every branch target resolves to a real
step in the same sequence, and every arm reaches a `stop` without crossing into
the other.

---

## 7. What this deliberately does NOT build

**Date-anchored waits.** A camp countdown "wants" to say *the camp starts in
five days*. It cannot. `sequence_runs` has no metadata column, so a run cannot
know which camp it belongs to, and the renderer supports exactly two
placeholders — `{{name}}` and `{{sms_consent_url}}` — neither of which is an
event name or date. Making it possible means a schema change plus a new step
kind plus a renderer change, all with a single reader.

The chase therefore runs on **relative waits from the moment interest was
registered** (four touches over about ten days) and the copy stays
camp-agnostic — "the camp you asked about". This is a real limitation and is
recorded here rather than hidden: if a camp is three months out, the chase
finishes long before the deadline it is named for.

**A `wait_until` step kind.** Same reason.

**Re-writing position 0 of the quiz sequences.** See §5.

---

## 8. The forward-only guard (owner decision #1)

`decideMove` holds forward-only at
[lib/lead-engine/pipeline-move.ts:248](../../../lib/lead-engine/pipeline-move.ts#L248);
`moveOpportunityBySequence` does not, making a `stage` step the only automated
writer that can drag a card backwards. Concrete harm: a nurture step pulls a
`consulted` card back to `consult_booked` and resets `entered_stage_at`, so the
board's staleness colouring lies and the coach's queue shows a "needs booking"
card for someone who already had their consult.

`moveOpportunityBySequence` ([lib/db/pipeline.ts:1043](../../../lib/db/pipeline.ts#L1043))
gains the same forward-only check, placed immediately after the existing
`already_on_stage` guard and mirroring `decideMove`'s comparison:

```ts
if (toStage.position <= current.stage_position) {
  return { kind: "skipped", reason: "would_move_backwards" }
}
```

`OpportunityState` already carries `stage_position`, so this needs no extra
read. A backwards `stage` step becomes a no-op that records why — not a silent
corruption, and not a failed run: the step is well-formed, so failing the whole
run would be disproportionate.

**This widens `SequenceMoveResult`'s `skipped` reason union**, which has two
consumers. Neither is checked by the compiler — see §10.

Do not reformat `lib/db/pipeline.ts`. It is one of the ~78 files Prettier
already reports as unclean on `main`; reformatting it would bury this change in
noise.

This is a behaviour change to code merged in item #2 and is safe to make now
precisely because that feature shipped dormant — this migration is the first
thing that can create a `stage` step at all.

---

## 9. Inventory of changes

**Migration `00255_sequence_content_and_branching.sql`** — `00254` is the last
on disk and the last applied to dev. Re-check the number before pushing;
migration numbers collide silently and git merges the collision clean.

1. Insert three `sequences` rows, all `status='draft'`.
2. Insert their steps, including the first `config`-bearing steps in the
   repository's history and the first `branch` steps in production.
3. Insert positions 1–7 for each of the four quiz sequences.
4. `UPDATE` the four quiz sequences to `paused`.

Every insert is `ON CONFLICT … DO NOTHING`, matching `00218`/`00229`, so the
migration is re-runnable. Every row names `business_id` explicitly from the
same literal the sibling seed migrations use — **no new
`SINGLETON_BUSINESS_ID` reference in TypeScript.**

**Code**

| File | Change |
|---|---|
| `lib/db/contacts.ts` | add `checkout_abandoned` to `ContactEventSource` |
| `lib/db/contact-detail.ts` | add its `SOURCE_LABELS` entry — **see §10** |
| `app/api/stripe/webhook/route.ts` | `captureLead` on `checkout.session.expired`, gated on `NON_COACHING_CHECKOUT_TYPES` |
| `app/api/events/[id]/signup/route.ts` | pass `metadata` to `captureLead` |
| `lib/db/pipeline.ts` | forward-only guard in `moveOpportunityBySequence`; widen the `skipped` reason union |
| `lib/db/contact-detail.ts` | render the new skip reason — **see §10** |

**Tests**

- `__tests__/migrations/00255_sequence_content_and_branching.test.ts` — reads
  the migration off disk. `__tests__/lib/lead-engine/seed-sequences.test.ts` is
  scoped to `00218` by a hardcoded path and **will not cover this file**;
  `__tests__/migrations/00254_sequence_tag_stage_steps.test.ts` is the pattern
  to copy. It must assert:
  - every branch target resolves to a real step in the same sequence;
  - **every branch arm reaches a `stop` without falling into the other arm** —
    walk each arm forward from its target, following `position + 1`, and fail
    if it reaches a position belonging to the sibling arm (§6);
  - every `tag`/`stage` step carries the config key `00254`'s constraints
    require;
  - every email step has a subject and a body, and every `wait` has minutes;
  - the four quiz sequences end `paused`;
  - no body contains the word "placeholder";
  - no body contains `{{sms_consent_url}}` (§10), and every merge field used is
    one the renderer actually supports.
- Unit tests for the two new writers and the forward-only guard.
- The **consumers'** suites for the widened union — see §10.

---

## 10. Risks, and the traps this repo has already paid for

**This item widens TWO unions, and the compiler catches neither.** That is the
trap that cost item #2 a silent bug: a task widening a discriminated union must
run the **consumers'** suites, not just its own. Both consumers here were found
by reading, not by tsc, and both would ship a degraded screen rather than an
error.

| Union widened | Consumer that must change | Why tsc is blind to it |
|---|---|---|
| `ContactEventSource` += `checkout_abandoned` | `SOURCE_LABELS`, [lib/db/contact-detail.ts:165](../../../lib/db/contact-detail.ts#L165) | typed `Record<string, string>`, so a missing key is legal. The coach sees a raw slug on the contact timeline. |
| `SequenceMoveResult` skipped reason += `would_move_backwards` | the reason chain at [lib/db/contact-detail.ts:314](../../../lib/db/contact-detail.ts#L314) | the chain compares a `string \| null` and **falls through to `null`**. The coach sees "A sequence left their card where it was" with no explanation of why. |

The runner itself ([sequence-tick-runner.ts:671](../../../lib/automation/sequence-tick-runner.ts#L671))
needs no change: it handles `skipped` generically and passes `result.reason`
through into the timeline row as data. Verified by reading it — not assumed.

There is no exhaustive `switch` and no `Record<ContactEventSource, …>` anywhere
in the repository. Verified.

**Mocked DAL tests cannot verify a column name.** Every DAL test mocks
`@/lib/supabase`, so fixtures and code can be wrong in the same direction and a
house-convention `as unknown as T[]` cast silences tsc. Column names in this
work were read from the live schema, and the migration test reads real SQL off
disk rather than a fixture.

**`lib/email.ts` returns a success shape when `RESEND_API_KEY` is unset.** A
send that did not throw is not a send. Nothing in this item should assert
delivery from a non-throwing call.

**Code must tolerate the old schema for one deploy.** The migration Action and
the Vercel build race on merge to main and nothing sequences them. Everything
here is additive — new rows, a new union member, a new label — so the code
tolerates the pre-migration schema: the new sequences simply do not exist yet
and nothing enrols.

**`{{sms_consent_url}}` throws if unsupplied.** `renderSequenceEmail` raises
when a body contains that placeholder and no URL was passed. No body written
here uses it.

**Copy is written for a non-programmer.** These strings reach a coach raw via
`run.last_error` on the contact detail page. No "opportunity", no "pipeline
stage", no "config", no backticks. The Pipeline page says "pipeline", "card"
and "stages" — it does not say "board".

---

## 11. What the owner must do after this deploys

Nothing here sends anything on its own. In order:

1. **Re-activate the four quiz sequences** once the new copy has been read.
   They are paused by this migration by their own decision.
2. **Activate the three new sequences**, which seed as `draft`.
3. **Confirm `checkout.session.expired` is subscribed** on the Stripe webhook
   endpoint. The handler exists and has handled session packs for months, but
   the subscription list is in the Stripe dashboard, which cannot be read from
   here. If it is not subscribed, `abandoned_checkout` never enrols anybody and
   nothing anywhere reports an error.

Steps 1 and 2 are one click each once gap #11 — the sequence management screen,
the next item in this build — exists. Until then they need
`scripts/activate-sequence.mjs`.
