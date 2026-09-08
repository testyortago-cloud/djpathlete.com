# Lead Engine — what is live, what is missing, and how to go live

**Date:** 2026-09-06
**Scope audited:** the "Full Engine · $2,250 · 6–8 weeks" package in the quotation
**Method:** every count, flag and status below was **read from production**
(`epzuvzkokzqtzomeyoha`) and from the code on `main` at `9c366ab2` on 2026-09-06.
Nothing is quoted from an earlier status document. Where an earlier document
disagrees, it is wrong and §2 says so.

**This is the only current document.** The four dated status reports and the
2026-09-01 version of this file are superseded — see §8.

---

## 1. Read this first

The engine is **built, deployed, switched on, and has almost nothing flowing
through it.**

Sending works — an email was delivered to a real inbox on 2026-09-06 and Resend
confirmed it. The tick cron fires every five minutes on its own. The chat
assistant is live on the marketing site and quotes real calendar times. The
contact record, the consent trail, the settings screen and the booking
integration all shipped.

What is missing splits into three piles, and only the first one stands between
you and being live:

1. **Switches that are off and content that was never written.** Two finished
   sequences sit paused. Three sequences the quotation names do not exist at
   all. There is no screen that shows you what the engine is doing. **This pile
   is most of the remaining value and almost none of the remaining difficulty.**
2. **Two features from the quotation that were never built** — replying to a
   text message from the admin, and more than one pipeline board.
3. **Seventy-three people waiting on a decision only you can make.**

The blunt version: on current production data the engine has **nurtured zero
real leads**. Not because it is broken — because one funnel is published, it has
received one submission, and the contact list is a bulk import that has recorded
nothing new since 2026-09-04.

---

## 2. Corrections to the 2026-09-01 version of this document

Five days and fourteen migrations have passed. The previous version listed five
outstanding phases. **Three of them have since shipped.** Every correction below
is in your favour.

| The 2026-09-01 version said | Actually, on 2026-09-06 |
|---|---|
| "**There is no contact detail page.** The history is being recorded and nobody can read it." | Shipped. [the contact detail page](<../app/(admin)/admin/contacts/[id]/page.tsx>) renders permission-to-contact, the do-not-contact list, sequences they are in, and full history. **Phase 1 done.** |
| "**Tags.** No column, no table, no code path." | Shipped — migrations 00237 and 00238, with [ContactTags.tsx](../components/admin/contacts/ContactTags.tsx). Merging carries tags across. **Zero tags have been applied yet.** |
| "*It books consults directly from live calendar availability.* — It does not." | It does now. [chat/tools.ts](../lib/lead-engine/chat/tools.ts) calls `listAvailableTimes`, and all six `CALENDLY_*` variables landed in production two days ago. **Phase 2 done.** |
| "**`updateBusinessSettings` has zero callers.** There is no settings screen." | Shipped. [BusinessSettingsForm](../components/admin/businesses/BusinessSettingsForm.tsx) edits all thirteen fields. **Phase 5 done.** |
| "The assistant is switched off (`chat_assistant_enabled = false`)." | It is **on**. |
| "The engine has never sent a successful email." | It has. 2026-09-06, Resend `delivered`, from `Darren J. Paul <noreply@send.darrenjpaul.com>`. |
| "`SINGLETON_BUSINESS_ID` is hard-coded in **124 places**." | **Five production files**, measured with the command in `CLAUDE.md`. The tenancy work has been eating this number steadily. |

**Two phases remain from that list:** Phase 3 (two-way SMS) and Phase 4
(pipeline boards). Both still have designs marked *"not yet approved"*.

---

## 3. Production, measured on 2026-09-06

### The nine sequences

Every step in every sequence has **real copy**. Zero placeholders remain
anywhere in production.

| Sequence | Status | Steps | Fires on | Runs ever |
|---|---|---|---|---|
| `new_lead_nurture` | **active** | 8 — 3 email, 3 wait, 1 SMS, 1 stop | funnel form | 0 |
| `quiz_aspiring_pro` | **active** | 1 email | quiz | 0 |
| `quiz_ceiling_breaker` | **active** | 1 email | quiz | 0 |
| `quiz_parent_coach` | **active** | 1 email | quiz | 0 |
| `quiz_rebuilder` | **active** | 1 email | quiz | 0 |
| `sms_repermission` | **active** | email + stop | manual only | 73, **all failed** |
| `newsletter_welcome` | **paused** | 6 — 2 email, 2 wait, 1 SMS, 1 stop | newsletter signup | 0 |
| `lead_magnet_delivery` | **paused** | 7 — 2 email, 3 wait, 1 SMS, 1 stop | lead magnet | 0 |
| `cold_lead_re_engagement` | **draft** | 6 — 2 email, 2 wait, 1 SMS, 1 stop | manual only | 0 |

**Zero branch steps exist across all nine.** The engine supports branching
(`branch_condition`, `on_true_position`, `on_false_position` are all real
columns and the evaluator works) — no sequence uses it.

> **Still true of production, and about to change.** Everything in §3 was measured
> on production, which has not moved. Branch `feat/sequence-content` (unmerged)
> takes this to **twelve** sequences and adds the first branch steps — see rows 5,
> 6 and 7 of §4. Nothing there sends on merge: the three new sequences seed as
> `draft`, and the four quiz sequences are deliberately **paused** by the same
> migration so you read the new copy before anybody receives it.

### Everything else

> **Re-measured from production on 2026-09-08, and one line below is now wrong.**
> A **real, live purchase landed on 2026-09-07 18:14:19 UTC** — a `cs_live_...` Checkout
> session, against a contact created 0.3 seconds earlier. So contacts are **170** (not 169)
> and timeline events **262** (not 261), and the claim in §1 that the engine has *"nurtured
> zero real leads"* no longer holds: it captured a paying customer end to end. Everything
> else in this table re-measured **unchanged** on 2026-09-08 — consent rows still 0, tags
> still 0, opportunities still 3 on the single Coaching board, funnels still 6 with 1
> published and 1 submission, bookings still 5, chat still 1 conversation.


| | Count | Reading |
|---|---|---|
| Contacts | **169** | Bulk-imported from GoHighLevel across 8 distinct minutes, zero first-touch sessions. Newest is 2026-09-04. |
| Consent rows | **0** | Nothing has been captured with dated consent yet. |
| Timeline events | 261 | Newest 2026-09-04 13:31. |
| Tags / merges / suppressions | **0 / 0 / 0** | All three features work; none has been used. |
| Sequence runs | 73 | **All `failed`.** All `sms_repermission`, 73 distinct people, enrolled 2026-08-22, killed 2026-08-31. |
| Pipelines / stages | **1** / 4 | Coaching only. |
| Opportunities | **3** | The board is effectively empty. |
| Funnels | 6, **1 published** | **1 submission, ever.** |
| Bookings | 5 | All `source='ghl'`. **Zero from Calendly.** |
| Chat conversations | **1** (2 messages) | Live but essentially untouched. |

### Configuration

| | |
|---|---|
| Sender | `Darren J. Paul <noreply@send.darrenjpaul.com>` — the verified domain ✅ |
| Reply-to | `darren@darrenjpaul.com` |
| Timezone / quiet hours | `America/New_York`, 08:00–21:00, DST-correct |
| Daily cap | 1 message per person per day, across all sequences |
| Twilio | All three required variables present in production; messaging-service SID set; A2P approved 2026-08-25 ✅ |
| Calendly | Connected 2026-09-04 (`status='connected'`); all six variables in production ✅ |
| `chat_assistant_enabled` | **true** |
| `cron_sequence_tick_enabled` | **true**, verified self-firing |
| `cron_pipeline_reconcile_enabled` | **no row → false**. See §4 item 9. |
| `logo_url`, `sms_sender_phone` | **empty** — neither blocks anything today |

---

## 4. What is missing

Ranked by what stands between you and a working engine. "Blocks go-live" means
*the engine cannot do its job without it*, not *it is in the quotation*.

| # | Missing | Area | Blocks go-live | Rough effort |
|---|---|---|---|---|
| 1 | **Two finished sequences are paused** — `newsletter_welcome`, `lead_magnet_delivery`. Real copy, triggers wired, nothing wrong with them. | Automation | **Yes** | Minutes — see §5A |
| 2 | **73 people are stranded** in terminal `failed` runs from the 2026-08-31 domain fault. | Automation | **Yes** | Minutes + your decision |
| 3 | **Only one funnel is published**, and it has one submission. Nothing is feeding the engine. | Funnels | **Yes** | Yours, not code |
| 4 | ~~**No reporting screen.**~~ **BUILT** — `/admin/sequences` lists every sequence with entered / still going / bought / booked / opted out / reached the end / something went wrong / something else, and a per-sequence detail page names every person and why they left. Branch `feat/sequence-reporting`, **merged 2026-09-07, not yet pushed**. | Automation | ~~Yes~~ **Closed** | ~~2–3 days~~ done |
| 5 | ~~**Three quoted sequences do not exist**: *abandoned checkout*, *service application received*, *camp or clinic deadline*.~~ **BUILT** — all three seeded by migration `00255`, as **`draft`**. Abandoned checkout rides `checkout.session.expired` (the only signal Stripe gives, ~24h after the session starts) and covers coaching and programs, not the shop; it skips anyone who paid on a later attempt. Service application received needed no code — `/api/inquiry` already writes the event, and the applicant currently receives nothing at all. Camp or clinic deadline chases people who registered INTEREST and have not paid; the interest route now marks its event so a filter can tell it from a paid one. Branch `feat/sequence-content`, **not yet merged**. | Automation | ~~No~~ **Closed** | ~~3–5 days incl. copy~~ done |
| 6 | ~~**The four quiz sequences are one email long.**~~ **BUILT** — each is now 8 steps: the existing result email, a wait, a second email, a branch on whether the reader is already a client, and a separate ending for each. Position 0 was left untouched — it is the copy you reviewed in `00253`. **All four are PAUSED by the same migration**, because they were live and adding steps would have sent unread copy to the next person who takes the quiz. **You re-activate them after reading.** | Automation | ~~No~~ **Closed** | ~~2–3 days incl. copy~~ done |
| 7 | ~~**Branching is unused.**~~ **BUILT** — the first branch steps this system has ever had. Two conditions, both chosen because the two sides say different things rather than just using a different channel: *is this person already a client* (four quiz sequences — an existing client is never asked to book an intro call), and *may we text them* (abandoned checkout — a short text if yes, a second email if no, so neither group gets silence). | Automation | ~~No~~ **Closed** | ~~1–2 days on top of #5/#6~~ done |
| 8 | **Three of four pipeline boards, and all routing.** `applyPipelineEvent` accepts a `pipelineKey` and **no caller anywhere passes one** — every booking, payment and quiz result lands on Coaching. A camp registration and a coaching enquiry are the same card in the same column. There is no screen to create a board. | Pipeline | No — but it is your #2 ask | 5–8 days ([design](superpowers/specs/2026-09-01-full-engine-phase4-pipeline-boards-design.md)) |
| 9 | **The pipeline repair cron is off.** A dropped webhook leaves a deal silently missing from the board and nothing fixes it. | Pipeline | No | Minutes — see §5A |
| 10 | **Two-way SMS.** `sendRenderedSequenceSms` has exactly one caller — the tick runner. You cannot text a person from the admin or reply to one. Inbound writes a timeline row and forwards to your email. | Automation | No | 4–6 days ([design](superpowers/specs/2026-09-01-full-engine-phase3-two-way-sms-design.md)) |
| 11 | **No screen to manage sequences at all** — no on/off toggle, no step editor. Turning the quiz sequences on required writing a script for the purpose. | Automation | No | 3–4 days |
| 12 | ~~**`tag` and `stage` sequence steps silently do nothing.**~~ **BUILT** — a `tag` step applies a tag, a `stage` step moves the contact's card. `sequence_steps.config` has its first reader. A sequence may MOVE a card but never close or reopen one. **Merged 2026-09-07, not yet pushed.** ~~Ships DORMANT~~ — **no longer dormant:** migration `00255` (branch `feat/sequence-content`) writes the first `tag` step, so this is live the moment that branch merges and the sequence is switched on. A `stage` step still has no writer. That branch also made a sequence's card move **forward-only**, matching every other automated writer. | Automation | ~~No~~ **Closed** | ~~1–2 days~~ done |
| 13 | ~~**The chat bubble is not on funnel or landing pages.**~~ **DECIDED 2026-09-07 — it stays OFF. Zero work.** The owner ruled it during the gap #4 brainstorm and confirmed it on 2026-09-08: *a landing page's job is to remove exits*. Where the quotation says otherwise, the ruling wins. **Written down 2026-09-08** because both rulings were verbal and this row kept reading as an open question — do not re-open it. | Chat | No | ~~One line, either way~~ **Closed, no work** |
| 14 | ~~**`shop`, `assessment` and `funnel_checkout` are declared contact sources and never written.**~~ **BUILT** — the Stripe webhook's completed-checkout capture now files `shop_order` under `shop` and `funnel_purchase` under `funnel_checkout`; every other checkout kind (a plain coaching sale, `event_signup`, `save_card`, `session_pack`) still writes `purchase`, unchanged — a narrowing, not a redefinition, since `hasPurchaseSince` reads that source. `assessment` writes **only onto a contact that already exists — it never mints one.** The assessment route 401s without a session, so every submitter is already a registered client, not a lead; minting a contact for them would change what the contacts list contains, which is a product decision, not a labelling fix. **This was my ruling, not the owner's** — see §2.3 of [the design doc](superpowers/specs/2026-09-08-contact-sources-design.md) for the argument and the two rejected alternatives. Four `SOURCE_LABELS` entries were missing, not three — `questionnaire` already had a live writer and was quietly falling back to a generic sentence; all four now render a coach-readable line. Branch `feat/contact-sources`, **not yet merged.** | Contacts | ~~No~~ **Closed** | ~~Half a day~~ done |
| 15 | ~~**Email sends are not consent-gated.**~~ **DECIDED 2026-09-07 — email stays UNGATED. Zero work.** The reason is elsewhere on this page: **170 contacts, zero consent rows** (re-measured 2026-09-08), so a hard gate would silence the entire imported list the day it shipped. Unsubscribe already works and stays the control. `hasEmailConsent` stays computed and stays *advisory* at [sequence-tick.ts:85](../lib/automation/sequence-tick.ts#L85); **SMS remains hard-gated** and that is not in question. **Written down 2026-09-08** — the ruling was verbal and this row kept reading as an open decision. | Compliance | No — unsubscribe works | ~~Decision first, then ~1 day~~ **Closed, no work** |

### Not missing — verified working, do not rebuild

Sequences genuinely stop on **purchase** ([stripe/webhook:223](../app/api/stripe/webhook/route.ts#L223)),
on **booking** ([bookings/ingest.ts:309](../lib/bookings/ingest.ts#L309)), on
**STOP** and on **unsubscribe**. Quiet hours are DST-correct including the
spring-forward gap. The daily cap and the no-two-sequences-at-once rule work.
Contact merging by email and phone works. STOP/HELP answers empty TwiML rather
than JSON. Delivery tracking is signature-verified. The chat assistant refuses
injury questions before the model is called, and its output validator has
already caught it inventing a price. Campaign→revenue exists at
`/admin/insights/campaign-revenue`. RLS is on all four pipeline tables.

---

## 5. Going live

### Part A — today, no code, about thirty minutes

Every command has a `--dry-run`. **Run it first, every time**, and check the
printed project host: the dev clone and production differ by one subdomain.

**1. Unpause the two finished sequences.** Both have real copy and live
triggers, so newsletter signups and lead-magnet downloads start being nurtured
the moment you do this.

```
node scripts/activate-sequence.mjs .env.prod newsletter_welcome --dry-run
node scripts/activate-sequence.mjs .env.prod newsletter_welcome
node scripts/activate-sequence.mjs .env.prod lead_magnet_delivery --dry-run
node scripts/activate-sequence.mjs .env.prod lead_magnet_delivery
```

**2. Turn on the pipeline repair cron**, so a dropped webhook stops costing you
a deal card:

```
node scripts/set-cron-flag.mjs .env.prod cron_pipeline_reconcile_enabled true --dry-run
node scripts/set-cron-flag.mjs .env.prod cron_pipeline_reconcile_enabled true
```

**3. Publish more funnels.** Five of your six funnels are unpublished. The
engine is wired correctly from funnel form → contact → `new_lead_nurture`; it
has simply had nothing to nurture. This is the single highest-value action on
this page and none of it is code.

### Part B — decisions only you can make

**1. The 73 stranded people.** They were asked for permission to text on
2026-08-22; the send died on 2026-08-31 through a configuration fault that has
since been fixed. They are in terminal `failed` and cannot recover or re-enrol
on their own — that guard is deliberate and protects people from a double send.

`scripts/repair-failed-sequence-runs.mjs` exists for exactly this, and it
**deliberately has no default for `--next-run-at`**, because the question is
yours: does a fifteen-day-old ask go out as written, or does it get re-dated
first? Answer that and the repair is a single command.

**2. Consent, and what "live" means for the imported list.** 169 contacts, zero
consent rows. Email is not consent-gated (§4 item 15) so those 169 *can* be
emailed. Whether they *should* be, given none of them has a dated consent record
here, is a business decision — and it is the same question the 73 re-permission
asks were trying to settle.

**3. The chat bubble on funnel pages.** Currently excluded on purpose. The
quotation says it is there. One line either way — tell me which.

**4. Do not cancel GoHighLevel yet.** It still holds the consent records and it
still runs the real quiz. Calendly is connected but has produced **zero**
bookings here — all five in the database are still `ghl`. Prove one Calendly
booking arrives through the webhook before you switch anything off.

### Part C — build, in this order

1. **The reporting screen** (#4). Everything else is guesswork without it, it is
   promised in every package, and the data is already being recorded correctly.
2. **Sequence content** — the three missing sequences, the four quiz stubs, and
   branching (#5, #6, #7). Biggest gap against the quotation, no new machinery
   needed.
3. **Pipeline boards and routing** (#8). Your second priority, and the only item
   here that needs real design work — routing is the hard half and does not
   exist in any form.
4. **Two-way SMS** (#10). Everything is approved and configured; what is missing
   is a conversation view and a send action.

Items #11–#15 are cleanups to fold into whichever of the above touches them.

---

## 6. The three areas, directly

### Automation workflow — *"no leads go to waste"*

The follow-up machine is real and running. What is not real is **how much there
is to follow up with**: five usable sequences of which four are a single email,
no branching, and three of the eight named in the quotation missing entirely.
The AI chat is live and answers from your genuine FAQs, programs and camp
availability, captures the lead with the campaign attached, offers real calendar
times, and escalates when unsure. It has held one conversation.

### Opportunity / pipeline — *"segment by offer and campaign"*

**This is the weakest area and it is exactly what you flagged.** One board
exists. Nothing routes to any other. Every sale of every kind lands in the same
four columns. The machinery for many boards is there and has never been used —
migration 00219 says so in its own comment. Auto-move, staleness colouring and
campaign→revenue all genuinely work; they are working on one board with three
cards on it.

### Sites / funnels

Structurally the most complete part of the system: a full builder, versioned
publishing, three preview routes, forms wired through to capture and enrolment.
The gap is not code, it is **usage** — one published funnel, one submission.

---

## 7. Traps already paid for — do not re-learn these

- **`lib/email.ts` returns a success shape when `RESEND_API_KEY` is unset.** A
  send that did not throw is not a send. Confirm against Resend, not the logs.
- **The tick returns *before* it logs when its flag is off**, so a silent
  `cron_runs` table does not mean a dead cron. A four-minute gap measured
  against a five-minute schedule is not a defect.
- **`business_settings.sender_name` and `postal_address` are load-bearing.** An
  empty sender name renders `from: " <addr>"`, which Resend rejects outright,
  and an empty postal address stops the tick running at all.
- **Read the migration that created a row before changing that row.** 00229 says
  in capitals not to seed the quiz sequences active, and explains that the gate
  is a human reading the copy.
- **The production Supabase connection is read-only.** Changes go through the
  scripts, which compare-and-set and read back.
- **Published funnel CSS is frozen** — style changes reach a live page only when
  that funnel is re-published.

---

## 8. Superseded documents

Delete-on-sight. Every one of them is wrong somewhere, and three of them read as
"almost done" while describing different systems:

- `docs/lead-engine-status-2026-08-21.md`
- `docs/lead-engine-status-2026-08-23.md`
- `docs/lead-engine-status-2026-08-24.md`
- `docs/lead-engine-status-2026-08-24-evening.md`
- the 2026-09-01 version of this file (see §2)

Still current: the four phase designs in `docs/superpowers/specs/`
(phase 3 and phase 4 are unbuilt; phase 1, 2 and 5 shipped), and
`docs/superpowers/specs/2026-09-01-lead-engine-last-mile-design.md` for the
history of the sending defect.
