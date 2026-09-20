# Lead Engine — Full Engine verification against the quotation

**Date:** 2026-09-19 (production read 14:20–16:10 UTC)
**Code:** `main` @ `10fef0f0`, confirmed deployed (the structured data that commit added is on the live quiz page)
**Quotation:** *Lead Engine — Quotation*, 16 August 2026, **Full Engine · $2,250 · white-label ready** (Google Doc `1d6OLtoGIWeq7XA-9842gbtucf7pxycL791lB82jGaPg` — identical to the pasted text)
**Method:** production read only through the `supabase-prod` MCP; Resend `GET /emails` and Twilio's messaging, A2P and messages endpoints read with the local credentials; the live site probed over HTTP; five read-only code audits on `main` (entry points, sequence engine, pipeline, SMS + chat, white-label), every claim of which was spot-checked by opening the cited lines; 47 targeted test files (856 tests) run on Node 24. **Nothing on production was written, flipped, published or sent.** The admin screens were not driven in a browser this pass; each route was confirmed to exist on production (login redirect, not 404), and the 13 Sept audit's screenshots cover most of them.

**This supersedes** `docs/full-engine-scope-vs-built.md` (dated 2026-09-06, annotated to 09-08) and the state notes in `docs/lead-engine-audit-2026-09-13.md`. Both are wrong in places below.

---

## 0. The answer in six sentences

1. **The Full Engine is built and live, and for the first time it is doing real work on production:** the Athlete Quiz funnel was published today at 14:14 UTC, the first quiz taken a minute later enrolled a person and Resend delivered the result email, and the abandoned-checkout sequence has sent three delivered emails since 16 Sept. Every screen the quotation names exists on production and every core mechanism (tick, claim, quiet hours, cap, exits, merge, consent, STOP, boards, auto-move, chat guardrails) is code with tests, and the tests are green.
2. **Against the quotation line by line, 22 promises are met, 11 are partial, and 6 are not built** (§2). Nothing partial or missing is a *mechanism*; they are specific behaviours the quotation names that the shipped code does not do.
3. **The six not built:** the four quoted branch conditions (opened-the-email, coaching-vs-camp, parent-vs-adult) cannot be expressed and email opens are not tracked; "camp deadline 14/7/3/1 days before the event" runs on enrolment-relative waits instead; the coach reminder two days after a service application; sequence status on the leads screen; "nobody in two sequences at once" (runs are serialised, not exclusive); and a leads/registrations count on the campaign→revenue screen.
4. **Two of the eleven entry points are not connected** (questionnaire writes nothing; assessment only annotates a contact that already exists), and bookings never create a contact.
5. **This pass found one live production defect and one dead branch.** An existing account holder with a session pack is being enrolled in *abandoned checkout* every other day because the pack payment-link cron mints a Stripe session daily and each expiry looks like an abandoned coaching sale (§3, D1). And `contacts.user_id` is never written by any code path, so the "is this person already a client" branch in all four quiz sequences can never be true — 55 of the 170 contacts are registered clients by email and none is linked (D2).
6. **White-label:** the sequence engine, SMS, chat and consent surfaces genuinely read identity from settings and carry `business_id`; the transactional mail those events trigger (inquiry alert and auto-reply, funnel lead alert, chat handover, quiz alert) is still hard-wired to "DJP Athlete", sends from the platform address, and two of them go to `darren@` / `sales@darrenjpaul.com` regardless of tenant. The funnel tables have no `business_id`. A second coach would start with zero sequences.

---

## 1. What moved since the 13 Sept audit

| 13 Sept said | Today |
|---|---|
| All six funnels/pages `draft`; `/go/athlete-quiz` 404 | **`athlete-quiz` is `published`** (converted page→funnel 14:13:59, published 14:14:05 UTC today) and serves 200. The other 8 rows are draft. |
| Prod has never had a successful sequence run | **4 delivered sequence emails** (Resend `delivered`), 3 real runs: `abandoned_checkout` ×2 (one completed, one active), `quiz_ceiling_breaker` ×1 (active, next step 21 Sept). |
| Two-way SMS on an unmerged branch | **Merged** (`5a20f4ff`) and deployed: `/admin/sms` list + thread, "Texts" in the sidebar, migration `00259`. Zero `sms_messages` rows yet. |
| Pipeline boards invisible (no switcher) | **Board switcher live** (`b52e0a6e`); three boards on production, all 4 cards on Coaching. |
| `contacts_with_session` 0/170 | 1/170. Attribution is now stamped for every organic `/go` visit (40 organic sessions since 13 Sept). |
| Reconcile cron off | **Still off** — and its own header says keep it off (§3, D12). It logs a `success {skipped:"disabled"}` row hourly, so the health scanner is quiet. |
| 73 stranded `sms_repermission` runs | Unchanged, terminal `failed`. Owner's call. |
| Twilio: "A2P approved" (from a doc) | **Read from Twilio today:** brand `APPROVED` (STANDARD, identity VERIFIED), one messaging service with one number, A2P campaign use-case **`MIXED`, status `VERIFIED`** — this covers marketing, which is the dependency the quotation's Stage 2 hangs on. One real outbound SMS was delivered 7 Sept. |

---

## 2. The quotation, line by line

Verdicts: **MET** = code + tests + (where applicable) observed on production · **PARTIAL** = exists but does less than the sentence says · **NOT BUILT** = the named behaviour does not exist · *(prod)* = also seen in production data today.

### 2.1 The comparison table (Full Engine column)

| Quotation line | Verdict | What actually exists |
|---|---|---|
| Automated email follow-up | **MET** *(prod)* | `sequenceTickCron` every 5 min → `POST /api/admin/internal/sequence-tick` (bearer-gated) → `claim_sequence_runs` (`SKIP LOCKED`, sequence must be ON, gate inside the RPC before `attempts+1`) → Resend/Twilio → `sequence_messages` sent/failed + delivery callbacks. 5,457 successful ticks; 4 delivered emails. |
| Number of sequences: 8 | **MET** *(prod)* | **12** on production, all ON since 9 Sept, zero placeholder copy. The four the quotation names by name all exist (`new_lead_nurture`, `abandoned_checkout`, `service_application_received`, `camp_clinic_deadline`); the rest are newsletter welcome, lead-magnet follow-up, cold re-engagement, four quiz-result variants, and the manual SMS re-permission ask. |
| Stops when they buy / unsubscribe | **MET** *(prod for buy)* | `exitRunsForContact(…,"payment")` on every completed Stripe checkout; `"unsubscribed"` from the token link. |
| Stops when they book a call | **MET** | Calendly and GHL booking webhooks both reach `ingestBooking` → exit `"booking"` for `scheduled`/`completed`, not for cancel/no-show. **Only for a contact that already exists** — a stranger's booking is invisible to the spine (§2.4). |
| Branching (different paths per person) | **PARTIAL** | Engine, evaluator, editor and 5 live branch steps exist. Conditions available: has phone, has account, has consent (email/SMS), enrolled-source. **None of the three examples the quotation gives is expressible** — see Complete tier below. |
| Quiet hours & message limits | **PARTIAL** | Quiet hours 08:00–20:59 in `contacts.timezone` falling back to the business timezone — but **no code ever writes `contacts.timezone`** (0/170 on prod), so everyone is on `America/New_York`. Cap = 1 message per contact per day across all sequences (email and SMS counted together) — met. "Nobody in two sequences at once" — **not enforced**: a contact is enrolled into every matching sequence; the younger run is merely deferred 5 minutes per tick so the oldest sends first. |
| Reporting screen: Full | **MET** *(prod route exists)* | `/admin/sequences`: On · Sequence · Entered · Still going · Bought · Booked a call · Opted out · Reached the end · Something went wrong · Something else, with a per-sequence page naming every person and why they left. |
| Unified contact record & timeline | **MET, one dead field** *(prod)* | One `contacts` row per person, merge by email and phone (RPC carries tags, consents, runs, cards), detail page with timeline, tags, consent, sequences. **`contacts.user_id` has no writer** (D2), so the record never learns the person is a client. |
| Pipeline boards | **MET, no editor** *(prod)* | 3 boards (Coaching, Camps & Clinics, Assessment), switcher, drag-and-drop move, forward-only auto-moves. **No UI creates, renames or reorders a board or stage, and no UI creates a card by hand** — boards are a migration's job. A new tenant is seeded Coaching only. |
| Campaign → revenue tracking | **PARTIAL** | `/admin/insights/campaign-revenue` shows **Campaign · Source · Gclid · Won deals · Won value**, all-time. **No leads count, no registrations count** — the quoted sentence "14 leads, 6 registrations and $2,340" cannot be produced. Organic `/go` leads are attributable now but all collapse into one "— / — / —" row because `landing_url` is not grouped. |
| Two-way SMS | **MET, unexercised** | Manual send (row inserted `queued` before the Twilio call, sid stamped, delivery callback monotonic), inbound webhook (signature-verified, tenant by messaging-service SID then number), thread screens, sidebar entry. **0 rows on production; never tested against a real handset** (cannot be sent from the Philippines, Twilio 21612). |
| AI chat on the website | **MET, with two wording gaps** *(prod: enabled, 1 conversation)* | Launcher on every marketing page after 800px scroll (reads the flag live), `/ask` page, refusal suite green. Gaps: it collects **email** marketing consent, not "texting consent"; it **offers live Calendly times and links to Calendly's page** rather than creating the booking itself. |
| Entry points connected: All 11 | **PARTIAL — 9 of 11** | See §2.4. |
| Built white-label ready | **PARTIAL** | See §2.5. |

### 2.2 Starter-tier bullets

| Promise | Verdict | Detail |
|---|---|---|
| Follow-up engine, scheduled job, records what happened | **MET** *(prod)* | As above. |
| Email templates with each person's name **and enquiry details** filled in, on your **existing branded layout** | **PARTIAL** | Only `{{name}}` (and `{{sms_consent_url}}`) are merge fields; enquiry details (sport, goals, service) never reach the renderer. The layout is a second template in `lib/lead-engine/email.ts` that mirrors the house colours and takes wordmark/logo/postal/sender from settings — branded per tenant, but not the transactional layout and it will drift from it. `brand_color` is never applied to email. |
| Two sequences live: *New funnel lead* (5 emails over 14 days), *Abandoned checkout* (3 emails over 3 days) | **MET in kind, not in shape** *(prod)* | New funnel lead = **3 emails + 1 SMS over 11 days**. Abandoned checkout = **1 email, then after 2 days an SMS (if they consented) or a second email** — 2 touches over 2 days. Both ON. |
| Automatic stop when someone buys or unsubscribes | **MET** *(prod)* | |
| Unsubscribe handling with a permanent do-not-contact list | **MET** | `contact_suppressions`, keyed by email/phone so it survives merges; checked before every sequence step and before every manual SMS. Not checked at *enrolment*, so a suppressed person shows as "Entered → Opted out" in reporting (nothing is sent). For SMS, a START/UNSTOP text lifts it — correct, but not "permanent". **The legacy newsletter unsubscribe route writes nothing here** (D17). |
| On/off switch in your admin | **MET** *(prod: driven 9 Sept)* | Per-sequence switch on the list and detail pages; master flag on `/admin/automation`. |
| Each lead's sequence status on the existing leads screen | **NOT BUILT** | No `/admin/leads`. The funnel leads board (`/admin/funnels/leads`) has zero sequence references; the contacts list shows Name/Email/Phone/Added and only the bulk-enrol picker. Status is on the contact **detail** page only. |

### 2.3 Complete-tier bullets

| Promise | Verdict | Detail |
|---|---|---|
| Branching on "opened the last email or not, coaching or camp, parent or adult athlete" | **NOT BUILT (as quoted)** | `sequence_messages.opened_at` has **no writer** and there is no Resend event webhook, so "opened" cannot be known. `source_is` compares the run's own sequence trigger, which is the same for everyone in that sequence, so it cannot split coaching from camp inside one sequence. The only way to split parent from athlete today is separate sequences chosen at enrolment (the quiz's `parent_coach` variant is exactly that). |
| *Service application received*: confirms to them ✓, alerts you with an AI summary and suggested reply ✓, **reminds you after two days** | **PARTIAL** | Auto-reply and the coach alert with `ai_summary` + `ai_draft_reply` are real (`/api/inquiry` → Sonnet, 20 s timeout, plain alert on failure). The 2-day **coach** reminder does not exist in any form: the seeded sequence's three emails all go to the applicant. An `alert` step kind exists and could be added in the editor. Also: the sequence's step 0 *and* the transactional auto-reply both confirm, so the applicant is confirmed twice. |
| *Camp or clinic deadline*: 14 / 7 / 3 / 1 days **before the event** | **NOT BUILT (as quoted)** | What runs: an email on registering interest, then +2 d, +6 d, +10 d — anchored to enrolment, whenever the camp is. There is no event date on a run and no anchor on a step; the seed migration says so outright. |
| Stops when they book a call | **MET** | As above. |
| Quiet hours 8am–9pm in their timezone; one message per person per day across all sequences; nobody in two sequences at once | **PARTIAL** | Timezone never populated (business-local for all); cap met; exclusivity not enforced (serialised instead). |
| Proper reporting screen | **MET** | As above. |

### 2.4 Full-tier bullets

| Promise | Verdict | Detail |
|---|---|---|
| One contact record per person, merged by email and phone | **MET** *(prod: 0 merges yet)* | |
| Full timeline — forms, emails, texts, calls booked, payments, sequences — plus tags and dated email/SMS consent | **MET, thin in practice** | All recorded when they happen. **Bookings write no timeline row** and never create a contact. On prod: **0 consent rows** — email consent is never asked on the funnel, quiz or inquiry forms (SMS consent is, when the box is ticked); 1 tag, applied by the engine. |
| **All eleven entry points connected** | **9 of 11** | Connected (write a contact + timeline event): funnel form, contact form, newsletter, shop free-download (the only "lead magnet" surface; `lead_magnets` has 0 rows), Stripe checkout (completed and expired), Step Up For Students, camps/clinics (interest and paid), service application (`/api/inquiry`), plus quiz, chat capture and the GHL import. **Not connected:** **questionnaire** (writes `client_profiles` + GHL only; no test references the route) and **assessment** (annotates an existing contact, never creates one, never enrols). **Bookings** look a contact up and never create one — a first-time booker is invisible to the spine and gets no card. |
| Boards shaped to how you sell, confirmed with you | **MET** | Owner confirmed the three boards on 8 Sept; there is no editor to reshape them later. |
| Cards move themselves on consult booked / payment | **MET** *(prod: 4 automatic cards)* | booking → first/second open stage; payment → instant Won with value; cancel/no-show → Lost; refund amends value only; forward-only. **A first-time buyer gets a contact but no Won card** (D3). **A payment on another board does not close an open enquiry card** — a second card is created. |
| Amber when sat too long, red when gone quiet | **MET, small** | Per-stage thresholds from the DB (3/7 and 5/14 days), computed at read time, rendered as an 8 px dot + "N days in stage". Based on **stage-entry time**, not on last contact activity — "gone quiet" is not what it measures. Rendering has no test. |
| Campaign to revenue | **PARTIAL** | Won deals + won value per campaign only. |
| Two-way SMS via your Twilio: sending, delivery tracking, inbound in your admin | **MET, unexercised** | Twilio brand approved, MIXED campaign verified, one number, MG SID set on production. `sms_sender_phone` and `sms_help_text` are empty (neither blocks anything). |
| STOP and HELP handling, dated opt-in capture, timezone-aware quiet hours | **MET** | STOP suppresses, revokes SMS consent, exits runs, answers empty TwiML; START lifts it. **HELP writes a timeline row only — the reply text is Twilio console configuration**, not code. Opt-in rows carry the exact wording shown, IP and user agent from funnel/quiz/inquiry/events/consent-link/START. Quiet hours defer sequence texts; manual texts warn and send on a second click (deliberate). **Manual sends are not consent-gated** (suppression only) — a policy call, not yet made. |
| All eight sequences with their text steps live | **PARTIAL — 5 of 12** | SMS steps exist in `new_lead_nurture`, `newsletter_welcome`, `lead_magnet_delivery`, `cold_lead_re_engagement`, `abandoned_checkout`. None in the four quiz sequences, `service_application_received`, `camp_clinic_deadline`, `sms_repermission`. A text only goes out when the contact has an SMS consent row — 0 on prod today. |
| Chat answers from FAQs, services, pricing, programs, camp availability | **MET, narrower** | Published FAQs (services are FAQ content), public programmes with `price_cents` (no session-pack or product pricing), camps with real spots-left, testimonials. FAQs/programmes/testimonials are read with no tenant predicate. |
| Chat captures the lead — name, email, phone **and texting consent** — with campaign attached | **PARTIAL** | Name, email, phone, attribution session and landing path: yes. The tick is **email** marketing consent; no SMS consent row is ever written by chat, so a chat lead with a phone would be skipped by every SMS step. **No sequence listens to `ai_chat`** — a chat lead is captured and never followed up. |
| Chat books consults from live calendar availability | **PARTIAL** | Reads live Calendly availability (7-day window) and shows up to 6 slots, each a prefilled link into Calendly's page. It never creates the booking; the booking arrives later by webhook. Calendly config for chat is **env-based**, not per-tenant. Prod: **0 Calendly bookings ever**; all 5 bookings are GHL. |
| Escalates when unsure; never injury advice, invented price, promised result | **MET** | Regex risk classifier refuses injury/medical turns before the model; output validator blocks (does not rewrite) ungrounded prices/dates/numbers, promised outcomes, injury advice; escalation emails `business_settings.reply_to`. Refusal suite green. |

### 2.5 "Built white-label ready" — the three promises

| Promise | Verdict | Detail |
|---|---|---|
| Branding lives in settings, editable by you | **PARTIAL** | 13 fields editable on `/admin/businesses` (operator-only). Sequence email/SMS, chat persona, SMS consent wording and funnel palette read them. **Every transactional mail those events trigger goes through `lib/email.ts`**: inquiry alert (`to: sales@darrenjpaul.com, cc: darren@`), inquiry auto-reply (signed "Coach Darren / DJP Athlete", GHL booking link), funnel lead alert (always `darren@` first), chat handover and quiz alert — all `from: RESEND_FROM_EMAIL` in the DJP-wordmarked layout. `brand_color` never reaches an email. `sms_sender_phone` saves un-normalised while the inbound match is verbatim. |
| Every record knows its business | **PARTIAL** | Contacts, consents, sequences, runs, messages, pipelines, opportunities, chat, quizzes, SMS, bookings, events, hosts, members: `business_id NOT NULL`, DAL readers predicate on it, tick RPC filters by tenant. **`funnels`, `funnel_steps`, `funnel_step_versions`, `funnel_submissions`, `funnel_step_turns`, `funnel_checkout_grants`, `lead_magnets`: no column, no predicate** — `/go/<slug>` is global and the funnel leads inbox is platform-wide. |
| Nothing has "DJP Athlete" hard-wired | **PARTIAL** | True inside `lib/lead-engine/`, the tick, chat, consent and unsubscribe-token surfaces — and a real test sweeps them (3/3 green). False in `lib/email.ts` (above) and the newsletter `/unsubscribe` page. Seeded copy is brand-free but belongs to business `…0001` only; **`create_business()` seeds no sequences, quizzes or funnels**, so a second coach starts with empty automations. |

`SINGLETON_BUSINESS_ID` inventory: the measured count is **6**, not the 5 CLAUDE.md records, because `lib/db/funnels.ts:572` names the constant in a doc comment (commit `bbfe0bc7`). It is prose, not a caller; `platform-inventory.test.ts` passes 5/5. Either reword the comment or update CLAUDE.md.

---

## 3. Defects found in this pass

Ranked by what they do to real people today.

**D1 — LIVE. A paying account holder is being nurtured as an abandoned lead, every other day.**
The pack payment-link cron (`lib/automation/pack-link-resend.ts`) mints a fresh `session_pack` Stripe Checkout session at 09:00 UTC daily while a renewal stays unpaid. Each session expires 24 h later; `checkout.session.expired` (`app/api/stripe/webhook/route.ts:403-495`) deliberately treats `session_pack` as a coaching checkout, captures `checkout_abandoned` and enrols `abandoned_checkout`. The sequence completes in ~2 days and nothing stops re-enrolment after completion. Production: the same person (a registered account holder, matched to `users` by email) received *Payment link — 10× training* on 15/17/18/19 Sept **and** *You left something half-finished* on 16 and 19 Sept and *Still worth a conversation* on 18 Sept, was tagged `abandoned-checkout` on 18 Sept, and has a fresh active run started 09:00 today. The copy addresses a prospective client considering coaching. **Fix:** exclude sessions minted by the renewal cron (they carry `metadata.source_package_id`) from the abandoned capture, or skip enrolment when the contact is an existing client; separately, consider a re-enrolment cooldown per (contact, sequence).

**D2 — `contacts.user_id` is never written.** Only the merge RPC copies it between contacts. Every insert writes email/phone/name only; registration, login, purchase and the GHL import never link. Production: 0/170 linked, **55/170 share an email with a `users` row**. Consequences: the `has_user` ("already a client") branch in all four quiz sequences always takes the not-a-client arm — the quiz taken today by a registered account got the "book an intro call" arm; `findContactByIdentifiers({userId})` never matches on its first key; nothing in the engine can tell a lead from a client. **Fix:** set `user_id` on create/update when the email matches a user, backfill once, and link at registration.

> **Correction, 2026-09-20 (the snapshot above is left as measured).** The figure is **54 contacts**, not 55. 55 is the JOIN-ROW count: one address matches two `users` rows differing only by case, so the obvious join counts that contact twice. Count contacts, not pairings: `select count(*) from contacts c where c.user_id is null and c.email is not null and exists (select 1 from users u where lower(u.email)=lower(c.email))`. It matters because this number became the acceptance test in the gap ledger ("read-back ≥ 55"), which the backfill could never have satisfied — excluding the 11 that match only a `status='lead'` placeholder, it links **43**. **Shipped and applied to production 2026-09-20 (`e27ccd9c` + migration `00264`); read back: 170 contacts, 43 linked, 0 still linkable.** D2 is closed.

**D3 — First-time buyer: contact created, no Won card.** In the completed-checkout handler the pipeline hook runs first and only for a pre-existing contact; the capture that creates the contact runs after it (`route.ts:284-345`). Production: the 28 Aug purchase created its contact and no card; that contact's card only appeared on its second purchase (17 Sept). **Fix:** capture first, then hook.

**D4 — Camp deadline sequence is not event-anchored** (§2.3). Needs an event reference on the run and a "days before event" step or scheduler.

**D5 — No coach reminder after a service application**; the applicant is confirmed twice (§2.3).

**D6 — None of the quoted branch conditions exist; no email-open tracking** (§2.3). Opens need a Resend event webhook writing `opened_at`; coaching/camp and parent/adult need a per-contact attribute the condition can read.

**D7 — "Nobody in two sequences at once" is not enforced** (§2.1). Today it is a send-order rule.

**D8 — `contacts.timezone` is never written**, so quiet hours are business-local for everyone. Calendly's invitee timezone is stored on the booking, not the contact.

**D9 — No sequence status on any leads list** (§2.2).

**D10 — Chat: email consent only, no SMS consent; no sequence listens to chat leads.**

**D11 — Questionnaire not connected; assessment attach-only; bookings never create a contact or a timeline row** (§2.4).

**D12 — Reconcile cron is off and its own header says keep it off** (`lib/automation/pipeline-reconcile.ts:291-309`): it routes every booking to Coaching and would mint a duplicate card for an assessment booking. It logs a `success {skipped}` row hourly, so the health screen reads clean. Needs a per-board reader before it is safe to enable.

**D13 — Campaign→revenue has no leads or registrations count** (§2.1).

**D14 — Manual SMS sends check suppression but not SMS consent** — policy decision outstanding.

**D15 — `POST /api/ghl/contact` is an unauthenticated public proxy** that creates GHL contacts from any email/name/phone, with no caller anywhere in the app. Remove it.

**D16 — White-label gaps** (§2.5): `lib/email.ts` brand-wiring and hard-coded recipients; funnel tables without `business_id`; `create_business()` seeds no sequences; `sms_sender_phone` unnormalised.

**D17 — The legacy newsletter unsubscribe (`/api/newsletter/unsubscribe`) writes only `newsletter_subscribers.unsubscribed_at`**; no consent revocation, no suppression, so the engine's view of that person is unchanged.

**D18 — Payment on one board leaves the enquiry card open on another; a coaching refund can amend a camp card; camp/clinic *enquiries* route to Coaching** — all three were disclosed in the 8 Sept merge note and all three still hold. Only the missing switcher has been fixed.

**D19 — Sequence copy on production is sending unreviewed.** Migrations `00253` and `00255` say "DRAFTED, not authored by Darren"; all 12 sequences were switched ON on 9 Sept and the abandoned-checkout drafts have now reached a real inbox three times. The quotation lists copy approval under "What I need from you".

---

## 4. Production today, measured

| | Value |
|---|---|
| Businesses | 1 (Primary) |
| Contacts / with phone / linked to a user / with timezone | 170 / 90 / **0** / **0** (55 match a user by email — see the correction under D2: 55 is join rows, **54** contacts. Linked is **43** as of 2026-09-20) |
| Consent rows / suppressions / merges / tags | 0 / 0 / 0 / 1 (`abandoned-checkout`, applied by the engine) |
| Timeline entry points since 22 Aug | purchase 6 · checkout_abandoned 4 · quiz 2 (166 `ghl_import` rows from the import) |
| Sequences | 12, all `active`; 5 with an SMS step; 5 with a branch step; 0 placeholders |
| Runs | 73 `failed` (legacy `sms_repermission`) · `abandoned_checkout` 1 completed + 1 active · `quiz_ceiling_breaker` 1 active |
| Sequence messages | 73 failed (31 Aug) · **4 sent, all `delivered` at Resend** (16, 18, 19 ×2 Sept) |
| Pipelines / stages / cards | 3 / 12 / 4 (all Coaching: 2 Won, 1 Lost, 1 Consult Booked) |
| Funnels | 9 rows, **1 published** (`athlete-quiz`, today 14:14 UTC); `funnel_submissions` 0; `quiz_attempts` 5 |
| Bookings | 5, all `source=ghl`, all linked to a contact; **0 Calendly** |
| Chat | 1 conversation, 2 messages; flag ON |
| SMS | 0 rows; Twilio brand APPROVED, campaign MIXED/VERIFIED, 1 number; last real send 7 Sept (delivered) |
| Settings | sender `Darren J. Paul <noreply@send.darrenjpaul.com>` (verified domain), reply-to `darren@`, `America/New_York`, 08–21, cap 1, postal address set, `logo_url` / `brand_color` / `sms_sender_phone` / `sms_help_text` empty |
| Crons | `sequenceTickCron` 5,457 success, last 15:30 UTC · `pipelineReconcileCron` disabled (155 logged skips) · `funnelWindowCron` on |
| Attribution | 566 sessions, 45 since 13 Sept, 40 organic |
| Tests (this pass, Node 24) | 47 files / 856 tests green: sequence-tick ×5, pipeline-reconcile, `lib/lead-engine/*` (44 files), Twilio webhooks, SMS routes, sequence reporting, platform-inventory 5/5, no-brand-literals 3/3 |

---

## 5. Verified working — do not rebuild

Tick + atomic claim + sequence-ON gate inside the RPC; idempotent sends; quiet-hours defer incl. DST; daily cap across sequences; exits on payment / booking / unsubscribe / STOP; suppression before every send; merge by email and phone with children re-pointed; tags; consent rows with wording/IP/UA; SMS consent link; signed Twilio inbound + status callbacks answering TwiML; manual SMS with queued-row-first; reporting screen and step editor (8 kinds, branch targets, wait, cascade refusal); board switcher, drag move, forward-only auto-move, refund amend, 30-day manual-Lost suppression; chat refusals (pre-model regex + post-model validator that blocks), rate limits, escalation to `reply_to`, live Calendly slots; every organic `/go` visit stamped with an attribution session; publish gate that blocks dead-end pages; funnel form captures the lead's name from role-tagged fields.

---

## 6. The quotation's "What I need from you" — status

| Item | Status |
|---|---|
| Decision on white-label readiness | Taken: built white-label (with the gaps in §2.5). |
| Approval of message copy per sequence | **Outstanding and now urgent** — drafts are live (D19). Quiz copy was reviewed (`00253`); the other eight were not. |
| Confirmation of the pipeline shape | Done 8 Sept (three boards). |
| What the Athlete Quiz automations in GHL currently do | Not verifiable from here. The quiz now lives in the app and is published; GHL's version, if still running, is a parallel path. |
| Twilio campaign covers marketing | **Confirmed today from Twilio: MIXED, VERIFIED.** |
| Notifications decision | Not decided; today inquiry alerts go to `sales@` + `darren@`, funnel alerts to `darren@` + the funnel's notify list, quiz alerts and chat handovers to `reply_to`. |
| Account access (email, Twilio, AI) | Done; all configured on production. |

GoHighLevel is still in the loop (contact form, newsletter and questionnaire still push to GHL; all bookings are GHL). Do not cancel it yet: zero Calendly bookings have arrived through the webhook, and the consent records still live there.

---

## 7. Closing the gaps, in the order that matters

1. **Stop D1 today** — one guard in the expired-checkout handler (skip renewal-minted sessions or existing clients). Small, tested, and it stops real emails to a real customer.
2. **Copy review (D19)** — owner reads the eight unreviewed sequences on `/admin/sequences/<key>`; the editor already lets them change wording without a deploy.
3. **Link contacts to users (D2) and fix the hook order (D3)** — half a day each, both make the existing branches and boards truthful.
4. **The quoted behaviours that are missing (D4, D5, D6, D9)** — each is a bounded feature: an event-anchored wait, an `alert` step for the coach, a Resend events webhook + `opened_at`, and a status column on the leads list. Together roughly a week.
5. **Entry points (D11)** — questionnaire and assessment capture, bookings that create a contact. One to two days.
6. **Policy calls, no code until decided:** manual-SMS consent gating (D14); "one sequence at a time" as a hard rule (D7); email consent wording on the forms; the 73 stranded runs.
7. **White-label (D16)** — route the five transactional mails through settings, add `business_id` to the funnel tables, seed sequences in `create_business()`. This is the part of the quotation's third promise that is not yet true, and it is a separate piece of work.
8. **Housekeeping:** remove `/api/ghl/contact` (D15); make the legacy newsletter unsubscribe suppress (D17); reword or re-count the singleton comment.

---

## 8. Evidence index

- Production reads: `supabase-prod` `execute_sql` (sequences + steps, runs, messages, timeline, pipelines, funnels, bookings, contacts↔users join, settings, flags, cron_runs, audit rows).
- Providers: Resend `GET /emails?limit=25`; Twilio `Services`, `Services/{sid}/PhoneNumbers`, `Services/{sid}/Compliance/Usa2p`, `a2p/BrandRegistrations`, `Messages.json` — all GET, via the scratchpad script `provider-readonly.mjs` (prints statuses and masked addresses only).
- Live site: `/go/athlete-quiz` 200 with 2 JSON-LD blocks; `/api/ask/config` `{"enabled":true}`; the nine admin routes redirect to login (exist).
- Code: five read-only audits on `main` @ `10fef0f0`, key claims re-read by hand (Stripe hook order `route.ts:276-345`; `evaluateBranch` `sequence-tick.ts:76-99`; `enrollIfTriggered` `enroll.ts:100-118`; `siblingRunDefer` `guardrails.ts:169-185`; `contacts.ts:276-292` insert payload; `pipeline-reconcile.ts:291-309`; campaign-revenue page columns; `askCaptureSchema`; `bookConsult`; `lib/email.ts:82-85,1582,2090-2091,2175`; `create_business` migrations).
- Tests: `scratchpad/lead-engine-tests.log` — `Test Files 47 passed · Tests 856 passed`.
