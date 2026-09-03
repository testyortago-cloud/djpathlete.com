-- supabase/migrations/00240_booking_tenancy_tables.sql
-- Calendly per coach, phase 0a: the tables that make a second coach possible.
--
-- WHY THIS EXISTS. There is no coach role and no coach_id anywhere in the lead
-- or booking schema; "multi-coach" has no column to key on today. A coach IS a
-- business (the tenant nineteen tables already hang off), and the person whose
-- calendar a booking lands on is a HOST. Membership carries access; hosts carry
-- calendars. That is why business_members and booking_hosts are two tables and
-- not one, and why neither is a new value in users.role -- widening that enum
-- makes every exhaustive two-branch conditional in the admin a latent bug.
--
-- WHY A NEW CONNECTION TABLE AND NOT platform_connections. That table's
-- plugin_name is UNIQUE with no tenant column, its Vault secret is named after
-- the plugin alone, and fn_connect_platform OVERWRITES the secret in place --
-- so a second coach connecting the same provider silently replaces the first
-- coach's token. Not an error. A silent token swap. Widening it means rewriting
-- four fn_* signatures that CREATE OR REPLACE cannot alter, 41 DAL call sites
-- and a Firebase twin; at that point it is a new table with an old name.
--
-- WHY coach_calendar_connections IS KEYED ON THE HOST, NOT THE BUSINESS. It
-- carries both ids and a COMPOSITE foreign key into booking_hosts(id,
-- business_id). Denormalising business_id beside a host_id with nothing tying
-- them together lets a row name business A and a host in business B, and every
-- .eq("business_id", ...) read then quietly returns the wrong coach's calendar.
-- One host per business today; keying on the host means "two coaches in one
-- business" is a row, not a migration.
--
-- WHAT IS NOT HERE. No fn_* RPC quartet -- its caller is the phase 2 OAuth
-- callback, and an RPC with no caller is a reader-less column. No btree_gist
-- and no exclusion constraint: Calendly arbitrates every booking on this path,
-- and a 23P01 raised inside our webhook returns 5xx to Calendly, whose retry
-- policy DISABLES the subscription after 24 hours of failure. A constraint that
-- can silently kill a coach's booking feed is worse than no constraint.
--
-- booking_availability_rules / _overrides and booking_notifications have NO
-- WRITER in this build. The two availability tables are the native path's and
-- are created because they are shared and cheap; booking_notifications waits
-- for phase 4's optional coach-branded courtesy email, which will have to widen
-- its `kind` CHECK -- the six values below are the native path's and none of
-- them names a courtesy note sent beside Calendly's own confirmation.
--
-- Validated against the dev clone inside begin/rollback on 2026-09-03: all
-- eight tables create, rollback verified clean. Postgres is 17.6, so
-- `unique nulls not distinct` on booking_notifications is available.

alter table public.businesses
  add column if not exists slug             text unique,
  add column if not exists status           text not null default 'active'   check (status in ('active','paused')),
  add column if not exists booking_provider text not null default 'calendly' check (booking_provider in ('calendly','native')),
  add column if not exists created_by       uuid references public.users(id) on delete set null;

-- slug is nullable for the one deploy the migration and Vercel race across. A
-- UNIQUE column admits any number of NULLs, so a second business with no slug
-- has no address and two of them collide in code rather than in the database.
-- A later migration backfills every row, adds
--   check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
-- and sets it not null.
update public.businesses set slug = 'primary'
 where id = '00000000-0000-0000-0000-000000000001' and slug is null;

create table if not exists public.booking_hosts (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  user_id               uuid references public.users(id) on delete set null,
  display_name          text not null,
  email                 text not null,                 -- replies land here; '' is allowed, as in business_settings
  timezone              text not null,                 -- IANA; validated in Zod, not by the DB
  location_kind         text not null default 'video' check (location_kind in ('video','phone','in_person','custom')),
  location_value        text not null default '',
  slot_interval_minutes smallint not null default 30   check (slot_interval_minutes in (10,15,20,30,60)),
  min_notice_minutes    integer  not null default 1440 check (min_notice_minutes >= 0),
  max_horizon_days      smallint not null default 30   check (max_horizon_days between 1 and 90),
  buffer_before_minutes smallint not null default 0    check (buffer_before_minutes >= 0),
  buffer_after_minutes  smallint not null default 0    check (buffer_after_minutes >= 0),
  daily_cap             smallint                       check (daily_cap is null or daily_cap >= 1),
  status                text not null default 'active' check (status in ('active','paused')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- The composite key exists so the children below can carry a two-column FK.
create unique index if not exists booking_hosts_id_business_key on public.booking_hosts (id, business_id);
create index if not exists booking_hosts_business_id on public.booking_hosts (business_id);

create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  role        text not null check (role in ('owner','coach','staff')),
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index if not exists business_members_user_id on public.business_members (user_id);

create table if not exists public.business_domains (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  host             text not null unique,   -- 'coach.example.com', lowercase, no scheme, no port
  kind             text not null default 'primary' check (kind in ('primary','alias')),
  verified_at      timestamptz,
  vercel_domain_id text,
  created_at       timestamptz not null default now()
);
create index if not exists business_domains_business_id on public.business_domains (business_id);

create table if not exists public.booking_types (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  host_id          uuid not null,
  slug             text not null,
  name             text not null,
  duration_minutes smallint not null check (duration_minutes between 5 and 480),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (business_id, slug),
  foreign key (host_id, business_id) references public.booking_hosts(id, business_id) on delete cascade
);

-- Weekly windows in the HOST's local wall-clock time. No instants here: a rule
-- is "Mondays 09:00-17:00", and which instants that means on a given Monday is
-- an engine's job, because of DST. Same-day only: the CHECK forbids an
-- overnight window, so a coach taking 21:00-01:00 calls writes two rows.
create table if not exists public.booking_availability_rules (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references public.booking_hosts(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),   -- 0 = Sunday, as Intl reports it
  start_local time not null,
  end_local   time not null,
  check (end_local > start_local)
);
create index if not exists booking_availability_rules_host_weekday
  on public.booking_availability_rules (host_id, weekday);

-- A 'closed' row carries no times. The looser CHECK would have admitted
-- ('closed', 09:00, 17:00) -- the natural shape for a partial-day closure --
-- which an engine reads as a whole-day closure, silently discarding the times.
create table if not exists public.booking_availability_overrides (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references public.booking_hosts(id) on delete cascade,
  local_date  date not null,
  kind        text not null check (kind in ('closed','open')),
  start_local time,
  end_local   time,
  check (
    (kind = 'closed' and start_local is null and end_local is null)
    or (kind = 'open' and start_local is not null and end_local is not null and end_local > start_local)
  )
);
create index if not exists booking_availability_overrides_host_date
  on public.booking_availability_overrides (host_id, local_date);

create table if not exists public.coach_calendar_connections (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references public.businesses(id) on delete cascade,
  host_id                   uuid not null,
  provider                  text not null check (provider in ('calendly')),   -- 'google' later
  status                    text not null default 'not_connected'
                              check (status in ('not_connected','connected','needs_reconnect','plan_lapsed','error')),
  -- vault.secrets id. The secret is NAMED
  --   'coach_calendar_connections:' || business_id || ':' || host_id || ':' || provider
  -- -- tenant- AND host-qualified, so a second host in one business cannot
  -- overwrite the first's token, which is exactly what platform_connections
  -- does today with an untenanted name.
  credentials_secret_id     uuid,
  calendly_user_uri         text,
  calendly_organization_uri text,
  calendly_role             text,        -- 'owner'|'admin'|'user'; org-scope calls need admin
  granted_scopes            text[] not null default '{}',   -- from /oauth/introspect; users may decline scopes
  event_type_uri            text,
  scheduling_url            text,
  webhook_subscription_uri  text,
  webhook_state             text,        -- mirrored from GET /webhook_subscriptions; disabled after 24h of failure
  webhook_checked_at        timestamptz,
  last_refresh_at           timestamptz,
  last_error                text,
  connected_by              uuid references public.users(id) on delete set null,
  connected_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (host_id, provider),
  foreign key (host_id, business_id) references public.booking_hosts(id, business_id) on delete cascade
);
create index if not exists coach_calendar_connections_business_id
  on public.coach_calendar_connections (business_id);
-- Phase 2's webhook proves the tenant by matching the delivery's event_type
-- against this row. That proof is only sound if one event type cannot belong to
-- two connections.
create unique index if not exists coach_calendar_connections_event_type_key
  on public.coach_calendar_connections (event_type_uri) where event_type_uri is not null;

create table if not exists public.booking_notifications (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses(id) on delete cascade,
  booking_id              uuid not null references public.bookings(id) on delete cascade,
  kind                    text not null check (kind in ('confirmation','rescheduled','cancelled','reminder','host_new','host_cancelled')),
  reminder_offset_minutes integer,                 -- null except when kind = 'reminder'
  sequence                integer not null default 0,
  scheduled_for           timestamptz not null default now(),
  status                  text not null default 'queued' check (status in ('queued','sent','failed','cancelled')),
  claimed_at              timestamptz,
  claimed_by              text,
  attempts                integer not null default 0,
  provider_message_id     text,
  error_name              text,
  status_code             integer,
  sent_at                 timestamptz,
  created_at              timestamptz not null default now(),
  -- NULLS NOT DISTINCT is load-bearing. reminder_offset_minutes is NULL for the
  -- five non-reminder kinds, and a plain UNIQUE treats NULLs as distinct -- so
  -- two 'confirmation' rows for one booking would both insert and a retry would
  -- send a second confirmation. Needs Postgres 15+; the clone is 17.6.
  unique nulls not distinct (booking_id, kind, sequence, reminder_offset_minutes)
);
create index if not exists booking_notifications_due
  on public.booking_notifications (business_id, status, scheduled_for);

alter table public.booking_hosts                   enable row level security;
alter table public.business_members                enable row level security;
alter table public.business_domains                enable row level security;
alter table public.booking_types                   enable row level security;
alter table public.booking_availability_rules      enable row level security;
alter table public.booking_availability_overrides  enable row level security;
alter table public.coach_calendar_connections      enable row level security;
alter table public.booking_notifications           enable row level security;

-- NOTE: CREATE POLICY has no IF NOT EXISTS in Postgres, so these statements are
-- NOT re-runnable. Any local applier that replays migrations must carry its own
-- DROP POLICY guard -- do not add one to this file, or a replay would silently
-- drop and recreate a live policy.
create policy "Service role full access on booking_hosts"
  on public.booking_hosts for all to service_role using (true) with check (true);
create policy "Service role full access on business_members"
  on public.business_members for all to service_role using (true) with check (true);
create policy "Service role full access on business_domains"
  on public.business_domains for all to service_role using (true) with check (true);
create policy "Service role full access on booking_types"
  on public.booking_types for all to service_role using (true) with check (true);
create policy "Service role full access on booking_availability_rules"
  on public.booking_availability_rules for all to service_role using (true) with check (true);
create policy "Service role full access on booking_availability_overrides"
  on public.booking_availability_overrides for all to service_role using (true) with check (true);
create policy "Service role full access on coach_calendar_connections"
  on public.coach_calendar_connections for all to service_role using (true) with check (true);
create policy "Service role full access on booking_notifications"
  on public.booking_notifications for all to service_role using (true) with check (true);

-- BACKFILL 1: every current admin becomes an OWNER of the singleton.
--
-- Not "one owner". The code change that follows this migration narrows the
-- booking notification fan-out from `users where role='admin'` to this
-- business's members. Backfilling a single owner would silently stop notifying
-- every other admin -- a behaviour change wearing a tenancy fix's clothes.
-- Written so the number of admins does not matter.
insert into public.business_members (business_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', u.id, 'owner'
  from public.users u
 where u.role = 'admin'
on conflict (business_id, user_id) do nothing;

-- BACKFILL 2: one host for the singleton, identity from business_settings.
insert into public.booking_hosts (business_id, user_id, display_name, email, timezone)
select bs.business_id,
       (select id from public.users where role = 'admin' order by created_at limit 1),
       coalesce(nullif(bs.display_name, ''), b.name),
       coalesce(nullif(bs.reply_to, ''), nullif(bs.sender_email, ''), ''),
       bs.timezone
  from public.business_settings bs
  join public.businesses b on b.id = bs.business_id
 where bs.business_id = '00000000-0000-0000-0000-000000000001'
   and not exists (select 1 from public.booking_hosts h where h.business_id = bs.business_id);
