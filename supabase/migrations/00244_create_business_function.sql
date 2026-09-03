-- supabase/migrations/00244_create_business_function.sql
-- Calendly per coach, phase 1: the function that makes a business EXIST.
--
-- WHY A FUNCTION AND NOT FOUR INSERTS FROM THE DAL. supabase-js cannot open a
-- transaction. A business needs four rows to be usable -- itself, its settings,
-- a host to receive bookings, and an owner membership -- and any subset is a
-- broken tenant: a businesses row with no business_settings row is a business
-- that throws on every screen, because getBusinessSettings() raises when the
-- row is missing rather than returning a default. A plpgsql function body runs
-- in one transaction, so the four rows commit together or not at all. This is
-- the same reason merge_contacts is plpgsql.
--
-- WHY THE HOST'S user_id IS NULL. The business exists before the coach's login
-- does: the operator creates the business, then invites the coach into it. The
-- invite accept path fills user_id in. A host row with a null user_id is a
-- calendar with no owner yet, which is exactly the state between those steps.
--
-- WHY THE CREATOR ALSO GETS AN owner MEMBERSHIP ROW even though role='admin'
-- is treated as an implicit owner of every business: the creator might not be
-- the operator later, and an owner membership is what survives the operator's
-- account being replaced. created_by records the same fact but is nullable
-- (on delete set null, 00240).
--
-- SLUG BECOMES NOT NULL IN THIS SAME DEPLOY, AND THAT IS SAFE -- reasoned, not
-- assumed. A file boundary is not a deploy boundary: apply-migrations.yml runs
-- every pending migration in one unattended pass, so the OLD build serves
-- against the NEW schema for the minutes until Vercel is live. The question is
-- always "can the old build violate this constraint?" Here it cannot, because
-- NOTHING in the current build inserts into businesses at all -- lib/db/
-- businesses.ts exports only getBusinessSettings and updateBusinessSettings,
-- the sole row came from 00212, and its slug was set by 00240. There is no
-- writer that could omit a slug. Contrast 00243, which IS unsafe that way and
-- is therefore a separate pull request: the old build inserts bookings and
-- names neither host_id nor end_at.

-- Every existing row already has a slug (00240 set the singleton's to
-- 'primary'), so this is a constraint on data that already conforms.
alter table public.businesses
  add constraint businesses_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$') not valid;
alter table public.businesses validate constraint businesses_slug_format;
alter table public.businesses alter column slug set not null;

create or replace function public.create_business(
  p_name              text,
  p_slug              text,
  p_timezone          text,
  p_host_display_name text,
  p_host_email        text,
  p_created_by        uuid
) returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses;
begin
  insert into public.businesses (name, slug, status, booking_provider, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), 'active', 'calendly', p_created_by)
  returning * into v_business;

  -- Only business_id is named: every other column has a DEFAULT (00212), and
  -- naming display_name/timezone here keeps the new tenant's identity from
  -- being the empty string on its first screen.
  insert into public.business_settings (business_id, display_name, timezone)
  values (v_business.id, btrim(p_name), p_timezone);

  insert into public.booking_hosts (business_id, user_id, display_name, email, timezone)
  values (v_business.id, null, btrim(p_host_display_name), coalesce(btrim(p_host_email), ''), p_timezone);

  -- p_created_by may be null (a system-created business), in which case there
  -- is no membership row to write. The operator still reaches it: role='admin'
  -- is an implicit owner of every business.
  if p_created_by is not null then
    insert into public.business_members (business_id, user_id, role)
    values (v_business.id, p_created_by, 'owner');
  end if;

  return v_business;
end;
$$;

revoke all on function public.create_business(text, text, text, text, text, uuid) from public;
grant execute on function public.create_business(text, text, text, text, text, uuid) to service_role;
