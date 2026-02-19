create table if not exists public.exercise_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  assignment_id uuid references public.program_assignments(id) on delete set null,
  completed_at timestamptz not null default now(),
  sets_completed integer,
  reps_completed text,
  weight_kg numeric,
  duration_seconds integer,
  rpe integer check (rpe between 1 and 10),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.exercise_progress enable row level security;
create policy "Users can view own progress" on public.exercise_progress for select using (user_id = auth.uid());
create policy "Users can insert own progress" on public.exercise_progress for insert with check (user_id = auth.uid());
create policy "Admins can manage all progress" on public.exercise_progress for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
