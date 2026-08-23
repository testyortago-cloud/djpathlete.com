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
-- STATUS IS UNTOUCHED. The sequence stays `draft` with a NULL trigger_source,
-- exactly as 00223 left it: nothing enrols and no copy reaches a real person
-- until a human reviews it AND runs
-- `node scripts/activate-sequence.mjs <env-file> sms_repermission`.
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
