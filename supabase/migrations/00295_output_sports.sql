-- Output Sports: a coach's Output account, which client is which Output athlete,
-- and the results pulled from it into performance_tests.
--
-- Why: Darren tests clients on Output Sports sensors (jumps, sprints, bar speed)
-- and wants the results in each client's record, starting with a remote client
-- in November 2026. Output's API is pull-only and has no API keys: it signs in
-- with the account OWNER's email and password and hands back a refresh token
-- that does not rotate. The app keeps that refresh token in Vault and never
-- stores the password.
--
-- WRITERS: app/api/admin/output-sports/connection/route.ts (connect, disconnect),
-- app/api/admin/clients/[id]/output/route.ts (link, unlink),
-- lib/output-sports/sync.ts (imported results, last_error, last_synced_at).
-- READERS: lib/db/output-sports.ts, used by Settings > Output Sports and the
-- client's Performance page. Service role only.

-- One Output account per business. Output's API works per organisation, and its
-- owner login is the only one the API accepts.
create table if not exists public.output_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  -- vault.secrets id; the secret is the refresh token, named 'output_connections:' || business_id
  credentials_secret_id uuid,
  -- Shown on the settings page so the coach knows which account is connected.
  account_email text not null,
  connected_by uuid references public.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  -- Set when Output refuses the stored token (password changed, API access lapsed).
  -- The settings page and the sync button show it and ask for a reconnect.
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.output_connections enable row level security;
drop policy if exists "Service role only" on public.output_connections;
create policy "Service role only" on public.output_connections for all using (false);

-- Which client is which Output athlete. Output has no endpoint to create an
-- athlete, so the coach adds them in Output and links them here.
create table if not exists public.output_athlete_links (
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_user_id uuid not null references public.users(id) on delete cascade,
  output_athlete_id text not null,
  -- Output's name for the athlete, shown as "Linked to ..." on the Performance page.
  output_athlete_name text not null,
  -- Shown as "Last synced ..."; also where the next sync starts reading from.
  last_synced_at timestamptz,
  linked_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (business_id, client_user_id),
  unique (business_id, output_athlete_id)
);

alter table public.output_athlete_links enable row level security;
drop policy if exists "Service role only" on public.output_athlete_links;
create policy "Service role only" on public.output_athlete_links for all using (false);

-- A result imported from Output: '<test_type>:<YYYY-MM-DD>', one row per test per
-- day. A re-sync updates that row instead of adding a second one. NULL for a
-- result typed in by hand, and NULLs never collide, so hand-entered rows are
-- untouched.
alter table public.performance_tests add column if not exists output_key text;
create unique index if not exists performance_tests_output_key
  on public.performance_tests (client_user_id, output_key);

-- Saves the refresh token for a business, creating or replacing its connection.
-- Not a raw UPDATE of vault.secrets: neither postgres nor service_role holds
-- UPDATE there (see 00250); vault.update_secret is vault's own write path.
create or replace function public.fn_connect_output(
  p_business_id   uuid,
  p_refresh_token text,
  p_account_email text,
  p_connected_by  uuid
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select c.credentials_secret_id into v_secret_id
    from public.output_connections c
   where c.business_id = p_business_id;

  if v_secret_id is not null then
    perform vault.update_secret(v_secret_id, p_refresh_token);
  else
    v_secret_id := vault.create_secret(p_refresh_token, 'output_connections:' || p_business_id);
  end if;

  insert into public.output_connections as t
    (business_id, credentials_secret_id, account_email, connected_by, connected_at, last_error, updated_at)
  values
    (p_business_id, v_secret_id, p_account_email, p_connected_by, now(), null, now())
  on conflict on constraint output_connections_pkey do update set
    credentials_secret_id = excluded.credentials_secret_id,
    account_email         = excluded.account_email,
    connected_by          = excluded.connected_by,
    connected_at          = excluded.connected_at,
    last_error            = null,
    updated_at            = now();
end;
$$;

-- Swaps in a new refresh token without touching who connected or when. Output's
-- tokens did not rotate when probed on 2026-10-30; this exists so a rotation
-- would not break the second sync.
create or replace function public.fn_store_output_refresh_token(
  p_business_id   uuid,
  p_refresh_token text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select c.credentials_secret_id into v_secret_id
    from public.output_connections c
   where c.business_id = p_business_id;
  if v_secret_id is not null then
    perform vault.update_secret(v_secret_id, p_refresh_token);
  end if;
end;
$$;

create or replace function public.fn_output_refresh_token(p_business_id uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select ds.decrypted_secret
    from public.output_connections c
    join vault.decrypted_secrets ds on ds.id = c.credentials_secret_id
   where c.business_id = p_business_id;
$$;

-- Deletes the token and the connection row. Links stay, so reconnecting the same
-- Output account needs no relinking.
create or replace function public.fn_disconnect_output(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select c.credentials_secret_id into v_secret_id
    from public.output_connections c
   where c.business_id = p_business_id;
  if v_secret_id is not null then
    delete from vault.secrets s where s.id = v_secret_id;
  end if;
  delete from public.output_connections c where c.business_id = p_business_id;
end;
$$;

revoke all on function public.fn_connect_output(uuid, text, text, uuid)        from public, anon, authenticated;
revoke all on function public.fn_store_output_refresh_token(uuid, text)        from public, anon, authenticated;
revoke all on function public.fn_output_refresh_token(uuid)                   from public, anon, authenticated;
revoke all on function public.fn_disconnect_output(uuid)                      from public, anon, authenticated;
grant execute on function public.fn_connect_output(uuid, text, text, uuid)    to service_role;
grant execute on function public.fn_store_output_refresh_token(uuid, text)    to service_role;
grant execute on function public.fn_output_refresh_token(uuid)                to service_role;
grant execute on function public.fn_disconnect_output(uuid)                   to service_role;
