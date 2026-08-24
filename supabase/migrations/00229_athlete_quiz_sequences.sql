-- supabase/migrations/00229_athlete_quiz_sequences.sql
-- The Athlete Quiz: one follow-up sequence per archetype.
--
-- Design: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §5.2
--
-- SEEDED AS 'draft', NOT 'active' — the same rule 00218 states and the same
-- reason: enrollIfTriggered() only reads sequences with status = 'active', so
-- nothing enrols and no copy reaches a real person until a human has read the
-- wording below and flipped one row. A sequence that is active on the day its
-- trigger starts firing sends mail nobody reviewed. Do not "helpfully" seed
-- these active.
--
-- THE COPY BELOW IS A PLACEHOLDER AND IS MARKED AS SUCH IN EVERY BODY. It
-- exists so the shape is real and reviewable, not because it is ready to send.
-- Darren's pass over the wording is the thing that makes any of these
-- flippable.
--
-- NO NEW ROUTING CODE. `enrollIfTriggered` already selects active sequences by
-- `trigger_source` and matches `trigger_filter` as exact key equality against
-- the contact event's metadata. `/api/quiz/submit` records the event with
-- `source: 'quiz'` and metadata carrying `branch`, so a filter of
-- `{"branch": "rebuilder"}` selects exactly the Rebuilders and nothing else.
--
-- THE FILTER VALUES ARE A CONTRACT with `quiz_branches.key`, which is itself a
-- contract with lib/quizzes/seed/rpi-athlete-quiz.ts. Renaming a branch key
-- silently stops enrolment — there is no foreign key across this boundary and
-- there cannot be, because the filter is JSON. A test asserts the four values
-- here match the seed module's four branch keys exactly, reading BOTH sides
-- rather than a copied list.
--
-- THE DOUBLE-SEND QUESTION, answered the way 00218 answers it: does anything
-- else email the visitor at the moment a quiz completes? `/api/quiz/submit`
-- sends the OPERATOR an alert for Red and Orange (lib/quizzes/alert.ts) and
-- sends the visitor nothing at all — the result is rendered on screen, not
-- emailed. So an immediate first step is safe for all four, and every sequence
-- below opens with one.

INSERT INTO public.sequences (business_id, key, name, description, trigger_source, trigger_filter, status)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'quiz_ceiling_breaker',
    'Quiz — Ceiling Breaker',
    'Follows an athlete who took the Athlete Quiz and sorted into Ceiling Breaker: already performing, looking for the next level. Their result is on screen before this arrives, so the first step sends immediately.',
    'quiz',
    '{"branch": "ceiling_breaker"}'::jsonb,
    'draft'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'quiz_rebuilder',
    'Quiz — Rebuilder',
    'Follows an athlete who sorted into Rebuilder: coming back from injury or recurring breakdown. Tone matters most here — this sequence must never read as a sales push at someone who is hurt.',
    'quiz',
    '{"branch": "rebuilder"}'::jsonb,
    'draft'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'quiz_aspiring_pro',
    'Quiz — Aspiring Pro',
    'Follows a young athlete building toward something serious. The reader may be the athlete or a parent, so the copy should work read aloud at a kitchen table.',
    'quiz',
    '{"branch": "aspiring_pro"}'::jsonb,
    'draft'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'quiz_parent_coach',
    'Quiz — Parent or Coach',
    'Follows a parent or coach enquiring on an athlete''s behalf. The quiz re-voices its questions in the third person for this branch and the follow-up should too: the reader is not the athlete.',
    'quiz',
    '{"branch": "parent_coach"}'::jsonb,
    'draft'
  )
ON CONFLICT (business_id, key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- One immediate step each. PLACEHOLDER COPY — every body says so in its own
-- first line, so a flip made without a copy pass is visible in the inbox
-- rather than silent.
-- -----------------------------------------------------------------------------

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_ceiling_breaker'),
  0, 'email', NULL,
  $subj$Your Athlete Quiz result$subj$,
  $body$PLACEHOLDER COPY — not reviewed. Do not activate this sequence until this line is gone.

Hi {{name}}

Thanks for working through the quiz. Your readout is based on what you told us about how your body is holding up under load, and where the gaps usually sit for athletes at your level.

If you want to go through it properly, reply to this email and we'll set up a time.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_rebuilder'),
  0, 'email', NULL,
  $subj$Your Athlete Quiz result$subj$,
  $body$PLACEHOLDER COPY — not reviewed. Do not activate this sequence until this line is gone.

Hi {{name}}

Thanks for working through the quiz. Coming back from a setback is its own problem, and the readout is about what has and has not been rebuilt — not about pushing you back to full speed before you are ready.

If you want to talk it through, reply to this email.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_aspiring_pro'),
  0, 'email', NULL,
  $subj$Your Athlete Quiz result$subj$,
  $body$PLACEHOLDER COPY — not reviewed. Do not activate this sequence until this line is gone.

Hi {{name}}

Thanks for working through the quiz. At this stage the things that matter most are the ones that compound — structure, specificity, and knowing where you actually stand rather than guessing.

If you want to go through the readout together, reply to this email.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;

INSERT INTO public.sequence_steps (business_id, sequence_id, position, kind, wait_minutes, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.sequences WHERE business_id = '00000000-0000-0000-0000-000000000001' AND key = 'quiz_parent_coach'),
  0, 'email', NULL,
  $subj$The athlete's quiz result$subj$,
  $body$PLACEHOLDER COPY — not reviewed. Do not activate this sequence until this line is gone.

Hi {{name}}

Thanks for working through the quiz on their behalf. The readout is about where the athlete stands physically right now, and which gaps are worth addressing before they become the reason for a setback.

If you want to go through it, reply to this email.$body$
)
ON CONFLICT (sequence_id, position) DO NOTHING;
