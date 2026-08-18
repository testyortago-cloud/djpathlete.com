# Lead Engine — continuation prompt (Stage 1b)

Paste everything below the line into a fresh session.

---

We are building the **Lead Engine** for djpathlete — a GoHighLevel replacement that
Darren Paul accepted as the **Full Engine, white-label ready** package ($2,250, 6–8
weeks). Read these two first, in this order:

- `docs/superpowers/specs/2026-08-18-lead-engine-design.md` — the design, reconciled
  against this repo. This is the binding authority.
- `docs/superpowers/plans/2026-08-18-lead-engine-stage1a-contact-spine.md` — the plan
  that has already been executed.

Then skim the newest entries in `JOURNAL.md` (local only, never commit it).

## What already exists — do not rebuild it

**Stage 1a is done and merged to local `main` (`cc2894ef`, not pushed).** Migrations
`00212`–`00215` exist but have **not** been run against production.

| Thing | Where |
|---|---|
| `businesses`, `business_settings` | `00212`, `lib/db/businesses.ts` |
| `contacts` + merge audit | `00213`, `lib/lead-engine/merge.ts` |
| `contact_timeline_events` | `00214` |
| `contact_consents`, `contact_suppressions` | `00215`, `lib/db/contact-consents.ts` |
| `recordContactEvent` — the one funnel all 11 entry points call | `lib/db/contacts.ts` |
| Email/phone normalisation | `lib/lead-engine/identity.ts` (`libphonenumber-js`) |
| Funnel form wired in | `lib/funnels/capture-contact.ts` |

Key contracts you must not violate:

- **`users` owns login and billing. `contacts` owns marketing and consent.** A contact
  may or may not have a user; a user always has a contact. Nothing existing was
  re-pointed and nothing should be.
- **Absence of a consent record is never consent, and a failed read is not absence.**
  `hasConsent` returns false only on genuine absence and throws on error.
- **`wording_shown` is NOT NULL** — never write a consent row you cannot quote.
- **`business_id` on every new table**, defaulting to
  `'00000000-0000-0000-0000-000000000001'`.
- **No brand literals** in any new code. Business identity comes from
  `business_settings` — which is `lib/db/businesses.ts`'s named reader, and Stage 1b is
  the stage that finally reads it.
- Every write to `contacts.email` must go through `normaliseEmail` (lowercases). The
  unique index is on `lower(email)` and lookups query plain `email`.

## Your job: plan and build Stage 1b — the sequence engine

This is the hardest part of the whole build. Spec §7 is the authority. In outline:

- `sequences`, `sequence_steps` (email / sms / wait / branch / tag / stage / alert /
  stop), `sequence_runs`, `sequence_messages`
- A tick every 5 minutes, reusing this repo's established pattern: Firebase
  `onSchedule` → `POST /api/admin/internal/<slug>` → a pure aggregator in
  `lib/automation/`. Copy `app/api/admin/internal/inbox-sla/route.ts` for the shape,
  including the `INTERNAL_CRON_TOKEN` bearer check and the `isCronSkipped` gate.
- **Claim due runs atomically** (`SKIP LOCKED`, not read-then-write) so an overlapping
  tick cannot double-send, and an idempotency key of `(run_id, step_id)` on every send.
- **Guardrails enforced at send time, not schedule time** — quiet hours in the contact's
  timezone, one message per contact per day across all sequences, one active sequence
  per contact. Schedule-time enforcement drifts the moment a tick runs late.
- Exit conditions on both tick and event (payment, booking, unsubscribe). "Stops when
  they reply" is deliberately deferred — it needs the inbox that is out of scope.
- Feature flag `cron_sequence_tick_enabled`, default **false**.
- Four email sequences as **seed data**, not code, so wording changes need no deploy.

Start with `superpowers:brainstorming` if anything about the shape is unsettled;
otherwise go straight to `superpowers:writing-plans`, then execute with
`superpowers:subagent-driven-development`.

## Carried-forward debt — fold these into Stage 1b, they were deferred with rulings

1. **Make the contact merge atomic.** `mergeContacts` in `lib/db/contacts.ts` is three
   un-transacted REST round-trips. It is idempotent, and its ordering is safe (timeline
   and consent re-pointed before the cascade delete), but it is not atomic. Stage 1b
   already needs a plpgsql function for `SKIP LOCKED` — build both together.
2. **Add a tiebreak to consent ordering.** `contact_consents` has no `created_at`, so
   `ORDER BY occurred_at DESC LIMIT 1` has no secondary key. This must be fixed
   **before** any `marketing_consent_log` backfill, which would insert many rows sharing
   one timestamp.
3. **Retention for `contact_timeline_events`.** Its `metadata` carries raw funnel payload
   PII and there is no retention cron. Copy the `auditLogRetentionCron` pattern.
4. **`suppress` matches the string "duplicate"** instead of Postgres code `23505`. One
   line.

## Testing conventions here

Targeted runs only — never the full suite by reflex. `npx vitest run <path>`, plus
`npx tsc --noEmit`. **This repo has 258 pre-existing tsc errors**; compare the total
count against that baseline rather than grepping for your own files, or new errors hide.

Two traps that cost time in Stage 1a:

- **Plan-authored test mocks are sketches.** Two brief-supplied Supabase mocks ignored
  `.eq()` filters entirely, making assertions pass trivially. Check that a mock actually
  filters before trusting a green test.
- **Actually run your mutations.** "This test would fail if X" is a guess until X has
  been applied and the failure observed. And when grepping captured terminal output for
  evidence, match structural markers (`❯`, `FAIL`, counts), not formatting — ANSI codes
  break naive greps and will tell you evidence is missing when it is not.

## Out of scope for you — human-blocked

- **Stage 2 (SMS) is blocked on Twilio A2P registration.** The credentials in
  `.env.local` are live (account active, Main-scope API key named DJPATHLETE), but the
  TrustHub business profile is `twilio-rejected` (error 18601): it registers YORTAGO LLC
  against the website darrenjpaul.com, and Twilio cannot verify that association.
  Darren must decide whose legal entity registers the brand. Build against
  `TWILIO_MAIN_SID` / `TWILIO_CLIENT_SECRET`, never the account auth token.
- A privacy-policy **v2 draft** sits on production `legal_documents`
  (`a332ecf6-88a2-4c9f-8bed-4bf99aa40252`, `is_active = false`) adding an SMS section,
  awaiting Darren's approval. Publishing means flipping `is_active` on v1 and v2
  together — the partial unique index allows only one active per type, so two separate
  admin saves will fail.
- Three open questions remain in spec §13, including that **"service application" — one
  of the eleven entry points — has no route in this repo under any spelling.**
