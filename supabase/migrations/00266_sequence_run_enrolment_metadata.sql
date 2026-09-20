-- 00266 — sequence_runs.enrolment_metadata (Lead Engine gap G10)
--
-- WHAT A RUN COULD NOT REMEMBER UNTIL NOW. The only fact about "why is this
-- person in this sequence" the engine could branch on was `source_is`, which
-- reads the SEQUENCE's own trigger_source — identical for everyone in that
-- sequence. So nothing could tell a camp enquiry from a coaching enquiry, or
-- a parent filling a form in on a child's behalf from an adult filling it in
-- for themselves. Both are quoted behaviours.
--
-- THE WRITER is `insertSequenceRun` in lib/lead-engine/enroll.ts — the ONE
-- place a `sequence_runs` row is ever inserted, shared by the triggered and
-- the manual enrolment paths. It writes the output of `pickEnrolmentMetadata`
-- (lib/lead-engine/enrolment-metadata.ts): an allow-list of seven keys
-- (service, role, event_kind, branch, tier, quiz_key, camp_name), never the
-- raw event payload — which, on the funnel path, is the visitor's entire
-- typed submission.
--
-- THE READERS, both named because a column with no reader is a labelling gap:
--   1. `evaluateBranch` (lib/automation/sequence-tick.ts), via
--      `DecisionContext.enrolmentMetadata`, which `loadRunContext`
--      (lib/db/sequences.ts) fills from the claimed run row. That is what
--      makes the new `{kind:"enrolled_metadata_is", key, value}` branch
--      predicate answerable.
--   2. The merge-field renderer planned as G16, so a message can say WHICH
--      camp or WHICH service without a second lookup. Not built yet; named
--      here so this column is not later mistaken for having one reader.
--
-- NOT NULL DEFAULT '{}' rather than a nullable column: every read site then
-- gets an object, and "this run remembers nothing" and "this run predates the
-- column" are the same answer to a branch — false. Existing rows backfill to
-- '{}' by the default, which is exactly right: they were enrolled before
-- anything was recorded, and pretending otherwise would be inventing data.
--
-- NO INDEX. The only reader loads the run row it has already claimed by
-- primary key; nothing queries BY this column. An index here would be
-- maintenance cost for no query. Add one when a screen filters on it.
--
-- NO business_id: `sequence_runs` already carries one (00216), and every
-- reader of this column reaches it through a row already scoped by it.
--
-- DEPLOY RACE. Vercel and the migration workflow race on merge to main, so
-- the code shipping alongside this must work for one deploy against a table
-- WITHOUT the column. It does, in both directions:
--   - the write: `insertSequenceRun` retries the insert without the key on
--     PostgREST's PGRST204 / Postgres' 42703, so an enrolment during the
--     window still creates its run (it just remembers nothing).
--   - the read: `claim_sequence_runs` (00217/00256) is
--     `RETURNS SETOF public.sequence_runs ... RETURNING r.*`, so it picks the
--     new column up with no function change at all; before the migration the
--     key is simply absent from the row, and `loadRunContext` reads it as
--     `?? {}` rather than testing it against null (an absent key is
--     `undefined`, and `undefined !== null`).

ALTER TABLE public.sequence_runs
  ADD COLUMN IF NOT EXISTS enrolment_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.sequence_runs.enrolment_metadata IS
  'G10. Allow-listed facts about the event that enrolled this run (service, role, event_kind, branch, tier, quiz_key, camp_name), written by lib/lead-engine/enroll.ts via pickEnrolmentMetadata. Never the raw event payload, and never an email or phone. Read by evaluateBranch''s enrolled_metadata_is predicate.';
