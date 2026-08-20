# Lead Engine — continuation prompt (Stage 4)

Paste everything below the line into a fresh session.

---

We are building the **Lead Engine** for djpathlete — a GoHighLevel replacement that
Darren Paul accepted as the **Full Engine, white-label ready** package ($2,250, 6–8
weeks). Read these first, in this order:

- `docs/superpowers/specs/2026-08-18-lead-engine-design.md` — the design, reconciled
  against this repo. **This is the binding authority.** Stage 4 is §11 ("Remaining
  entry points into `recordContactEvent`. GHL contact import under the §6 consent
  position."). A mid-run ruling that contradicts a spec sentence is wrong by default
  — one such ruling shipped a Critical in Stage 1c; see the journal.
- `docs/lead-engine-status-2026-08-21.md` — where everything stands as of today.
- `supabase/migrations/00218_lead_engine_seed_sequences.sql` — the header comment is
  the double-send audit AND the per-source wiring table. It names exactly which
  sequence waits on which trigger source.

Then skim the newest entries in `JOURNAL.md` (local only, never commit it), and
`git worktree list` + `git log --oneline -15` before starting anything — peer
sessions commit to this repo mid-run, and continuation prompts describe intent at
the time they were written, not current state.

## What already exists — do not rebuild it

**Stages 1a, 1b, 1c, refund handling, and branded emails are all merged, pushed,
and deployed.** Migrations `00211`–`00220` are applied to production. **The engine
is LIVE**: `cron_sequence_tick_enabled` is true in prod `system_settings`,
`business_settings` identity is filled, and the `new_lead_nurture` sequence is
`active` — funnel form submissions enrol real leads and send real email today.

| Thing | Where |
|---|---|
| Contact spine: `contacts`, merges, timeline, consents, suppressions | `00212`–`00215`, `lib/db/contacts.ts`, `lib/db/contact-consents.ts` |
| `recordContactEvent` — the one funnel every entry point must call | `lib/db/contacts.ts`; today's only caller is `lib/funnels/capture-contact.ts` (`source: "funnel_form"`) |
| Sequence engine: tables, tick, claim, idempotency, unsubscribe | `00216`–`00218`, `lib/automation/sequence-tick*.ts`, `lib/lead-engine/` |
| Enrolment: `enrollIfTriggered` reads ACTIVE sequences matching a `trigger_source` | `lib/lead-engine/enroll.ts`, reached only from inside `recordContactEvent` |
| Pipeline board + campaign-to-revenue + refund correction | `00219`–`00220`, `/admin/pipeline`, `/admin/insights/campaign-revenue` |
| Branded email rendering (settings-driven, house layout) | `lib/lead-engine/email.ts` |
| Ops scripts (argv env-file pattern; prod WRITES need the human to run them) | `scripts/inspect-lead-engine.mjs`, `scripts/flip-lead-engine-on.mjs`, `scripts/render-lead-engine-emails.ts` |

Two seeded sequences sit `draft`, copy written and reviewed, **waiting on exactly
this stage**: `newsletter_welcome` (trigger `newsletter`) and `lead_magnet_delivery`
(trigger `lead_magnet`). `cold_lead_re_engagement` is manual-only by design.

## Key contracts you must not violate

- **`users` owns login and billing. `contacts` owns marketing and consent.**
- **Every entry point keeps its existing behaviour and gains one write** — upsert a
  contact via `recordContactEvent`. Do not reroute, dedupe, or "improve" what a
  route already does; the contact write is additive and must never break the
  route's primary job (losing a gbraid is acceptable, losing the lead is not).
- **The double-send audit is binding** (00218 header): `contact_form`,
  `lead_magnet`, `event_signup` already email the lead at capture, so their
  sequences open with a `wait` step, never an immediate email. `newsletter` and
  `funnel_form` are audited safe for immediate sends. Re-verify the audit rows you
  touch — code may have moved since 2026-08-18.
- **Consent:** absence of a consent record is never consent, a failed read is
  neither absence nor presence, and `wording_shown` is NOT NULL — never write a
  consent row you cannot quote. Every phone field that feeds this system captures
  SMS consent evidence.
- **The GHL import follows §6 literally:** the ~90 existing numbers import with
  **no SMS consent**. One re-permission email; only those who agree join.
  Importing them as subscribed is ruled out — this is the single legally dangerous
  move available and the spec forbids it. (`scripts/ghl-export.mjs` may already
  exist from a peer session's export work — check before writing an exporter.)
- **No brand literals** in `lib/lead-engine/` or the other files
  `__tests__/lib/lead-engine/no-brand-literals.test.ts` sweeps. Identity comes from
  `business_settings`.
- Every write to `contacts.email` goes through `normaliseEmail`; `business_id`
  defaults to `'00000000-0000-0000-0000-000000000001'` on every new table.
- **Activating a sequence is a prod data change a human makes** — deliver the
  wiring dark (sequence stays `draft`), verify, then hand Darren the flip. Do not
  seed anything active.

## Your job: plan and build Stage 4 — the remaining entry points, and the GHL import

Spec §11 Stage 4, plus §5–6 for the import. In outline:

1. **Wire the remaining entry points into `recordContactEvent`**, each with its
   correct `source` string and consent evidence. The spec's §3 reuse map found
   these routes: contact form (`app/api/contact`), newsletter
   (`app/api/newsletter`), shop leads / lead magnets (`app/api/shop/leads`) and
   shop checkout, questionnaire, Step Up, assessments, camps via `event_signups`.
   Funnel submit is already wired. For each: confirm what the route does TODAY,
   pick the source string, capture attribution (gclid/gbraid/wbraid/fbclid where
   present), and leave the route's own emails and side effects untouched.
2. **Enrolment goes live for the two waiting sequences** once their sources emit:
   `newsletter` → `newsletter_welcome`, `lead_magnet` → `lead_magnet_delivery`.
   Ship dark; activation is Darren's flip via the ops script pattern.
3. **GHL contact import** under the §6 consent position: import contacts and
   emails as consented only where evidence exists, phones with NO SMS consent, one
   re-permission email flow for the ~90 numbers. Idempotent, resumable, and it
   must respect existing `contact_suppressions` and merge rules.
4. **Resolve the "service application" open question** (spec §13.1 — no route
   exists under any spelling). Ask Darren what it is before inventing anything;
   it blocks part of this stage only.

Non-goals for this stage: SMS sending (Stage 2, blocked on Twilio A2P), the chat
assistant (Stage 3), new pipeline features, GHL workflow switch-off (that is the
separate switch-over phase with its own parallel-run plan).

## Verification gates

Targeted suites plus a build — never the full suite by reflex. `tsc --noEmit`
baseline is **251 on main; re-measure before you start** and compare normalised
error lists (`comm`), not counts. Mutation-test the claims that matter (a wired
route that drops its contact write, an import row that fabricates consent). Prove
the no-brand-literals sweep still passes. For anything user-visible, drive the
real app and look at it — screenshots under `screenshots/`, per the house rules.

Plan with `superpowers:writing-plans`, execute with subagent-driven development
and per-task reviews, and finish with a whole-branch review before the human
merge gate. Work on a branch in a worktree; do not push or merge without an
explicit go-ahead, and never run a prod-writing script yourself — prepare it and
hand the command to Darren's operator.
