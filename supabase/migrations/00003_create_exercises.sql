create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text not null check (category in ('strength', 'cardio', 'flexibility', 'plyometric', 'sport_specific', 'recovery')),
  muscle_group text,
  difficulty text not null default 'intermediate' check (difficulty in ('beginner', 'intermediate', 'advanced')),
  equipment text,
  video_url text,
  thumbnail_url text,
  instructions text,
  created_by uuid references public.users(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.exercises enable row level security;
create policy "Anyone can view active exercises" on public.exercises for select using (is_active = true);
create policy "Admins can manage exercises" on public.exercises for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
