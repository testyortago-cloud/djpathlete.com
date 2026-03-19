-- Add expires_at to program_assignments for time-limited access
-- When set and past, the client loses access and must re-purchase/subscribe

ALTER TABLE public.program_assignments
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
