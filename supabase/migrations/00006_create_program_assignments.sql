create table if not exists public.program_assignments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  assigned_by uuid references public.users(id),
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.program_assignments enable row level security;
create policy "Users can view own assignments" on public.program_assignments for select using (user_id = auth.uid());
create policy "Admins can manage assignments" on public.program_assignments for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
