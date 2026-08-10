-- 00204_funnel_lead_lifecycle.sql
--
-- Makes a captured lead something you can WORK, not just something that was
-- stored. Until now `funnel_submissions` was write-only in the strictest
-- sense: `listSubmissions()` existed in the DAL and was imported by no file in
-- the repo, and nothing anywhere emailed when a lead arrived.
--
-- Three columns and an index. Additive and non-destructive: every existing row
-- becomes `status = 'new'`, which is exactly what it is.
--
-- WHY THE COACH-SIDE STATE LIVES IN COLUMNS AND NOT IN `payload`.
-- `payload` is the VISITOR's answers, verbatim, as they typed them. Mixing the
-- operator's follow-up state into it would mean the record of what someone
-- said stops being a record of what someone said — and every future reader of
-- that jsonb has to know which keys are theirs and which are ours.

ALTER TABLE public.funnel_submissions
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS notes             text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

-- A CHECK rather than an enum type: the three values are a workflow, and a
-- workflow gains a step far more often than a domain gains a member. Altering a
-- check constraint is a one-line migration; altering an enum in Postgres is not.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funnel_submissions_status_check'
  ) THEN
    ALTER TABLE public.funnel_submissions
      ADD CONSTRAINT funnel_submissions_status_check
      CHECK (status IN ('new', 'contacted', 'signed_up'));
  END IF;
END $$;

-- The inbox's default view is "new leads, newest first", and this is a growth
-- table.
CREATE INDEX IF NOT EXISTS funnel_submissions_status_idx
  ON public.funnel_submissions (status, created_at DESC);

COMMENT ON COLUMN public.funnel_submissions.status IS
  'Coach-side follow-up state: new | contacted | signed_up. Never set by the visitor.';
COMMENT ON COLUMN public.funnel_submissions.notes IS
  'Coach-side free text. The visitor''s own answers stay in payload, untouched.';
COMMENT ON COLUMN public.funnel_submissions.status_changed_at IS
  'When status last moved. Null means it has never moved off ''new''.';
