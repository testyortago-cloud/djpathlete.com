-- supabase/migrations/00223_lead_engine_repermission_sequence.sql
-- Lead Engine Stage 4, Task 9: the SMS re-permission ask for imported GHL
-- contacts.
--
-- Design: docs/superpowers/specs/2026-08-18-lead-engine-stage1b-sequence-engine-design.md
--         plus Task 7-8's import work (lib/lead-engine/import.ts,
--         scripts/import-ghl-contacts.ts).
--
-- SEEDED AS 'draft', trigger_source NULL — same "ships loaded, safety on"
-- contract as every sequence in 00218: nothing enrols and no copy reaches a
-- real person until a human reviews the wording below AND runs
-- `node scripts/activate-sequence.mjs <env-file> sms_repermission` to flip
-- the status to 'active'. NULL trigger_source additionally means this
-- sequence can NEVER auto-enrol via enrollIfTriggered() no matter its
-- status — lib/lead-engine/enroll.ts's enrolContactManually() (added this
-- task) is the only code path that ever creates a sequence_runs row for it,
-- and only a human invoking scripts/enrol-repermission.ts ever calls that
-- function for this sequence key.
--
-- WHO THIS IS FOR: the ~90 contacts imported by scripts/import-ghl-contacts.ts
-- (Tasks 7-8) that carry a phone number pulled from GoHighLevel. Every one
-- of them was tagged with a `sms_repermission_candidate` timeline event
-- (lib/lead-engine/import.ts) specifically because a GHL phone number is
-- NOT SMS consent — the import's own design finding (see that file's
-- comment above `smsRepermissionCandidate`) is that GHL never recorded what
-- any of its 104 tags meant, so nothing in the export can be read as
-- documented agreement to be texted. This sequence is the deliberate,
-- one-time ask that closes that gap: reach the contact by the channel we
-- ALREADY have standing permission to use (email — they gave it to a real
-- business at some point, which is a materially different bar than a phone
-- number sitting in an export) and ask them, in plain language, to say yes
-- to texting.
--
-- ONE EMAIL STEP, IMMEDIATE, NOT A NURTURE: these are existing contacts who
-- already have a relationship with this business, not a fresh lead walking
-- in the door — there is no funnel-style drip to run them through, and
-- repeatedly emailing someone to ask if they'll accept a DIFFERENT channel
-- is its own annoyance. One ask, then stop. Position 0 is `email` with no
-- preceding `wait` (nothing else in the codebase emails an imported contact
-- at the moment of import — `importGhlContact` sends nothing, per its own
-- header comment — so there is no double-send question here the way 00218
-- audits for live trigger sources). Position 1 is `stop`.
--
-- =============================================================================
-- THE REALITY CHECK: WHAT "TAP A LINK" WOULD REQUIRE, AND WHY THIS EMAIL
-- DOES NOT OFFER ONE.
--
-- The obvious shape for this ask is "reply YES or click here to opt in."
-- This repo has no consent landing page — grep `app/` for a route that
-- shows SMS consent wording and records a `contact_consents` row on a
-- contact's own action, the way the funnel form's checkbox does at submit
-- time (lib/lead-engine/sms-consent-wording.ts, __tests__/api/funnels/
-- submit-sms-consent.test.ts), and nothing matches for an EXISTING contact
-- clicking a link out of an email. Inventing a URL for a page that does not
-- exist would ship a dead link to ~90 real people, which is worse than not
-- offering one. So this email offers exactly one path: REPLY TO THE EMAIL
-- WITH THE WORD YES.
--
-- THE HARDER PART: replying to this EMAIL does not automatically record
-- anything. app/api/webhooks/twilio/inbound/route.ts is the only code in
-- this repo that turns a "YES" into a recorded consent event (its
-- START_KEYWORDS branch: unsuppress + recordConsent(granted: true) +
-- sms_start_received timeline event) — and that route is reachable ONLY by
-- an inbound Twilio SMS webhook POST, signature-validated against
-- TWILIO_AUTH_TOKEN. A reply typed into an email client is an SMTP message
-- to `business_settings.reply_to`, not an SMS to a Twilio number; it never
-- touches that route, no matter what word it contains. There is no
-- automated path from "contact replies YES to this email" to a
-- contact_consents row. That is not a bug to route around here — it is the
-- honest state of the system, and pretending otherwise (e.g. quietly
-- granting SMS consent the moment ANY reply arrives, unread) would be
-- worse: it would fabricate consent evidence for a channel a human never
-- actually reviewed.
--
-- SO CLOSING THE LOOP IS A MANUAL ACT, TODAY, BY DESIGN. THE RUNBOOK:
--
--   1. The email's replies land in `business_settings.reply_to` (the same
--      inbox every other sequence email's replies already go to — this
--      sequence sends no auto-reply and adds no new inbox to watch).
--   2. An operator reads a reply. If it affirmatively agrees to texting
--      (the word "yes", or unambiguous equivalent — the operator's
--      judgment call, made by a human reading real language, is exactly
--      what this step exists to require instead of pattern-matching one
--      keyword unread), they record consent by hand with the one-liner
--      below, quoting the reply's own text as the evidence
--      (`wordingShown`) — the same "what was actually shown/said" contract
--      `contact_consents.wording_shown` carries everywhere else in this
--      engine:
--
--        import { recordConsent } from "@/lib/db/contact-consents"
--        await recordConsent({
--          contactId: "<the contact's uuid>",
--          channel: "sms",
--          granted: true,
--          source: "email_reply_manual",
--          wordingShown: "<the reply's own text, quoted verbatim>",
--        })
--
--      `source: "email_reply_manual"` is a new, honest label — distinct
--      from "sms_inbound" (an actual SMS reply through the Twilio webhook)
--      and from "ghl_import" (evidence read off the GHL export) — so a
--      later audit of contact_consents can tell exactly how each SMS
--      consent row was obtained. It is not yet read by any code in this
--      repo; it exists purely as a truthful `source` value for this manual
--      act, the same way "sms_inbound" and "ghl_import" already are.
--   3. That single `recordConsent` call is the entire mechanism.
--      `hasConsent(contactId, "sms")` (lib/db/contact-consents.ts) reads
--      the most recent row per contact/channel regardless of `source`, so
--      once this row exists the contact is indistinguishable, to every
--      other part of the sequence engine, from a contact who consented via
--      the Twilio START path. No code change is needed to make a
--      manually-recorded consent row "count."
--
-- FUTURE WORK, EXPLICITLY OUT OF SCOPE HERE: a consent landing page (a
-- signed link the contact can tap, that shows the exact
-- renderSmsConsentWording() sentence and records contact_consents the
-- moment they click "I agree" — closing the loop automatically the same
-- way the funnel checkbox does) would remove the manual step above. Until
-- that page exists, this sequence's ask is honestly "reply YES", and
-- consent-recording is honestly a human's job.
--
-- COPY RULES (mirrors 00218 and 00222): plain text, no brand literal (swept
-- by both __tests__/lib/lead-engine/no-brand-literals.test.ts and this
-- migration's own assertions in __tests__/lib/lead-engine/seed-sequences.test.ts),
-- {{name}} never immediately followed by punctuation (renderSequenceEmail's
-- substituteName falls back to "" for a nameless contact — "Hi {{name}},"
-- would render "Hi ,"). Unlike 00222's sms bodies (which must NOT contain
-- "STOP" because renderSequenceSms appends SMS_OPT_OUT_SENTENCE once, at
-- send time), this is an EMAIL step — nothing in lib/lead-engine/email.ts
-- appends an SMS-style opt-out clause to a sequence email body, so the
-- STOP/HELP mention has to be written into the copy itself, here, to be
-- compatible with what renderSmsConsentWording() promises once a contact
-- actually starts receiving texts.
-- =============================================================================

INSERT INTO public.sequences (business_id, key, name, description, trigger_source, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'sms_repermission',
  'SMS Re-permission Ask',
  'One-time email to an imported contact whose phone number carries no recorded SMS consent (tagged sms_repermission_candidate at import — see lib/lead-engine/import.ts), asking them to reply YES to start receiving texts. Manual enrolment only (trigger_source NULL) via scripts/enrol-repermission.ts; closing the loop on a YES reply is a manual act today (see this migration''s header) until a consent landing page exists.',
  NULL,
  'draft'
)
ON CONFLICT (business_id, key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Position 0: the ask. Immediate — no preceding wait; see header comment.
-- -----------------------------------------------------------------------------

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'sms_repermission'),
  0, 'email', NULL,
  $subj$Can we text you?$subj$,
  $body$Hi {{name}}

We'd like to be able to reach you by text as well as email — often the quicker way to get a real person when you have a question.

Right now we don't have your OK to text this number, so we're asking directly: if that's fine with you, just reply YES to this email and we'll start sending texts here. Message and data rates may apply once texting begins, and you can reply STOP to opt out or HELP for help at any time after that.

If you'd rather we stick to email only, you don't need to do anything — we won't text you unless you tell us to.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Position 1: stop. One ask, then done — no follow-up email.
-- -----------------------------------------------------------------------------

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'sms_repermission'),
  1, 'stop', NULL, NULL, NULL
)
ON CONFLICT (sequence_id, position) DO NOTHING;
