-- supabase/migrations/00226_repermission_consent_link.sql
-- The SMS re-permission ask starts offering a link.
--
-- WHAT CHANGED, AND WHY IT COULD NOT BE DONE IN 00223.
--
-- 00223 seeded this email asking people to REPLY YES, and its header explains
-- at length that it did so because this repo had no consent landing page:
-- "Inventing a URL for a page that does not exist would ship a dead link to
-- ~90 real people, which is worse than not offering one." That was correct
-- then. Its FUTURE WORK paragraph described the page that would change it —
-- "a signed link the contact can tap, that shows the exact
-- renderSmsConsentWording() sentence and records contact_consents the moment
-- they click 'I agree'". That page now exists:
--
--     app/(marketing)/sms-consent/[token]/page.tsx   the page and its states
--     app/(marketing)/sms-consent/[token]/actions.ts the POST that writes
--     lib/lead-engine/sms-consent.ts                 the flow
--     lib/lead-engine/sms-consent-token.ts           the `smsok.` signed token
--
-- so the body below now leads with the link. The manual runbook in 00223 is
-- no longer the ONLY way to close the loop on a yes; it remains the way to
-- close the loop on a REPLY, which is why the reply-YES line survives below.
--
-- THE LINK IS A PLACEHOLDER, NOT A URL, AND IT HAS TO BE.
--
-- `sequence_steps.body` is one flat text column shared by every recipient of
-- this step, while the link is signed per CONTACT (an HMAC over the contact
-- id and business id) and rooted at a per-DEPLOYMENT origin. So the stored
-- copy carries the literal token
--
--     {{sms_consent_url}}
--
-- and `renderSequenceEmail` (lib/lead-engine/email.ts) substitutes it at send
-- time from a URL `lib/automation/sequence-tick-runner.ts` mints per run —
-- exactly the split that already keeps the unsubscribe URL out of the seed
-- copy. In the HTML part it becomes a real anchor; in the plain-text part,
-- the bare URL. A body carrying the placeholder with no URL supplied makes
-- the renderer throw rather than mail template syntax to a person.
--
-- THIS ONLY AFFECTS FUTURE SENDS. `sequence_messages.body_rendered` stores
-- the bytes each message was actually sent as (see the comment above
-- `renderSequenceEmail`'s call in the tick runner), so nothing already
-- delivered is rewritten or reinterpreted by this migration. Anyone who
-- already got the reply-YES version still has a working instruction, and the
-- inbox runbook in 00223 still handles their reply.
--
-- STATUS IS NOT UNTOUCHED IN PRODUCTION, AND THIS HEADER USED TO SAY IT WAS.
--
-- The UPDATE below does not write `sequences.status` — it touches one
-- `sequence_steps` row and nothing else. What was wrong was the conclusion
-- drawn from that: "the sequence stays `draft` ... nothing enrols and no copy
-- reaches a real person until a human reviews it AND runs
-- `node scripts/activate-sequence.mjs <env-file> sms_repermission`."
--
-- That describes a FRESH database. It has not described production since
-- 2026-08-22, when a human did exactly those two things: `sms_repermission`
-- was activated and 73 contacts were enrolled and mailed the 00223 copy
-- (docs/lead-engine-status-2026-08-23.md — 90 imported records carry a phone,
-- 73 of those also carry an email, and the ask goes out by email). On that
-- database this file edits the live copy of an ACTIVE sequence. The reason it
-- still reaches nobody new is that the sequence is one email then `stop` and
-- those 73 runs are finished — not that a safety catch is holding.
--
-- What DOES remain true of every database: `trigger_source` is NULL, so
-- nothing can auto-enrol into this sequence no matter its status.
-- `enrolContactManually` invoked by a human is the only path that creates a
-- run for it.
--
-- RELEASE ORDER: DEPLOY THE CODE FIRST, THEN APPLY THIS FILE.
--
-- The copy written below is understood only by the NEW renderer.
-- `{{sms_consent_url}}` means "substitute the per-contact link" to a build
-- carrying the placeholder handling in lib/lead-engine/email.ts, and means
-- nothing at all to the build before it. If this migration lands while the old
-- bundle is still serving, an email step rendering in that window mails the
-- literal `{{sms_consent_url}}` to a person as visible template syntax — and
-- `sequence_messages.body_rendered` freezes those bytes as the record of what
-- was sent, so it cannot be tidied up afterwards. The hazard runs backwards
-- too: rolling the code back after this file is applied puts the old renderer
-- in front of the new copy again.
--
-- The practical exposure is small. One email then `stop`, 73 runs completed on
-- 22 August, nothing auto-enrolling, so there should be no pending run for the
-- tick to pick up in that window. "Should be" is not "cannot", and the
-- ordering costs nothing: ship the code, confirm it is live, then apply this
-- file. Only the reverse order has a failure mode.
--
-- COPY RULES (unchanged from 00223): plain text; no brand literal (swept by
-- __tests__/lib/lead-engine/no-brand-literals.test.ts and asserted again in
-- __tests__/lib/lead-engine/seed-sequences.test.ts); {{name}} never
-- immediately followed by punctuation, because renderSequenceEmail's
-- substituteName falls back to "" for a nameless contact and "Hi {{name}},"
-- would render "Hi ,"; and the STOP/HELP/rates clause stays in the body,
-- because nothing in lib/lead-engine/email.ts appends an SMS-style opt-out
-- sentence to an EMAIL step the way renderSequenceSms does for sms.

UPDATE public.sequence_steps
SET
  subject = $subj$Can we text you?$subj$,
  body = $body$Hi {{name}}

We'd like to be able to reach you by text as well as email — often the quicker way to get a real person when you have a question.

Right now we don't have your OK to text this number. If that's fine with you, tap the link below. It opens a page that shows exactly what you're agreeing to, and there's a button to press.

{{sms_consent_url}}

Message and data rates may apply once texting begins, and you can reply STOP to opt out or HELP for help at any time after that.

If the link doesn't work for you, just reply YES to this email and we'll sort it out from our end.

If you'd rather we stick to email only, you don't need to do anything — we won't text you unless you tell us to.$body$
WHERE business_id = '00000000-0000-0000-0000-000000000001'
  AND position = 0
  AND sequence_id = (
    SELECT id FROM public.sequences
    WHERE business_id = '00000000-0000-0000-0000-000000000001'
      AND key = 'sms_repermission'
  );
