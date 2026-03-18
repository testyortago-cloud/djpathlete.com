-- Drop the target_user_id column from programs.
-- Audience is now simplified to public (is_public=true) vs private (is_public=false).
-- Private program visibility is controlled entirely through program_assignments.
ALTER TABLE public.programs DROP COLUMN IF EXISTS target_user_id;
