-- Phase 2a: clinics & camps admin CMS
-- Creates events + event_signups tables and two capacity-guard RPCs.

-- events table -------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('clinic', 'camp')),
  slug text not null unique,
  title text not null,
  summary text not null,
  description text not null,
  focus_areas text[] not null default '{}',
  start_date timestamptz not null,
  end_date timestamptz,
  session_schedule text,
  location_name text not null,
  location_address text,
  location_map_url text,
  age_min int,
  age_max int,
  capacity int not null check (capacity > 0),
  signup_count int not null default 0 check (signup_count >= 0 and signup_count <= capacity),
  price_cents int check (price_cents is null or price_cents >= 0),
  stripe_price_id text,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled', 'completed')),
  hero_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_events_status on events (status);
create index if not exists idx_events_type on events (type);
create index if not exists idx_events_start_date on events (start_date);

-- event_signups table ------------------------------------------------------
create table if not exists event_signups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  signup_type text not null check (signup_type in ('interest', 'paid')),
  parent_name text not null,
  parent_email text not null,
  parent_phone text,
  athlete_name text not null,
  athlete_age int not null,
  sport text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'refunded')),
  stripe_session_id text,
  stripe_payment_intent_id text,
  amount_paid_cents int,
  user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_event_signups_event_id on event_signups (event_id);
create index if not exists idx_event_signups_status on event_signups (status);
create index if not exists idx_event_signups_email on event_signups (parent_email);

-- confirm_event_signup RPC ------------------------------------------------
-- Atomically flips a pending signup to confirmed and increments the event's
-- signup_count. Returns jsonb { ok: bool, reason?: text }.
create or replace function confirm_event_signup(p_signup_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_signup event_signups%rowtype;
  v_capacity int;
  v_signup_count int;
begin
  select * into v_signup from event_signups where id = p_signup_id for update;
  if v_signup is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_signup.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  select capacity, signup_count into v_capacity, v_signup_count
  from events where id = v_signup.event_id for update;

  if v_signup_count >= v_capacity then
    return jsonb_build_object('ok', false, 'reason', 'at_capacity');
  end if;

  update event_signups set status = 'confirmed', updated_at = now() where id = p_signup_id;
  update events set signup_count = signup_count + 1, updated_at = now() where id = v_signup.event_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- cancel_event_signup RPC -------------------------------------------------
-- Flips a pending or confirmed signup to cancelled. If previously confirmed,
-- decrements the event's signup_count. Returns jsonb { ok: bool, reason?: text }.
create or replace function cancel_event_signup(p_signup_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_signup event_signups%rowtype;
  v_was_confirmed boolean;
begin
  select * into v_signup from event_signups where id = p_signup_id for update;
  if v_signup is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_signup.status not in ('pending', 'confirmed') then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;

  v_was_confirmed := v_signup.status = 'confirmed';

  update event_signups set status = 'cancelled', updated_at = now() where id = p_signup_id;

  if v_was_confirmed then
    update events set signup_count = signup_count - 1, updated_at = now() where id = v_signup.event_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Event images storage bucket ---------------------------------------------
insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;
