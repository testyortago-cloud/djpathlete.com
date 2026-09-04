-- supabase/migrations/00250_coach_calendar_connection_functions.sql
-- Calendly per coach, phase 2: the writer for coach_calendar_connections.
--
-- 00240 created that table and deliberately shipped no RPCs, because "an RPC
-- with no caller is a reader-less column". Its caller now exists: the OAuth
-- callback at /api/admin/bookings/calendar/callback.
--
-- WHY A SECOND QUARTET AND NOT THE platform_connections ONE. fn_connect_platform
-- names its vault secret after the plugin ALONE, so a second tenant connecting
-- the same provider silently overwrites the first tenant's token -- not an
-- error, a silent token swap. The secret name below is tenant- AND
-- host-qualified, exactly as 00240's comment specifies.
--
-- THE ALIASING IS NOT COSMETIC. RETURNS TABLE(id uuid, ...) declares `id` as a
-- plpgsql output variable, which collides with vault.secrets.id inside
-- UPDATE/DELETE. That exact bug shipped once already and needed 00090 to fix
-- it; every statement here that touches vault.secrets is aliased from the start.
--
-- TWO MORE INSTANCES OF THE SAME BUG CLASS, FOUND BY ACTUALLY CALLING THESE
-- FUNCTIONS, NOT JUST CREATING THEM. `CREATE FUNCTION` does not validate a
-- plpgsql body's embedded SQL; both surfaced only at CALL time:
--   1. `on conflict (host_id, provider)` -- the bare column-list form -- also
--      collides with RETURNS TABLE's output variables, because the conflict
--      target's identifiers are parsed as expressions. Fixed by naming the
--      constraint instead (`on conflict on constraint
--      coach_calendar_connections_host_id_provider_key`), which has no bare
--      column identifiers left for plpgsql to trip on.
--   2. A raw `update vault.secrets set secret = ...` -- the exact form 00089
--      uses for platform_connections -- fails with `permission denied for
--      table secrets`: neither the function owner nor service_role holds
--      UPDATE on vault.secrets in this project (confirmed by inspecting
--      information_schema.role_table_grants), only SELECT/DELETE/REFERENCES/
--      TRUNCATE. vault.update_secret() is vault's own supabase_admin-owned
--      SECURITY DEFINER write path and is used here instead; DELETE stays a
--      raw statement because DELETE on vault.secrets IS granted.
--
-- RE-RUNNABLE. Every statement is ADD COLUMN IF NOT EXISTS or CREATE OR REPLACE
-- FUNCTION. No CREATE POLICY (00240 already enabled RLS and wrote the
-- service_role policy for this table), so a local applier needs no DROP guard.

alter table public.coach_calendar_connections
  -- Calendly access tokens last about two hours. Storing the expiry lets the
  -- accessor refresh BEFORE a call fails, instead of discovering expiry as a
  -- 401 in the middle of an availability read the assistant then reports to a
  -- visitor as "calendar unreachable".
  add column if not exists access_token_expires_at     timestamptz,
  -- The coach's own confirmation that "Check for conflicts" is on in their
  -- Calendly. NO API EXPOSES THAT SETTING -- it is this design's one genuine
  -- blind spot, and the coach's eyes are the only instrument. A timestamp
  -- makes the confirmation auditable rather than a piece of copy nobody can
  -- prove was ever read.
  add column if not exists conflict_check_confirmed_at timestamptz;

-- fn_get_coach_calendar_connection
-- Keyed on (host_id, provider) because 00240 declares `unique (host_id,
-- provider)`: the HOST is the key and business_id rides along for the
-- composite FK. Keying on business_id alone would return an arbitrary row the
-- moment a business has two hosts.
create or replace function public.fn_get_coach_calendar_connection(
  p_host_id  uuid,
  p_provider text
)
returns table (
  id                          uuid,
  business_id                 uuid,
  host_id                     uuid,
  provider                    text,
  status                      text,
  credentials                 jsonb,
  calendly_user_uri           text,
  calendly_organization_uri   text,
  calendly_role               text,
  granted_scopes              text[],
  event_type_uri              text,
  scheduling_url              text,
  webhook_subscription_uri    text,
  webhook_state               text,
  webhook_checked_at          timestamptz,
  access_token_expires_at     timestamptz,
  conflict_check_confirmed_at timestamptz,
  last_refresh_at             timestamptz,
  last_error                  text,
  connected_by                uuid,
  connected_at                timestamptz,
  created_at                  timestamptz,
  updated_at                  timestamptz
)
language sql
security definer
set search_path = public, vault
as $$
  select
    c.id, c.business_id, c.host_id, c.provider, c.status,
    coalesce(
      (select ds.decrypted_secret::jsonb from vault.decrypted_secrets ds
        where ds.id = c.credentials_secret_id),
      '{}'::jsonb
    ) as credentials,
    c.calendly_user_uri, c.calendly_organization_uri, c.calendly_role,
    c.granted_scopes, c.event_type_uri, c.scheduling_url,
    c.webhook_subscription_uri, c.webhook_state, c.webhook_checked_at,
    c.access_token_expires_at, c.conflict_check_confirmed_at,
    c.last_refresh_at, c.last_error, c.connected_by, c.connected_at,
    c.created_at, c.updated_at
  from public.coach_calendar_connections c
  where c.host_id = p_host_id and c.provider = p_provider;
$$;

-- fn_list_coach_calendar_connections
-- DOES NOT DECRYPT. fn_list_platform_connections returns credentials for every
-- row because its one caller predates the split; a list screen has no business
-- holding tokens, and a function that returns them invites a caller that logs
-- them.
create or replace function public.fn_list_coach_calendar_connections(
  p_business_id uuid
)
returns table (
  id                          uuid,
  business_id                 uuid,
  host_id                     uuid,
  provider                    text,
  status                      text,
  calendly_user_uri           text,
  calendly_organization_uri   text,
  calendly_role               text,
  granted_scopes              text[],
  event_type_uri              text,
  scheduling_url              text,
  webhook_subscription_uri    text,
  webhook_state               text,
  webhook_checked_at          timestamptz,
  access_token_expires_at     timestamptz,
  conflict_check_confirmed_at timestamptz,
  last_refresh_at             timestamptz,
  last_error                  text,
  connected_by                uuid,
  connected_at                timestamptz,
  created_at                  timestamptz,
  updated_at                  timestamptz
)
language sql
security definer
set search_path = public, vault
as $$
  select
    c.id, c.business_id, c.host_id, c.provider, c.status,
    c.calendly_user_uri, c.calendly_organization_uri, c.calendly_role,
    c.granted_scopes, c.event_type_uri, c.scheduling_url,
    c.webhook_subscription_uri, c.webhook_state, c.webhook_checked_at,
    c.access_token_expires_at, c.conflict_check_confirmed_at,
    c.last_refresh_at, c.last_error, c.connected_by, c.connected_at,
    c.created_at, c.updated_at
  from public.coach_calendar_connections c
  where c.business_id = p_business_id
  order by c.created_at asc;
$$;

create or replace function public.fn_connect_coach_calendar(
  p_business_id               uuid,
  p_host_id                   uuid,
  p_provider                  text,
  p_credentials               jsonb,
  p_calendly_user_uri         text,
  p_calendly_organization_uri text,
  p_calendly_role             text,
  p_access_token_expires_at   timestamptz,
  p_connected_by              uuid
)
returns table (
  id                          uuid,
  business_id                 uuid,
  host_id                     uuid,
  provider                    text,
  status                      text,
  credentials                 jsonb,
  calendly_user_uri           text,
  calendly_organization_uri   text,
  calendly_role               text,
  granted_scopes              text[],
  event_type_uri              text,
  scheduling_url              text,
  webhook_subscription_uri    text,
  webhook_state               text,
  webhook_checked_at          timestamptz,
  access_token_expires_at     timestamptz,
  conflict_check_confirmed_at timestamptz,
  last_refresh_at             timestamptz,
  last_error                  text,
  connected_by                uuid,
  connected_at                timestamptz,
  created_at                  timestamptz,
  updated_at                  timestamptz
)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id   uuid;
  v_secret_name text;
begin
  select c.credentials_secret_id into v_secret_id
    from public.coach_calendar_connections c
   where c.host_id = p_host_id and c.provider = p_provider;

  -- Tenant- AND host-qualified: a second host in one business cannot overwrite
  -- the first's token. This exact string is specified in 00240's comment.
  v_secret_name := 'coach_calendar_connections:' || p_business_id || ':' || p_host_id || ':' || p_provider;

  if v_secret_id is not null then
    -- Not a raw UPDATE. vault.secrets denies UPDATE outright -- confirmed
    -- against the dev clone, where neither postgres (this function's owner)
    -- nor service_role holds it (only SELECT/DELETE/REFERENCES/TRUNCATE).
    -- vault.update_secret is supabase_admin-owned SECURITY DEFINER and is
    -- vault's actual write API; it also regenerates the nonce, which a raw
    -- UPDATE of the ciphertext column would not.
    perform vault.update_secret(v_secret_id, p_credentials::text);
  else
    v_secret_id := vault.create_secret(p_credentials::text, v_secret_name);
  end if;

  insert into public.coach_calendar_connections as t (
    business_id, host_id, provider, status, credentials_secret_id,
    calendly_user_uri, calendly_organization_uri, calendly_role,
    granted_scopes, access_token_expires_at, connected_by, connected_at, updated_at
  ) values (
    p_business_id, p_host_id, p_provider, 'connected', v_secret_id,
    p_calendly_user_uri, p_calendly_organization_uri, p_calendly_role,
    -- Calendly publishes no granular scopes; a token carries the authorizing
    -- user's own permissions. An invented list here would be worse than an
    -- empty one, because a later reader would trust it.
    '{}'::text[], p_access_token_expires_at, p_connected_by, now(), now()
  )
  -- ON CONFLICT (host_id, provider) -- the bare column-list form -- fails at
  -- CALL time with "column reference \"host_id\" is ambiguous": RETURNS
  -- TABLE(..., host_id uuid, ...) declares host_id as a plpgsql output
  -- variable, and the conflict-target's bare identifiers are parsed as
  -- expressions subject to plpgsql's variable-vs-column scan, exactly the
  -- 00090 bug class but on this function's OWN output columns rather than
  -- vault.secrets. ON CONSTRAINT names the unique constraint instead of
  -- column identifiers, so there is nothing left for that scan to trip on.
  on conflict on constraint coach_calendar_connections_host_id_provider_key do update set
    business_id               = excluded.business_id,
    status                    = 'connected',
    credentials_secret_id     = excluded.credentials_secret_id,
    calendly_user_uri         = excluded.calendly_user_uri,
    calendly_organization_uri = excluded.calendly_organization_uri,
    calendly_role             = excluded.calendly_role,
    access_token_expires_at   = excluded.access_token_expires_at,
    connected_by              = excluded.connected_by,
    connected_at              = now(),
    last_error                = null,
    updated_at                = now(),
    -- RECONNECTING TO A DIFFERENT CALENDLY ACCOUNT INVALIDATES THE CHOSEN EVENT
    -- TYPE. An event_type_uri belongs to the account that owns it; carrying it
    -- across a reconnect would leave a row claiming an event type its token can
    -- no longer read, and the webhook would keep matching deliveries to it. Same
    -- account -> keep the choice, so an ordinary re-consent is not a re-setup.
    event_type_uri            = case when t.calendly_user_uri is distinct from excluded.calendly_user_uri
                                     then null else t.event_type_uri end,
    scheduling_url            = case when t.calendly_user_uri is distinct from excluded.calendly_user_uri
                                     then null else t.scheduling_url end,
    webhook_subscription_uri  = case when t.calendly_user_uri is distinct from excluded.calendly_user_uri
                                     then null else t.webhook_subscription_uri end;

  return query select * from public.fn_get_coach_calendar_connection(p_host_id, p_provider);
end;
$$;

-- fn_disconnect_coach_calendar
-- Deletes the vault secret outright. Phase 0 proved by probe that a SECURITY
-- DEFINER function granted to service_role CAN delete from vault.secrets
-- (rows_deleted = 1 under `set local role service_role`), so no fallback design
-- is needed.
create or replace function public.fn_disconnect_coach_calendar(
  p_host_id  uuid,
  p_provider text
)
returns table (
  id                          uuid,
  business_id                 uuid,
  host_id                     uuid,
  provider                    text,
  status                      text,
  credentials                 jsonb,
  calendly_user_uri           text,
  calendly_organization_uri   text,
  calendly_role               text,
  granted_scopes              text[],
  event_type_uri              text,
  scheduling_url              text,
  webhook_subscription_uri    text,
  webhook_state               text,
  webhook_checked_at          timestamptz,
  access_token_expires_at     timestamptz,
  conflict_check_confirmed_at timestamptz,
  last_refresh_at             timestamptz,
  last_error                  text,
  connected_by                uuid,
  connected_at                timestamptz,
  created_at                  timestamptz,
  updated_at                  timestamptz
)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select c.credentials_secret_id into v_secret_id
    from public.coach_calendar_connections c
   where c.host_id = p_host_id and c.provider = p_provider;

  if v_secret_id is not null then
    delete from vault.secrets s where s.id = v_secret_id;
  end if;

  update public.coach_calendar_connections c
     set status                      = 'not_connected',
         credentials_secret_id       = null,
         calendly_user_uri           = null,
         calendly_organization_uri   = null,
         calendly_role               = null,
         granted_scopes              = '{}'::text[],
         event_type_uri              = null,
         scheduling_url              = null,
         webhook_subscription_uri    = null,
         webhook_state               = null,
         webhook_checked_at          = null,
         access_token_expires_at     = null,
         conflict_check_confirmed_at = null,
         last_refresh_at             = null,
         last_error                  = null,
         connected_by                = null,
         connected_at                = null,
         updated_at                  = now()
   where c.host_id = p_host_id and c.provider = p_provider;

  return query select * from public.fn_get_coach_calendar_connection(p_host_id, p_provider);
end;
$$;

-- fn_store_refreshed_calendar_credentials -- THE COMPARE-AND-SWAP.
--
-- Calendly's refresh tokens are SINGLE-USE: a refresh token is revoked
-- immediately after a successful POST /oauth/token, and reusing one answers
-- 400/401 invalid_grant. Two requests that notice an expired access token at
-- the same instant therefore both send the same refresh token, and one of them
-- loses.
--
-- The naive loser does one of two harmful things: it writes its failure
-- (marking a healthy connection needs_reconnect, so the coach is told to
-- reconnect a calendar that works), or it writes a token from a revoked grant.
-- Either way a working connection needs manual repair, and it happens more
-- often the busier the coach is.
--
-- So: lock the WRITE, never the network call. The advisory lock is
-- transaction-scoped and this transaction contains no HTTP; holding a lock
-- across a network call on a pooled connection is how you exhaust the pool.
-- The comparison is what makes that safe -- if the stored refresh token is no
-- longer the one the caller started from, somebody else already rotated it and
-- THEIRS is live, so this call writes nothing and hands the winner's
-- credentials back for the loser to use.
create or replace function public.fn_store_refreshed_calendar_credentials(
  p_connection_id           uuid,
  p_expected_refresh_token  text,
  p_credentials             jsonb,
  p_access_token_expires_at timestamptz
)
returns table (stored boolean, credentials jsonb)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_current   jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_connection_id::text));

  select c.credentials_secret_id into v_secret_id
    from public.coach_calendar_connections c
   where c.id = p_connection_id;

  if v_secret_id is null then
    return query select false, '{}'::jsonb;
    return;
  end if;

  select ds.decrypted_secret::jsonb into v_current
    from vault.decrypted_secrets ds
   where ds.id = v_secret_id;

  if coalesce(v_current->>'refresh_token', '') is distinct from coalesce(p_expected_refresh_token, '') then
    return query select false, coalesce(v_current, '{}'::jsonb);
    return;
  end if;

  -- Not a raw UPDATE -- see the matching note in fn_connect_coach_calendar.
  perform vault.update_secret(v_secret_id, p_credentials::text);

  update public.coach_calendar_connections c
     set access_token_expires_at = p_access_token_expires_at,
         last_refresh_at         = now(),
         last_error              = null,
         status                  = 'connected',
         updated_at              = now()
   where c.id = p_connection_id;

  return query select true, p_credentials;
end;
$$;

revoke all on function public.fn_get_coach_calendar_connection(uuid, text)   from public, anon, authenticated;
revoke all on function public.fn_list_coach_calendar_connections(uuid)       from public, anon, authenticated;
revoke all on function public.fn_connect_coach_calendar(uuid, uuid, text, jsonb, text, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.fn_disconnect_coach_calendar(uuid, text)       from public, anon, authenticated;
revoke all on function public.fn_store_refreshed_calendar_credentials(uuid, text, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function public.fn_get_coach_calendar_connection(uuid, text)   to service_role;
grant execute on function public.fn_list_coach_calendar_connections(uuid)       to service_role;
grant execute on function public.fn_connect_coach_calendar(uuid, uuid, text, jsonb, text, text, text, timestamptz, uuid) to service_role;
grant execute on function public.fn_disconnect_coach_calendar(uuid, text)       to service_role;
grant execute on function public.fn_store_refreshed_calendar_credentials(uuid, text, jsonb, timestamptz) to service_role;
