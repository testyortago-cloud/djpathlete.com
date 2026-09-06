-- supabase/migrations/00252_events_business_id.sql
-- Tenancy phase 5a: events and their signups carry a tenant.
--
-- THE RACE. On push to main this applies while Vercel is still building.
-- Old code + new schema: createEvent inserts no business_id, and the DEFAULT
-- below is what keeps that insert from failing 23502. New code + old schema
-- cannot happen (the code ships after the migration in every ordering that
-- matters here, and a missing column fails loudly rather than silently).
--
-- THE DEFAULT MUST OUTLIVE THIS DEPLOY. Dropping it belongs in a LATER
-- branch, once every writer stamps business_id explicitly. It cannot be
-- dropped in a second migration in THIS branch: the migration Action applies
-- every pending migration in one run, so the default would never exist during
-- the window it was added for.
--
-- NOT NULL is safe immediately because Postgres applies a non-volatile
-- default to existing rows without a table rewrite, so the existing events and
-- signups are backfilled by the ADD COLUMN itself. No separate backfill.

alter table public.events
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

-- Sole purpose: be the target of event_signups' composite FK below. Postgres
-- requires a unique constraint on the referenced columns.
alter table public.events
  add constraint events_id_business_id_key unique (id, business_id);

-- Per-tenant slugs. Two coaches both wanting /camps/summer-camp is the first
-- day of the second tenant, not an edge case. Case-sensitivity is unchanged
-- from events_slug_key deliberately; funnels uses lower(slug) and reconciling
-- the two is a separate change, not one to smuggle into a tenancy migration.
alter table public.events drop constraint events_slug_key;
alter table public.events
  add constraint events_business_id_slug_key unique (business_id, slug);

create index events_business_status_end_idx
  on public.events (business_id, status, end_date);

alter table public.event_signups
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001';

-- A signup's tenant cannot drift from its event's: the pair must exist in
-- events. This is why events_id_business_id_key above exists.
--
-- ON DELETE CASCADE is inherited from event_signups_event_id_fkey below, not
-- a new choice. deleteEvent(id, {force:true}) in lib/db/events.ts and the
-- admin delete-event confirm dialog both depend on the FK cascading signups
-- away; dropping this clause here would silently turn that force-delete into
-- a foreign_key_violation. Keep it on any future edit of this constraint.
alter table public.event_signups
  add constraint event_signups_event_business_fkey
    foreign key (event_id, business_id)
    references public.events (id, business_id)
    on delete cascade;

-- REQUIRED, not tidy-up. PostgREST picks an embed by finding THE foreign key
-- between two tables; with both this and the composite FK above it answers
-- PGRST201 ("more than one relationship was found") instead of rows, breaking
-- lib/db/bookkeeping.ts's income read and a functions/ admin tool that embed
-- events from event_signups. Verified on the dev clone 2026-09-06: the embed
-- resolves across the composite FK alone, and fails PGRST201 with both
-- present. The composite FK implies this one (events.id is the primary key),
-- so dropping it loses no integrity.
alter table public.event_signups drop constraint event_signups_event_id_fkey;

-- The two signup RPCs gain a tenant argument. DROP first: CREATE OR REPLACE
-- cannot change a signature, and adding an argument would create an OVERLOAD,
-- leaving the unguarded one-argument version callable — which is the whole
-- hole this closes. No TypeScript predicate reaches inside a plpgsql body, so
-- the argument is the only thing that can enforce the tenant here.
drop function if exists public.confirm_event_signup(uuid);
drop function if exists public.cancel_event_signup(uuid);

create function public.confirm_event_signup(p_signup_id uuid, p_business_id uuid)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_signup event_signups%rowtype;
  v_capacity int;
  v_signup_count int;
begin
  select * into v_signup from event_signups
   where id = p_signup_id and business_id = p_business_id for update;
  if not found then
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
$function$;

create function public.cancel_event_signup(p_signup_id uuid, p_business_id uuid)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_signup event_signups%rowtype;
  v_was_confirmed boolean;
begin
  select * into v_signup from event_signups
   where id = p_signup_id and business_id = p_business_id for update;
  if not found then
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
$function$;
