create table if not exists public.program_exercises (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 1 and 7),
  week_number integer not null default 1,
  order_index integer not null default 0,
  sets integer,
  reps text,
  duration_seconds integer,
  rest_seconds integer,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.program_exercises enable row level security;
create policy "Anyone can view program exercises" on public.program_exercises for select using (true);
create policy "Admins can manage program exercises" on public.program_exercises for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
