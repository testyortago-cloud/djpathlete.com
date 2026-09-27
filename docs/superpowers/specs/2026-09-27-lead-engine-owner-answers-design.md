# Lead engine — the owner's answers of 2026-09-27

**Status:** design, autonomous mode ("do whats best", "do what is needed"). Built on branch
`worktree-lead-engine-owner-answers` off `main@075cd760`. Nothing is merged or deployed without the
owner's word.

## 0. What the owner said, and what each answer means

The owner answered the "still not done" list line by line:

| Owner's line | The item it answers | What this build does |
|---|---|---|
| "create me a followup for the people who leave their details in the chat" | G18's open half: no sequence follows a chat lead | §1: a new sequence, `chat_lead_follow_up` |
| "text steps is sequence is good" | G17: six drafted text steps | Approved as written. Ledger only. |
| "do whats best" | G11: no 1-day-before camp reminder | §2: 14/7/3/1, keeping the approved "last one" email last |
| "looks good" | G12: the coach alert's wording | Approved as written. Ledger only. |
| "yes i want it" | Decision 7: email-permission wording on the funnel, quiz and application forms | §3: an email-permission tick on those three forms |
| "i want the autorepply for the booking" | G30's carried clause: the application auto-reply links the old GoHighLevel calendar | §4: the button links the coach's own Calendly, or is left out |
| "do what is needed" | the rest | §5: small fixes found on 2026-09-27; §6: ledger truth |

**Assumptions, stated so they can be corrected:** the mapping above follows the order of the list
the owner was answering. "yes i want it" is read as decision 7, not the section-3 fixes; the fixes
are done anyway under "do what is needed".

## 1. Chat lead follow-up (G18)

**Today:** `POST /api/ask/capture` saves a contact, files email/SMS consent when ticked, and records a
timeline event with source `ai_chat`. No sequence has `trigger_source = 'ai_chat'`, so nobody follows
up, AND nothing tells the coach: the chat capture writes no notification and sends no email (the
escalation email in `lib/lead-engine/chat/escalate.ts` is for the assistant being unsure, not for a
capture). The visitor is told "Thanks — someone has your details now."

> **Revised 2026-09-27 after the Task 1 review (supersedes the step-1 alert and the superseding
> paragraph below).** The coach is told by a TRANSACTIONAL email sent from `POST /api/ask/capture` on
> EVERY capture — `sendChatLeadAlertEmail` in `lib/email/lead-alerts.ts`, to the business's
> `reply_to`, like the quiz and application alerts — not by a sequence step. `ai_chat` stays
> NON-superseding. Why: with `ai_chat` superseding, a person inside `camp_clinic_deadline` or the
> application follow-up who asks the chat one question has that run ended `superseded`, and the
> camp's 30-day cooldown then refuses their re-registration, so they lose the 14/7/3/1 countdown; and
> a repeat chat lead inside the cooldown would never reach the coach, while the visitor is told
> "someone has your details now". A transactional alert reaches the coach every time, whatever
> sequence the person is in. The sequence therefore has NO alert step: email · wait 2 days · email ·
> wait 1 day · text · end (6 steps). The alert's subject is `{{name}} left their details in your
> website chat` with the real name substituted; its body says they asked a question in the chat and
> were told a person would be in touch, gives their email and phone as given, and says to open the
> chat assistant in the admin to read the conversation. A failed alert never fails the capture.

**Design.** One new sequence, added to the starter set so every business gets it as a draft:

- key `chat_lead_follow_up`, name **Chat Lead Follow-Up**, `trigger_source = 'ai_chat'`, filter `{}`,
  cooldown 30 days, status **draft** everywhere (including the platform business).
- Description (coach-facing): "Follows someone who leaves their details in the chat on your website.
  It confirms to them that their question reached you, then checks in two days later."

| # | Step | Content |
|---|---|---|
| 1 | Email | Subject: `Your question reached us` · Body: `Hi {{first_name}}\n\nThanks for leaving your details in the chat. Your question has been passed on, and a real person will get back to you.\n\nIf there's anything you'd like to add in the meantime, such as the sport, the athlete's age, or what you're hoping to fix, just reply to this email. It helps us give you a proper answer rather than a general one.` |
| 2 | Wait | 2 days (2880) |
| 3 | Email | Subject: `Did you get what you needed?` · Body: `Hi {{first_name}}\n\nJust checking your question got answered. If it didn't, or if it raised new ones, reply here and it comes straight to us.\n\nIf you're weighing up whether training with us is the right fit, the easiest next step is a short call. Reply with a couple of times that suit you and we'll set it up.` |
| 4 | Wait | 1 day (1440) — every text sits behind a wait (00272: a text right after an email lands the next morning under the daily cap of 1) |
| 5 | Text | `Checking your question from the website chat got answered. Reply here if you still need anything.` — plain ASCII, no `{{name}}`, no STOP line (appended automatically), one GSM-7 segment with the opt-out sentence, per 00272's four rules |
| 6 | End here | |

**The coach alert** is `sendChatLeadAlertEmail`, sent and awaited by `POST /api/ask/capture` on every
capture (see the blockquote above for why it is not a sequence step).

**Superseding.** `IS_SUPERSEDING_SOURCE.ai_chat` stays `false`. A chat lead already inside another
sequence keeps that sequence and is refused the chat follow-up (G14 option B); the coach is still told
by the transactional alert. `enroll.test.ts` pins that an `ai_chat` event does not exit an active
`camp_clinic_deadline` run.

**Why a draft, not live.** 00229's rule: the gate on a sequence reaching the public is a human reading
it. The owner switches it on at Sequences → Chat Lead Follow-Up with one confirmed click.

## 2. Camp or clinic deadline: 14 / 7 / 3 / 1 (G11)

**Today (production, read 2026-09-27):** email · wait until 14d before · email · wait until 7d · email
"Places are limited" · wait 1 day · text · wait until 3d · email **"Last one about this"** ("I will not
keep bringing it up") · end. A fourth email after it would break the promise the owner approved, the
same reasoning 00272 used to place the camp text.

**Design.** Keep the approved last email LAST and move it to 1 day before; add one new email at 3 days:

... · wait until 3d · **NEW email "Three days to go"** · **NEW wait until 1d** · email "Last one about
this" (same row, moved) · end (same row, moved).

New email: Subject `Three days to go` · Body: `Hi {{first_name}}\n\nThe camp is three days away. If
you're still deciding, the thing worth knowing is that registering interest doesn't hold a place —
registering properly does.\n\nIf something's in the way, such as the date, the cost, or whether it's
the right level, reply and tell me. I'd rather sort it out than have you miss it.`

**Mechanics (a migration, like 00271/00272):**
- Per business, find `camp_clinic_deadline`. Recognise the shape by STRUCTURE, not text: the last
  three steps are `wait{days_before_anchor:3}` · `email` · `stop`, and no step already waits
  `days_before_anchor:1`. Anything else is SKIPPED with a NOTICE (one tenant never blocks another).
- Existing rows keep their ids (so `sequence_messages` history and the FK cascade are untouched):
  renumber the email and stop from p+1/p+2 to p+3/p+4 through the +1000 park, then insert the new
  email at p+1 and `wait {days_before_anchor:1}` (no minutes; 00268 allows it) at p+2.
- In-flight runs (`current_position` names the NEXT step): a run at p+1 was due the 3-day email and now
  gets the new one, then waits for the 1-day moment — unchanged. A run at p+2 had already had "Last
  one" and must not get it again — move it to p+4 (the stop). Production had 0 active runs on
  2026-09-27; the rule still has to be right.
- Verify at the end, scoped to the sequences converted.
- The starter-set JSON for new businesses gets the same shape.

## 3. Email-permission tick on the funnel, quiz and application forms (decision 7)

**Today:** those three forms show an SMS tick beside a phone field and file `contact_consents`
(`channel: 'sms'`) with the exact wording, IP and user agent. Nothing asks about email, so production
holds almost no email-consent rows and the sequence page says "N people have no recorded permission
to email". Email stays UNGATED (ruling of 2026-09-07); this records consent, it does not gate sending.

**Design.** Mirror the SMS pattern exactly.

- `lib/lead-engine/email-consent-wording.ts`: `renderEmailConsentWording(displayName)` =
  `Yes, ${displayName} can email me training tips, news and offers. I can unsubscribe at any time.`
  and `hasEmailConsentDisplayName`. Brand-neutral (the chat's own sentence names "coaching, camps and
  clinics", which not every coach sells). Lives under `lib/lead-engine`, so the no-brand-literals
  sweep covers it.
- **Funnel forms:** `FormIsland` renders the wording server-side; `FunnelForm` shows an UNTICKED
  checkbox named `email_consent` under every `email` field, reusing the same
  `.djp-field[data-djp-field-type="checkbox"]` structure as the SMS tick so published CSS needs no
  re-publish. `/api/funnels/submit` accepts `email_consent` (optional, default false, same reason as
  `smsConsent`: open pages must not 400 during the deploy window) and files the row when true and an
  email is present, re-rendering the wording server-side.
- **Quiz gate:** the same in `QuizIsland` and `/api/quiz/submit`.
- **Application form:** the same in `InquiryForm`/`InquiryFormClient` and `/api/inquiry` (and any
  other form posting to `/api/inquiry`).
- Consent rows use the route's own source (`funnel_form`, `quiz`, `inquiry`), `granted: true`, the
  re-rendered wording, IP, user agent. A blank display name shows no tick and files nothing. A consent
  write failure never fails the submission (the lead is already saved).

**Not in scope:** the camp/clinic signup modal and the newsletter (it already has its own tick).

## 4. Application auto-reply: the coach's own booking page (G30's carried clause)

**Today:** `sendInquiryAutoReply` (`lib/email/lead-alerts.ts`) always links `PLATFORM_BOOKING_LINK`,
a hard-coded GoHighLevel widget, whoever the applicant applied to.

**Design.** Resolve the link with `calendlyBookingOfferForBusiness(businessId).schedulingUrl`
(`lib/calendly/config-for-business.ts`): the business's own connection, the platform's environment
fallback for the platform business only, or nothing.
- A URL → the "Schedule Your Consultation" button links it (prefill name and email if a prefill helper
  already exists for the chat's slot links; otherwise the plain URL).
- No URL, or the resolver throws → no button; the sentence becomes "The next step is a short
  consultation call. Reply to this email and we'll find a time." The auto-reply must still send: an
  applicant never gets silence because a calendar read failed.
- Delete `PLATFORM_BOOKING_LINK`, and its allowlist entry in `no-brand-literals.test.ts`.

## 5. Small fixes found on 2026-09-27

- **Business settings, quiet hours.** The two fields are the ALLOWED window (`quietHoursDefer`:
  `[start, end)`), but they are labelled "Quiet hours start/end" and the hint says "No text messages
  go out … between these hours" — the opposite. Relabel **"Start sending at"** / **"Stop sending
  at"**; hint: "Follow-up emails and texts only go out between these hours, in each person's own time
  zone when we know it, otherwise this business's. Use the hour of the day, from 0 (midnight) to 23
  (11pm): 8 and 21 means 8am until 9pm." Column names unchanged.
- **Daily limit hint:** "The most follow-up messages (emails and texts together) one person can be
  sent in a day, across all sequences." (Verify the cap counts both channels before writing it.)
- **Campaign Revenue** in the sidebar (Business section, after Analytics), gated by the same registry.
- **Business settings** reachable: a "Business Settings" link on Settings → Configuration.

## 6. Ledger and docs (truth, not code)

`docs/lead-engine-gaps-to-ship-2026-09-19.md`: G17 copy approved; G12 wording approved; G18 built
(draft); G11 fourth reminder built; G30 booking clause built; decision 1 → closed by G03 (2026-09-20);
decision 7 built; `cron_pipeline_reconcile_enabled` is TRUE on production (read 2026-09-27; the
"finished but not switched on" section is stale). A "superseded" banner on
`docs/lead-engine-audit-2026-09-13.md`.

## 7. Verification

Targeted tests by FILE (the new/edited suites plus every suite importing a changed module), tsc per-file
identical to a same-environment baseline, `next build` 0, the migration applied to the dev clone and
read back, `test:integration:selects` and `test:integration:drift`, mutants on each new guard, an
independent whole-branch review, and annotated screenshots of every changed screen
(`screenshots/lead-engine-owner-answers/`).

## 8. Out of scope, recorded

- sales@: `sales@send.darrenjpaul.com` has no MX record and cannot receive mail, so it must never be
  an alert recipient; routing alerts elsewhere or changing the From address is a production settings
  change awaiting the owner's word.
- The HELP reply text, logo and brand colour are empty on production; they are the owner's content.
- No lead magnet exists on production.
- The event signup modal has no email tick.
