# Calendly per-coach phase 2 — per-coach OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each coach their own Calendly connection, so the booking webhook derives `business_id` and `host_id` from a `coach_calendar_connections` row instead of two placeholder constants.

**Architecture:** A vault-backed `fn_*` RPC quartet writes per-coach OAuth credentials under a tenant- and host-qualified secret name. A PKCE OAuth flow under `/api/admin/bookings/calendar` lets a coach connect their own account and pick which event type is the consult; picking it registers the Calendly webhook subscription. The webhook then resolves its tenant by matching the delivery's `event_type` against that row, falling back to the existing environment variables as a documented ramp so the live booking feed never has a flag day.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + `supabase_vault`, Zod 4, vitest (node environment), Tailwind v4, shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-09-04-calendly-per-coach-phase2-oauth-design.md](../specs/2026-09-04-calendly-per-coach-phase2-oauth-design.md)

## Global Constraints

- **Migration number is `00250`.** Confirmed next free (`00249` is the highest). Renumbering is free only before the push.
- **Migrations apply to production automatically on push to main**, racing the Vercel build. Every statement in `00250` must be additive and tolerated by the previous build.
- **`users.role` stays `admin | client | editor | staff`.** Never widen it.
- **`lib/tenancy/resolve.ts` is the single tenant boundary.** Do not add a second resolver.
- **Do not elaborate the permissions system** — no presets, no new tiers, no business switcher. Do not add a `PermissionDef`; the new routes sit under existing `schedule`-mapped prefixes.
- **Do not scope `listGoogleAdsAccounts` or any ads reader.** `/admin/ads` is owner-only deliberately.
- **Admin UI is light-only.** `.dark` is a class variant these components were never built against.
- **Tables use `components/ui/data-table.tsx`** primitives: `DataTableCard`, `DataTableToolbar`, `DataTable`, `DataTableHeader`, `DataTableHead`, `DataTableRow`, `DataTableCell`, `DataTableEmpty`, `DataTableFooter`, `DataTableBadge` (tones `neutral | success | warning | info | danger`). `DataTableEmpty` renders its own `<tr>` — never wrap it in `DataTableRow`.
- **Every new test file starts with `// @vitest-environment node` on line 1.** The jsdom lane is broken repo-wide (`ERR_REQUIRE_ESM`); a jsdom test reports "no tests", which looks exactly like passing. **Always confirm a non-zero test count in the run output.**
- **Never 5xx the Calendly webhook for an unrecognised event type.** Calendly disables a subscription after 24h of failures.
- **`granted_scopes` stays `{}`.** Calendly publishes no granular scopes.
- **No Claude attribution** in commits, code comments, or any document.
- **tsc baseline is exactly 251 errors.** Compare the error **set**, not the count: `npx tsc --noEmit 2>&1 | grep -E "error TS" | sed -E 's/\(.*//' | sort > /tmp/after.txt && diff /tmp/phase2-base.txt /tmp/after.txt`

---

### Task 1: Migration 00250 — columns, the `fn_*` quartet, and the compare-and-swap

**Files:**
- Create: `supabase/migrations/00250_coach_calendar_connection_functions.sql`

**Interfaces:**
- Consumes: `coach_calendar_connections` (migration `00240`), `supabase_vault`.
- Produces: SQL functions `fn_connect_coach_calendar`, `fn_get_coach_calendar_connection`, `fn_list_coach_calendar_connections`, `fn_disconnect_coach_calendar`, `fn_store_refreshed_calendar_credentials`. Columns `coach_calendar_connections.access_token_expires_at`, `.conflict_check_confirmed_at`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00250_coach_calendar_connection_functions.sql`:

```sql
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
    update vault.secrets s set secret = p_credentials::text where s.id = v_secret_id;
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
  on conflict (host_id, provider) do update set
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

  update vault.secrets s set secret = p_credentials::text where s.id = v_secret_id;

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
```

- [ ] **Step 2: Apply it to the dev clone**

Run: `node scripts/migrations/apply.mjs`
Expected: `00250` applied, no error. The applier stops at the first failure, so any SQL error surfaces here.

- [ ] **Step 3: Read the schema back and prove the secret name is tenant-qualified**

Write `/tmp/verify-00250.sql` and run it through the Supabase MCP `execute_sql` (dev project) or `psql`. It must prove three things, not merely that the functions exist:

```sql
-- 1. Both columns exist.
select column_name from information_schema.columns
 where table_name = 'coach_calendar_connections'
   and column_name in ('access_token_expires_at','conflict_check_confirmed_at');
-- expect 2 rows

-- 2. All five functions exist and are SECURITY DEFINER.
select p.proname, p.prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'fn_%coach_calendar%'
    or p.proname = 'fn_store_refreshed_calendar_credentials';
-- expect 5 rows, prosecdef = true for all

-- 3. THE PROPERTY THAT MATTERS: two hosts in one business get two secrets.
--    Uses the singleton's real host plus a throwaway second host, inside a
--    transaction that is rolled back.
begin;
  insert into public.booking_hosts (business_id, display_name, email, timezone)
  values ('00000000-0000-0000-0000-000000000001','Probe Host 2','','UTC')
  returning id \gset probe2_
  select public.fn_connect_coach_calendar(
    '00000000-0000-0000-0000-000000000001',
    (select id from public.booking_hosts where business_id='00000000-0000-0000-0000-000000000001' order by created_at limit 1),
    'calendly', '{"access_token":"a","refresh_token":"r"}'::jsonb,
    'https://api.calendly.com/users/AAA', 'https://api.calendly.com/organizations/OOO', 'owner',
    now() + interval '2 hours', null);
  select public.fn_connect_coach_calendar(
    '00000000-0000-0000-0000-000000000001', :'probe2_id',
    'calendly', '{"access_token":"b","refresh_token":"s"}'::jsonb,
    'https://api.calendly.com/users/BBB', 'https://api.calendly.com/organizations/OOO', 'user',
    now() + interval '2 hours', null);
  -- Two DISTINCT secrets, two DISTINCT names. If the name were untenanted,
  -- this would be one row and the first coach's token would be gone.
  select count(distinct s.id) as secrets, count(distinct s.name) as names
    from public.coach_calendar_connections c
    join vault.secrets s on s.id = c.credentials_secret_id
   where c.business_id = '00000000-0000-0000-0000-000000000001';
  -- expect secrets = 2, names = 2
rollback;
```

Record the actual output in the commit message. A migration that "succeeded" is not the same as a migration that did what it says.

- [ ] **Step 4: Prove the compare-and-swap refuses a stale token**

```sql
begin;
  -- Connect with refresh_token 'r'.
  select public.fn_connect_coach_calendar(
    '00000000-0000-0000-0000-000000000001',
    (select id from public.booking_hosts where business_id='00000000-0000-0000-0000-000000000001' order by created_at limit 1),
    'calendly', '{"access_token":"a","refresh_token":"r"}'::jsonb,
    'https://api.calendly.com/users/AAA', null, 'owner', now(), null);

  -- A caller that started from 'r' wins.
  select * from public.fn_store_refreshed_calendar_credentials(
    (select id from public.coach_calendar_connections
      where host_id = (select id from public.booking_hosts where business_id='00000000-0000-0000-0000-000000000001' order by created_at limit 1)
        and provider='calendly'),
    'r', '{"access_token":"a2","refresh_token":"r2"}'::jsonb, now() + interval '2 hours');
  -- expect stored = true

  -- A second caller that ALSO started from 'r' is now stale: it must write
  -- nothing and be handed r2 back.
  select * from public.fn_store_refreshed_calendar_credentials(
    (select id from public.coach_calendar_connections
      where host_id = (select id from public.booking_hosts where business_id='00000000-0000-0000-0000-000000000001' order by created_at limit 1)
        and provider='calendly'),
    'r', '{"access_token":"a3","refresh_token":"r3"}'::jsonb, now() + interval '2 hours');
  -- expect stored = false AND credentials->>'refresh_token' = 'r2'  (NOT r3)
rollback;
```

- [ ] **Step 5: Prove disconnect really removes the vault row**

```sql
begin;
  select public.fn_connect_coach_calendar(
    '00000000-0000-0000-0000-000000000001',
    (select id from public.booking_hosts where business_id='00000000-0000-0000-0000-000000000001' order by created_at limit 1),
    'calendly', '{"access_token":"a","refresh_token":"r"}'::jsonb, 'https://api.calendly.com/users/AAA', null, 'owner', now(), null);
  select count(*) from vault.secrets where name like 'coach_calendar_connections:%';  -- expect >= 1
  select public.fn_disconnect_coach_calendar(
    (select id from public.booking_hosts where business_id='00000000-0000-0000-0000-000000000001' order by created_at limit 1), 'calendly');
  select count(*) from vault.secrets where name like 'coach_calendar_connections:%';  -- expect 0
rollback;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00250_coach_calendar_connection_functions.sql
git commit -m "db(calendly): the writer coach_calendar_connections has been waiting for"
```

---

### Task 2: The DAL and its types

**Files:**
- Create: `lib/db/coach-calendar-connections.ts`
- Modify: `types/database.ts` (append `CoachCalendarConnection`, `CoachCalendarProvider`, `CoachCalendarStatus`)
- Test: `__tests__/lib/db/coach-calendar-connections.test.ts`

**Interfaces:**
- Consumes: Task 1's five SQL functions; `createServiceRoleClient` from `@/lib/supabase`.
- Produces:
  ```ts
  export type CoachCalendarProvider = "calendly"
  export type CoachCalendarStatus = "not_connected" | "connected" | "needs_reconnect" | "plan_lapsed" | "error"
  export interface CoachCalendarConnection { /* every column, credentials?: Record<string, unknown> */ }

  getCoachCalendarConnection(hostId: string, provider?: CoachCalendarProvider): Promise<CoachCalendarConnection | null>
  listCoachCalendarConnections(businessId: string): Promise<CoachCalendarConnection[]>
  connectCoachCalendar(input: ConnectCoachCalendarInput): Promise<CoachCalendarConnection>
  disconnectCoachCalendar(hostId: string, provider?: CoachCalendarProvider): Promise<CoachCalendarConnection>
  storeRefreshedCalendarCredentials(args): Promise<{ stored: boolean; credentials: Record<string, unknown> }>
  setCoachCalendarError(connectionId: string, status: CoachCalendarStatus, message: string): Promise<void>
  updateCoachCalendarEventType(args): Promise<void>
  confirmCoachCalendarConflictCheck(connectionId: string, confirmed: boolean): Promise<void>
  findCoachCalendarConnectionByEventType(eventTypeUri: string): Promise<CoachCalendarConnection | null>
  ```

- [ ] **Step 1: Write the failing test**

`__tests__/lib/db/coach-calendar-connections.test.ts`:

```ts
// @vitest-environment node
//
// The read-failure path is the point of this suite. postgrest-js RESOLVES
// rather than throws: a missing table, a missing column or a transient fault
// all arrive as { data: null, error }. Treating that as "no connection matched"
// is what would silently file another coach's booking into the platform's
// tenant -- see the tenant resolver in lib/bookings/calendly-tenant.ts, whose
// whole failure story rests on this function throwing instead of returning null.
import { describe, it, expect, vi, beforeEach } from "vitest"

let rpcResult: { data: unknown; error: unknown }
let selectResult: { data: unknown; error: unknown }
let rpcCalls: Array<[string, Record<string, unknown>]>
let eqCalls: Array<[string, unknown]>

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args])
      return Promise.resolve(rpcResult)
    },
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          eqCalls.push([col, val])
          return { maybeSingle: () => Promise.resolve(selectResult) }
        },
      }),
    }),
  }),
}))

import {
  getCoachCalendarConnection,
  findCoachCalendarConnectionByEventType,
  storeRefreshedCalendarCredentials,
} from "@/lib/db/coach-calendar-connections"

beforeEach(() => {
  rpcCalls = []
  eqCalls = []
  rpcResult = { data: [], error: null }
  selectResult = { data: null, error: null }
})

describe("getCoachCalendarConnection", () => {
  it("passes the host id and provider to the RPC, not the business id", async () => {
    rpcResult = { data: [{ id: "conn-1", host_id: "host-1" }], error: null }
    await getCoachCalendarConnection("host-1")
    expect(rpcCalls[0][0]).toBe("fn_get_coach_calendar_connection")
    expect(rpcCalls[0][1]).toEqual({ p_host_id: "host-1", p_provider: "calendly" })
  })

  it("returns null when the RPC returns no rows", async () => {
    rpcResult = { data: [], error: null }
    expect(await getCoachCalendarConnection("host-1")).toBeNull()
  })

  it("THROWS on a read error rather than returning null", async () => {
    rpcResult = { data: null, error: { code: "42883", message: "function does not exist" } }
    await expect(getCoachCalendarConnection("host-1")).rejects.toThrow(/42883/)
  })
})

describe("findCoachCalendarConnectionByEventType", () => {
  it("matches on event_type_uri", async () => {
    selectResult = { data: { id: "conn-1", business_id: "biz-1", host_id: "host-1" }, error: null }
    const row = await findCoachCalendarConnectionByEventType("https://api.calendly.com/event_types/E1")
    expect(eqCalls).toEqual([["event_type_uri", "https://api.calendly.com/event_types/E1"]])
    expect(row?.id).toBe("conn-1")
  })

  it("returns null when nothing matched", async () => {
    selectResult = { data: null, error: null }
    expect(await findCoachCalendarConnectionByEventType("https://x/E9")).toBeNull()
  })

  it("THROWS on a read error — a failed read is not 'no match'", async () => {
    selectResult = { data: null, error: { code: "PGRST301", message: "JWT expired" } }
    await expect(findCoachCalendarConnectionByEventType("https://x/E1")).rejects.toThrow(/PGRST301/)
  })
})

describe("storeRefreshedCalendarCredentials", () => {
  it("returns the winner's credentials when the swap was refused", async () => {
    rpcResult = { data: [{ stored: false, credentials: { refresh_token: "winner" } }], error: null }
    const out = await storeRefreshedCalendarCredentials({
      connectionId: "conn-1",
      expectedRefreshToken: "stale",
      credentials: { refresh_token: "mine" },
      accessTokenExpiresAt: "2026-09-04T00:00:00.000Z",
    })
    expect(out.stored).toBe(false)
    expect(out.credentials).toEqual({ refresh_token: "winner" })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run __tests__/lib/db/coach-calendar-connections.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/coach-calendar-connections`. **Confirm the output shows a non-zero test count**; "no tests" means the environment pragma is missing or wrong.

- [ ] **Step 3: Write `lib/db/coach-calendar-connections.ts`**

Every read checks `error` explicitly and **throws**, including the `by-event-type` lookup. Include this comment above `findCoachCalendarConnectionByEventType`:

```ts
/**
 * The webhook's tenant proof. Matches on `event_type_uri`, which 00240 made
 * uniquely claimable with a partial unique index -- so one event type cannot
 * belong to two connections and this match is a function, not a heuristic.
 *
 * THROWS ON A READ ERROR, and that is the whole point. PostgREST resolves
 * rather than throws, so `{ data: null, error }` and "nothing matched" are the
 * same shape. If this returned null for both, the webhook would take its
 * environment-variable ramp and file another coach's booking into the
 * platform's tenant. Null means matched nothing; a throw means could not look.
 */
```

Use `.select("*").eq("event_type_uri", eventTypeUri).maybeSingle()` against `coach_calendar_connections` — a plain read, not an RPC, because no credentials are needed to identify a tenant and an RPC that decrypts tokens for a webhook is a token the webhook did not need.

`setCoachCalendarError`, `updateCoachCalendarEventType` and `confirmCoachCalendarConflictCheck` are plain `.update()` calls on non-secret columns and need no RPC.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/lib/db/coach-calendar-connections.test.ts`
Expected: PASS, non-zero count.

- [ ] **Step 5: Commit**

```bash
git add lib/db/coach-calendar-connections.ts types/database.ts __tests__/lib/db/coach-calendar-connections.test.ts
git commit -m "feat(calendly): a DAL for coach calendar connections, whose reads fail loudly"
```

---

### Task 3: `lib/calendly/oauth.ts` — PKCE, signed state with a nonce and an expiry

**Files:**
- Create: `lib/calendly/oauth.ts`
- Test: `__tests__/lib/calendly/oauth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const CALENDLY_AUTH_BASE_DEFAULT = "https://auth.calendly.com"
  export const CALENDLY_STATE_TTL_SECONDS = 600
  export type CalendlyOAuthState = { business_id: string; host_id: string; user_id: string; nonce: string; iat: number }
  export function createPkcePair(): { verifier: string; challenge: string }
  export function signState(payload: CalendlyOAuthState, secret: string): string
  export function verifyState(state: string, secret: string, nowSeconds?: number): CalendlyOAuthState | null
  export function buildAuthorizationUrl(input: { clientId: string; redirectUri: string; state: string; challenge: string; authBase?: string }): string
  export type CalendlyTokenResponse = { access_token: string; refresh_token: string; expires_in: number; token_type: string; owner?: string; organization?: string }
  export function exchangeCodeForTokens(input): Promise<CalendlyTokenResponse>
  export function refreshAccessToken(input): Promise<CalendlyTokenResponse>
  export class CalendlyOAuthError extends Error { readonly kind: "invalid_grant" | "http" | "network" | "shape"; readonly status: number | null }
  ```

- [ ] **Step 1: Write the failing test**

`__tests__/lib/calendly/oauth.test.ts`:

```ts
// @vitest-environment node
//
// The state helper here is NOT the one in lib/ads/oauth.ts, and the difference
// is deliberate. That one validates the HMAC and nothing else, so a signed
// state stays valid forever -- a real, pre-existing weakness in three shipped
// flows (google-ads, gmail, gsc), named in the phase 2 spec §1.2 and left
// alone there. This one checks `iat` against a TTL, and the callback pairs it
// with a nonce cookie, because a signature proves WE minted the state, not
// that THIS BROWSER asked for it.
import { describe, it, expect, vi } from "vitest"
import {
  createPkcePair, signState, verifyState, buildAuthorizationUrl,
  exchangeCodeForTokens, refreshAccessToken, CalendlyOAuthError,
  CALENDLY_STATE_TTL_SECONDS,
} from "@/lib/calendly/oauth"

const SECRET = "test-secret"
const payload = { business_id: "biz-1", host_id: "host-1", user_id: "user-1", nonce: "n1", iat: 1_000_000 }

describe("state", () => {
  it("round-trips a payload inside the TTL", () => {
    const s = signState(payload, SECRET)
    expect(verifyState(s, SECRET, payload.iat + 10)).toEqual(payload)
  })

  it("REJECTS a state older than the TTL", () => {
    const s = signState(payload, SECRET)
    expect(verifyState(s, SECRET, payload.iat + CALENDLY_STATE_TTL_SECONDS + 1)).toBeNull()
  })

  it("rejects a state signed with a different secret", () => {
    expect(verifyState(signState(payload, "other"), SECRET, payload.iat + 10)).toBeNull()
  })

  it("rejects a tampered payload", () => {
    const s = signState(payload, SECRET)
    const [body, sig] = s.split(".")
    const evil = Buffer.from(JSON.stringify({ ...payload, business_id: "biz-2" }), "utf8").toString("base64url")
    expect(verifyState(`${evil}.${sig}`, SECRET, payload.iat + 10)).toBeNull()
  })

  it("rejects a state issued in the future beyond clock skew", () => {
    expect(verifyState(signState(payload, SECRET), SECRET, payload.iat - 120)).toBeNull()
  })
})

describe("PKCE", () => {
  it("produces a verifier and an S256 challenge that differ", () => {
    const { verifier, challenge } = createPkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(challenge).not.toBe(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)  // base64url, no padding
  })

  it("produces a different pair each call", () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier)
  })
})

describe("buildAuthorizationUrl", () => {
  it("sends S256 and the challenge, never the verifier", () => {
    const { verifier, challenge } = createPkcePair()
    const url = new URL(buildAuthorizationUrl({
      clientId: "cid", redirectUri: "https://x/cb", state: "st", challenge,
    }))
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBe(challenge)
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.toString()).not.toContain(verifier)
  })
})

describe("refreshAccessToken", () => {
  it("classifies invalid_grant as its own kind — it is the one non-transient failure", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
    await expect(refreshAccessToken({
      refreshToken: "r", clientId: "c", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toMatchObject({ kind: "invalid_grant" })
  })

  it("classifies a 503 as http, NOT invalid_grant — a transient fault must not retire a connection", async () => {
    const fetchImpl = vi.fn(async () => new Response("upstream", { status: 503 }))
    await expect(refreshAccessToken({
      refreshToken: "r", clientId: "c", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toMatchObject({ kind: "http", status: 503 })
  })

  it("returns the ROTATED refresh token, not the one it sent", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: "a2", refresh_token: "r2", expires_in: 7200, token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } }))
    const out = await refreshAccessToken({
      refreshToken: "r1", clientId: "c", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(out.refresh_token).toBe("r2")
  })
})

describe("exchangeCodeForTokens", () => {
  it("sends the code_verifier", async () => {
    let sentBody = ""
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      sentBody = String(init.body)
      return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 7200, token_type: "Bearer" }),
        { status: 200, headers: { "content-type": "application/json" } })
    })
    await exchangeCodeForTokens({
      code: "code-1", verifier: "ver-1", clientId: "c", clientSecret: "s",
      redirectUri: "https://x/cb", fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(sentBody).toContain("code_verifier=ver-1")
  })

  it("rejects a 200 whose body is not a token response", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ hello: "world" }),
      { status: 200, headers: { "content-type": "application/json" } }))
    await expect(exchangeCodeForTokens({
      code: "c", verifier: "v", clientId: "c", clientSecret: "s", redirectUri: "https://x/cb",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toMatchObject({ kind: "shape" })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run __tests__/lib/calendly/oauth.test.ts` — FAIL, module not found. Confirm non-zero count.

- [ ] **Step 3: Implement `lib/calendly/oauth.ts`**

Key requirements, all pinned by the tests above:

- `verifyState` compares the HMAC with `timingSafeEqual` (as `lib/ads/oauth.ts` does), then checks `now - iat` is within `[-60, CALENDLY_STATE_TTL_SECONDS]`. The `-60` allows clock skew; a state from the future beyond that is rejected.
- `createPkcePair` uses `randomBytes(32).toString("base64url")` for the verifier and `createHash("sha256").update(verifier).digest("base64url")` for the challenge.
- Endpoint constants carry a comment: Calendly's published authorization-server metadata names `https://calendly.com/oauth/{authorize,token}` while its refresh-token guide names `https://auth.calendly.com/oauth/token`. **Both appear in Calendly's own docs**, so the base is a module constant with an `authBase` override rather than a literal at the call site, and is confirmed against a live client before go-live.
- Token responses are parsed with Zod; a 200 with the wrong shape is `kind: "shape"`, never a silent partial object.
- `invalid_grant` is detected from the response body's `error` field on a 400/401 and raised as `kind: "invalid_grant"`.

- [ ] **Step 4: Run the tests** — `npx vitest run __tests__/lib/calendly/oauth.test.ts`, expect PASS with a non-zero count.

- [ ] **Step 5: Commit**

```bash
git add lib/calendly/oauth.ts __tests__/lib/calendly/oauth.test.ts
git commit -m "feat(calendly): PKCE and a signed state that actually expires"
```

---

### Task 4: `lib/calendly/credentials.ts` — the token accessor

**Files:**
- Create: `lib/calendly/credentials.ts`
- Test: `__tests__/lib/calendly/credentials.test.ts`

**Interfaces:**
- Consumes: Task 2's `getCoachCalendarConnection`, `storeRefreshedCalendarCredentials`, `setCoachCalendarError`; Task 3's `refreshAccessToken`, `CalendlyOAuthError`.
- Produces:
  ```ts
  export type CalendlyCredentials = { access_token: string; refresh_token: string }
  export const REFRESH_SKEW_SECONDS = 120
  export function needsRefresh(expiresAt: string | null, nowMs?: number): boolean
  export async function accessTokenForConnection(connection: CoachCalendarConnection, deps?): Promise<string>
  ```

- [ ] **Step 1: Write the failing test**

`__tests__/lib/calendly/credentials.test.ts`:

```ts
// @vitest-environment node
//
// Calendly refresh tokens are single-use: revoked the instant a refresh
// succeeds. The failures pinned here are the two that brick a connection --
// the loser of a concurrent refresh writing its failure over a healthy row,
// and a transient 5xx being mistaken for a dead grant.
import { describe, it, expect, vi, beforeEach } from "vitest"

const storeRefreshed = vi.fn()
const setError = vi.fn()
const refresh = vi.fn()

vi.mock("@/lib/db/coach-calendar-connections", () => ({
  storeRefreshedCalendarCredentials: (...a: unknown[]) => storeRefreshed(...a),
  setCoachCalendarError: (...a: unknown[]) => setError(...a),
}))
vi.mock("@/lib/calendly/oauth", async (orig) => ({
  ...(await orig<typeof import("@/lib/calendly/oauth")>()),
  refreshAccessToken: (...a: unknown[]) => refresh(...a),
}))

import { accessTokenForConnection, needsRefresh, REFRESH_SKEW_SECONDS } from "@/lib/calendly/credentials"
import { CalendlyOAuthError } from "@/lib/calendly/oauth"

const NOW = Date.parse("2026-09-04T12:00:00.000Z")
function conn(over: Record<string, unknown> = {}) {
  return {
    id: "conn-1", business_id: "biz-1", host_id: "host-1", provider: "calendly", status: "connected",
    credentials: { access_token: "a1", refresh_token: "r1" },
    access_token_expires_at: new Date(NOW + 3_600_000).toISOString(),
    ...over,
  } as never
}

beforeEach(() => {
  storeRefreshed.mockReset(); setError.mockReset(); refresh.mockReset()
  process.env.CALENDLY_CLIENT_ID = "cid"; process.env.CALENDLY_CLIENT_SECRET = "csec"
})

describe("needsRefresh", () => {
  it("is false well before expiry", () => {
    expect(needsRefresh(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe(false)
  })
  it("is true inside the skew window", () => {
    expect(needsRefresh(new Date(NOW + (REFRESH_SKEW_SECONDS - 10) * 1000).toISOString(), NOW)).toBe(true)
  })
  it("is true when the expiry is unknown — an unknown expiry is not a valid token", () => {
    expect(needsRefresh(null, NOW)).toBe(true)
  })
})

describe("accessTokenForConnection", () => {
  it("returns the stored token without refreshing when it is still fresh", async () => {
    expect(await accessTokenForConnection(conn(), { now: () => NOW })).toBe("a1")
    expect(refresh).not.toHaveBeenCalled()
  })

  it("refreshes and returns the NEW access token", async () => {
    refresh.mockResolvedValue({ access_token: "a2", refresh_token: "r2", expires_in: 7200, token_type: "Bearer" })
    storeRefreshed.mockResolvedValue({ stored: true, credentials: { access_token: "a2", refresh_token: "r2" } })
    const token = await accessTokenForConnection(conn({ access_token_expires_at: new Date(NOW - 1000).toISOString() }), { now: () => NOW })
    expect(token).toBe("a2")
  })

  it("uses the WINNER's token when the swap was refused, and does not error the row", async () => {
    refresh.mockResolvedValue({ access_token: "mine", refresh_token: "r-mine", expires_in: 7200, token_type: "Bearer" })
    storeRefreshed.mockResolvedValue({ stored: false, credentials: { access_token: "theirs", refresh_token: "r-theirs" } })
    const token = await accessTokenForConnection(conn({ access_token_expires_at: new Date(NOW - 1000).toISOString() }), { now: () => NOW })
    expect(token).toBe("theirs")
    expect(setError).not.toHaveBeenCalled()
  })

  it("marks needs_reconnect on invalid_grant", async () => {
    refresh.mockRejectedValue(new CalendlyOAuthError("invalid_grant", "dead", 400))
    await expect(accessTokenForConnection(conn({ access_token_expires_at: new Date(NOW - 1000).toISOString() }), { now: () => NOW })).rejects.toThrow()
    expect(setError).toHaveBeenCalledWith("conn-1", "needs_reconnect", expect.any(String))
  })

  it("does NOT mark needs_reconnect on a 503 — status must stay untouched", async () => {
    refresh.mockRejectedValue(new CalendlyOAuthError("http", "upstream", 503))
    await expect(accessTokenForConnection(conn({ access_token_expires_at: new Date(NOW - 1000).toISOString() }), { now: () => NOW })).rejects.toThrow()
    const statuses = setError.mock.calls.map((c) => c[1])
    expect(statuses).not.toContain("needs_reconnect")
  })
})
```

- [ ] **Step 2: Run and watch it fail.** `npx vitest run __tests__/lib/calendly/credentials.test.ts`

- [ ] **Step 3: Implement.** `needsRefresh(null, …)` returns **true** — an unknown expiry is not a valid token, and the alternative (assume fresh) fails at the worst moment. On `invalid_grant`, call `setCoachCalendarError(id, "needs_reconnect", …)`; on every other failure, record `last_error` **without** changing status, then rethrow as `CalendlyUnavailable` so callers already handling that keep working.

- [ ] **Step 4: Run — expect PASS with a non-zero count.**

- [ ] **Step 5: Commit**

```bash
git add lib/calendly/credentials.ts __tests__/lib/calendly/credentials.test.ts
git commit -m "feat(calendly): refresh single-use tokens without bricking the loser"
```

---

### Task 5: `lib/calendly/account.ts` — identity, event types, subscriptions

**Files:**
- Create: `lib/calendly/account.ts`
- Test: `__tests__/lib/calendly/account.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CalendlyIdentity = { uri: string; name: string; email: string; schedulingUrl: string; organizationUri: string | null }
  export type CalendlyEventType = { uri: string; name: string; durationMinutes: number; schedulingUrl: string; active: boolean }
  export class CalendlyPlanRequiredError extends Error {}
  export function fetchIdentity(args): Promise<CalendlyIdentity>
  export function listEventTypes(args): Promise<CalendlyEventType[]>
  export function createWebhookSubscription(args): Promise<{ uri: string; state: string }>
  export function deleteWebhookSubscription(args): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
//
// The 403 case is the one that matters. Calendly webhooks need a PAID plan
// (Standard, Teams or Enterprise); POST /webhook_subscriptions answers 403 on
// a Free account. That is the documented meaning of the `plan_lapsed` status
// 00240 put in the CHECK constraint, and the difference between a coach
// reading "webhooks need a paid Calendly plan" and reading "something went
// wrong".
import { describe, it, expect, vi } from "vitest"
import {
  fetchIdentity, listEventTypes, createWebhookSubscription, deleteWebhookSubscription,
  CalendlyPlanRequiredError,
} from "@/lib/calendly/account"

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

describe("createWebhookSubscription", () => {
  it("raises CalendlyPlanRequiredError on 403 — a Free plan, not a generic failure", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ title: "Permission Denied" }), { status: 403 }))
    await expect(createWebhookSubscription({
      accessToken: "a", organizationUri: "https://api.calendly.com/organizations/O",
      userUri: "https://api.calendly.com/users/U", callbackUrl: "https://x/api/webhooks/calendly",
      signingKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toBeInstanceOf(CalendlyPlanRequiredError)
  })

  it("subscribes to exactly invitee.created and invitee.canceled", async () => {
    let sent: Record<string, unknown> = {}
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ resource: { uri: "https://api.calendly.com/webhook_subscriptions/W", state: "active" } }), { status: 201, headers: { "content-type": "application/json" } })
    })
    const out = await createWebhookSubscription({
      accessToken: "a", organizationUri: "https://api.calendly.com/organizations/O",
      userUri: "https://api.calendly.com/users/U", callbackUrl: "https://x/api/webhooks/calendly",
      signingKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(sent.events).toEqual(["invitee.created", "invitee.canceled"])
    expect(sent.scope).toBe("user")
    expect(out.uri).toBe("https://api.calendly.com/webhook_subscriptions/W")
  })
})

describe("deleteWebhookSubscription", () => {
  it("treats a 404 as success — already gone is the desired end state", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }))
    await expect(deleteWebhookSubscription({ accessToken: "a", subscriptionUri: "https://api.calendly.com/webhook_subscriptions/W", fetchImpl: fetchImpl as unknown as typeof fetch })).resolves.toBeUndefined()
  })
})

describe("listEventTypes", () => {
  it("returns active event types with their public page and duration", async () => {
    const fetchImpl = vi.fn(async () => ok({ collection: [
      { uri: "https://api.calendly.com/event_types/E1", name: "Consult", duration: 30, scheduling_url: "https://calendly.com/c/consult", active: true },
    ] }))
    const types = await listEventTypes({ accessToken: "a", userUri: "https://api.calendly.com/users/U", fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(types).toEqual([{ uri: "https://api.calendly.com/event_types/E1", name: "Consult", durationMinutes: 30, schedulingUrl: "https://calendly.com/c/consult", active: true }])
  })
})

describe("fetchIdentity", () => {
  it("reads uri, organization and scheduling page from GET /users/me", async () => {
    const fetchImpl = vi.fn(async () => ok({ resource: {
      uri: "https://api.calendly.com/users/U", name: "Coach", email: "coach@example.com",
      scheduling_url: "https://calendly.com/coach", current_organization: "https://api.calendly.com/organizations/O",
    } }))
    const me = await fetchIdentity({ accessToken: "a", fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(me).toEqual({ uri: "https://api.calendly.com/users/U", name: "Coach", email: "coach@example.com", schedulingUrl: "https://calendly.com/coach", organizationUri: "https://api.calendly.com/organizations/O" })
  })
})
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement.** These are the same three API calls `scripts/calendly-setup.mjs` already makes by hand (`/users/me`, `/event_types?user=`, `/webhook_subscriptions`); the shapes are proven there. Parse every response with Zod, `.loose()` so a new Calendly field is not a failure. Injectable `fetchImpl`, matching `lib/calendly/client.ts`.

- [ ] **Step 4: Run — expect PASS, non-zero count.**

- [ ] **Step 5: Commit**

```bash
git add lib/calendly/account.ts __tests__/lib/calendly/account.test.ts
git commit -m "feat(calendly): read an account's identity and event types, and own its webhook"
```

---

### Task 6: `resolveCalendlyTenant` — the seam's logic, in isolation

**Files:**
- Create: `lib/bookings/calendly-tenant.ts`
- Test: `__tests__/lib/bookings/calendly-tenant.test.ts`

**Interfaces:**
- Consumes: Task 2's `findCoachCalendarConnectionByEventType`; `platformBusinessId` and the new `platformHostId` (Task 7 moves it — this task may import `singletonHostId` and Task 7 renames both together, or Task 7 runs first; either order works because the rename is mechanical).
- Produces:
  ```ts
  export type CalendlyTenant =
    | { kind: "connection"; businessId: string; hostId: string; connectionId: string }
    | { kind: "platform"; businessId: string; hostId: string | null }
    | { kind: "unknown" }
  export function resolveCalendlyTenant(eventTypeUri: string | null | undefined, deps?): Promise<CalendlyTenant>
  ```

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
//
// Three outcomes, and the fourth thing that is NOT an outcome: a read failure.
// If a failed lookup returned "unknown" or fell through to the platform ramp,
// a transient database fault would file one coach's booking into another
// coach's tenant -- silently, with a 200, and with no way to tell afterwards.
// So the read throws and the route answers 500, which Calendly retries.
import { describe, it, expect, vi, beforeEach } from "vitest"

const findByEventType = vi.fn()
vi.mock("@/lib/db/coach-calendar-connections", () => ({
  findCoachCalendarConnectionByEventType: (...a: unknown[]) => findByEventType(...a),
}))

import { resolveCalendlyTenant } from "@/lib/bookings/calendly-tenant"

beforeEach(() => {
  findByEventType.mockReset()
  delete process.env.CALENDLY_EVENT_TYPE_URI
})

describe("resolveCalendlyTenant", () => {
  it("returns the CONNECTION's ids when an event type matches", async () => {
    findByEventType.mockResolvedValue({ id: "conn-9", business_id: "biz-9", host_id: "host-9" })
    const t = await resolveCalendlyTenant("https://api.calendly.com/event_types/E9")
    expect(t).toEqual({ kind: "connection", businessId: "biz-9", hostId: "host-9", connectionId: "conn-9" })
  })

  it("takes the platform ramp only when the env event type matches exactly", async () => {
    findByEventType.mockResolvedValue(null)
    process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/ENV"
    const t = await resolveCalendlyTenant("https://api.calendly.com/event_types/ENV", {
      platformBusinessId: () => "biz-platform", platformHostId: async () => "host-platform",
    })
    expect(t).toEqual({ kind: "platform", businessId: "biz-platform", hostId: "host-platform" })
  })

  it("is unknown when neither a row nor the env matches", async () => {
    findByEventType.mockResolvedValue(null)
    process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/ENV"
    expect(await resolveCalendlyTenant("https://api.calendly.com/event_types/OTHER")).toEqual({ kind: "unknown" })
  })

  it("is unknown for a delivery carrying no event type — it cannot be proven to belong to anyone", async () => {
    process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/ENV"
    expect(await resolveCalendlyTenant(null)).toEqual({ kind: "unknown" })
    expect(findByEventType).not.toHaveBeenCalled()
  })

  it("is unknown when nothing matches AND no env is configured", async () => {
    findByEventType.mockResolvedValue(null)
    expect(await resolveCalendlyTenant("https://api.calendly.com/event_types/E1")).toEqual({ kind: "unknown" })
  })

  it("PROPAGATES a read failure — it must never be mistaken for 'no match'", async () => {
    findByEventType.mockRejectedValue(new Error("connection read failed (PGRST301)"))
    process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/E1"
    await expect(resolveCalendlyTenant("https://api.calendly.com/event_types/E1")).rejects.toThrow(/PGRST301/)
  })
})
```

Note the fifth test's control value: it uses the SAME event type as the env var, so if a read failure were swallowed the test would see the ramp rather than a throw — the failure is distinguishable from the pass.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement**, with a `console.warn` on the platform branch naming the event type, so the ramp's use is visible in logs rather than invisible.

- [ ] **Step 4: Run — expect PASS, non-zero count.**

- [ ] **Step 5: Commit**

```bash
git add lib/bookings/calendly-tenant.ts __tests__/lib/bookings/calendly-tenant.test.ts
git commit -m "feat(calendly): resolve a delivery's tenant from its event type"
```

---

### Task 7: Close the seam in the webhook, and rename `singletonHostId`

**Files:**
- Modify: `app/api/webhooks/calendly/route.ts:5-10,183-215`
- Modify: `lib/db/bookings.ts` (remove `singletonHostId`)
- Modify: `lib/tenancy/platform.ts` (add `platformHostId`, update the inventory comment)
- Modify: `app/api/webhooks/ghl-booking/route.ts:4,127`
- Modify: `__tests__/lib/db/bookings.test.ts`, `__tests__/api/webhooks/calendly-booking.test.ts` (retarget, do not delete)
- Test: `__tests__/api/webhooks/calendly-tenant-resolution.test.ts` (new)

**Interfaces:**
- Consumes: Task 6's `resolveCalendlyTenant`.
- Produces: `platformHostId(): Promise<string | null>` in `lib/tenancy/platform.ts`.

- [ ] **Step 1: Move the function, do not rewrite it**

Move `singletonHostId`'s body verbatim into `lib/tenancy/platform.ts` as `platformHostId`. Its behaviour is load-bearing and must not drift: it returns `null` rather than throwing on a read failure, and it logs the PostgREST error, because since `00243` made `bookings.host_id` NOT NULL a null return means the insert fails with `23502` and that log line is the only diagnostic separating "no host row" from "the read failed".

Add to `platform.ts`'s frozen-seam inventory, under the "correct by construction" heading:

```
 *   - the GHL booking webhook's HOST (app/api/webhooks/ghl-booking/route.ts),
 *     via platformHostId() below. Not a caller that cannot resolve: the GHL
 *     calendar is the one Calendly REPLACES, it will never be per-coach, and
 *     so the platform's own host is the right answer rather than a placeholder
 *     awaiting a later phase. The Calendly webhook stopped calling it in
 *     phase 2, when a connection row began carrying the host.
```

Update `__tests__/lib/db/bookings.test.ts` to import `platformHostId` from its new home — **retarget the tests, do not delete them.** They pin the read-failure path, which is exactly the behaviour that must survive the move.

- [ ] **Step 2: Write the failing route test**

`__tests__/api/webhooks/calendly-tenant-resolution.test.ts` asserts, against the real route with a valid signature:

1. A delivery whose `event_type` matches a connection ingests with **that row's** `businessId`/`hostId`/`connectionId` — asserting the **values**, not merely that ingest was called.
2. A delivery matching only `CALENDLY_EVENT_TYPE_URI` ingests with the platform ids and `connectionId: null`.
3. A delivery matching neither answers **200** and calls `ingestBooking` **zero** times.
4. A resolver throw answers **500** (so Calendly retries) and calls `ingestBooking` zero times.
5. **Control:** an unrecognised event type never produces a 5xx — assert `res.status` is `200`, pinning the constraint that a subscription must not be disabled.

- [ ] **Step 3: Run it and watch it fail.** `npx vitest run __tests__/api/webhooks/calendly-tenant-resolution.test.ts`

- [ ] **Step 4: Rewrite the route's resolution block**

Replace lines 183-191 (the env event-type gate) and 210-211 (the two placeholders) with a single call to `resolveCalendlyTenant`. Delete the `platformBusinessId` and `singletonHostId` imports from this file. Rewrite the route's header comment so the paragraph describing the env gate describes the connection lookup and the ramp instead — a header comment that documents deleted behaviour is worse than none.

- [ ] **Step 5: Run the whole affected set**

```bash
npx vitest run __tests__/api/webhooks/calendly-tenant-resolution.test.ts \
  __tests__/api/webhooks/calendly-booking.test.ts \
  __tests__/api/webhooks/ghl-booking-attribution.test.ts \
  __tests__/lib/db/bookings.test.ts \
  __tests__/lib/bookings/calendly-tenant.test.ts
```

Expected: all PASS, non-zero count. Then confirm nothing still imports the old name:

```bash
grep -rn "singletonHostId" --include='*.ts' --include='*.tsx' . | grep -v node_modules
```

Expected: **no matches** outside comments describing the rename.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/calendly/route.ts lib/db/bookings.ts lib/tenancy/platform.ts \
        app/api/webhooks/ghl-booking/route.ts __tests__/
git commit -m "feat(calendly): the webhook derives its tenant from a connection row"
```

---

### Task 8: The OAuth routes

**Files:**
- Create: `app/api/admin/bookings/calendar/connect/route.ts`
- Create: `app/api/admin/bookings/calendar/callback/route.ts`
- Create: `lib/calendly/connect-env.ts` (reads `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`, redirect URI)
- Modify: `.env.example`
- Test: `__tests__/api/admin/calendar-oauth.test.ts`

**Interfaces:**
- Consumes: Tasks 2-5. `resolveAdminTenantForRequest` from `@/lib/tenancy/resolve`.
- Produces: the two routes; cookie names `calendly_oauth_nonce`, `calendly_oauth_verifier`.

- [ ] **Step 1: Write the failing test**

Assert, for the **callback**, that each of these writes **nothing** (`connectCoachCalendar` called zero times) and redirects with the stated reason:

| Case | Reason |
|---|---|
| state absent | `state` |
| state signed with a different secret | `state` |
| state older than 600s | `state` |
| nonce cookie missing | `state` |
| nonce cookie present but different from the state's nonce | `state` |
| verifier cookie missing | `pkce` |
| `?error=access_denied` | `declined` |
| token exchange non-200 | `exchange` |
| `/users/me` non-200 | `identity` |

Plus a **positive control**: a fully valid callback calls `connectCoachCalendar` exactly once with `business_id` and `host_id` taken **from the signed state**, and clears both cookies. Without that control, every assertion above passes just as well if the route is broken and never writes at all.

For **connect**: the redirect URL carries `code_challenge_method=S256`, and both cookies are set `httpOnly` with `maxAge` 600.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement the two routes**

- `connect` resolves `businessId` via `resolveAdminTenantForRequest(request)`, reads the business's `booking_hosts` row for `host_id`, mints the PKCE pair and the signed state, sets both cookies (`httpOnly`, `sameSite: "lax"`, `secure` in production, `path: "/api/admin/bookings/calendar"`, `maxAge: 600`), and redirects.
- `callback` verifies state → nonce cookie → verifier cookie → exchanges → `fetchIdentity` → `connectCoachCalendar` → redirects to `/admin/bookings/calendar?calendar=connected`. **Both cookies are deleted on every exit path**, success or failure; a verifier that outlives its exchange is a reusable one.
- The state secret is `NEXTAUTH_SECRET`, as `lib/ads/oauth.ts`'s callers already do.

Add to `.env.example` under the existing Calendly block:

```
# CALENDLY_CLIENT_ID / CALENDLY_CLIENT_SECRET  The OAuth app, created at
#                        calendly.com -> Integrations & apps -> API & webhooks
#                        -> OAuth applications. Redirect URI must be exactly
#                        <origin>/api/admin/bookings/calendar/callback.
#                        These replace the per-account CALENDLY_API_TOKEN for
#                        every coach who connects; the four values above remain
#                        as the platform's own not-yet-connected path.
CALENDLY_CLIENT_ID=
CALENDLY_CLIENT_SECRET=
```

- [ ] **Step 4: Run — expect PASS, non-zero count.**

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookings/calendar lib/calendly/connect-env.ts .env.example __tests__/api/admin/calendar-oauth.test.ts
git commit -m "feat(calendly): a coach can connect their own Calendly, with PKCE and a nonce that is checked"
```

---

### Task 9: Event-type selection, disconnect, conflict confirmation

**Files:**
- Create: `app/api/admin/bookings/calendar/event-type/route.ts` (GET list, POST select)
- Create: `app/api/admin/bookings/calendar/disconnect/route.ts` (POST)
- Create: `app/api/admin/bookings/calendar/conflict-check/route.ts` (POST)
- Test: `__tests__/api/admin/calendar-event-type.test.ts`

- [ ] **Step 1: Write the failing test**

Pin these properties:

1. `POST /event-type` writes `event_type_uri` **and** registers the subscription, storing `webhook_subscription_uri`.
2. A `CalendlyPlanRequiredError` from registration sets status **`plan_lapsed`** and answers 402 with a message naming a paid Calendly plan — assert the **message text**, because "an error was returned" passes for the generic one this exists to avoid.
3. A `23505` on `coach_calendar_connections_event_type_key` answers 409 with a message saying the event type is already connected to another calendar.
4. `POST /disconnect` deletes the subscription **before** the vault secret — assert call order, since a failure between them must leave credentials that can still authenticate the retry.
5. A subscription delete that 404s does not stop the disconnect.
6. `POST /conflict-check` with `{confirmed: true}` stamps the timestamp; `{confirmed: false}` clears it.
7. Every route refuses a caller the tenant resolver rejects.

- [ ] **Step 2: Run and watch it fail.**
- [ ] **Step 3: Implement.** Use `withAudit()` from `lib/audit/with-audit.ts` where the existing admin routes do, and add the needed action slugs to `lib/audit/actions.ts` (`calendar.connected`, `calendar.disconnected`, `calendar.event_type_selected`) — the taxonomy is a closed set, so a new event means a new row there.
- [ ] **Step 4: Run — expect PASS, non-zero count.**
- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookings/calendar lib/audit/actions.ts __tests__/api/admin/calendar-event-type.test.ts
git commit -m "feat(calendly): pick the consult event type, and own the webhook subscription that follows"
```

---

### Task 10: The screen — `/admin/bookings/calendar`

**Files:**
- Create: `app/(admin)/admin/bookings/calendar/page.tsx`
- Create: `components/admin/bookings/CalendarConnectionCard.tsx`
- Modify: `app/(admin)/admin/bookings/page.tsx` (a link to the new page)

- [ ] **Step 1: Build the page**

Server component: `resolveAdminTenant()` → the business's `booking_hosts` row → `getCoachCalendarConnection(hostId)`. Renders `CalendarConnectionCard` in one of four states — no host, not connected, connected without an event type, connected with one — inside `DataTableCard` chrome (`rounded-xl border border-border bg-white shadow-sm`).

Copy rules, from the house standard: name controls exactly as they appear, then say what they mean in plain words. **No jargon** — no "OAuth", "authorize", "integration", "sync", "endpoint". Short sentences, one idea each.

- Not connected: *"Connect your Calendly so bookings land here automatically. You keep your own Calendly account — we only read the times you're free and get told when someone books."* Button: **Connect Calendly**.
- Connected, no event type: *"Which of your Calendly meetings is the consult? Pick one. We'll watch that one for new bookings."*
- Connected, chosen: the account name and email, the event type name and its public page, a **Disconnect** button, and the conflict-check block from spec §6.3 with `DataTableBadge tone="warning"` when unconfirmed.
- `plan_lapsed`: *"Calendly only sends us bookings on a paid plan (Standard, Teams or Enterprise). Upgrade in Calendly, then pick your meeting again."*

Remember `DataTableEmpty` renders its own `<tr>` — do not wrap it in `DataTableRow`.

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | sed -E 's/\(.*//' | sort > /tmp/after.txt
diff /tmp/phase2-base.txt /tmp/after.txt   # expect NO new lines
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/bookings" components/admin/bookings
git commit -m "feat(calendly): the screen a coach connects their own calendar from"
```

---

### Task 11: Per-business availability

**Files:**
- Create: `lib/calendly/config-for-business.ts`
- Test: `__tests__/lib/calendly/config-for-business.test.ts`

- [ ] **Step 1: Write the failing test.** Pin: a business with a connected row returns that row's token and event type; a business with **no** connection falls back to `readCalendlyConfig()`; a business whose connection has no `event_type_uri` yet falls back too (a connection without a chosen event type cannot answer an availability question); and a **read failure throws** rather than silently falling back to the platform's calendar.

- [ ] **Step 2: Run and watch it fail.**
- [ ] **Step 3: Implement.** Document that this is inert until phase 4, because `/api/ask` still resolves its tenant with `platformBusinessId()` — building it now means phase 4 changes one resolver instead of rediscovering that availability was hard-wired.
- [ ] **Step 4: Run — expect PASS, non-zero count.**
- [ ] **Step 5: Commit**

```bash
git add lib/calendly/config-for-business.ts __tests__/lib/calendly/config-for-business.test.ts
git commit -m "feat(calendly): availability reads a business's own connection when it has one"
```

---

### Task 12: Verification, screenshots, and the journal

- [ ] **Step 1: Full targeted run**

```bash
npx vitest run __tests__/lib/calendly __tests__/lib/db/coach-calendar-connections.test.ts \
  __tests__/lib/db/bookings.test.ts __tests__/lib/bookings/calendly-tenant.test.ts \
  __tests__/api/webhooks/calendly-booking.test.ts \
  __tests__/api/webhooks/calendly-tenant-resolution.test.ts \
  __tests__/api/webhooks/ghl-booking-attribution.test.ts \
  __tests__/api/admin/calendar-oauth.test.ts __tests__/api/admin/calendar-event-type.test.ts
```

Record the real numbers. **A "no tests" line for any file is a crash, not a pass.**

- [ ] **Step 2: tsc set comparison and build**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | sed -E 's/\(.*//' | sort > /tmp/after.txt
diff /tmp/phase2-base.txt /tmp/after.txt    # must be empty
npm run build 2>&1 | tail -30
```

Compare the **set**. A falling count hides a new error just as well as a rising one hides nothing.

- [ ] **Step 3: Screenshots, driven against the real app**

Write `scripts/capture-calendly-phase2-screenshots.mjs` following `scripts/capture-phase1-multicoach-screenshots.mjs`. Drive the **real** `/admin/bookings/calendar` route in a signed-in browser — not a harness, not a storybook, not a preview page. Capture the not-connected state, the event-type picker, the connected state with the conflict-check warning, and the `plan_lapsed` message. Burn numbered markers and captions **into** the PNGs at the capture's exact pixel width. Write them to `screenshots/calendly-per-coach-phase2/`.

Reaching the connected state needs a real Calendly OAuth app. If one does not exist, **stop and say so** — capture the reachable states and record exactly which state could not be reached and why. Do not fabricate one, and do not mutate production data to reach it.

Derive marker positions from `boundingBox()` × device scale factor, and make the helper **warn loudly** when a target matches nothing — a helper that degrades politely turns a broken annotation into a silent no-op.

- [ ] **Step 4: Update `JOURNAL.md`** (local only, gitignored — never stage it). Newest first, dated, tagged `[Feature build-out]`, with a **mistakes made + lesson** section. That section is the point of the journal.

- [ ] **Step 5: Commit the screenshots and the script**

```bash
git add screenshots/calendly-per-coach-phase2 scripts/capture-calendly-phase2-screenshots.mjs
git commit -m "docs(calendly): annotated screenshots of the connect flow, driven through the real screen"
```

---

## Self-review

**Spec coverage.** §2 → Task 1. §3 → Tasks 1 (CAS) and 4 (classification). §4 → Tasks 3 and 8. §5 → Tasks 6 and 7. §6 → Tasks 9 and 10. §7 → Task 11. §8 → every task's test step plus Task 12. §9 → Task 1's additive-only migration. §10 (out of scope) → no tasks, correctly.

**Placeholders.** None: every code step carries real code, every verification step carries the exact command and its expected output.

**Type consistency.** `CoachCalendarConnection` (Task 2) is consumed by Tasks 4, 6, 10, 11 under that name. `CalendlyOAuthError.kind` values (`invalid_grant | http | network | shape`) are used identically in Tasks 3 and 4. `resolveCalendlyTenant`'s three-arm return (Task 6) is consumed with the same arm names in Task 7. `CalendlyPlanRequiredError` (Task 5) is caught in Task 9. `platformHostId` (Task 7) is injected in Task 6's test as `platformHostId`.

**One ordering note.** Task 6's implementation references `platformHostId`, which Task 7 creates. Either order works — Task 6 can import `singletonHostId` and Task 7 renames it as part of a mechanical sweep — but running Task 7 first avoids a rename inside a just-written file.
