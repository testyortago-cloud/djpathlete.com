# Lead Engine — build design

**Status:** design, approved in chat; stage plans not yet written
**Date:** 2026-08-18
**Package:** Full Engine, white-label ready ($2,250 · 6–8 weeks)
**Source documents:** *DJP Athlete — Lead Engine* (specification) and *Lead Engine — Quotation*, both in Drive
**Supersedes nothing.**

---

## 1. What this is

The Drive specification describes the Lead Engine from the outside. It was written
before anyone read this repository closely, and three of its assumptions about the
code are wrong in ways that change the build.

This document is the inside view: the decisions, the reconciliation against what is
actually here, and the four stages.

## 2. The three decisions

### 2.1 Contacts sit beside `users`, not on top of them

The specification promises *"one contact record per person… merged by email and
phone."* This repository already has an identity spine — `users`, with
`status='lead'` and a nullable `password_hash` (migration `00125`). Consent,
attribution, enquiries, submissions, bookings and payments all point at `users.id`.

That spine cannot deliver the promise:

- `users.email` is unique and carries the login. Two records for one human cannot be
  merged, because the second cannot exist.
- 90 of the 300 GoHighLevel contacts have a phone and no email. They cannot be
  `users` rows at all.

| Option | Verdict |
|---|---|
| Replace `users` with `contacts` | **Rejected.** 214 migrations, every RLS policy (`users.role = 'admin'`) and the NextAuth session assume `users.id`. Re-plumbs live billing tables to ship a marketing feature, and cannot be made backward-tolerant for one deploy ([[tolerate-old-schema-one-deploy]]). |
| **`contacts` beside `users`, linked** | **Chosen.** |
| Extend `users` | **Rejected.** Cannot represent a phone-only person, cannot merge, and makes every client and admin a marketing target. |

> **`users` owns login and billing. `contacts` owns marketing and consent.**
> A contact may or may not have a user. A user always has a contact.

Every entry point gains one write — upsert a contact — and keeps its existing
`lead_user_id` write untouched.

### 2.2 White-label covers the new tables, and that is a stated limit

Built, per the quotation's three promises: branding in `business_settings` not code;
`business_id uuid NOT NULL` on every new table; no brand string hard-wired.

**The limit:** `business_id` goes on new tables only. `users`, `payments` and
`bookings` do not become tenant-scoped. This is what was sold — the quotation's
argument is that the groundwork is cheap *"while the tables are empty"*, and the new
tables are the empty ones.

The third promise is enforced mechanically: a test scans the template directory and
fails on the literals `DJP Athlete`, `Darren`, and the sending domain.

### 2.3 One pipeline board, with the machinery for many

Finding 3 of the specification found two of four existing pipelines with zero
opportunities ever, and 422 of 437 in one. Four boards rebuilds unused scaffolding in
a new place. Ship the machinery for N, seed **Coaching**, add the rest as
configuration once confirmed.

## 3. Reuse map

| Needed | Exists as |
|---|---|
| Scheduled tick | Firebase `onSchedule` → `POST /api/admin/internal/<slug>` → aggregator in `lib/automation/`. 20+ in production. |
| Cron health | `cron_runs` + automation-health watchdog |
| Branded email | `lib/email.ts` (Resend), `components/emails/_shared` |
| Attribution | `marketing_attribution` — session-keyed, `gclid`/`gbraid`/`wbraid`/`fbclid`, 5 UTMs, landing URL, referrer |
| Feature flags | `system_settings`, per-cron flag convention, default off |
| Audit | `audit_logs`, `withAudit()`, closed slug taxonomy in `lib/audit/actions.ts` |
| AI | `lib/ai/` |
| 9 of 11 entry points | funnel submit, contact, newsletter, shop leads + checkout, questionnaire, Step Up, lead magnets, assessments, camps via `event_signups` |
| Admin lists | house `data-table` component set |

**Greenfield:** contacts + merge, sequence engine, opportunities + boards, all SMS
*code*, chat assistant.

### 3.1 Twilio — credentials verified 2026-08-18

`.env.local` carries two working credential pairs. Both authenticate; neither can
send yet.

| Item | State |
|---|---|
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | Live. Account `active`, type `Full`, $50 balance, created 2026-08-13 |
| `TWILIO_MAIN_SID` + `TWILIO_CLIENT_SECRET` | Live. API key `SK…`, friendly name `DJPATHLETE`, Main scope — 200 on messaging, messages, numbers, A2P, TrustHub, billing |
| Phone numbers | **0** |
| Messaging services | **0** |
| A2P brand registrations | **0** |
| TrustHub profile `DJP Athlete` | **`twilio-rejected`**, error 18601 |
| Address supporting document | **`DRAFT`**, never submitted |

**Build against the API key**, not the account auth token: it is independently
revocable, rotating it breaks nothing else, and it can later be narrowed to a
restricted messaging-only key. The auth token stays out of the application.

Submitted business identity, and the likely rejection cause:

```
business_name = YORTAGO
website_url   = https://www.darrenjpaul.com/
EIN           = 88-2915522  (LLC)
authorized_representative_1 = "e kyc platform"
```

The registered entity is YORTAGO; the website is darrenjpaul.com. Twilio vetting
requires the legal name and EIN to match public records and the website to belong to
that business. A name/site mismatch is a textbook 18601. The representative reads as
placeholder text and the address document was never submitted.

## 4. White-label foundation

`businesses` — one seeded row at a fixed UUID so `business_id` defaults without a
lookup.

`business_settings` — display name, sender name, sender address, reply-to, logo URL,
timezone, quiet-hours window, daily message cap, postal address for the footer, and
the name SMS `HELP` replies with.

Per-tenant Twilio config (subaccount, brand, number) belongs here, not in env vars —
A2P registration is per legal entity, so a second business needs its own.

## 5. Contacts and the merge

`contacts` — business, nullable `user_id`, email (citext), `phone_e164`, name,
first-touch attribution, per-channel consent timestamps. Unique on
`(business_id, email)` and `(business_id, phone_e164)`, nulls ignored.

`contact_merges` — audit row per merge. Merges are destructive; keep them reversible
on paper.

`contact_timeline_events` — append-only: kind, `occurred_at`, `metadata jsonb`,
source ref. Reads across both spines.

**Merge rule.** Normalise first (email lowercased/trimmed, phone to E.164), then:

- email matches X → update X
- phone matches X → update X
- **email matches X and phone matches a different Y** → X and Y are the same human.
  Merge Y into X (oldest survives), re-point children, log it.
- neither → create

One funnel for all eleven callers:

```ts
recordContactEvent({ email, phone, name, source, attributionSessionId, metadata })
```

## 6. Consent

**The specification did not know two consent tables already exist.** Neither is
per-channel; neither can exist without a `users` row.

- `user_consents` — legal/programme waivers, guardian fields
- `marketing_consent_log` — one boolean, FK `users.id`, IP + user agent

`contact_consents` is new: contact, channel (`email` | `sms`), granted, source,
evidence, `occurred_at`. Evidence includes IP, user agent, **and the exact wording
shown at the time**.

`marketing_consent_log` is **not migrated and not deleted** — it keeps working, is
superseded going forward, and back-fills the new table where a user is linked.

`contact_suppressions` — permanent do-not-contact keyed by email or phone rather
than by contact, so it survives a merge or delete.

**Finding 2 honoured literally:** the 90 existing numbers import with **no SMS
consent**. One re-permission email; only those who agree join. Importing them as
subscribed is the single legally dangerous move available here, and is ruled out.

A failed consent read must never be treated as absence — or presence — of consent
([[null-and-empty-are-different-answers]]).

## 7. Sequence engine

`sequences`; `sequence_steps` (email | sms | wait | branch | tag | stage | alert |
stop); `sequence_runs` (contact, sequence, step, `next_run_at`, status,
`exit_reason`); `sequence_messages` (channel, template, provider id, delivered,
opened, clicked).

Tick every 5 minutes via the existing cron pattern, logic in a pure aggregator.

- **Claim atomically** — `SKIP LOCKED`, not read-then-write. An overlapping tick must
  not double-send.
- **Idempotency key** of `(run_id, step_id)` on every send.
- **Guardrails at send time, not schedule time** — quiet hours in the contact's
  timezone, one message per contact per day across all sequences, one active sequence
  per contact. Schedule-time enforcement drifts when a tick runs late.
- **Exit conditions** evaluate on tick and on event (payment, booking, unsubscribe).
  *Stops when they reply* is deferred — it needs the out-of-scope inbox.

Flag `cron_sequence_tick_enabled`, default **false**. Eight sequences ship as seed
data so wording changes need no deploy.

## 8. Pipeline and campaign-to-revenue

`pipelines`, `pipeline_stages`, `opportunities` (contact, stage, value, source
campaign, `entered_stage_at`, outcome + reason).

Cards move on booking and payment events; every automatic move is logged. Amber/red
staleness computed at read time, never stored.

Campaign-to-revenue joins first-touch attribution → contact → opportunity → payment.
Per Finding 4 there is nothing to back-fill: 435 of 437 opportunities are open, none
valued. Reporting starts at launch. Say this to Darren before launch so the first
month's thin report is expected.

## 9. Where this differs from the specification

| Specification assumed | Reality | Change |
|---|---|---|
| Consent is greenfield | Two consent tables exist, both user-keyed | Reconcile, don't duplicate |
| 11 entry points connected | 9 found; **"service application" has no route** | One question before Stage 4 |
| 4 pipeline boards | 2 of 4 never used | Machinery for N, seed 1 |
| Twilio account exists, only campaign use case to confirm | Business profile **rejected**; no brand, campaign, number or service | Registration becomes a Stage 1 blocking task |

## 10. Repository constraints

- Migrations race Vercel on merge — tolerate the old schema for one deploy; an absent
  column is not a null value.
- Name the reader before writing a column; this repo has twice shipped
  collected-and-ignored fields.
- New audited actions need slugs in the closed taxonomy.
- Targeted tests plus a build, not full-suite runs.

## 11. Stages

### Stage 1 — weeks 1–4
Business + settings tables. Contacts, merge, timeline. Per-channel consent +
suppression. Sequence engine, tick, guardrails, exit conditions, 4 email sequences.
One pipeline board with self-moving cards. Campaign-to-revenue. Settings-driven
branding.

**Blocking task, owner Darren — Twilio registration chain.** Fix the rejected
business profile (legal name matching EIN 88-2915522, website belonging to that
entity, real authorised representative, address document out of draft) → A2P brand →
campaign approved for **marketing/mixed** use, not notifications → buy number →
attach to messaging service. Campaign vetting is the 1–3 week item. Started week 1
this clears before Stage 2; started week 5 it costs the delivery date.

### Stage 2 — weeks 5–6
`lib/sms.ts` against the API key, mirroring `lib/email.ts`. Inbound + status webhook.
STOP/HELP mirrored into `contact_suppressions`. Consent capture on every phone field.
Text steps across all eight sequences.

### Stage 3 — weeks 6–7
Chat assistant answering only from DB-backed FAQs, services, pricing, programmes,
camp availability. Tools: `capture_lead`, `book_consult`, `escalate`. The forbidden
list — no invented pricing, no injury advice, no promised outcomes — gets a refusal
test suite. A prompt instruction is not a control.

### Stage 4 — week 8
Remaining entry points into `recordContactEvent`. GHL contact import under the §6
consent position.

### Switch-over
Parallel run. Watch real leads. Disable GHL workflows one at a time. Cancel last. The
Athlete Quiz scoring lives in GHL and produces most leads; it stays until its
replacement is proven. Two other live automations need homes — one appears to create
client accounts on a won sale, one pushes injury data to Airtable.

## 12. Testing

Targeted suites plus a build. Deepest coverage on the engine: exit conditions per
trigger, quiet hours across timezones, daily cap across simultaneous sequences, claim
race under overlapping ticks, send idempotency under retry. Plus the no-brand-string
scan, the AI refusal suite, and browser tests for the widget and unsubscribe path.

## 13. Open questions

1. **What is the "service application" entry point?** No route under any spelling.
   Blocks part of Stage 4 only.
2. **Twilio registration — resolved into a task, not a question.** See §3.1 and
   Stage 1. Needs Darren's legal entity details.
3. **Real pipeline shape.** One board ships; rest is configuration.
4. **The two other live GHL automations.** Both need homes before switch-off.
