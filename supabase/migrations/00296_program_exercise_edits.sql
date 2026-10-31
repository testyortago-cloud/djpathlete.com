-- Exercise changes a coach makes to AI-generated programs, so the generator can learn from them.
--
-- Why: the owner (2026-10-31) asked for a log of how often Darren changes an exercise the AI picked, and for the
-- program generator to learn from it. Each time the coach takes out an exercise the AI placed, the generator
-- ranks that exercise lower for this coach; each time the coach puts one in, higher.
--
-- WRITERS: app/api/admin/programs/[id]/exercises/route.ts (added) and
-- app/api/admin/programs/[id]/exercises/[exerciseId]/route.ts (removed), via lib/db/program-exercise-edits.ts.
-- Only programs with is_ai_generated; moves, set/rep edits, and bulk week/day clears or copies are not logged.
-- READERS: functions/src/ai/edit-learning.ts (the generator's ranking) and lib/db/program-exercise-edits.ts
-- (Settings > AI Program Policy, "Learned from your edits"). Both read by coach_id. Service role only.

create table if not exists public.program_exercise_edits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- The coach who made the change; the generator learns per coach.
  coach_id uuid not null references public.users(id) on delete cascade,
  -- Kept after the program is deleted: the lesson outlives the program.
  program_id uuid references public.programs(id) on delete set null,
  client_id uuid references public.users(id) on delete set null,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  action text not null check (action in ('removed', 'added')),
  -- removed: the AI had placed this exercise (program_exercises.slot_role was set). A coach removing one they
  -- added themselves is not a verdict on the AI, so the generator ignores it.
  ai_pick boolean not null default false,
  week_number int,
  day_of_week int,
  created_at timestamptz not null default now()
);

create index if not exists program_exercise_edits_coach_created
  on public.program_exercise_edits (coach_id, created_at desc);

alter table public.program_exercise_edits enable row level security;
drop policy if exists "Service role only" on public.program_exercise_edits;
create policy "Service role only" on public.program_exercise_edits for all using (false);

insert into public.system_settings (key, value, description)
values (
  'ai_learn_from_edits_enabled',
  'true'::jsonb,
  'When true, the AI program generator ranks exercises the coach keeps taking out of AI programs lower, and ones the coach puts in higher (program_exercise_edits).'
)
on conflict (key) do nothing;
