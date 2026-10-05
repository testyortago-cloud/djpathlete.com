-- 00289_program_library_and_week_release.sql
--
-- Program library (folders of ready-made programs) and weekly week-release.
-- Spec: docs/superpowers/specs/2026-10-05-program-library-and-week-release-design.md
--
-- Additive. Every existing assignment keeps release_base_week NULL, meaning
-- "no schedule, every week visible" (today's behaviour), and the release-clock
-- trigger does nothing for such a row. Safe under the code that predates it.

CREATE TABLE public.program_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX program_folders_business_name_key
  ON public.program_folders (business_id, lower(btrim(name)));
-- Service-role DAL only (lib/db/program-folders.ts); no policies.
ALTER TABLE public.program_folders ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.program_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- A library program ("template") is never sold or assigned directly; "Give to
-- client" copies it. Every template lives in a folder, and the folder carries
-- the tenant, so the library is tenant-scoped although programs is not (G37).
-- RESTRICT: a folder that still holds programs cannot be deleted.
ALTER TABLE public.programs
  ADD COLUMN is_template boolean NOT NULL DEFAULT false,
  ADD COLUMN folder_id uuid REFERENCES public.program_folders(id) ON DELETE RESTRICT;
ALTER TABLE public.programs
  ADD CONSTRAINT programs_template_never_public CHECK (NOT (is_template AND is_public)),
  ADD CONSTRAINT programs_template_has_folder CHECK (
    (is_template AND folder_id IS NOT NULL) OR (NOT is_template AND folder_id IS NULL)
  );
CREATE INDEX programs_folder_id_idx ON public.programs (folder_id) WHERE folder_id IS NOT NULL;

-- Weekly release. release_base_week NULL = no schedule (every week visible).
-- Otherwise weeks 1..base were released before release_anchor_at, and one more
-- week is released every 7 days after it. Anchor NULL with a base = paused.
ALTER TABLE public.program_assignments
  ADD COLUMN release_base_week integer CHECK (release_base_week >= 1),
  ADD COLUMN release_anchor_at timestamptz;

-- Coach override per week: 'auto' follows the schedule, 'shown' opens early,
-- 'hidden' closes it whatever the schedule says.
ALTER TABLE public.program_week_access
  ADD COLUMN visibility text NOT NULL DEFAULT 'auto'
    CHECK (visibility IN ('auto', 'shown', 'hidden'));

-- The release clock runs only while the assignment is "running": active and
-- not awaiting payment. Every status/payment writer (Stripe webhook, admin
-- PATCH, funnel grant) goes through this trigger, so none of them has to
-- remember to pause or resume the clock.
--
-- TWIN: lib/programs/week-visibility.ts releasedThroughWeek() uses the same
-- formula (base + whole weeks since the anchor, never negative). Change both.
CREATE OR REPLACE FUNCTION public.program_assignment_release_clock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  was_running boolean;
  is_running boolean;
BEGIN
  IF NEW.release_base_week IS NULL THEN
    RETURN NEW;
  END IF;

  is_running := NEW.status = 'active' AND NEW.payment_status <> 'pending';

  IF TG_OP = 'INSERT' THEN
    -- Given while payment is pending: the clock starts when they pay.
    IF NOT is_running THEN
      NEW.release_anchor_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  was_running := OLD.status = 'active' AND OLD.payment_status <> 'pending';

  IF was_running AND NOT is_running AND OLD.release_anchor_at IS NOT NULL THEN
    -- Freeze: keep what was released, stop the clock. A client who cancels
    -- after week 1 and returns months later resumes at week 2, not week 9.
    NEW.release_base_week := NEW.release_base_week
      + greatest(0, floor(extract(epoch FROM (now() - OLD.release_anchor_at)) / 604800))::integer;
    NEW.release_anchor_at := NULL;
  ELSIF NOT was_running AND is_running AND NEW.release_anchor_at IS NULL THEN
    NEW.release_anchor_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER program_assignment_release_clock
  BEFORE INSERT OR UPDATE OF status, payment_status ON public.program_assignments
  FOR EACH ROW EXECUTE FUNCTION public.program_assignment_release_clock();
