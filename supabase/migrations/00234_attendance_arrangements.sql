-- 00234_attendance_arrangements.sql — attendance-only clients (no pack, no money)
--
-- For clients coached in person at a partner facility that bills them through
-- ITS own system. They use the app and are coached here, but buy nothing here,
-- so there is no pack to deduct a credit from. This is deliberately NOT a row in
-- client_packages: that table exists to move money (Stripe, auto-renew, the
-- renewal reminder cron, the bookkeeping income adapter all read it), and an
-- arrangement never involves any. Attendance still lands in session_checkins so
-- a client's training history is one ledger, not two.
--
-- Uses the canonical public.update_updated_at() trigger fn (00012) and mirrors
-- the session_packs RLS style (00170). All access in-app is via the service-role
-- client which bypasses RLS; policies are defense-in-depth.

create table if not exists public.attendance_arrangements (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references public.users(id) on delete cascade,
  -- Free-text on purpose: one facility exists, so a `facilities` table would be
  -- speculative. Shown to the coach as the "who bills this client" reminder.
  label text,
  session_type text not null default 'in_person',
  status text not null default 'active' check (status in ('active','ended')),
  started_on date not null default current_date,
  ended_on date,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one ACTIVE arrangement per client; ended ones accumulate as history.
create unique index if not exists attendance_arrangements_one_active
  on public.attendance_arrangements(client_user_id) where status = 'active';
create index if not exists idx_attendance_arrangements_client
  on public.attendance_arrangements(client_user_id, status);

-- ─── The ledger learns to hold a check-in that burned no credit ──────────────
-- Widening to nullable is the backward-compatible direction: existing code
-- always writes a non-null client_package_id, so this migration can land ahead
-- of the deploy that starts writing arrangement_id.
alter table public.session_checkins alter column client_package_id drop not null;
alter table public.session_checkins
  add column if not exists arrangement_id uuid references public.attendance_arrangements(id) on delete cascade;

-- Exactly one source per row. Passes on every existing row (pack set,
-- arrangement null → num_nonnulls = 1).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'session_checkins_one_source'
  ) then
    alter table public.session_checkins
      add constraint session_checkins_one_source
      check (num_nonnulls(client_package_id, arrangement_id) = 1);
  end if;
end $$;

create index if not exists idx_session_checkins_arrangement
  on public.session_checkins(arrangement_id, checked_in_at desc) where voided = false;

create trigger set_updated_at before update on public.attendance_arrangements
  for each row execute function public.update_updated_at();

-- ─── RLS (defense-in-depth; app uses service-role which bypasses these) ──────
alter table public.attendance_arrangements enable row level security;

create policy "Clients view own arrangement" on public.attendance_arrangements
  for select using (client_user_id = auth.uid());
create policy "Admins manage all arrangements" on public.attendance_arrangements
  for all using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );
