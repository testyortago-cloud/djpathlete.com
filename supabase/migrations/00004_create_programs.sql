create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text not null check (category in ('strength', 'conditioning', 'sport_specific', 'recovery', 'nutrition', 'hybrid')),
  difficulty text not null default 'intermediate' check (difficulty in ('beginner', 'intermediate', 'advanced', 'elite')),
  duration_weeks integer not null default 4,
  sessions_per_week integer not null default 3,
  price_cents integer,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.programs enable row level security;
create policy "Anyone can view active programs" on public.programs for select using (is_active = true);
create policy "Admins can manage programs" on public.programs for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
