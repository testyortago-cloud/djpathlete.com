# Lead Engine — status report, 2026-08-21

The Lead Engine is the in-house replacement for GoHighLevel: one system that
captures every lead, follows up automatically, tracks each deal to a closed sale,
and reports what every campaign actually earned. This is where it stands today.

**Bottom line: the engine is live in production.** A lead who submits a funnel
form is captured into the contact system, enrolled in the New Lead Nurture email
sequence, and followed up automatically over ten days — in the site's own
branding, with lawful footers and working unsubscribe. The pipeline board and the
campaign revenue report are live in the admin. SMS, the chat assistant, and the
remaining lead-capture forms are the work still ahead.

---

## Done and live in production

### Stage 1a — the contact spine (shipped 2026-08-18)

The foundation every other piece stands on. Migrations `00212`–`00215`.

- **Contacts** live beside user accounts: every lead becomes a contact whether or
  not they ever register. Duplicate contacts merge safely, keeping the earliest
  first-touch attribution and a full audit trail.
- **Timeline** — every meaningful event (form submitted, email sent, booking
  made, payment taken) lands on the contact's timeline.
- **Consent and suppression** per channel (email / SMS), with the exact wording
  the person saw recorded on every consent, and a permanent do-not-contact list
  that survives merges and deletes.
- Ad-click attribution (`gclid`, `gbraid`, `wbraid`, `fbclid`) captured at the
  form so iOS ad leads stop reading as organic.

### Stage 1b — the sequence engine (shipped 2026-08-19)

The automated follow-up machinery. Migrations `00216`–`00218`.

- Sequences of steps (email, wait, and future SMS), run by a tick every five
  minutes. Sends are claimed atomically so an overlapping run can never
  double-send, and every send is idempotent under retry.
- **One-click unsubscribe** with a signed per-contact link; unsubscribing writes
  the suppression, the consent revocation (quoting the footer wording), and an
  audit row in one motion.
- Four email sequences seeded with reviewed copy: New Lead Nurture, Newsletter
  Welcome, Lead Magnet Follow-Up, Cold Lead Re-engagement.
- A double-send audit for every entry point, so a lead never gets two automated
  emails in the same moment.

### Stage 1c — pipeline and campaign revenue (shipped 2026-08-19/20)

Where leads become deals and deals become numbers. Migrations `00219`–`00220`.

- **The pipeline board** (`/admin/pipeline`): every lead is a card; bookings and
  Stripe payments move cards to Won automatically; manual closes are audited.
- An hourly reconciler repairs what a dropped webhook lost — constrained so it
  can only win a card that already exists, never invent one.
- **Campaign revenue** (`/admin/insights/campaign-revenue`): Won money traced
  back to the campaign that earned it, grouped by campaign / source / ad click.
- **Refund handling** (shipped 2026-08-20): a refund corrects a Won card's value
  without unmaking the sale, scoped to coaching payments only.

### Switched on — 2026-08-20

The engine went from built-but-dark to live:

- Business identity filled in production (sender, reply-to, display name, postal
  address — the legally required pieces of every commercial email).
- **New Lead Nurture activated** — three emails: immediately on enrolment, day 3,
  day 10, then stop. Replies go to darren@darrenjpaul.com.
- The five-minute tick enabled, and its first production run verified successful.

### Branded emails — 2026-08-21

The sequence emails now carry the site's visual identity — the dark header band,
accent strip, and house typography — matching every other email the app sends.
Previews rendered from the live production data are in
`screenshots/lead-engine-emails/` (open `index.html`).

---

## Live today, end to end

1. A visitor submits a funnel form.
2. They become (or update) a contact, with attribution and consent evidence.
3. They're enrolled in New Lead Nurture; the first branded email sends within
   five minutes, from Darren J. Paul, with a working unsubscribe.
4. Their card appears on the pipeline board; a booking or payment moves it.
5. A won deal's value lands in the campaign revenue report; a refund corrects it.

Watchdogs: the tick is on the automation-health scanner's expected list, so
silent failures surface in the daily health email.

## Built but intentionally dark

| Thing | Why it waits |
|---|---|
| Newsletter Welcome sequence | Copy ready; the newsletter form doesn't feed the contact system until Stage 4 |
| Lead Magnet Follow-Up sequence | Same — waits on Stage 4 wiring |
| Cold Lead Re-engagement | Manual-enrolment by design; needs an admin surface to pick contacts |
| SMS steps | Blocked on Twilio A2P registration (rejected business profile must be fixed first — needs Darren's legal entity details) |

## Not started

- **Stage 2 — SMS**: sending, inbound + STOP/HELP handling, text steps in
  sequences. Blocked on the Twilio chain above.
- **Stage 3 — chat assistant**: answers only from database-backed facts, with a
  tested refusal list.
- **Stage 4 — remaining entry points + GHL import**: wire the contact form,
  newsletter, shop leads, checkout, questionnaire, Step Up, assessments, and camps
  into the contact system; import GHL contacts under the strict consent position
  (the ~90 existing phone numbers import with **no** SMS consent and get one
  re-permission email). Continuation prompt ready:
  `docs/superpowers/2026-08-21-lead-engine-stage4-continuation-prompt.md`.
- **Switch-over**: parallel run against GHL, then disable its workflows one at a
  time. The Athlete Quiz stays in GHL until its replacement is proven.

## Decisions waiting on Darren

1. **Read the three New Lead Nurture emails** (previews above) — they're reaching
   real leads now; rewording is safe any time.
2. **Twilio registration chain** — the long pole for SMS; campaign vetting alone
   is 1–3 weeks.
3. **The 30-day re-booking suppression window** on the pipeline — confirm or tune.
4. **Stripe idempotency hardening** — today's check stops duplicate webhook
   redelivery but not a true simultaneous race; a unique index closes it.
5. **"Service application" entry point** — named in the original brief, no such
   route exists; what is it?
6. **Two live GHL automations need homes before switch-off** — one creates client
   accounts on a won sale, one pushes injury data to Airtable.
