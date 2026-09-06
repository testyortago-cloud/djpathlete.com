-- supabase/migrations/00253_athlete_quiz_result_copy.sql
-- The Athlete Quiz: real copy replaces the placeholder in all four sequences.
--
-- 00229 seeded these four sequences with a body that says, in every one of
-- them, "PLACEHOLDER COPY — not reviewed. Do not activate this sequence until
-- this line is gone." This migration removes that line by replacing the body.
--
-- STATUS IS DELIBERATELY NOT CHANGED. 00229's rule stands and is repeated here
-- because it is the whole safety property of this subsystem:
--
--     enrollIfTriggered() only reads sequences with status = 'active', so
--     nothing enrols and no copy reaches a real person until a human has read
--     the wording and flipped one row.
--
-- The copy below was DRAFTED, not authored by Darren. Replacing a placeholder
-- with an unread draft and activating in the same change would defeat 00229's
-- gate entirely — the point of the gate is a human reading the words, not the
-- absence of the word PLACEHOLDER. So: read the four bodies, edit whatever
-- does not sound like you, and only then run
--     UPDATE public.sequences SET status = 'active' WHERE key LIKE 'quiz_%';
-- Do not "helpfully" seed these active.
--
-- WHAT THE COPY HAD TO WORK AROUND. renderSequenceEmail (lib/lead-engine/email.ts)
-- substitutes exactly two placeholders: {{name}} and {{sms_consent_url}}. There
-- is NO variable for the visitor's tier, score or profile, so a body cannot say
-- "you scored 88" or "you're a Rebuilder". Each of these four therefore reads
-- correctly whether the reader scored red or green. Giving the renderer a tier
-- variable is a worthwhile follow-up and would let these get materially better;
-- it is not this migration.
--
-- ONE SEQUENCE PER BRANCH, not per tier. The filter is quiz_branches.key
-- (00229's contract with lib/quizzes/seed/rpi-athlete-quiz.ts), so the reader's
-- ARCHETYPE selects the sequence and their SCORE does not.
--
-- PROVEN END TO END BEFORE THIS WAS WRITTEN, on the dev clone, 2026-09-06:
-- a real quiz completion through /api/quiz/progress + /api/quiz/submit created
-- the contact, enrolled quiz_rebuilder, and the tick delivered this exact
-- rebuilder body to a real inbox. Resend confirmed `status=delivered`
-- (id 5306c2be-b0f8-40b3-85f4-a070429786f3), which matters because
-- lib/email.ts returns a success shape when RESEND_API_KEY is unset, so a
-- resolved send has never by itself meant a delivered one.
--
-- TWO SETTINGS THE SEND REQUIRES, both already correct in production and both
-- discovered by that test failing without them:
--   business_settings.sender_name    — an empty one renders `from: " <addr>"`,
--                                      which Resend rejects outright.
--   business_settings.postal_address — the tick refuses to run without it.
--
-- IDEMPOTENT. Keyed on sequences.key + position, so a re-run rewrites the same
-- four rows to the same values.

UPDATE public.sequence_steps s
SET subject = v.subject,
    body    = v.body,
    updated_at = now()
FROM (VALUES
  ('quiz_ceiling_breaker',
   'Your Athlete Quiz result',
   E'Hi {{name}}\n\nYour results are in the link you just saw — worth reading properly rather than skimming.\n\nThe pattern with athletes at your level is rarely a lack of work. It''s that one or two specific qualities have stopped translating into output, and training harder around them doesn''t fix it.\n\nIf you want to know which ones, reply to this email and tell me what you''re training for.'),

  ('quiz_rebuilder',
   'Your Athlete Quiz result',
   E'Hi {{name}}\n\nYour results are in the link you just saw.\n\nWhen something keeps breaking down, the site of the pain is usually not the cause. What the quiz points at is where load is going that shouldn''t be — which is the part worth fixing before you push volume again.\n\nIf you want to talk through what''s been recurring, reply to this email.'),

  ('quiz_aspiring_pro',
   'Your Athlete Quiz result',
   E'Hi {{name}}\n\nYour results are in the link you just saw.\n\nAt your stage the gap between good and serious is rarely talent — it''s whether the physical base gets built before the sport demands it. The things the quiz flagged are the ones that get expensive later if they''re left.\n\nIf you want to know what to prioritise first, reply to this email.'),

  ('quiz_parent_coach',
   'The athlete''s quiz result',
   E'Hi {{name}}\n\nThe results are in the link you just saw.\n\nMost programs an athlete this age lands in are built for a group, not for them. What the quiz flags is specific to the athlete you answered for — and it''s the difference between training that holds up and training that just adds load.\n\nIf you''d like to go through it, reply to this email.')
) AS v(seq_key, subject, body)
WHERE s.sequence_id = (SELECT q.id FROM public.sequences q WHERE q.key = v.seq_key)
  AND s.position = 0;
