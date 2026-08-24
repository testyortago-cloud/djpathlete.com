-- 00230_funnel_submissions_quiz.sql
--
-- A COMPLETED QUIZ IS A LEAD ON THE FUNNEL IT WAS TAKEN ON.
--
-- Until now it was not. A finished quiz wrote a contact, a consent row, a
-- timeline event and a pipeline card -- but no `funnel_submissions` row, and
-- the Leads screen reads that table. Somebody who spent three minutes
-- answering thirty-two questions never appeared under the funnel that asked
-- them.
--
-- TWO COLUMNS, both additive. Every existing row is already correct.
--
-- WHY `kind` IS ITS OWN COLUMN AND NOT "quiz_attempt_id IS NOT NULL".
-- Reading a nullable pointer as a type discriminator makes "we could not link
-- the attempt" indistinguishable from "this was a form fill" -- and the row
-- that would be mislabelled is exactly the one something already went wrong
-- for. `kind` is NOT NULL with a default, so it always answers.
--
-- WHY THE SCORE IS NOT COPIED HERE. It is on `quiz_attempts`, which is the row
-- this points at. Copying it would create a second answer to "what did they
-- score" that can drift from the first. And `payload` is defined by 00204 as
-- the visitor's own answers, so the score does not belong in there either --
-- see lib/quizzes/answer-payload.ts.

ALTER TABLE public.funnel_submissions
  ADD COLUMN IF NOT EXISTS kind            text NOT NULL DEFAULT 'form',
  -- ON DELETE SET NULL, matching quiz_attempts.contact_id: erasing an attempt
  -- must not erase the record that a lead came in.
  ADD COLUMN IF NOT EXISTS quiz_attempt_id uuid REFERENCES public.quiz_attempts(id) ON DELETE SET NULL;

-- A CHECK rather than an enum -- the call 00204 made for `status`, for the same
-- reason: this is a short list that gains a member far less often than
-- altering a Postgres enum costs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funnel_submissions_kind_check'
  ) THEN
    ALTER TABLE public.funnel_submissions
      ADD CONSTRAINT funnel_submissions_kind_check
      CHECK (kind IN ('form', 'quiz'));
  END IF;
END $$;

-- ONE COMPLETION, ONE LEAD. The pipeline already dedupes on the attempt id
-- (SOURCE_EVENT_ID_KEYS reads `quiz_attempt_id`); without this, a resubmitted
-- attempt would open no second card but WOULD file a second lead, and the two
-- surfaces would disagree about how many people took the quiz. Partial, so the
-- nulls on every form fill do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS funnel_submissions_quiz_attempt_key
  ON public.funnel_submissions (quiz_attempt_id)
  WHERE quiz_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS funnel_submissions_kind_idx
  ON public.funnel_submissions (kind, created_at DESC);

COMMENT ON COLUMN public.funnel_submissions.kind IS
  'form = a form island capture; quiz = a completed quiz. Never set by the visitor.';
COMMENT ON COLUMN public.funnel_submissions.quiz_attempt_id IS
  'The attempt this lead completed. The score, tier and archetype live there, not here.';
