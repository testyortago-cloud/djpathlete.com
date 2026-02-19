-- Users table (extends Supabase auth.users)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  first_name text not null,
  last_name text not null,
  role text not null default 'client' check (role in ('admin', 'client')),
  avatar_url text,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.users enable row level security;
create policy "Admins can view all users" on public.users for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
create policy "Users can view own profile" on public.users for select using (id = auth.uid());
create policy "Users can update own profile" on public.users for update using (id = auth.uid());
create policy "Admins can manage all users" on public.users for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
