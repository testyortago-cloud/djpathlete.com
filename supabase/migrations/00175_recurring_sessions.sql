-- 00175_recurring_sessions.sql — recurring in-person standing slots + attendance
-- NOTE: written but NOT applied to the live DB until approved.
-- Attendance is DECOUPLED from session packs: a scheduled session can be marked
-- attended with or without a credit burn. Uses the canonical
-- public.update_updated_at() trigger fn (00012). All in-app access is via the
-- service-role client (RLS bypassed); policies are defense-in-depth.

-- ─── Standing slot (one row per client × weekday × time) ─────────────────────
create table if not exists public.recurring_sessions (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references public.users(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0=Sun..6=Sat
  start_time time not null,
  duration_minutes int not null default 60 check (duration_minutes > 0),
  location text,
  notes text,
  status text not null default 'active' check (status in ('active','paused')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_recurring_sessions_client on public.recurring_sessions(client_user_id, status);
create index if not exists idx_recurring_sessions_active_dow on public.recurring_sessions(status, day_of_week);

-- ─── Concrete dated occurrences generated from the template ──────────────────
create table if not exists public.scheduled_sessions (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references public.users(id) on delete cascade,
  recurring_session_id uuid references public.recurring_sessions(id) on delete set null, -- null = ad-hoc / walk-in
  session_date date not null,
  start_time time not null,
  duration_minutes int not null default 60 check (duration_minutes > 0),
  status text not null default 'scheduled' check (status in ('scheduled','attended','no_show','cancelled')),
  attended_at timestamptz,
  checkin_id uuid references public.session_checkins(id) on delete set null, -- set only if a credit was also burned
  cancelled_at timestamptz,
  cancel_reason text,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_user_id, session_date, start_time)
);
create index if not exists idx_scheduled_sessions_date_status on public.scheduled_sessions(session_date, status);
create index if not exists idx_scheduled_sessions_client_date on public.scheduled_sessions(client_user_id, session_date);

-- ─── updated_at triggers ─────────────────────────────────────────────────────
create trigger set_updated_at before update on public.recurring_sessions
  for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.scheduled_sessions
  for each row execute function public.update_updated_at();

-- ─── RLS (defense-in-depth; app uses service-role) ───────────────────────────
alter table public.recurring_sessions enable row level security;
alter table public.scheduled_sessions enable row level security;

-- Clients may read their own sessions; writes happen via service-role only.
create policy recurring_sessions_own_read on public.recurring_sessions
  for select using (auth.uid() = client_user_id);
create policy scheduled_sessions_own_read on public.scheduled_sessions
  for select using (auth.uid() = client_user_id);
