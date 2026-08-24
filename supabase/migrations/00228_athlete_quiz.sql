-- supabase/migrations/00228_athlete_quiz.sql
-- The Athlete Quiz, rebuilt in the funnel builder.
-- Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §1
--
-- Seven tables. `quizzes` and `quiz_attempts` carry business_id; the five
-- child tables reach it through their parent, which is why only two rows below
-- default it. Duplicating ownership onto a child invites the two copies to
-- disagree after a merge.

CREATE TABLE IF NOT EXISTS public.quizzes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                    REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- Stable slug. The funnel island references the id, but a human — and the
  -- seed script — addresses a quiz by this.
  key             text NOT NULL,
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  intro_headline  text NOT NULL DEFAULT '',
  intro_body      text NOT NULL DEFAULT '',
  gate_headline   text NOT NULL DEFAULT '',
  gate_body       text NOT NULL DEFAULT '',
  result_headline text NOT NULL DEFAULT '',
  -- Set by the seed and cleared the first time a human saves the quiz. It is
  -- what the editor's "these numbers were reconstructed, not recovered" banner
  -- keys on: the weights and tier cutoffs did not survive the GHL export and
  -- nobody should mistake a plausible default for Darren's judgement.
  seed_marker     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, key)
);

-- An archetype. `key` is a CONTRACT, not a label: it is the value a
-- sequence's trigger_filter matches on (`{"branch": "rebuilder"}`), so
-- renaming `name` is free and renaming `key` silently stops enrolment.
CREATE TABLE IF NOT EXISTS public.quiz_branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id     uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  key         text NOT NULL,
  name        text NOT NULL,
  description text,
  position    integer NOT NULL DEFAULT 0,
  UNIQUE (quiz_id, key)
);

-- `branch_id` IS NULLABLE ON PURPOSE, AND THAT IS THE WHOLE ROUTING DESIGN.
-- NULL means "asked of everyone" — which is how the router question itself is
-- stored, and how the shared segmentation questions are. A NOT NULL here would
-- need a second table for shared questions and a union to walk them.
--
-- `position` is GLOBAL across the quiz, not per branch. The walk is every
-- question ordered by position, filtered to (branch_id IS NULL OR branch_id =
-- the walked branch). That is what lets the router sit at 10, shared questions
-- at 20-40, a branch's own at 50-80 and the closer at 90, with no per-branch
-- ordering column and no join to sequence them.
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id    uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  branch_id  uuid REFERENCES public.quiz_branches(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  prompt     text NOT NULL,
  help_text  text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Three columns, each meaningful on a different kind of question:
--
--   weight               every option has one. ALL-ZERO ON A QUESTION IS THE
--                        DOCUMENTED WAY TO MARK IT SEGMENTATION-ONLY: it adds
--                        nothing to the raw score and nothing to the maximum,
--                        so it cannot move the percentage. "Where are you
--                        based?" is not a preparedness question.
--   routes_to_branch_id  only on a question whose branch_id is NULL. This is
--                        what makes the router the router — there is no
--                        is_router flag, because a flag and the routing data
--                        could disagree and then one of them is lying.
--   profile_id           a VOTE. The profile with the most votes wins. One
--                        mechanism covers both an athlete literally picking
--                        their profile (all five votes on one question) and it
--                        being inferred across several.
CREATE TABLE IF NOT EXISTS public.quiz_options (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id         uuid NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  position            integer NOT NULL DEFAULT 0,
  label               text NOT NULL,
  weight              numeric NOT NULL DEFAULT 0,
  routes_to_branch_id uuid REFERENCES public.quiz_branches(id) ON DELETE SET NULL,
  profile_id          uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Bands read the NORMALISED score (0-100), not a raw total, so one band set
-- stays honest across branches with different question counts. Coverage of
-- 0..100 with no gap and no overlap is enforced by quizGate, not here: a
-- CHECK constraint can police one row, and the property is about the set.
CREATE TABLE IF NOT EXISTS public.quiz_tiers (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id   uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  key       text NOT NULL,
  position  integer NOT NULL DEFAULT 0,
  min_score integer NOT NULL CHECK (min_score >= 0 AND min_score <= 100),
  max_score integer NOT NULL CHECK (max_score >= 0 AND max_score <= 100),
  headline  text NOT NULL,
  body      text NOT NULL DEFAULT '',
  cta_label text,
  cta_href  text,
  UNIQUE (quiz_id, key)
);

CREATE TABLE IF NOT EXISTS public.quiz_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id     uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  key         text NOT NULL,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- Position 0 is the no-vote fallback. Seeded as "Not sure where it's
  -- leaking", which is exactly what an answer set with no signal means.
  position    integer NOT NULL DEFAULT 0,
  UNIQUE (quiz_id, key)
);

-- One row per visitor, upserted as they walk.
--
-- THERE IS NO 'abandoned' STATUS. Nothing observes the moment someone gives
-- up, so a row claiming to know would be guessing. An attempt that is
-- in_progress with an old updated_at IS the abandonment, and a report can say
-- so without a writer having to invent the event.
--
-- score/raw_score/max_score are all stored. Keeping max_score is what makes a
-- past result immutable: re-deriving an old percentage from today's weights
-- would let a weight edit silently rewrite what someone was told in March.
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                           REFERENCES public.businesses(id) ON DELETE CASCADE,
  quiz_id                uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  branch_id              uuid REFERENCES public.quiz_branches(id) ON DELETE SET NULL,
  attribution_session_id text,
  answers                jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                 text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  raw_score              numeric,
  max_score              numeric,
  score                  integer,
  tier_key               text,
  profile_key            text,
  -- ON DELETE SET NULL so erasing a contact does not erase the operational
  -- record that the quiz was taken, matching chat_conversations.contact_id.
  contact_id             uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- Whether the Red/Orange operator alert ACTUALLY went out. lib/email.ts
  -- returns a success shape when RESEND_API_KEY is unset, so "we called the
  -- sender" and "somebody was told" are different claims and only one of them
  -- is worth recording.
  alert_status           text NOT NULL DEFAULT 'not_needed' CHECK (alert_status IN ('not_needed','sent','failed')),
  alerted_at             timestamptz,
  started_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_order
  ON public.quiz_questions (quiz_id, position);
CREATE INDEX IF NOT EXISTS idx_quiz_options_order
  ON public.quiz_options (question_id, position);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz
  ON public.quiz_attempts (quiz_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_contact
  ON public.quiz_attempts (contact_id) WHERE contact_id IS NOT NULL;

-- ── Row level security ──────────────────────────────────────────────────────
--
-- WITHOUT THIS, EVERY TABLE ABOVE IS WORLD-READABLE AND WORLD-WRITABLE.
-- Supabase grants `anon` full DML on a public-schema table whose RLS is off,
-- and NEXT_PUBLIC_SUPABASE_ANON_KEY ships inside the browser bundle. Migration
-- 00227 shipped exactly that defect one migration ago: measured on the dev
-- clone, the anon key returned every chat conversation and every message,
-- while contacts / contact_consents / faqs returned nothing.
--
-- quiz_attempts holds the same class of data one table over — what a stranger
-- said about their injury, their rehab, their child's age and development
-- stage — tied to a contact_id. And an open UPDATE would be worse than a
-- disclosure: the score, tier and profile on an attempt decide whether a deal
-- card opens and whether Darren is emailed, so a writable row is a way to
-- manufacture an urgent lead.
--
-- Service role only, matching 00212 / 00213 / 00214 / 00215 / 00227. Nothing
-- reads these tables with the anon key — every access goes through
-- lib/db/quizzes.ts, which uses createServiceRoleClient() — so this costs
-- nothing at all.
ALTER TABLE public.quizzes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_branches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_options   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_tiers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on quizzes"
  ON public.quizzes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on quiz_branches"
  ON public.quiz_branches FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on quiz_questions"
  ON public.quiz_questions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on quiz_options"
  ON public.quiz_options FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on quiz_tiers"
  ON public.quiz_tiers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on quiz_profiles"
  ON public.quiz_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on quiz_attempts"
  ON public.quiz_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);
