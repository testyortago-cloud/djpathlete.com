-- 00171_session_pack_program_link.sql — tie a pack to a program, and a check-in to a workout day.
-- NOTE: written but NOT applied to the live DB until approved. Apply BEFORE deploying the
-- reader code (the live check-in/sell paths read these columns).

alter table public.client_packages
  add column if not exists assignment_id uuid references public.program_assignments(id) on delete set null;

alter table public.session_checkins
  add column if not exists workout_session_id uuid references public.workout_sessions(id) on delete set null;

create index if not exists idx_client_packages_assignment on public.client_packages(assignment_id);
