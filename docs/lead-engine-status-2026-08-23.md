# Lead Engine — status report, 2026-08-23

The Lead Engine is the in-house replacement for GoHighLevel: one system that
captures every lead, follows up automatically, tracks each deal to a closed
sale, and reports what every campaign actually earned.

This supersedes `docs/lead-engine-status-2026-08-21.md`, which was written
before Stage 4 shipped and is now wrong in three specific places. Those
corrections are listed at the bottom, because a stale status report is worse
than none — it puts settled decisions back on the open list and sends people
looking for blockers that have already cleared.

**Bottom line: everything except SMS sending and the chat assistant is live.**
Leads from every entry point land in the contact system, three email sequences
are running, the pipeline board and campaign revenue report are in the admin,
and the old GoHighLevel contacts have been imported. SMS is built and waiting
on Twilio's approval. The chat assistant has not been started.

---

## Live in production

### The spine, the sequences, the pipeline (Stages 1a–1c, 18–20 August)

- **Contacts** live beside user accounts, so a lead becomes a contact whether
  or not they ever register. Duplicates merge safely, keeping the earliest
  first-touch attribution and a full audit trail.
- **Timeline** — every meaningful event lands on the contact's record.
- **Consent and suppression** per channel, storing the exact wording the person
  saw, plus a permanent do-not-contact list that survives merges and deletes.
- **Ad-click attribution** captured at the form, so iOS ad leads stop reading
  as organic.
- **Sequences** run on a five-minute tick. Sends are claimed atomically, so an
  overlapping run cannot double-send, and every send is idempotent under retry.
- **One-click unsubscribe** with a signed per-contact link, writing the
  suppression, the consent revocation and an audit row in one motion.
- **The pipeline board** (`/admin/pipeline`) — every lead is a card; bookings
  and Stripe payments move cards to Won automatically. An hourly reconciler
  repairs what a dropped webhook lost, constrained so it can only win a card
  that already exists.
- **Campaign revenue** (`/admin/insights/campaign-revenue`) — Won money traced
  back to the campaign that earned it. A refund corrects a Won card's value
  without unmaking the sale.

### Every entry point now feeds the spine (Stage 4, 22 August)

The seven remaining lead sources were wired in: contact form, newsletter, shop
lead magnets, inquiry, event signup, purchase and questionnaire. SMS consent
checkboxes were added to the last three phone-collecting forms.

### Day one against production (22 August)

- `newsletter_welcome` and `lead_magnet_delivery` activated. Enrolment is not
  retroactive — nobody who subscribed earlier was pulled in.
- **166 GoHighLevel contacts imported**, zero merges, meaning none of them
  collided with a contact already in the system. Of 300 exported records, 134
  carried no email and no phone and were skipped.
- **73 re-permission asks enrolled and sent.** 90 imported records carry a
  phone but only 73 also carry an email, and the ask goes out over email, so
  the other 17 have no channel and were correctly left alone.

### The privacy policy carrying the SMS section is published

This is the correction that matters most for the Twilio work — see below.

---

## Built, correct, and deliberately switched off

| Thing | Why it waits |
|---|---|
| The whole SMS path — sender, inbound STOP/HELP, delivery status, text steps | Twilio A2P registration. The code is provably dark: with no messaging-service SID configured, text steps skip as unsupported rather than failing |
| Cold Lead Re-engagement sequence | Ships as a draft. It is manual-enrolment by design, and until now nothing could enrol anyone |

---

## Not started

- **Stage 3 — the chat assistant.** Answers only from database-backed facts
  (FAQs, services, pricing, programmes, camp availability), with tools to
  capture a lead, book a consult, and escalate. The forbidden list — no
  invented pricing, no injury advice, no promised outcomes — needs a refusal
  test suite, because a prompt instruction is not a control.
- **The switch-over itself.** Parallel run, then disable GoHighLevel workflows
  one at a time.

---

## What still blocks the switch-over

1. **The Athlete Quiz** lives in GoHighLevel and produces most leads. It stays
   there until a replacement is built and proven. That replacement is not
   scoped yet, and it is the single biggest remaining piece of work.
2. **Two live GoHighLevel automations need homes.** One creates client accounts
   on a won sale; one pushes injury data to Airtable.
3. **Twilio A2P.** The business profile was rejected under error 18601 and
   needs resubmitting with the legal entity details. Campaign vetting alone
   runs one to three weeks after that clears.

---

## Corrections to the 21 August report

1. **The privacy policy with the SMS section is published, not pending.** The
   21st's report predates it. `scripts/publish-privacy-policy-sms.mjs` ran
   against production, and `scripts/backfill-legal-publish-audit.mjs` then
   repaired the audit row the first attempt failed to write — that script
   refuses to log anything unless the *live* policy actually contains the SMS
   section, so its having run is evidence the document is serving. One A2P
   prerequisite fewer.
2. **The 30-day re-booking suppression window is not an open question.** It was
   settled on 19 August — the Stage 1c design document records "Darren
   confirmed 30 days", and the value stands as built. It should never have
   appeared on the 21st's decision list.
3. **"Service application" does not exist and never did.** It was named in the
   original brief as an entry point. There is no such route here, and no
   matching form in GoHighLevel either — 8 forms and 4 submissions were checked.
   Closed, not outstanding.
