create table if not exists public.client_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date_of_birth date,
  gender text check (gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  sport text,
  position text,
  experience_level text check (experience_level in ('beginner', 'intermediate', 'advanced', 'elite')),
  goals text,
  injuries text,
  height_cm numeric,
  weight_kg numeric,
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

alter table public.client_profiles enable row level security;
create policy "Users can view own profile" on public.client_profiles for select using (user_id = auth.uid());
create policy "Users can update own profile" on public.client_profiles for update using (user_id = auth.uid());
create policy "Admins can manage all profiles" on public.client_profiles for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
