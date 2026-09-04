# Full Engine — the proposal against what is built

**Date:** 2026-09-01
**Scope audited:** the "Full Engine · $2,000 · 6–8 weeks" package
**Method:** read from the code on `main` at `69a678f2`, not from the status docs.
Production row counts and flag values are quoted from
`docs/lead-engine-go-live-runbook-2026-09-01.md`, which read them from prod this
afternoon; nothing here re-reads the database.

---

## 1. The short version

Most of Full Engine is built and deployed. **Five claims in the proposal are not
true as written**, and one caveat in the proposal is out of date in your favour.

| Verdict | Count | Items |
|---|---|---|
| Built and matches the claim | 18 | merging, consent, entry points, staleness, auto-move, campaign→revenue, STOP/HELP, quiet hours, delivery tracking, chat answers, chat capture, chat escalation, chat guardrails, … |
| **Built, but narrower than claimed** | 3 | two-way SMS, the chat bubble's reach, the timeline |
| **Not built** | 5 | tags, three pipeline boards, contact detail screen, chat booking, settings screen |
| Proposal caveat now resolved | 1 | the Twilio A2P dependency |

Behind all of it sits the fact from this morning: **the engine has still never
successfully sent an email**, and 73 people are waiting on a dating decision
(runbook step 4).

---

## 2. The customer database

### Built and true

- **One contact record per person, merged by email and phone.**
  `contacts` (migration 00213), with `normaliseEmail` / `normalisePhone` in
  [lib/lead-engine/identity.ts](../lib/lead-engine/identity.ts) and `decideMerge`
  in [lib/lead-engine/merge.ts](../lib/lead-engine/merge.ts). 166 contacts
  imported from GoHighLevel. A `contact_merges` table keeps the survivor, the
  merged id, and a full snapshot of what was absorbed.
- **Separate email and SMS consent.** `contact_consents` (00215) carries
  `channel text NOT NULL CHECK (channel IN ('email','sms'))` with dated rows and
  the wording that was shown at the time. `contact_suppressions` is separate and
  identifier-keyed, so a STOP from an unknown number still blocks.
- **All eleven entry points feed the spine.** Verified per route, not assumed:

  | Entry point | Route | Recorded as |
  |---|---|---|
  | Funnel forms | `app/api/funnels/submit` | `funnel_form` |
  | Checkout | `app/api/stripe/webhook` | `purchase` |
  | Contact form | `app/api/contact` | `contact_form` |
  | Service applications | `app/api/inquiry` | `inquiry` |
  | Newsletter | `app/api/newsletter` | `newsletter` |
  | Blog lead magnets | `app/api/shop/leads` | `lead_magnet` |
  | Camp registration | `app/api/events/[id]/signup` + `/checkout` | `event_signup` |
  | Shop | `app/api/stripe/webhook` | `purchase` |
  | Assessment page | `app/api/inquiry` | `inquiry` |
  | Questionnaire | `app/api/questionnaire` | `questionnaire` |
  | Step Up For Students | `app/api/inquiry` (`form_context: "step_up"`) | `step_up` |

  Two the proposal does not claim are also wired: the quiz (`quiz`) and the AI
  assistant (`ai_chat`).

  Shop is covered because
  [app/api/stripe/webhook/route.ts:230](../app/api/stripe/webhook/route.ts#L230)
  states the rule outright — *"EVERY completed checkout joins the contact
  spine"* — and shop checkout uses that same webhook.

### The nuance worth knowing

Three sources are **declared in the union and never written**: `shop`,
`assessment`, `funnel_checkout`
([lib/db/contacts.ts:9-26](../lib/db/contacts.ts#L9-L26)). Those leads land
under `purchase`, `inquiry` and `funnel_form` instead. Everyone is captured; you
cannot slice the list by "came from the shop" or "came from the assessment
page". Cheap to fix, and worth fixing before anyone reports off `source`.

### Not built

- **Tags.** No column on `contacts`, no table, no code path. Migration 00223
  records why there is nothing to migrate: the GoHighLevel export gave no way to
  tell what any of its **104 tags** meant.
- **A screen for the timeline.** `contact_timeline_events` (00214) is written by
  eleven-plus paths and indexed `(contact_id, occurred_at DESC)` — built for
  exactly this read — but [app/(admin)/admin/contacts/](../app/(admin)/admin/contacts/)
  holds only `page.tsx`, a list built for bulk sequence enrolment. **There is no
  contact detail page.** The history is being recorded and nobody can read it.

  Note the migration's own header: payments and bookings are *not* in this
  table, they still hang off `users`. A timeline screen has to union three
  sources, not select from one.

→ **Phase 1** covers both.

---

## 3. Pipeline

### Built and true

- Drag between stages, and cards that move themselves. `decideMove`
  ([lib/lead-engine/pipeline-move.ts](../lib/lead-engine/pipeline-move.ts))
  handles triggers `booking | payment | manual | reconciler | merge | quiz`,
  forward-only on late events, and treats a new booking after a close as a new
  deal.
- Amber and red staleness, computed at read time and never stored, from
  per-stage `amber_after_days` / `red_after_days`.
- Campaign to revenue — [lib/automation/campaign-revenue.ts](../lib/automation/campaign-revenue.ts),
  surfaced at `/admin/insights/campaign-revenue`.
- The security hole the 24 August status doc flagged is **closed**: migration
  00231 enabled RLS on all four pipeline tables. That row can be struck.

### Not built

**Three of the four boards.** Migration 00219 seeds Coaching only, with four
stages, and says so in its own comment: *"machinery for N boards, exactly one
seeded."*

The machinery really is there — `applyPipelineEvent` takes an optional
`pipelineKey` that defaults to `DEFAULT_PIPELINE_KEY = "coaching"`
([lib/db/pipeline.ts:34](../lib/db/pipeline.ts#L34), `:479`). **No caller passes
it**, so every event in the system lands on the Coaching board. Assessment,
Camps & Clinics and Programs & Products do not exist, there is no screen to
create one, and nothing decides which board a new opportunity belongs on.

The board is also empty in production — nothing has flowed through it yet.

→ **Phase 4.**

---

## 4. Text messaging

### The proposal's caveat is resolved

> *"Stage 2 depends on your Twilio campaign registration covering marketing use…
> If it needs re-registering, that's a 1–3 week carrier review."*

It was re-registered and **approved on 2026-08-25**. All three gates are green —
business profile `twilio-approved`, brand `APPROVED` (TCR `BWS458H`, STANDARD),
campaign `VERIFIED` with no errors — and a test message reached a real handset
`delivered`, `error=none`. Approval took about a day.
See `docs/compliance/2026-08-24-a2p-campaign-resubmission.md`.

Throughput is the unvetted-brand default (AT&T 4 msg/sec, T-Mobile ~2,000/day),
which is ample at current volume. Raising it means paying for secondary vetting
— a separate decision, not a blocker.

### Built and true

- **STOP / HELP / opt-in**, and done carefully: whole-word keyword sets rather
  than substring matching (so "STOP IT" is not a STOP), suppression checked
  *before* consent, and an **empty TwiML** response — a JSON body would 12300
  every STOP.
- **Timezone-aware quiet hours** and a daily cap, in
  [lib/lead-engine/guardrails.ts](../lib/lead-engine/guardrails.ts), read from
  the business timezone.
- **Delivery tracking** — `app/api/webhooks/twilio/status`, with the callback
  URL and the verification URL built from the same `appOrigin()` so the
  signature check cannot drift.

### Built, but narrower than claimed

> *"Two-way SMS … sending, delivery tracking, and inbound replies landing in
> your admin rather than only on your phone."*

- **Sending is sequence-only.** `sendRenderedSequenceSms` has exactly one caller
  in the repo — the sequence tick runner. There is no way to send a text to
  someone from the admin, and no way to reply to one.
- **Inbound does not land in the admin.** The webhook writes a
  `contact_timeline_events` row — which, per §2, has no screen — and forwards
  the message to your `reply_to` **email address**. `/admin/inbox` is a Gmail
  view; it has nothing to do with SMS.

So the inbound half works and the outbound half is automated-only. "Two-way" in
the sense most people mean it is not there yet.

> *"All eight sequences from the specification, with their text steps live."*

Nine sequences exist. SMS steps are seeded into **three** — `newsletter_welcome`,
`lead_magnet_delivery`, `cold_lead_re_engagement` — plus `sms_repermission`.
`new_lead_nurture`'s text step exists only as a **commented-out runbook** inside
migration 00222. The four quiz sequences are drafts still carrying
`PLACEHOLDER COPY`.

**Still untested:** inbound STOP and HELP against a live handset. Delivery
working does not prove opt-out works, and opt-out is the compliance-critical
half.

→ **Phase 3.**

---

## 5. The AI assistant

### Built and true

- Answers from real FAQs, services, pricing, programmes and camp availability —
  [lib/lead-engine/chat/facts.ts](../lib/lead-engine/chat/facts.ts), with tools
  `search_faqs`, `list_programmes`, `list_camps_and_clinics`,
  `list_testimonials`.
- **A grounded-value validator** that has already caught the assistant inventing
  a price and mis-stating a camp date. The comments in `facts.ts` read as a log
  of real bugs found and closed.
- Lead capture with the campaign that brought them — `capture_lead` →
  `/api/ask/capture` → `captureLead(source: "ai_chat")`.
- Escalation — [escalate.ts](../lib/lead-engine/chat/escalate.ts) writes
  `escalated_at` first and is allowed to fail loudly, so a visitor is never told
  a human is coming when no record exists.
- The injury/medical, no-invented-price and no-promised-result guardrails, in
  `risk.ts` and `validate.ts`.

### Two claims to correct

> *"It books consults directly from live calendar availability."*

It does not. `book_consult` puts a link to `/contact` on screen. The code says
so in as many words —
[tools.ts:18](../lib/lead-engine/chat/tools.ts#L18): *"There is no public
booking-creation route"*, and `:253`: *"You cannot book anything yourself; this
hands the visitor over."* Nothing in the app holds availability: `bookings`
(migration 00050) is a record-only table with `source DEFAULT 'ghl'`, populated
entirely by the GoHighLevel webhook.

> *"A chat bubble on your website — funnels, landing pages and marketing pages."*

It is on marketing pages only. [app/(funnel)/layout.tsx](../app/(funnel)/layout.tsx)
excludes it deliberately: *"A landing page's entire job is to remove exits."*
That is a defensible design call — but it contradicts the sentence, so one of
the two has to change.

The assistant is also switched off (`chat_assistant_enabled = false`).

→ **Phase 2** (booking) and a one-line decision on the funnel bubble.

---

## 6. Built to be reconfigured

Every promised field exists on `business_settings`: `display_name`,
`sender_name`, `sender_email`, `reply_to`, `logo_url`, `timezone`,
`quiet_hours_start` / `_end`, `daily_message_cap`, `postal_address`,
`sms_help_text`, `sms_messaging_service_sid`, `sms_sender_phone`.

**But `updateBusinessSettings` has zero callers.** There is no settings screen.
Changing any of it is a SQL statement — which is literally what happened to
`sender_email` this afternoon, and what two code comments already complain about
(*"nothing calls updateBusinessSettings, so an untouched install would send…"*).

> *"A rebrand, a move to a new sending domain, or adding a second business line
> stops being a development job."*

The first two become settings changes once the screen exists. The third does
not: `SINGLETON_BUSINESS_ID` is hard-coded in **124 places**.

→ **Phase 5.**

---

## 7. What the proposal does not mention, and should

- **The engine has never sent a successful email.** 73 `sms_repermission` runs
  are `failed`; sending was proved working today with a control, but the 73 need
  repairing before anything reaches a person. Runbook steps 4–6.
- **The Airtable injury-details job** — the second of the two GoHighLevel jobs
  with no home here — is still unbuilt. (The first, handing an athlete their
  account when a deal is won, shipped today.)
- **Do not cancel GoHighLevel yet.** It still holds the consent records, it
  still runs the real quiz, and until Phase 2 it is the only calendar.

---

## 8. The five phases

Ordered by what unblocks what, not by size.

| Phase | What it delivers | Doc |
|---|---|---|
| 1 | The contact record becomes readable — detail page, timeline, tags | [phase 1](superpowers/specs/2026-09-01-full-engine-phase1-contact-record-design.md) |
| 2 | Calendly replaces the GoHighLevel calendar, and the assistant books | [phase 2](superpowers/specs/2026-09-01-full-engine-phase2-calendly-booking-design.md) |
| 3 | Two-way SMS — a conversation view you can reply from | [phase 3](superpowers/specs/2026-09-01-full-engine-phase3-two-way-sms-design.md) |
| 4 | Four pipeline boards, created from a screen rather than a migration | [phase 4](superpowers/specs/2026-09-01-full-engine-phase4-pipeline-boards-design.md) |
| 5 | The business settings screen | [phase 5](superpowers/specs/2026-09-01-full-engine-phase5-business-settings-design.md) |

**Why this order.** Phase 1 first because the timeline is already being written
and cannot be read — the cheapest gap between recorded and useful, and Phase 3
hangs its send action off the screen it builds. Phase 2 second because it is the
last thing keeping GoHighLevel load-bearing. Phase 5 last only because it is the
smallest, not because it matters least — it is the one that stops you needing a
developer to change your own sender address.

## 9. Corrections to earlier status docs

`docs/lead-engine-status-2026-08-24-evening.md` is now wrong in three places:

| It says | Actually |
|---|---|
| "Texts cannot send — waiting on Twilio, 1–3 weeks" | Approved 2026-08-25, delivery proven to a handset |
| "A security gap on the deal records" | Closed by migration 00231 |
| "One [GHL job] sets up a client's account when a sale is won… Not built yet" | Shipped 2026-09-01 |
