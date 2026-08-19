# Lead Engine Stage 1b — the sequence engine

**Status:** design, approved in chat 2026-08-18. Plan not yet written.
**Authority:** subordinate to `docs/superpowers/specs/2026-08-18-lead-engine-design.md` (§7 is the
clause this expands). Where the two disagree, that document wins on intent and this one wins on
mechanism.
**Builds on:** `docs/superpowers/plans/2026-08-18-lead-engine-stage1a-contact-spine.md` (executed,
merged to local `main` at `cc2894ef`, unpushed).

---

## 1. What this is

Stage 1a gave the Lead Engine one row per human and a dated record of what they agreed to. It
cannot yet say anything to them. Stage 1b is the part that speaks: a sequence engine that decides,
every five minutes, which contacts are due to hear from the business and whether it is allowed to
tell them.

The engine ships **flagged off** (`cron_sequence_tick_enabled`, default `false`). Nothing sends
until Darren flips it in `/admin/automation`.

## 2. Decisions

Eight questions were open when this stage began. All eight were settled in brainstorming; the
reasoning is recorded here because the alternatives are all defensible and the next person will
wonder.

| # | Decision | Rejected alternative, and why |
|---|---|---|
| 1 | **Enrolment is declarative.** Each `sequences` row carries `trigger_source` (a `ContactEventSource`) plus an optional `trigger_filter`. `recordContactEvent` calls `enrollIfTriggered()` at the end, non-fatally. | Explicit `enrollContact()` at each of 11 entry points: every new sequence becomes a deploy, contradicting §7's "seed data so wording changes need no deploy". Tick-time scanning: no hot-path risk, but a 0–5 minute delay on the welcome email and a per-sequence watermark to maintain. |
| 2 | **Four email-only sequences seed now**, schema sized for eight. Stage 2 adds `sms` steps and the remaining four without a migration. | All eight now: more copy to review before the engine is trusted. One only: too thin to prove the guardrails interact correctly. |
| 3 | **No new admin page.** Registering the flag in `lib/cron-catalog.ts` yields a toggle *and* a "Run now" button on `/admin/automation` for free. | A read-only `/admin/sequences` is real operational value but belongs after the engine is trusted. A sequence editor contradicts decision 2. |
| 4 | **`contacts.timezone` added nullable**, resolved as `contact.timezone ?? business_settings.timezone`. Nothing populates it in Stage 1b, so today every contact resolves to the business timezone — honestly and visibly. | Business timezone only: needs a migration *and* a code change exactly when Stage 2 starts sending SMS across zones, where wrong is a TCPA problem. Inferring from the phone's country code: `+1` spans six US zones, so it would be confidently wrong, which is worse than knowingly coarse. |
| 5 | **A new settings-driven sender** at `lib/lead-engine/email.ts`. `lib/email.ts` is not touched. | Parameterising `emailLayout()` means refactoring a 2,800-line file behind 40+ live senders to ship a flagged-off feature. A thin `sendRawEmail()` export keeps Lead Engine rendering in a file the §2.2 brand scan can never pass. |
| 6 | **One-click HMAC unsubscribe** at `/unsubscribe/[token]`, plus a `List-Unsubscribe` header. | A confirm-click page defends against mail-scanner prefetch but puts friction between wanting out and being out. Extending `/api/newsletter/unsubscribe` inherits an unauthenticated raw-email POST — anyone can unsubscribe anyone — and blurs two lists. |
| 7 | **Timeline retention scrubs `metadata` to `{}`** and stamps `scrubbed_at`, keeping the row. | Deleting the row matches `auditLogRetentionCron` and gives the repo one retention idiom, but "this person first arrived via the funnel in March" is exactly what the timeline exists to answer and carries no PII once scrubbed. |
| 8 | **Tick model: claim → pure decision → execute.** | Deciding and sending inline needs a Supabase mock for every quiet-hours and daily-cap test, and this repo has shipped two mocks that ignored their filters. A `sequence_sends` queue drained by a second worker isolates failures best, but is a second cron and a second flag for a feature that ships off. |

## 3. Schema

### 3.1 Migration `00216_lead_engine_sequences.sql`

Five objects. Every table carries `business_id uuid NOT NULL DEFAULT
'00000000-0000-0000-0000-000000000001'` referencing `businesses(id)`, RLS enabled, service-role
full-access policy — matching `00212`–`00215` exactly.

**`sequences`** — `key text` (stable slug), `name`, `description`, `trigger_source text`
(nullable; null means manual enrolment only), `trigger_filter jsonb NOT NULL DEFAULT '{}'`,
`status text CHECK (status IN ('draft','active','paused','archived')) DEFAULT 'draft'`.
`UNIQUE (business_id, key)`.

**`sequence_steps`** — `sequence_id` (cascade), `position int`, `kind text CHECK (kind IN
('email','sms','wait','branch','tag','stage','alert','stop'))`, `wait_minutes int`, `subject text`,
`body text`, `branch_condition jsonb`, `on_true_position int`, `on_false_position int`,
`config jsonb NOT NULL DEFAULT '{}'`. `UNIQUE (sequence_id, position)`.

All eight kinds are in the CHECK from day one even though three do not execute yet (§6) — the
schema should not need a migration to gain a step type whose target already exists.

**`sequence_runs`** — `sequence_id`, `contact_id` (cascade), `current_position int DEFAULT 0`,
`status text CHECK (status IN ('active','completed','exited','failed')) DEFAULT 'active'`,
`next_run_at timestamptz NOT NULL DEFAULT now()`, `claimed_at timestamptz`, `claimed_by text`,
`attempts int NOT NULL DEFAULT 0`, `exit_reason text`, `enrolled_at`, `completed_at`.

**`sequence_messages`** — `run_id` (cascade), `step_id`, `contact_id` (cascade), `channel text
CHECK (channel IN ('email','sms'))`, `to_identifier text` (the address as of send time),
`subject`, `body_rendered`, `provider text`, `provider_message_id text`, `status text CHECK
(status IN ('queued','sent','failed','skipped'))`, `error text`, `sent_at`, `delivered_at`,
`opened_at`, `clicked_at`.

**`contacts.timezone text`** — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

### 3.2 The three indexes that carry meaning

```sql
-- THE idempotency key. One message per step per run, enforced by the database.
CREATE UNIQUE INDEX sequence_messages_idem
  ON sequence_messages (run_id, step_id);

-- A double form-submit must not enrol the same contact into the same sequence twice.
CREATE UNIQUE INDEX sequence_runs_one_active_per_sequence
  ON sequence_runs (business_id, sequence_id, contact_id) WHERE status = 'active';

-- The claim scan and the send-time sibling-run guardrail.
CREATE INDEX sequence_runs_due_idx
  ON sequence_runs (business_id, status, next_run_at) WHERE status = 'active';
```

**There is deliberately no unique index enforcing one active run per contact overall.** §7 places
that guardrail at send time, and an index would be schedule-time enforcement wearing a disguise: a
second sequence must be allowed to enrol and queue behind the first, with only the oldest active
run permitted to send. Blocking the enrolment instead would silently discard the signal that the
contact did something new.

### 3.3 Migration `00217_lead_engine_sequence_functions.sql`

Two plpgsql functions (`claim_sequence_runs`, `merge_contacts`) and the two schema-level debt
fixes, §9.2 and §9.3. §9.4 is a code change with no migration.

**`claim_sequence_runs(p_business_id uuid, p_limit int, p_claim_token text)`** — the atomic claim.

```sql
UPDATE sequence_runs r
   SET claimed_at = now(), claimed_by = p_claim_token, attempts = r.attempts + 1
 WHERE r.id IN (
   SELECT id FROM sequence_runs
    WHERE business_id = p_business_id
      AND status = 'active'
      AND next_run_at <= now()
      AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
    ORDER BY next_run_at
      FOR UPDATE SKIP LOCKED
    LIMIT p_limit)
RETURNING r.*;
```

The `claimed_at < now() - interval '10 minutes'` arm is what stops a tick that died mid-batch from
stranding its runs forever. It is also the only reason `attempts` exists: a run whose attempts
climb without its position moving is a poison message, and the automation-health watchdog should
be able to see that.

**`merge_contacts(p_survivor uuid, p_merged uuid, p_business uuid, p_reason text)`** — §9.1.

## 4. The tick

```
sequenceTickCron  (*/5 * * * *, UTC)          functions/src/index.ts
  └─ POST /api/admin/internal/sequence-tick   app/api/admin/internal/sequence-tick/route.ts
       ├─ INTERNAL_CRON_TOKEN bearer check
       ├─ isCronSkipped('cron_sequence_tick_enabled', defaultEnabled: false)
       ├─ logCronStart / logCronEnd            lib/db/cron-runs.ts
       └─ runSequenceTick()
            ├─ claim_sequence_runs(...)        lib/db/sequences.ts      [IO]
            ├─ decideStep(run, steps, ctx)     lib/automation/sequence-tick.ts   [PURE]
            └─ execute(action)                 lib/db/sequences.ts + lib/lead-engine/email.ts [IO]
```

The route copies `app/api/admin/internal/inbox-sla/route.ts` for shape, including
`export const runtime = "nodejs"` and `maxDuration`.

`decideStep` is a pure function over `(run, steps, context)` returning exactly one action:

| Action | Meaning |
|---|---|
| `send` | Render and send this step's message, then advance. |
| `advance` | Move to the next position without sending (`wait` elapsed, `branch` resolved, unsupported kind). |
| `defer(until)` | A guardrail blocked the send. Set `next_run_at = until`, keep the position. |
| `exit(reason)` | An exit condition matched. `status='exited'`, `exit_reason=reason`. |
| `complete` | Ran off the end of the step list, or hit a `stop`. |
| `fail(error)` | The engine cannot proceed safely (§6, unknown branch predicate). |

`context` is assembled once per run before the call: resolved timezone, business settings, consent
for the step's channel, suppression state, the contact's local-day message count, and the oldest
active sibling run. That is one extra read per run and it is what buys mock-free guardrail tests.

## 5. Guardrails

All three are pure functions in `lib/lead-engine/guardrails.ts`, evaluated **at send time**.

1. **Quiet hours.** `quietHoursDefer(nowUtc, tz, startHour, endHour)` returns null or the UTC
   instant when the window opens. `tz` is passed explicitly so tests can sweep zones without a
   database. Resolution is `contact.timezone ?? business_settings.timezone`.
2. **Daily cap.** `business_settings.daily_message_cap` (default 1) counted over the contact's
   **local** calendar day across all sequences — `sequence_messages` where `status='sent'` and
   `sent_at` falls inside that local day. Not the UTC day: a 9pm America/New_York send and a 9am
   send the next morning are two different days to the recipient and the same UTC day to Postgres.
3. **One active sequence per contact.** Only the run with the earliest `enrolled_at` among a
   contact's active runs may send. Others defer.

Each guardrail names the instant it defers to: quiet hours defers to the moment the window opens,
the daily cap defers to the contact's next local midnight, and a sibling run defers one tick. A
blocked send always **defers, never skips**. The step stays pending and goes out when the window
opens. Skipping would silently drop an email that the sequence's author intended to send, which is
the failure the "guardrails at send time" rule exists to prevent in the first place.

## 6. Steps

**Executing now:** `email`, `wait`, `branch`, `stop`, `alert`.

**Valid in schema, not executing:** `sms` (Stage 2 — Twilio A2P is human-blocked), `tag` and
`stage` (Stage 1c — no `contact_tags` table and no pipeline exists to move a card on). Encountering
one records a `sequence_step_unsupported` timeline event and advances. Visible, not silent. No
Stage 1b seed sequence uses them.

**`alert`** notifies the business, not the contact: an email to `business_settings.reply_to` plus a
timeline event. It is the step type a sequence uses to say "a human should look at this one".

### 6.1 The consent regime differs by channel

Stage 1a deliberately writes no consent row from the funnel form —
`wording_shown` is NOT NULL and the form displays no consent wording — so
`hasConsent` returns `false` for every contact that exists today. Gating email on
it would ship an engine that can never send.

- **Email is opt-out.** Blocked only by `contact_suppressions`. This is the
  CAN-SPAM regime, and the one-click unsubscribe in §8 is what satisfies it.
- **SMS is opt-in.** Requires an explicit granted consent row. TCPA does not
  accept opt-out, and §6 of the parent spec already rules that the 90 imported
  phone numbers arrive with no SMS consent.

No Stage 1b sequence sends SMS, so that branch is unreachable until Stage 2. The
rule is encoded in the pure decision function now, with tests for both channels,
rather than being invented under deadline later.

**Branch predicates** are a closed set:

```
{ "kind": "has_phone" }
{ "kind": "has_user" }
{ "kind": "has_consent", "channel": "email" | "sms" }
{ "kind": "source_is",   "value": "<ContactEventSource>" }
```

An **unrecognised predicate fails the run** (`status='failed'`, error recorded) rather than
defaulting to false. Defaulting means guessing which arm is correct, and a wrong guess sends the
wrong email to a real person. A failed run is visible and recoverable; a wrong send is neither.

## 7. Enrolment and exits

**Enrolment.** `enrollIfTriggered(contactId, source, metadata)` in `lib/lead-engine/enroll.ts`,
called at the end of `recordContactEvent`, wrapped exactly like the existing timeline write: errors
are logged with correlating ids and never thrown. A unique violation on
`sequence_runs_one_active_per_sequence` is not an error — it means this contact is already in this
sequence, which is the correct outcome of a double submit. The contract in `lib/funnels/capture-contact.ts`
holds — losing an enrolment is recoverable, losing the lead is not.

**Exits** evaluate on tick *and* on event, so a missed hook costs five minutes rather than a wrong
send:

| Trigger | Hook site | Resolution |
|---|---|---|
| Unsubscribe | `/unsubscribe/[token]` | contact id is in the token |
| Payment | `app/api/stripe/webhook/route.ts` (`checkout.session.completed`) | `contacts.user_id`, falling back to the customer email |
| Booking | `app/api/webhooks/ghl-booking/route.ts` | `contact_email` / `contact_phone`, both already on the payload |
| Suppression | tick | `contact_suppressions` |

`exitRunsForContact(contactId, reason)` is idempotent and non-fatal at every call site — a
marketing exit must never fail a payment webhook.

*Stops when they reply* remains deferred: it needs the inbox, which is out of scope.

## 8. Email and unsubscribe

`lib/lead-engine/email.ts` reads `business_settings` for sender name, sender email, reply-to, logo,
display name and postal address; renders the step's stored `subject`/`body`; appends the postal
address and unsubscribe link CAN-SPAM requires; and sets the `List-Unsubscribe` header so Gmail's
native control works. It uses the Resend SDK directly with the same missing-API-key guard
`lib/email.ts` applies.

**No brand literal appears in any of it.** A test scans `lib/lead-engine/**` and the seed migration
for `DJP Athlete`, `Darren`, and the sending domain, delivering §2.2's third promise.

**The token.** `lib/lead-engine/unsubscribe-token.ts` follows `lib/qr/checkin-token.ts`: HMAC over
`NEXTAUTH_SECRET`, `timingSafeEqual`, base64url. It **must carry its own prefix marker** (`unsub.`)
and verify it. That file already documents a bug where token families sharing the secret
cross-validated because a non-date segment yielded `NaN`; an unprefixed unsubscribe token would be
the same bug with a worse blast radius — a check-in link that silently unsubscribes someone.

**Send-path idempotency, stated honestly.** The `sequence_messages` row is inserted with
`status='queued'` *before* Resend is called; a unique-violation on `(run_id, step_id)` means another
tick already has it, and this tick skips. If the process dies between the insert and the send, the
row stays `queued`. Such a row is retried after **15 minutes**: the insert's unique violation is
caught, the existing row is read, and a row that is still `queued` with a null
`provider_message_id` and a `created_at` older than 15 minutes is re-sent rather than skipped. This is at-least-once, not
exactly-once: the alternative is a sequence that stalls forever on a single crash. The window is
documented at the callsite and must not be described as exactly-once anywhere.

## 9. Carried-forward debt

### 9.1 Atomic merge

`merge_contacts(...)` in plpgsql — one transaction — replaces the body of `mergeContacts`. The
JS function keeps its signature and becomes a `.rpc()` call; `decideMerge` stays pure JS and is
untouched. The function performs, in order: snapshot the loser, re-point every child, carry
`user_id` across or record the conflict, insert the `contact_merges` audit row if absent, delete
the loser.

### 9.2 Consent tiebreak

`contact_consents` gains `created_at timestamptz NOT NULL DEFAULT now()`. `hasConsent` orders by
`(occurred_at DESC, created_at DESC)` and the lookup index is rebuilt to match. This must land
**before** any `marketing_consent_log` backfill, which would insert many rows sharing one
`occurred_at` and leave "the most recent record wins" undefined.

### 9.3 Timeline retention

`contact_timeline_events` gains `scrubbed_at timestamptz`. A daily
`contactTimelineRetentionCron` (03:30 UTC, after the audit-log prune) nulls `metadata` to `{}` and
stamps `scrubbed_at` on rows older than `contact_timeline_retention_days` (default 365), skipping
rows already scrubbed. Flag `cron_contact_timeline_retention_enabled`, default **true** — the same
reasoning as the audit-log retention flag: unbounded PII accumulation is the risk being managed, so
the safe default is on. Twin helper in `lib/db/` and `functions/src/lib/`, and the cron joins the
`automation-health-scanner` expected list.

### 9.4 Suppression conflict code

`suppress` matches `error.code === '23505'` instead of `String(error.message).includes('duplicate')`.

## 10. The cascade trap, restated because it is about to recur

Stage 1a's one real bug: `mergeContacts` re-pointed timeline rows before deleting the losing
contact but never re-pointed `contact_consents`, which cascades — so merging two records destroyed
consent evidence in the subsystem whose entire purpose is defensible consent. The cause was
structural: the merge was written in one task, the consent table in a later one, and neither task's
reviewer could see the interaction.

**Stage 1b adds two more cascading children of `contacts`:** `sequence_runs.contact_id` and
`sequence_messages.contact_id`. The identical bug is available again, in the same function.

**And an earlier draft of this section proved the point by getting it wrong.** It listed four
children. There are five. `contact_merges.survivor_id` (`00213`, line 51) is also
`REFERENCES public.contacts(id) ON DELETE CASCADE` — so merging a contact that had itself survived
an earlier merge destroys that earlier merge's audit row and its `merged_snapshot`. This is not an
exotic path: `lib/lead-engine/merge.ts` picks the survivor as oldest-`created_at`-wins and merges
never touch `created_at`, so a past survivor losing to an older contact that resurfaces is ordinary
dedup behaviour. Task 1's reviewer caught it and reproduced it live. The lesson is not "remember
contact_merges" — it is that the enumeration must be **run**, not recalled.

The authoritative list, as of `00216`, produced by
`grep -n "REFERENCES public.contacts(id)" supabase/migrations/*.sql`:

| Child | Migration | Handling in `merge_contacts` |
|---|---|---|
| `contact_merges.survivor_id` | `00213:51` | re-point to survivor |
| `contact_timeline_events.contact_id` | `00214:11` | re-point to survivor |
| `contact_consents.contact_id` | `00215:15` | re-point to survivor |
| `sequence_runs.contact_id` | `00216:70` | re-point, exiting a loser's run where the survivor is already active in that sequence |
| `sequence_messages.contact_id` | `00216:103` | re-point to survivor |

Exempt, with reasons: `contact_merges.merged_id` carries no FK by design, so the audit row survives
its subject; `contact_suppressions` is keyed by identifier rather than `contact_id`, so a
suppression survives a merge, a delete, and the same person arriving again months later.

Therefore:

- `merge_contacts` re-points all five before the delete.
- The plan's final review **runs the grep** and checks each hit against the merge — it does not
  trust per-task review, or this table, to be complete. If the grep returns a sixth row, the
  function is wrong until proven otherwise.
- A test asserts the merge preserves a losing contact's runs and messages, not only its consent.

## 11. Seed data — and the double-send audit

Four sequences seed as data in `00216`, not code.

**Required before choosing a trigger source: enumerate what that source already emails the lead.**
Verified 2026-08-18:

| Source | Already emails the lead? | Safe for an immediate first step? |
|---|---|---|
| `funnel_form` | No — `sendNewFunnelLeadEmail` goes to the admin | **Yes** |
| `contact_form` | **Yes** — `sendContactAutoReply`, `app/api/contact/route.ts:94` | No; first step must wait, or the sequence must not own the reply |
| `newsletter`, `lead_magnet`, `event_signup`, `assessment` | Unaudited | Audit before seeding |

This table is the "name the reader before writing a column" discipline pointed at sending: the
failure mode is two emails landing within a second of each other, and it is visible to every lead.

Candidate four, to be confirmed against the audit: new-lead nurture (`funnel_form`), lead-magnet
delivery and follow-up (`lead_magnet`), newsletter welcome (`newsletter`), and a cold-lead
re-engagement sequence. Any source that already auto-replies takes a `wait` as its first step.

The four sequences, their exact copy, and the per-source audit above are a **plan task**, not
settled here — copy belongs in seed data precisely so it can change without a deploy.

## 12. Testing

Targeted suites plus `tsc --noEmit`, compared against the **258-error baseline** as a total count.
Grepping the output for touched filenames hides new errors in files you did not expect to break.

| Concern | How |
|---|---|
| Quiet hours across timezones | Table-driven pure tests, no mocks |
| Daily cap across simultaneous sequences | Pure, over a fixture message list |
| Exit conditions per trigger | Pure, one case per trigger |
| Branch predicates incl. unknown → fail | Pure |
| Send idempotency under retry | DAL test asserting the unique violation is caught, plus the 15-minute requeue |
| **Claim race under overlapping ticks** | **Integration lane against the real database** — two concurrent `claim_sequence_runs` calls must return disjoint sets. `SKIP LOCKED` cannot be proven against a mock, and a unit test that asserts the migration text contains the words is worth nothing. Uses `__tests__/integration/_helpers/cleanup.ts`. |
| No brand literals | Scan of `lib/lead-engine/**` + seed migration |
| Merge preserves children | Runs and messages, not only consent (§10) |

Two Stage 1a traps that must not recur: a Supabase mock that ignores `.eq()` filters makes
assertions pass trivially — check that a mock actually filters before trusting a green test. And
"this test would fail if X" is a guess until X has been applied and the failure observed.

## 13. Deploy

Migrations `00212`–`00217` land together; none has run against production. The
`Apply Supabase Migrations` workflow races Vercel on push, so for one deploy window the new columns
may not exist. Two paths are already live-adjacent and must tolerate that: `recordContactEvent`
(reached from the funnel submit route) already swallows its errors, and `enrollIfTriggered` inherits
the same contract. The tick flag defaulting to `false` is the outer safety net — the tick does not run,
so nothing sends, until the schema is confirmed present.

`cron_sequence_tick_enabled` is registered in `lib/cron-catalog.ts` (toggle + "Run now") and
`sequence-tick` is added to `VERCEL_ROUTE_JOBS` in `app/api/admin/automation/trigger/route.ts`,
since the runner is a Next.js route rather than a Firebase function.

New audit slugs go in the closed taxonomy in `lib/audit/actions.ts`.

## 14. Out of scope

SMS sending of any kind (Stage 2, human-blocked on Twilio A2P); the pipeline board and
campaign-to-revenue (Stage 1c); a sequence editor UI; "stops when they reply"; the GHL contact
import; and the `marketing_consent_log` backfill — which §9.2 unblocks but does not perform.

## 15. Open questions

1. **The four sequences' copy and their trigger sources**, pending the §11 audit of the four
   unaudited entry points.
2. **Whether `alert` should reach anything other than `business_settings.reply_to`** — there is no
   notification surface for staff other than email today.
3. Inherited from the parent spec: the "service application" entry point still has no route under
   any spelling, and the privacy-policy v2 draft awaits Darren's approval.
