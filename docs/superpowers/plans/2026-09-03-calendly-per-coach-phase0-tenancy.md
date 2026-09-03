# Calendly per coach — phase 0 (tenancy foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a second coach possible at the schema and the consequence chain — every booking lands stamped with a `business_id` and a `host_id`, and all four of its consequences are scoped to that business instead of falling to a hard-coded constant.

**Architecture:** Four additive migrations staged across three logical deploys (tables → columns → code → tighten), then the booking ingest split into four named stages and threaded with a required tenant. Nothing about Calendly changes in this phase; the shipped adapter keeps working, passing the singleton explicitly. Phase 2 is what swaps that constant for a connection row.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres 17.6, `@supabase/supabase-js` service-role client, Vitest, TypeScript.

**Spec:** [docs/superpowers/specs/2026-09-03-calendly-per-coach-phase0-tenancy-design.md](../specs/2026-09-03-calendly-per-coach-phase0-tenancy-design.md)

## Global Constraints

- **Worktree:** `.claude/worktrees/calendly-per-coach`, branch `feat/calendly-per-coach`. **Never** switch the main checkout's branch — peer Claude sessions commit to `feat/calendly-booking` in it.
- **Never push to `main`. Never merge. Never deploy.** Commit to the branch only.
- **No Claude attribution** in any commit message. No `Co-Authored-By`, no "Generated with" footer.
- **`tsc --noEmit` baseline is EXACTLY 251 errors**, measured in this worktree at `225b7fb4`. Compare the count *and* the file list — a falling count hides new errors too.
- **Targeted tests only.** `npx vitest run <path>`. Never the full suite.
- **Every jsdom vitest suite in this repo reports "no tests" (`ERR_REQUIRE_ESM`).** Put `// @vitest-environment node` at the top of every suite you create or touch, and confirm the run reports a non-zero test count. A suite reporting "no tests" looks exactly like a suite that passes.
- **`.env.local` points at the DEV CLONE** (project ref `anjvztjiokcgiyhobknq`). **Never load `.env.prod`. Never call any `supabase-prod` MCP tool.**
- **Migrations go to the dev clone via the `supabase` MCP `apply_migration` tool** and are then **read back** with `execute_sql`. `public.repo_migrations` does not exist on the clone — that ledger is production's GitHub Action, not this path.
- **`CREATE POLICY` has no `IF NOT EXISTS`.** Write the bare `CREATE POLICY` in the `.sql`, with the house comment (see `00231_pipeline_rls.sql:36-39`). **Never** put a `DROP POLICY` in a migration file. If you must re-apply during iteration, drop the objects by hand first.
- **Check the migration number before writing each file.** `00239` is the highest on this branch, but a peer session may have claimed `00240` in the meantime and git merges a collision clean. `ls supabase/migrations/ | tail -3` first, every time.
- **Do not add a `CHECK` to `bookings.source`.** Production rows cannot be read from a branch and a losing bet fails the migration mid-deploy.
- Singleton business id is the literal `00000000-0000-0000-0000-000000000001`, exported as `SINGLETON_BUSINESS_ID` from `lib/lead-engine/constants.ts:3`.
- Quote grep globs under zsh: `--include='*.ts'`. An unquoted glob prints "no matches found" and a count of 0 that looks like an answer.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `supabase/migrations/00240_booking_tenancy_tables.sql` | The eight new tables, their RLS, and the two backfills that make the singleton a real tenant |
| `supabase/migrations/00241_bookings_tenant_columns.sql` | Seven nullable columns on `bookings`, their backfill, three indexes, RLS on `bookings` |
| `supabase/migrations/00242_google_ads_accounts_business_id.sql` | `business_id` on `google_ads_accounts`, singleton default |
| `supabase/migrations/00243_bookings_tenant_not_null.sql` | The tightening: three `NOT NULL`s and the range check. A **later deploy** than 00241 |
| `__tests__/db/sequences-tenancy.test.ts` | That `exitRunsForContact` refuses to touch another business's runs |
| `__tests__/lib/bookings/ingest-tenancy.test.ts` | That the fan-out is scoped to members, the zone is the business's, and the ads account is resolved per business |

**Modified**

| Path | Change |
|---|---|
| `lib/bookings/ingest.ts` | Split four ways; `businessId`/`hostId` required on the input; writes seven new columns; fan-out narrowed; zone fixed |
| `lib/db/sequences.ts:503` | `exitRunsForContact` gains a third parameter and a `business_id` predicate |
| `lib/lead-engine/unsubscribe.ts:95`, `app/api/webhooks/twilio/inbound/route.ts:265`, `app/api/stripe/webhook/route.ts:204` | Pass the tenant to `exitRunsForContact` |
| `lib/lead-engine/capture.ts` | `CaptureLeadInput` gains `businessId?`, threaded to `recordContactEvent` |
| `lib/ads/conversions.ts` | `enqueueBookingConversion` takes a required `business_id` and resolves that business's account |
| `lib/db/google-ads-accounts.ts:19` | `getActiveGoogleAdsAccounts` takes an optional `businessId` |
| `app/api/webhooks/calendly/route.ts`, `app/api/webhooks/ghl-booking/route.ts` | Pass the singleton's business and host explicitly; Calendly additionally passes the conversation id and invitee timezone it already parses |
| `__tests__/lib/bookings/ingest.test.ts`, `__tests__/api/webhooks/calendly-booking.test.ts`, `__tests__/api/webhooks/sequence-exit-hooks.test.ts`, `__tests__/api/webhooks/pipeline-hooks.test.ts`, `__tests__/db/sequences.test.ts` | Retargeted, not rewritten |

---

## Task 1: Migration 00240 — the eight tables

**Files:**
- Create: `supabase/migrations/00240_booking_tenancy_tables.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `booking_hosts`, `business_members`, `business_domains`, `booking_types`, `booking_availability_rules`, `booking_availability_overrides`, `coach_calendar_connections`, `booking_notifications`; columns `businesses.slug|status|booking_provider|created_by`; the unique index `booking_hosts_id_business_key on (id, business_id)` that tasks 2's `host_id` foreign key needs.

- [ ] **Step 1: Confirm the migration number is still free**

```bash
cd "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees/calendly-per-coach"
ls supabase/migrations/ | tail -3
```

Expected: `00239_calendly_bookings.sql` is the highest. If `00240` exists, use the next free number and say so in your report.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/00240_booking_tenancy_tables.sql`. The statement order below is load-bearing — assembled any other way the migration fails with `42P01`, because `booking_types` and `coach_calendar_connections` both reference `booking_hosts`, and `booking_notifications` references `bookings`.

```sql
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
```

- [ ] **Step 3: Apply to the dev clone**

Use the `supabase` MCP tool `apply_migration` with `project_id: "anjvztjiokcgiyhobknq"`, `name: "booking_tenancy_tables"`, and the file's contents as `query`.

- [ ] **Step 4: Read it back — the apply returning success is not the proof**

Run this with `execute_sql` against `anjvztjiokcgiyhobknq`:

```sql
select
  (select count(*) from information_schema.tables where table_schema='public'
     and table_name in ('booking_hosts','business_members','business_domains','booking_types',
                        'booking_availability_rules','booking_availability_overrides',
                        'coach_calendar_connections','booking_notifications')) as tables,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('booking_hosts','business_members','business_domains','booking_types',
                       'booking_availability_rules','booking_availability_overrides',
                       'coach_calendar_connections','booking_notifications')) as policies,
  (select count(*) from public.business_members) as members_backfilled,
  (select count(*) from public.booking_hosts)    as hosts_backfilled,
  (select slug from public.businesses where id='00000000-0000-0000-0000-000000000001') as singleton_slug,
  (select count(*) from public.users where role='admin') as admin_users;
```

Expected: `tables=8`, `policies=8`, `members_backfilled` equals `admin_users` (1 on the clone), `hosts_backfilled=1`, `singleton_slug='primary'`.

**If `members_backfilled` does not equal `admin_users`, stop and report.** That equality is the whole safety argument for task 6.

- [ ] **Step 5: Prove the composite foreign key actually refuses a cross-tenant row**

The two-column FK is the reason this table shape was chosen over the champion proposal's. Prove it rejects, rather than assuming it:

```sql
begin;
insert into public.businesses (id, name, slug) values (gen_random_uuid(), 'Probe B', 'probe-b');
-- a connection naming business B but the singleton's host must be refused
insert into public.coach_calendar_connections (business_id, host_id, provider)
select (select id from public.businesses where slug='probe-b'),
       (select id from public.booking_hosts limit 1),
       'calendly';
rollback;
```

Expected: **error 23503** (`foreign key violation`) on the second insert. If it inserts successfully, the composite key is wrong and the whole tenancy argument fails — stop and report.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00240_booking_tenancy_tables.sql
git commit -m "feat(bookings): the eight tables a second coach needs

Phase 0a. A coach is a business; the person whose calendar a booking lands on
is a host. Membership carries access, hosts carry calendars — which is why
neither is a new value in users.role, an enum every exhaustive two-branch
conditional in the admin already assumes.

coach_calendar_connections is a new table rather than a business_id on
platform_connections: that table's plugin_name is UNIQUE with no tenant column
and fn_connect_platform overwrites the Vault secret in place, so a second coach
connecting silently replaces the first coach's token. It is keyed on the host
with a composite FK into booking_hosts(id, business_id), so a row cannot name
one business and another's host.

The business_members backfill inserts EVERY current admin, not one owner,
because the fan-out change that follows narrows notifications to members."
```

---

## Task 2: Migration 00241 — `bookings` grows a tenant

**Files:**
- Create: `supabase/migrations/00241_bookings_tenant_columns.sql`

**Interfaces:**
- Consumes: `booking_hosts`, `coach_calendar_connections` from task 1.
- Produces: `bookings.business_id` (nullable, singleton default), `.host_id`, `.connection_id`, `.contact_id`, `.chat_conversation_id`, `.end_at`, `.invitee_timezone`; RLS on `bookings`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00241_bookings_tenant_columns.sql
-- Calendly per coach, phase 0a part 2: bookings learns whose booking it is.
--
-- ADDITIVE AND NULLABLE, DELIBERATELY. Migrations and Vercel race on a push to
-- main, unsequenced. The previous build must keep inserting successfully for
-- the one deploy where this has landed and the code has not -- so nothing here
-- is NOT NULL and business_id carries a singleton DEFAULT. 00243 tightens, in a
-- LATER deploy, once every writer passes all three. Setting a column NOT NULL
-- while the previous build is still serving is how a migration takes
-- production down.
--
-- SEVEN COLUMNS, AND ONLY SEVEN. The parent design spec lists twenty-six on
-- this table. The nineteen not here -- google_event_id, google_ical_uid,
-- google_sync_status, google_calendar_id, google_etag, idempotency_key,
-- ip_hash, sequence, rescheduled_count, cancelled_at, cancelled_by,
-- cancel_reason, location_kind, location_value, visitor_timezone,
-- host_timezone, consequences_error -- belong to the NATIVE booking path and
-- its manage page. Calendly holds the calendar, so nothing in this build would
-- ever write a Google event id. Every column below has a writer landing in this
-- same phase.
--
-- booking_date KEEPS ITS NAME. It is the start instant, and seven read sites
-- plus the attribution join name it. end_at beside it is the honest minimum;
-- renaming it to start_at is a drive-by with a blast radius.
--
-- NO CHECK ON source. 00239 settled that: production's rows cannot be read from
-- a branch and a losing bet fails the migration Action mid-deploy.

alter table public.bookings
  add column if not exists business_id          uuid references public.businesses(id)
                                                default '00000000-0000-0000-0000-000000000001',
  add column if not exists host_id              uuid references public.booking_hosts(id),
  add column if not exists connection_id        uuid references public.coach_calendar_connections(id) on delete set null,
  add column if not exists contact_id           uuid references public.contacts(id) on delete set null,
  add column if not exists chat_conversation_id uuid references public.chat_conversations(id) on delete set null,
  add column if not exists end_at               timestamptz,
  add column if not exists invitee_timezone     text;

update public.bookings set business_id = '00000000-0000-0000-0000-000000000001'
 where business_id is null;

-- Explicitly "the business's first host": the join form picks one arbitrarily
-- and silently the day a business has two.
update public.bookings b
   set host_id = (select h.id from public.booking_hosts h
                   where h.business_id = b.business_id
                   order by h.created_at limit 1)
 where b.host_id is null;

-- greatest(..., 1) because 00050:6 is `duration_minutes int DEFAULT 30` with no
-- positivity CHECK. A stored 0 or a negative would give end_at <= booking_date,
-- which 00243's range check then refuses -- mid-deploy, on production data this
-- branch cannot read. The dev clone reports zero such rows; the clone is not
-- production.
update public.bookings
   set end_at = booking_date + make_interval(mins => greatest(coalesce(duration_minutes, 30), 1))
 where end_at is null;

create index if not exists bookings_business_id on public.bookings (business_id);
create index if not exists bookings_host_start  on public.bookings (host_id, booking_date);
create index if not exists bookings_contact_id  on public.bookings (contact_id) where contact_id is not null;

-- RLS. Every one of the seven from("bookings") call sites in this repo uses the
-- service-role key, including the Firebase twin at functions/src/ai/
-- admin-tools.ts, whose client comes from functions/src/lib/supabase.ts and
-- reads SUPABASE_SERVICE_ROLE_KEY. Enumerated before this line was written --
-- without RLS these new tenant columns are readable with the publishable key.
alter table public.bookings enable row level security;

-- NOTE: CREATE POLICY has no IF NOT EXISTS in Postgres, so this statement is
-- NOT re-runnable. Any local applier that replays migrations must carry its own
-- DROP POLICY guard -- do not add one to this file.
create policy "Service role full access on bookings"
  on public.bookings for all to service_role using (true) with check (true);
```

- [ ] **Step 2: Apply to the dev clone**

MCP `apply_migration`, `project_id: "anjvztjiokcgiyhobknq"`, `name: "bookings_tenant_columns"`.

- [ ] **Step 3: Read back, including the two preconditions 00243 will need**

```sql
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='bookings'
     and column_name in ('business_id','host_id','connection_id','contact_id',
                         'chat_conversation_id','end_at','invitee_timezone')) as new_columns,
  (select count(*) from pg_policies where schemaname='public' and tablename='bookings') as policies,
  (select relrowsecurity from pg_class where oid='public.bookings'::regclass) as rls_on,
  (select count(*) from public.bookings where business_id is null or host_id is null or end_at is null) as unbackfilled,
  (select count(*) from public.bookings where end_at <= booking_date) as bad_ranges;
```

Expected: `new_columns=7`, `policies=1`, `rls_on=true`, `unbackfilled=0`, `bad_ranges=0`.

- [ ] **Step 4: Prove the service-role DAL still reads the table with RLS on**

RLS silently returns zero rows to the wrong role rather than erroring, so "it applied" proves nothing. Run:

```bash
npx tsx -e '
import { createServiceRoleClient } from "./lib/supabase"
const s = createServiceRoleClient()
const { data, error } = await s.from("bookings").select("id, business_id, host_id, end_at").limit(5)
console.log("error:", error?.message ?? "none", "rows:", data?.length ?? 0)
console.log(data)
'
```

Expected: `error: none`, `rows: 5` (the clone has 6 bookings), and every row shows a non-null `business_id`, `host_id` and `end_at`. **If rows is 0, RLS is wrong** — the policy did not attach or the client is not service-role. Stop and report.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00241_bookings_tenant_columns.sql
git commit -m "feat(bookings): bookings learns whose booking it is

Seven nullable columns, backfilled to the singleton, plus RLS. Nullable and
singleton-defaulted on purpose: migrations and Vercel race on a push to main,
so the previous build has to keep inserting for one deploy. 00243 tightens.

Seven columns and not the parent spec's twenty-six. The nineteen left out are
native-path columns — Calendly holds the calendar, so nothing here would ever
write a Google event id. Every column added has a writer landing this phase.

RLS was verified safe first by enumerating all seven from(\"bookings\") call
sites, including the Firebase twin, and confirming each uses the service-role
key. There is no anon-key read of bookings in the repo."
```

---

## Task 3: Split `ingestBooking` four ways — a pure refactor

**Files:**
- Modify: `lib/bookings/ingest.ts:124-311`
- Test: `__tests__/lib/bookings/ingest.test.ts`, `__tests__/api/webhooks/calendly-booking.test.ts` (run, do not edit)

**Interfaces:**
- Consumes: nothing new.
- Produces: four module-private functions that task 5 threads a tenant through:
  - `readAndGate(ctx, input): Promise<{ existing: ExistingRow | null; staleReturn: BookingIngestResult | null }>`
  - `runContactConsequences(ctx, input): Promise<void>`
  - `writeRow(ctx, input, existing): Promise<{ result: BookingIngestResult; bookingId: string | null; clickIds: ClickIds }>`
  - `runPostWriteEffects(ctx, input, bookingId, clickIds): Promise<void>`
  - `type IngestCtx = { supabase: ReturnType<typeof createServiceRoleClient>; log: string }`

**This task changes no behaviour.** Threading a tenant through code you have just restructured makes a failure ambiguous between the two changes, which is the whole reason this is its own task.

- [ ] **Step 1: Record the green baseline before touching anything**

```bash
npx vitest run __tests__/lib/bookings/ingest.test.ts __tests__/api/webhooks/calendly-booking.test.ts 2>&1 | tail -15
```

Write down the exact number of passing tests. Expected: both files report a non-zero test count and all pass. **If either reports "no tests", stop** — check for the `// @vitest-environment node` pragma before going further.

- [ ] **Step 2: Perform the split**

Move code; do not rewrite it. Every comment block in `ingestBooking` travels with the code it explains — those comments record why the ordering is what it is (the status-gate asymmetry between `exitRunsForContact` and `applyPipelineEvent`, the reschedule skip, the 23505 path) and losing them loses the reasoning.

`ingestBooking` becomes the orchestrator:

```ts
export async function ingestBooking(input: BookingIngestInput): Promise<BookingIngestResult> {
  const ctx: IngestCtx = { supabase: createServiceRoleClient(), log: `[booking-ingest:${input.source}]` }

  const { existing, staleReturn } = await readAndGate(ctx, input)
  if (staleReturn) return staleReturn

  await runContactConsequences(ctx, input)

  const { result, bookingId, clickIds } = await writeRow(ctx, input, existing)
  if (result.action === "created") {
    await runPostWriteEffects(ctx, input, bookingId, clickIds)
  }
  return result
}
```

The boundaries, taken from the current line numbers:

- `readAndGate` — the read-by-key (`:131`) and the stale-terminal gate (`:133-139`). Returns `staleReturn` non-null only for the ignore case.
- `runContactConsequences` — the whole `if (!input.rescheduled) { try { … } catch { … } }` block (`:159-177`), never-rethrow intact.
- `writeRow` — click-id resolution and the email fallback (`:180-193`), the `if (existing) return updateExisting(…)` branch, the insert row construction, the `23505` re-read, and the `recordAudit` for a new row (`:246-263`). Returns the resolved `clickIds` so the ads effect does not resolve them twice.
- `runPostWriteEffects` — the `countsAsNew` computation, the ads conversion (`:269-286`) and the admin notification (`:288-308`).

`countsAsNew` is computed inside `runPostWriteEffects`; the update path already returns before it in the current code, and the orchestrator's `result.action === "created"` guard preserves that exactly.

- [ ] **Step 3: Run the same two suites and compare test-for-test**

```bash
npx vitest run __tests__/lib/bookings/ingest.test.ts __tests__/api/webhooks/calendly-booking.test.ts 2>&1 | tail -15
```

Expected: the **same** count as step 1, all passing. A different count means a test was skipped or lost, not that the refactor worked.

- [ ] **Step 4: Confirm the type-check has not moved**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: exactly `251`.

- [ ] **Step 5: Commit**

```bash
git add lib/bookings/ingest.ts
git commit -m "refactor(bookings): split the ingest into its four stages

readAndGate / runContactConsequences / writeRow / runPostWriteEffects. A pure
move — no signature changed and no behaviour did. The two suites report the
same test count, all green, and tsc is unchanged at 251.

Done as its own commit because the tenant threading that follows would
otherwise make any failure ambiguous between the restructure and the change."
```

---

## Task 4: `exitRunsForContact` gains a tenant

**Files:**
- Modify: `lib/db/sequences.ts:503-521`
- Modify: `lib/bookings/ingest.ts` (the call inside `runContactConsequences`), `lib/lead-engine/unsubscribe.ts:95`, `app/api/webhooks/twilio/inbound/route.ts:265`, `app/api/stripe/webhook/route.ts:204`
- Test: create `__tests__/db/sequences-tenancy.test.ts`; retarget `__tests__/db/sequences.test.ts:365-395`, `__tests__/api/webhooks/sequence-exit-hooks.test.ts`, `__tests__/api/webhooks/pipeline-hooks.test.ts`, `__tests__/lib/bookings/ingest.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `exitRunsForContact(contactId: string, reason: SequenceExitReason, businessId: string): Promise<number>` where `type SequenceExitReason = "booking" | "unsubscribed" | "sms_stop" | "payment"`.

**This is the most dangerous signature in the phase.** Today it is `(contactId: string, reason: string)`. A `businessId` passed as the second argument **type-checks** — both are strings — and would write a uuid into `sequence_runs.exit_reason` while applying no tenant predicate at all: the exact leak this change exists to close. The new `reason` parameter is therefore typed as a **union, not `string`**, so `tsc` refuses a uuid in that position.

- [ ] **Step 1: Write the failing test**

Create `__tests__/db/sequences-tenancy.test.ts`:

```ts
// @vitest-environment node
//
// exitRunsForContact is the one scoped-table write in the booking chain that
// had no business_id predicate. It was correct only by accident — contact_id
// happens to be tenant-unique today — and the accident ends the moment two
// businesses exist. This suite is the predicate's only proof.
import { describe, it, expect, vi, beforeEach } from "vitest"

const BUSINESS_A = "00000000-0000-0000-0000-000000000001"
const BUSINESS_B = "00000000-0000-0000-0000-0000000000b2"

// Records every .eq() applied to the update, so the test can assert the
// PREDICATE and not merely the return value. A mock that returns rows proves
// nothing about which rows the database would have matched.
let appliedEqs: Array<[string, unknown]>

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "sequence_runs") throw new Error(`unmocked table ${table}`)
      const chain: any = {
        update: () => chain,
        eq: (col: string, val: unknown) => {
          appliedEqs.push([col, val])
          return chain
        },
        select: () => Promise.resolve({ data: [{ id: "run-1" }], error: null }),
      }
      return chain
    },
  }),
}))

import { exitRunsForContact } from "@/lib/db/sequences"

describe("exitRunsForContact tenancy", () => {
  beforeEach(() => {
    appliedEqs = []
  })

  it("filters on business_id, not just contact_id and status", async () => {
    await exitRunsForContact("c-1", "booking", BUSINESS_B)
    expect(appliedEqs).toContainEqual(["business_id", BUSINESS_B])
    expect(appliedEqs).toContainEqual(["contact_id", "c-1"])
    expect(appliedEqs).toContainEqual(["status", "active"])
  })

  it("writes the reason into exit_reason and never the business id", async () => {
    let updatePayload: Record<string, unknown> | null = null
    vi.resetModules()
    vi.doMock("@/lib/supabase", () => ({
      createServiceRoleClient: () => ({
        from: () => {
          const chain: any = {
            update: (p: Record<string, unknown>) => {
              updatePayload = p
              return chain
            },
            eq: () => chain,
            select: () => Promise.resolve({ data: [], error: null }),
          }
          return chain
        },
      }),
    }))
    const { exitRunsForContact: fresh } = await import("@/lib/db/sequences")
    await fresh("c-1", "booking", BUSINESS_A)
    expect(updatePayload).toMatchObject({ exit_reason: "booking", status: "exited" })
    expect(JSON.stringify(updatePayload)).not.toContain(BUSINESS_A)
  })
})
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
npx vitest run __tests__/db/sequences-tenancy.test.ts 2>&1 | tail -20
```

Expected: FAIL. The first test fails because `appliedEqs` contains no `business_id` entry. **If it passes, the test is pinning nothing** — stop and fix the test before touching the implementation.

- [ ] **Step 3: Change the signature and add the predicate**

In `lib/db/sequences.ts`, above the function:

```ts
/**
 * Why `reason` is a union and not `string`: the third parameter is a business
 * id, and before this change the signature was (contactId, reason) — so a
 * caller passing a business id second would type-check, write a uuid into
 * exit_reason, and apply no tenant predicate at all. Typing the reason is what
 * lets tsc police the mistake this parameter exists to prevent.
 */
export type SequenceExitReason = "booking" | "unsubscribed" | "sms_stop" | "payment"
```

Then:

```ts
export async function exitRunsForContact(
  contactId: string,
  reason: SequenceExitReason,
  businessId: string,
): Promise<number> {
  const supabase = getClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from("sequence_runs")
    .update({
      status: "exited",
      exit_reason: reason,
      completed_at: nowIso,
      claimed_at: null,
      claimed_by: null,
      updated_at: nowIso,
    })
    .eq("contact_id", contactId)
    .eq("business_id", businessId)
    .eq("status", "active")
    .select("id")
  if (error) throw error
  return (data ?? []).length
}
```

Keep the existing doc comment above it and extend its "Filtered by both `contact_id` and `status`" sentence to name `business_id` too — a comment that describes the old filter set is worse than none.

- [ ] **Step 4: Update all four production callers**

```bash
grep -rn 'exitRunsForContact(' --include='*.ts' lib app | grep -v 'export async function'
```

Expected exactly four, and each takes the tenant it already has in scope:

| File:line | Call becomes |
|---|---|
| `lib/bookings/ingest.ts` (in `runContactConsequences`) | `await exitRunsForContact(contactId, "booking", input.businessId)` — **task 5 adds `input.businessId`; until then pass `SINGLETON_BUSINESS_ID` imported from `@/lib/lead-engine/constants`** |
| `lib/lead-engine/unsubscribe.ts:95` | `await exitRunsForContact(contactId, "unsubscribed", businessId)` if a `businessId` is already in scope in that function; otherwise `SINGLETON_BUSINESS_ID` |
| `app/api/webhooks/twilio/inbound/route.ts:265` | `await exitRunsForContact(contactId, "sms_stop", businessId)` — this route already resolves a business for its settings; use that value, and only fall back to `SINGLETON_BUSINESS_ID` if it genuinely has none |
| `app/api/stripe/webhook/route.ts:204` | `await exitRunsForContact(contactId, "payment", SINGLETON_BUSINESS_ID)` |

**Read each call site's surrounding function before choosing.** If a real business id is already in scope, use it — a `SINGLETON_BUSINESS_ID` where a real value was available is a leak you are choosing to leave.

- [ ] **Step 5: Retarget the existing suites that assert the two-argument call**

These assert `toHaveBeenCalledWith(contactId, reason)` and will now fail. Add the third argument to each; **do not delete any of them**:

```bash
grep -rn 'exitRunsForContactMock).toHaveBeenCalledWith\|exitRunsForContact("c-1"\|exitRunsForContact("' __tests__/
```

The known sites are `__tests__/db/sequences.test.ts:372,393,395`, `__tests__/api/webhooks/sequence-exit-hooks.test.ts:164,251,349,361,419`, `__tests__/api/webhooks/pipeline-hooks.test.ts:241,256,268`, and `__tests__/lib/bookings/ingest.test.ts:177,299`. Each becomes `…toHaveBeenCalledWith("<id>", "<reason>", "00000000-0000-0000-0000-000000000001")`.

- [ ] **Step 6: Run the new suite and every retargeted one**

```bash
npx vitest run __tests__/db/sequences-tenancy.test.ts __tests__/db/sequences.test.ts \
  __tests__/api/webhooks/sequence-exit-hooks.test.ts __tests__/api/webhooks/pipeline-hooks.test.ts \
  __tests__/lib/bookings/ingest.test.ts 2>&1 | tail -20
```

Expected: all pass, every file reporting a non-zero count.

- [ ] **Step 7: Confirm tsc caught nothing new**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: exactly `251`. If it rose, a caller was missed — `grep 'error TS' | grep -i 'exitRuns'` will name it.

- [ ] **Step 8: Commit**

```bash
git add lib/db/sequences.ts lib/bookings/ingest.ts lib/lead-engine/unsubscribe.ts \
  app/api/webhooks/twilio/inbound/route.ts app/api/stripe/webhook/route.ts \
  __tests__/db/sequences-tenancy.test.ts __tests__/db/sequences.test.ts \
  __tests__/api/webhooks/sequence-exit-hooks.test.ts __tests__/api/webhooks/pipeline-hooks.test.ts \
  __tests__/lib/bookings/ingest.test.ts
git commit -m "fix(sequences): exitRunsForContact takes the tenant it was missing

It was the one scoped-table write in the booking chain with no business_id
predicate — correct only because contact_id happens to be tenant-unique today,
which stops being true the moment a second business exists.

The reason parameter is now a union rather than string. That is the point: the
old signature was (contactId, reason), so a caller passing a business id second
type-checked, wrote a uuid into exit_reason, and applied no tenant predicate at
all. Typing the reason makes tsc refuse the exact mistake the new parameter
exists to prevent.

The new suite asserts the PREDICATE, not the return value — a mock that returns
rows proves nothing about which rows the database would have matched. Verified
red against the old signature first."
```

---

## Task 5: Thread the tenant through the ingest and both adapters

**Files:**
- Modify: `lib/bookings/ingest.ts`, `app/api/webhooks/calendly/route.ts`, `app/api/webhooks/ghl-booking/route.ts`
- Test: `__tests__/lib/bookings/ingest.test.ts`, `__tests__/api/webhooks/calendly-booking.test.ts`

**Interfaces:**
- Consumes: `exitRunsForContact(contactId, reason, businessId)` from task 4; the columns from task 2.
- Produces: `BookingIngestInput` gains `businessId: string` (**required**), `hostId: string | null`, `connectionId: string | null`, `chatConversationId: string | null`, `inviteeTimezone: string | null`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/bookings/ingest.test.ts`. The existing `input()` helper must gain `businessId` and `hostId` so every existing test keeps compiling — add them there with the singleton defaults, then add:

```ts
const BUSINESS_B = "00000000-0000-0000-0000-0000000000b2"

describe("tenant threading", () => {
  it("passes the input's business to every consequence and stamps it on the row", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("c-9")
    selectMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    insertSingle.mockResolvedValueOnce({ data: { id: "b-9" }, error: null })

    await ingestBooking(input({ businessId: BUSINESS_B, hostId: "host-b", status: "scheduled" }))

    expect(findContactByIdentifiersMock).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_B }),
    )
    expect(exitRunsForContactMock).toHaveBeenCalledWith("c-9", "booking", BUSINESS_B)
    expect(applyPipelineEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_B }),
    )
    expect(lastInsertedRow).toMatchObject({
      business_id: BUSINESS_B,
      host_id: "host-b",
      contact_id: "c-9",
    })
  })

  it("derives end_at from booking_date and duration", async () => {
    selectMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    insertSingle.mockResolvedValueOnce({ data: { id: "b-10" }, error: null })

    await ingestBooking(input({ bookingDate: "2026-09-10T14:00:00.000Z", durationMinutes: 45 }))

    expect(lastInsertedRow).toMatchObject({ end_at: "2026-09-10T14:45:00.000Z" })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run __tests__/lib/bookings/ingest.test.ts 2>&1 | tail -20
```

Expected: FAIL — `businessId` is not a property of `BookingIngestInput`, and `business_id`/`end_at` are not on the inserted row.

- [ ] **Step 3: Extend `BookingIngestInput`**

```ts
export type BookingIngestInput = {
  source: BookingSource
  /**
   * REQUIRED, and deliberately not defaulted. Every DAL function in the Lead
   * Engine takes `businessId = SINGLETON_BUSINESS_ID`, and that default is what
   * let the tenant leak this far — a booking's four consequences all landed in
   * the singleton because nobody had to say otherwise. A new field that
   * defaults the tenant is how the next leak ships.
   */
  businessId: string
  /** The host whose calendar this lands on. Null only until 00243 tightens. */
  hostId: string | null
  /** The coach_calendar_connections row this delivery matched. Null until phase 2 exists. */
  connectionId: string | null
  /** The chat conversation that produced this booking, if any. */
  chatConversationId: string | null
  /** The invitee's own timezone as the vendor reported it. */
  inviteeTimezone: string | null
  // … every existing field unchanged
}
```

- [ ] **Step 4: Use it**

In `runContactConsequences`:

```ts
const contactId = await findContactByIdentifiers({
  email: input.contact.email,
  phone: input.contact.phone,
  businessId: input.businessId,
})
if (contactId) {
  if (input.status === "scheduled" || input.status === "completed") {
    await exitRunsForContact(contactId, "booking", input.businessId)
  }
  await applyPipelineEvent({
    contactId,
    event: { kind: "booking", status: input.status, occurredAt: new Date() },
    businessId: input.businessId,
  })
}
```

`runContactConsequences` currently discards `contactId`. `writeRow` needs it for the `contact_id` column, so return it: `runContactConsequences(ctx, input): Promise<string | null>`, and the orchestrator passes it into `writeRow`. On the never-rethrow catch path it returns `null` — a failed contact resolution must still write the booking row, exactly as today.

In `readByKey`, add the tenant predicate so a redelivered vendor key can never match another tenant's row:

```ts
async function readByKey(
  supabase: ReturnType<typeof createServiceRoleClient>,
  key: { column: BookingKeyColumn; value: string },
  businessId: string,
): Promise<ExistingRow | null> {
  const { data } = await supabase
    .from("bookings")
    .select("id, status, booking_date")
    .eq(key.column, key.value)
    .eq("business_id", businessId)
    .maybeSingle()
  return (data as ExistingRow | null) ?? null
}
```

Both call sites (the initial read and the 23505 re-read) pass `input.businessId`.

In `writeRow`'s insert row:

```ts
const endAt = new Date(
  new Date(input.bookingDate).getTime() + Math.max(input.durationMinutes ?? 30, 1) * 60_000,
).toISOString()

const row: Record<string, unknown> = {
  // … every existing field unchanged
  business_id: input.businessId,
  host_id: input.hostId,
  connection_id: input.connectionId,
  contact_id: contactId,
  chat_conversation_id: input.chatConversationId,
  end_at: endAt,
  invitee_timezone: input.inviteeTimezone,
}
```

`Math.max(…, 1)` mirrors the migration's `greatest(…, 1)` — the column has no positivity CHECK, and a zero would produce `end_at === booking_date`, which 00243's range check refuses.

`updateExisting` must also maintain `end_at` when the date moves, or a reschedule leaves a stale range:

```ts
.update({
  status: input.status,
  booking_date: input.bookingDate,
  end_at: endAt,
  notes: input.notes,
  updated_at: new Date().toISOString(),
})
```

- [ ] **Step 5: Update both adapters**

`app/api/webhooks/ghl-booking/route.ts` — add to the `ingestBooking({…})` call at `:122`:

```ts
      businessId: SINGLETON_BUSINESS_ID,
      hostId: await singletonHostId(),
      connectionId: null,
      chatConversationId: null,
      inviteeTimezone: null,
```

`app/api/webhooks/calendly/route.ts` — add to the call at `:205`:

```ts
      businessId: SINGLETON_BUSINESS_ID,
      hostId: await singletonHostId(),
      connectionId: null,
      // Both of these are already parsed on this route and then thrown away:
      // the conversation id reaches only the audit row's metadata, and the
      // invitee timezone is validated at :81 and dropped. They have columns now.
      chatConversationId: tracking.conversationId ?? null,
      inviteeTimezone: data.timezone ?? null,
```

Check the exact field name for the invitee timezone against the route's Zod schema around `:81` before writing it.

Add to `lib/db/bookings.ts`:

```ts
/**
 * The one host of the one business, for the two adapters that still resolve
 * their tenant from a constant. Phase 2 replaces both call sites with the host
 * on the coach_calendar_connections row the delivery matched; until then this
 * is the honest way to say "the singleton's host" without hard-coding a uuid
 * that only exists because a backfill created it.
 *
 * Returns null rather than throwing: a missing host row must not fail a booking
 * webhook, and host_id is nullable until 00243.
 */
export async function singletonHostId(): Promise<string | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from("booking_hosts")
    .select("id")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}
```

- [ ] **Step 6: Retarget the Calendly route suite**

`__tests__/api/webhooks/calendly-booking.test.ts` asserts the shape passed to `ingestBooking`. Add the five new fields to those assertions and add one test that the two newly-carried values arrive:

```ts
it("carries the conversation id and the invitee timezone it used to drop", async () => {
  // … post a signed invitee.created payload with tracking.utm_term carrying a
  // conversation id and an invitee timezone, using this suite's existing helper
  expect(ingestBookingMock).toHaveBeenCalledWith(
    expect.objectContaining({
      businessId: "00000000-0000-0000-0000-000000000001",
      chatConversationId: expect.any(String),
      inviteeTimezone: "America/New_York",
    }),
  )
})
```

Mock `singletonHostId` in this suite — it reaches the database otherwise.

- [ ] **Step 7: Run both suites and tsc**

```bash
npx vitest run __tests__/lib/bookings/ingest.test.ts __tests__/api/webhooks/calendly-booking.test.ts \
  __tests__/api/webhooks/sequence-exit-hooks.test.ts __tests__/api/webhooks/pipeline-hooks.test.ts 2>&1 | tail -20
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: all suites green with non-zero counts; tsc exactly `251`.

- [ ] **Step 8: Commit**

```bash
git add lib/bookings/ingest.ts lib/db/bookings.ts app/api/webhooks/calendly/route.ts \
  app/api/webhooks/ghl-booking/route.ts __tests__/lib/bookings/ingest.test.ts \
  __tests__/api/webhooks/calendly-booking.test.ts
git commit -m "feat(bookings): the ingest carries a tenant, and both adapters name it

businessId is required on BookingIngestInput, not defaulted. Every Lead Engine
DAL function takes businessId = SINGLETON_BUSINESS_ID, and that default is what
let a booking's four consequences all land in the singleton because nobody had
to say otherwise.

readByKey gains the predicate too, so a redelivered vendor key can never match
across tenants.

The Calendly adapter now keeps two values it already parsed and discarded: the
chat conversation id, which reached only the audit row's metadata, and the
invitee timezone, validated and then dropped. Both have columns now."
```

---

## Task 6: Narrow the notification fan-out, and fix the fourth timezone

**Files:**
- Modify: `lib/bookings/ingest.ts` (`runPostWriteEffects`)
- Test: create `__tests__/lib/bookings/ingest-tenancy.test.ts`

**Interfaces:**
- Consumes: `business_members` from task 1; `input.businessId` from task 5.
- Produces: nothing further tasks depend on.

Today the fan-out is `select id from users where role = 'admin'` — a cross-tenant broadcast the day a second business exists. And the date string is built with `toLocaleString` and no `timeZone`, i.e. the server process zone, which on Vercel cannot even be set because `TZ` is reserved. Both live in the same function and need the same `business_settings` read, so they are one task.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/bookings/ingest-tenancy.test.ts`. Model the Supabase mock on `__tests__/lib/bookings/ingest.test.ts`'s, adding a `business_members` branch.

```ts
// @vitest-environment node
//
// Two behaviours that are invisible to the existing suites because both are
// correct-by-accident while one business exists: who gets notified, and in
// which timezone the notification is worded.
import { describe, it, expect, vi, beforeEach } from "vitest"

const SINGLETON = "00000000-0000-0000-0000-000000000001"
const BUSINESS_B = "00000000-0000-0000-0000-0000000000b2"

// … the standard consequence mocks, copied from ingest.test.ts …

vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: vi.fn(async (id: string) => ({
    business_id: id,
    timezone: id === BUSINESS_B ? "Australia/Sydney" : "America/New_York",
    display_name: "Test",
  })),
}))

let memberRowsByBusiness: Record<string, Array<{ user_id: string }>>
let notificationsInserted: Array<Record<string, unknown>> | null

// in the supabase mock:
//   if (table === "business_members") return {
//     select: () => ({ eq: (_c: string, businessId: string) =>
//       Promise.resolve({ data: memberRowsByBusiness[businessId] ?? [], error: null }) }) }
//   if (table === "notifications") return { insert: (rows: any) => { notificationsInserted = rows; return Promise.resolve({ error: null }) } }
//   if (table === "users") throw new Error("the fan-out must not read users directly any more")

describe("booking notification fan-out", () => {
  beforeEach(() => {
    memberRowsByBusiness = {
      [SINGLETON]: [{ user_id: "admin-1" }, { user_id: "admin-2" }],
      [BUSINESS_B]: [{ user_id: "coach-b" }],
    }
    notificationsInserted = null
  })

  it("notifies every member of THIS business — the presence control", async () => {
    await ingestBooking(input({ businessId: SINGLETON, status: "scheduled" }))
    expect(notificationsInserted).toHaveLength(2)
    expect(notificationsInserted!.map((n) => n.user_id).sort()).toEqual(["admin-1", "admin-2"])
  })

  it("notifies no member of another business", async () => {
    await ingestBooking(input({ businessId: BUSINESS_B, status: "scheduled" }))
    expect(notificationsInserted).toHaveLength(1)
    expect(notificationsInserted![0].user_id).toBe("coach-b")
  })

  it("words the time in the business's zone, not the server's", async () => {
    // 2026-09-10T14:00Z is 10:00 AM in New York and 12:00 AM the next day in Sydney.
    await ingestBooking(input({ businessId: BUSINESS_B, bookingDate: "2026-09-10T14:00:00.000Z" }))
    expect(String(notificationsInserted![0].message)).toContain("Sep 11")
    expect(String(notificationsInserted![0].message)).not.toContain("Sep 10")
  })

  it("still notifies when the business has no settings row", async () => {
    const { getBusinessSettings } = await import("@/lib/db/businesses")
    vi.mocked(getBusinessSettings).mockRejectedValueOnce(new Error("business_settings row missing"))
    await ingestBooking(input({ businessId: SINGLETON, status: "scheduled" }))
    expect(notificationsInserted).toHaveLength(2)
  })
})
```

The first test is the **presence control**. "No notification for the other business" passes just as well when nothing was inserted at all, so a test that only asserts absence pins nothing.

The last test matters because `getBusinessSettings` **throws** when the row is missing (`lib/db/businesses.ts:33`). A booking webhook must not 500 because a settings row is absent.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run __tests__/lib/bookings/ingest-tenancy.test.ts 2>&1 | tail -25
```

Expected: FAIL — the `users` branch of the mock throws, because the implementation still reads `users` directly.

- [ ] **Step 3: Implement**

In `runPostWriteEffects`, replace the admin query and the date formatting:

```ts
// The recipients are this business's MEMBERS — owner, coach and staff alike —
// not every role='admin' user in the deployment, which was a cross-tenant
// broadcast waiting for a second business. 00240's backfill made every current
// admin an owner of the singleton, so this is behaviour-identical today.
const { data: members } = countsAsNew
  ? await ctx.supabase.from("business_members").select("user_id").eq("business_id", input.businessId)
  : { data: null }

if (members && members.length > 0) {
  // The FOURTH timezone. This string was built with toLocaleString and no
  // timeZone, i.e. the server process zone — and TZ is a reserved Vercel
  // environment variable, so the project cannot even choose it. A missing
  // settings row must not fail a booking webhook, hence the catch.
  const settings = await getBusinessSettings(input.businessId).catch(() => null)
  const bookingDate = new Date(input.bookingDate).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: settings?.timezone || "UTC",
  })

  const notifications = (members as Array<{ user_id: string }>).map((m) => ({
    user_id: m.user_id,
    type: "success" as const,
    title: "New Call Booked",
    message: `${input.contact.name} (${input.contact.email}) booked a call for ${bookingDate}`,
    is_read: false,
    link: "/admin/bookings",
  }))

  await ctx.supabase.from("notifications").insert(notifications)
}
```

Import `getBusinessSettings` from `@/lib/db/businesses`.

- [ ] **Step 4: Run the new suite and the two existing ones**

```bash
npx vitest run __tests__/lib/bookings/ingest-tenancy.test.ts __tests__/lib/bookings/ingest.test.ts \
  __tests__/api/webhooks/calendly-booking.test.ts 2>&1 | tail -20
```

Expected: all green. `ingest.test.ts`'s supabase mock has a `users` branch that is now unreachable — update that mock to a `business_members` branch returning `[{ user_id: "admin-1" }]` so its existing notification assertions keep meaning what they meant.

- [ ] **Step 5: Confirm nothing else read the fan-out**

```bash
grep -rn 'role.*admin' --include='*.ts' lib/bookings/
```

Expected: no `users`/`role='admin'` query remains in `lib/bookings/`.

- [ ] **Step 6: Commit**

```bash
git add lib/bookings/ingest.ts __tests__/lib/bookings/ingest-tenancy.test.ts __tests__/lib/bookings/ingest.test.ts
git commit -m "fix(bookings): notify this business's members, in this business's timezone

The fan-out selected every role='admin' user in the deployment — a cross-tenant
broadcast the day a second business exists. It is now the business's members,
and 00240's backfill made every current admin an owner of the singleton, so
today's behaviour is unchanged. The suite proves that with a presence control:
asserting that the other business gets nothing passes just as well when nothing
was inserted at all.

The notification string was built with toLocaleString and no timeZone — the
server process zone, which on Vercel cannot even be set because TZ is reserved.
It is the business's zone now, closing the fourth of the four zones this repo
renders the same instant in.

getBusinessSettings throws when the row is missing, so the read is caught: a
booking webhook must not 500 because a settings row is absent."
```

---

## Task 7: `CaptureLeadInput` gains a tenant

**Files:**
- Modify: `lib/lead-engine/capture.ts:32-45,60-75`
- Test: `__tests__/lib/lead-engine/capture-tenancy.test.ts` (create), or append to an existing capture suite if one exists — check with `ls __tests__/lib/lead-engine/ | grep -i capture`

**Interfaces:**
- Consumes: nothing.
- Produces: `CaptureLeadInput.businessId?: string`, forwarded to `recordContactEvent`.

Without this, every coach's chat-captured lead files under the singleton's contacts, because the tenant is chosen one level down by `input.businessId ?? SINGLETON_BUSINESS_ID` at `lib/db/contacts.ts:220`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const recordContactEventMock = vi.fn(async () => ({ contactId: "c-1", created: true, merged: false }))
vi.mock("@/lib/db/contacts", () => ({
  recordContactEvent: (...a: unknown[]) => recordContactEventMock(...a),
}))

import { captureLead } from "@/lib/lead-engine/capture"

describe("captureLead tenancy", () => {
  beforeEach(() => recordContactEventMock.mockClear())

  it("forwards businessId to the contact spine", async () => {
    await captureLead({ source: "chat", email: "a@b.com", businessId: "00000000-0000-0000-0000-0000000000b2" })
    expect(recordContactEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "00000000-0000-0000-0000-0000000000b2" }),
    )
  })

  it("omits businessId when the caller gives none, so the DAL default still applies", async () => {
    await captureLead({ source: "chat", email: "a@b.com" })
    expect(recordContactEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: undefined }),
    )
  })
})
```

Check the real `ContactEventSource` union in `lib/db/contacts.ts` and use a value from it rather than the literal `"chat"` if that is not one.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run __tests__/lib/lead-engine/capture-tenancy.test.ts 2>&1 | tail -15
```

Expected: FAIL — `businessId` is not a property of `CaptureLeadInput`.

- [ ] **Step 3: Implement**

```ts
export type CaptureLeadInput = {
  source: ContactEventSource
  email?: string | null
  phone?: string | null
  name?: string | null
  /**
   * The tenant this lead belongs to. Optional for now because eight callers
   * pre-date multi-tenancy and the DAL still defaults; a caller on a coach's
   * page MUST pass it, or the lead files under the singleton's contacts —
   * `input.businessId ?? SINGLETON_BUSINESS_ID` at lib/db/contacts.ts:220 is
   * where that decision is actually made.
   */
  businessId?: string
  attribution?: { /* unchanged */ } | null
  metadata?: Record<string, unknown>
}
```

and in the body:

```ts
    const { contactId } = await recordContactEvent({
      email: input.email,
      phone: input.phone,
      name: input.name,
      source: input.source,
      businessId: input.businessId,
      metadata: { ...(input.metadata ?? {}), ...(input.attribution ?? {}) },
    })
```

Leave all eight existing callers alone — they are single-tenant surfaces and the DAL default is still correct for them. Phase 2 is what passes a real value from the chat route.

- [ ] **Step 4: Run and check tsc**

```bash
npx vitest run __tests__/lib/lead-engine/capture-tenancy.test.ts 2>&1 | tail -10
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: green; `251`.

- [ ] **Step 5: Commit**

```bash
git add lib/lead-engine/capture.ts __tests__/lib/lead-engine/capture-tenancy.test.ts
git commit -m "feat(lead-engine): captureLead can name its tenant

CaptureLeadInput had no businessId, so the tenant was chosen a level down by
input.businessId ?? SINGLETON_BUSINESS_ID — meaning every lead captured on a
coach's page would file under the singleton's contacts with nothing to signal
it. Optional, because the eight existing callers are single-tenant surfaces
where the DAL default is still right; phase 2's chat route passes a real one."
```

---

## Task 8: The ads conversion resolves per business

**Files:**
- Create: `supabase/migrations/00242_google_ads_accounts_business_id.sql`
- Modify: `lib/db/google-ads-accounts.ts:19-27`, `lib/ads/conversions.ts:41-53,62-90`, `lib/bookings/ingest.ts` (`runPostWriteEffects`)
- Test: append to `__tests__/lib/bookings/ingest-tenancy.test.ts`

**Interfaces:**
- Consumes: `input.businessId` from task 5.
- Produces: `getActiveGoogleAdsAccounts(businessId?: string)`; `BookingConversionInput.business_id: string` (required).

`enqueueBookingConversion` takes `google_ads_accounts[0]` — a second singleton, independent of `business_id`, sitting under the ads consequence.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00242_google_ads_accounts_business_id.sql
-- The second singleton. enqueueBookingConversion picks accounts[0] of the
-- active Google Ads accounts, so multi-coach ads attribution was blocked by one
-- line independently of business_id.
--
-- NOT NULL with a singleton DEFAULT, so every existing row is filled by the
-- default and every existing reader -- lib/ads/agent.ts, lib/ads/ga4-audiences.ts,
-- conversions.ts's own value-adjustment path, and the Firebase twin in
-- functions/src/ads/ -- keeps working untouched.

alter table public.google_ads_accounts
  add column if not exists business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id) on delete cascade;

create index if not exists google_ads_accounts_business_id
  on public.google_ads_accounts (business_id);
```

- [ ] **Step 2: Apply and read back**

MCP `apply_migration`, name `google_ads_accounts_business_id`, then:

```sql
select count(*) as accounts,
       count(*) filter (where business_id = '00000000-0000-0000-0000-000000000001') as singleton_filled
  from public.google_ads_accounts;
```

Expected: `accounts = singleton_filled = 4` on the clone.

- [ ] **Step 3: Write the failing test**

Append to `__tests__/lib/bookings/ingest-tenancy.test.ts`:

```ts
describe("ads conversion tenancy", () => {
  it("enqueues against this business's account", async () => {
    await ingestBooking(input({ businessId: BUSINESS_B, status: "scheduled", clickIds: { gclid: "g1", gbraid: null, wbraid: null, fbclid: null } }))
    expect(enqueueBookingConversionMock).toHaveBeenCalledWith(
      expect.objectContaining({ business_id: BUSINESS_B }),
    )
  })
})
```

And a DAL-level test in a new `__tests__/db/google-ads-accounts-tenancy.test.ts` proving the filter is applied:

```ts
// @vitest-environment node
// Asserts the PREDICATE. A mock that returns an account proves nothing about
// which rows the database would have matched.
let appliedEqs: Array<[string, unknown]>
// … supabase mock recording .eq() calls, as in sequences-tenancy.test.ts …

it("filters active accounts by business", async () => {
  await getActiveGoogleAdsAccounts("00000000-0000-0000-0000-0000000000b2")
  expect(appliedEqs).toContainEqual(["business_id", "00000000-0000-0000-0000-0000000000b2"])
  expect(appliedEqs).toContainEqual(["is_active", true])
})

it("defaults to the singleton so existing callers are unchanged", async () => {
  await getActiveGoogleAdsAccounts()
  expect(appliedEqs).toContainEqual(["business_id", "00000000-0000-0000-0000-000000000001"])
})
```

- [ ] **Step 4: Run and watch both fail**

```bash
npx vitest run __tests__/lib/bookings/ingest-tenancy.test.ts __tests__/db/google-ads-accounts-tenancy.test.ts 2>&1 | tail -20
```

- [ ] **Step 5: Implement**

`lib/db/google-ads-accounts.ts`:

```ts
/**
 * `businessId` defaults to the singleton because four existing callers
 * (lib/ads/agent.ts twice, lib/ads/ga4-audiences.ts, and the value-adjustment
 * path in lib/ads/conversions.ts) pre-date multi-tenancy and are correct with
 * it. New callers pass one. The default-parameter idiom stays on EXISTING DAL
 * functions for one migration and is removed caller by caller; a NEW function
 * that defaults the tenant is how the next leak ships.
 */
export async function getActiveGoogleAdsAccounts(
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<GoogleAdsAccount[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true)
  if (error) throw error
  return (data ?? []) as GoogleAdsAccount[]
}
```

`lib/ads/conversions.ts` — add `business_id: string` to `BookingConversionInput` (required — it has one caller) and use it:

```ts
  // Was accounts[0] of every active account: a second single-tenant assumption
  // sitting under the ads consequence, independent of business_id. A business
  // with no configured account enqueues nothing, which is correct — ads
  // attribution is per business or it is wrong.
  const accounts = await getActiveGoogleAdsAccounts(input.business_id)
  const account = accounts[0]
  if (!account) return null
```

`lib/bookings/ingest.ts` — pass it:

```ts
      await enqueueBookingConversion({
        booking_id: bookingId,
        booking_date: input.bookingDate,
        business_id: input.businessId,
        gclid,
        gbraid,
        wbraid,
      })
```

- [ ] **Step 6: Run everything this touched, plus tsc**

```bash
npx vitest run __tests__/lib/bookings/ingest-tenancy.test.ts __tests__/db/google-ads-accounts-tenancy.test.ts \
  __tests__/lib/bookings/ingest.test.ts 2>&1 | tail -20
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: green; `251`. Also grep the ads suites for breakage: `npx vitest run __tests__/lib/ads 2>&1 | tail -10` if that directory exists.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/00242_google_ads_accounts_business_id.sql lib/db/google-ads-accounts.ts \
  lib/ads/conversions.ts lib/bookings/ingest.ts __tests__/lib/bookings/ingest-tenancy.test.ts \
  __tests__/db/google-ads-accounts-tenancy.test.ts
git commit -m "fix(ads): the booking conversion resolves the business's account

enqueueBookingConversion took google_ads_accounts[0] — a second singleton under
the ads consequence, independent of business_id, which would have made every
coach's booking a conversion on whichever account sorted first.

business_id is NOT NULL with a singleton default, so all four existing rows are
filled and every current reader — the ads agent, ga4-audiences, the
value-adjustment path and the Firebase twin — is untouched. A business with no
configured account now enqueues nothing, which is correct: ads attribution is
per business or it is wrong."
```

---

## Task 9: Migration 00243 — the tightening

**Files:**
- Create: `supabase/migrations/00243_bookings_tenant_not_null.sql`

**Interfaces:**
- Consumes: every writer from tasks 5-8.
- Produces: `NOT NULL` on `bookings.business_id`, `.host_id`, `.end_at`; constraint `bookings_end_after_start`.

**This is a separate deploy from 00241, deliberately.** It runs only after the code that writes all three columns is live. Do not fold it into an earlier migration.

- [ ] **Step 1: Read the preconditions back BEFORE writing the migration**

```sql
select count(*) as unbackfilled from public.bookings
 where business_id is null or host_id is null or end_at is null;
select count(*) as bad_ranges from public.bookings where end_at <= booking_date;
```

Both must be `0`. **If either is non-zero, stop and report** — do not "fix" it by widening the constraint. A constraint an existing row violates fails the migration mid-deploy, which is exactly what 00239's header warns about.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/00243_bookings_tenant_not_null.sql
-- Calendly per coach, phase 0c: the tightening. A LATER DEPLOY than 00241.
--
-- Setting a column NOT NULL while the previous build is still serving is how a
-- migration takes production down. 00241 added these nullable and backfilled
-- them; the code that writes all three shipped between the two. This is the
-- third of three deploys and it must not be folded into either of the others.
--
-- PRECONDITIONS, read back on the target before running:
--   select count(*) from public.bookings
--    where business_id is null or host_id is null or end_at is null;  -- must be 0
--   select count(*) from public.bookings where end_at <= booking_date; -- must be 0
--
-- business_id KEEPS ITS DEFAULT through this migration and loses it in a later
-- one -- belt and braces for one more release.
--
-- NO EXCLUSION CONSTRAINT, and no btree_gist. Calendly arbitrates every booking
-- on this path. An exclusion violation raised inside our webhook returns 5xx to
-- Calendly, whose retry policy DISABLES the subscription after 24 hours of
-- failed delivery, and a disabled subscription must be recreated by hand. A
-- constraint that can silently kill a coach's booking feed is worse than no
-- constraint. It returns, predicated on an `arbiter` column, if a direct-book
-- path is ever built.

alter table public.bookings
  alter column business_id set not null,
  alter column host_id     set not null,
  alter column end_at      set not null;

-- NOT VALID then VALIDATE: the two-step takes a weaker lock than a single
-- validating ADD CONSTRAINT, which holds ACCESS EXCLUSIVE for the whole scan.
alter table public.bookings
  add constraint bookings_end_after_start check (end_at > booking_date) not valid;
alter table public.bookings validate constraint bookings_end_after_start;
```

- [ ] **Step 3: Apply and read back the constraint itself**

MCP `apply_migration`, name `bookings_tenant_not_null`, then:

```sql
select conname, convalidated, pg_get_constraintdef(oid) as def
  from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_end_after_start';
select column_name, is_nullable from information_schema.columns
 where table_schema='public' and table_name='bookings'
   and column_name in ('business_id','host_id','end_at') order by column_name;
```

Expected: the constraint exists with `convalidated = true`, and all three columns report `is_nullable = 'NO'`.

- [ ] **Step 4: Prove the constraint actually refuses a bad row**

```sql
begin;
insert into public.bookings (contact_name, contact_email, booking_date, end_at, business_id, host_id)
values ('Probe','p@example.invalid', now(), now() - interval '1 minute',
        '00000000-0000-0000-0000-000000000001', (select id from public.booking_hosts limit 1));
rollback;
```

Expected: **error 23514** (`check_violation`). If it inserts, the constraint is not doing its job — stop and report.

- [ ] **Step 5: Prove the ingest still writes successfully against the tightened schema**

Re-run the booking suites — they mock Supabase, so they cannot catch this. The real proof is task 10's browser pass. Note that here and move on:

```bash
npx vitest run __tests__/lib/bookings/ __tests__/api/webhooks/calendly-booking.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00243_bookings_tenant_not_null.sql
git commit -m "feat(bookings): business_id, host_id and end_at become NOT NULL

The third of three deploys. 00241 added them nullable and backfilled; the code
that writes all three shipped between the two. Setting a column NOT NULL while
the previous build is still serving is how a migration takes production down,
which is why this is its own file and not folded into 00241.

NOT VALID then VALIDATE on the range check, so the scan does not hold ACCESS
EXCLUSIVE. Preconditions were read back on the target first — a constraint an
existing row violates fails the migration mid-deploy.

Still no exclusion constraint: Calendly arbitrates, and a 23P01 inside our
webhook is how a coach's subscription gets disabled after 24h of retries."
```

---

## Task 10: Verification, mutation checks, and the browser proof

**Files:**
- Create: `screenshots/calendly-per-coach/` with annotated PNGs
- Create: `scripts/capture-phase0-screenshots.mjs` (or extend the existing `scripts/capture-calendly-booking-screenshots.mjs` — read it first and follow its shape)

- [ ] **Step 1: Full targeted sweep**

```bash
npx vitest run __tests__/lib/bookings/ __tests__/db/sequences.test.ts __tests__/db/sequences-tenancy.test.ts \
  __tests__/db/google-ads-accounts-tenancy.test.ts __tests__/lib/lead-engine/capture-tenancy.test.ts \
  __tests__/api/webhooks/calendly-booking.test.ts __tests__/api/webhooks/sequence-exit-hooks.test.ts \
  __tests__/api/webhooks/pipeline-hooks.test.ts __tests__/api/webhooks/ghl-booking-attribution.test.ts 2>&1 | tail -25
```

Every file must report a **non-zero** test count and pass.

- [ ] **Step 2: tsc, compared properly**

```bash
npx tsc --noEmit 2>&1 | grep 'error TS' | sort > /tmp/tsc-after.txt
wc -l /tmp/tsc-after.txt
diff <(sort /private/tmp/claude-501/*/scratchpad/tsc-baseline.txt | grep 'error TS') /tmp/tsc-after.txt || true
```

Expected: `251`, and the diff empty. A falling count hides new errors too — the file list is the real check.

- [ ] **Step 3: Mutation-check the four new suites**

For each, apply the change it claims to catch and confirm it goes **red**. Run the mutation, do not trust the comment — "this would be caught" is a guess until applied. Revert each mutation immediately after.

| Suite | Mutation | Must fail |
|---|---|---|
| `sequences-tenancy.test.ts` | Delete `.eq("business_id", businessId)` from `exitRunsForContact` | yes |
| `ingest-tenancy.test.ts` (fan-out) | Change `.eq("business_id", input.businessId)` to `.eq("business_id", SINGLETON_BUSINESS_ID)` | yes |
| `ingest-tenancy.test.ts` (zone) | Delete the `timeZone:` property from the `toLocaleString` options | yes |
| `google-ads-accounts-tenancy.test.ts` | Delete `.eq("business_id", businessId)` | yes |
| `ingest.test.ts` (tenant threading) | Change `business_id: input.businessId` to `business_id: SINGLETON_BUSINESS_ID` in the insert row | yes |

**Editing only a comment block is not a mutation.** Move or delete the code itself.

- [ ] **Step 4: Confirm the dev clone's final shape**

```sql
select
  (select count(*) from information_schema.tables where table_schema='public'
     and table_name in ('booking_hosts','business_members','business_domains','booking_types',
                        'booking_availability_rules','booking_availability_overrides',
                        'coach_calendar_connections','booking_notifications')) as new_tables,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('booking_hosts','business_members','business_domains','booking_types',
                       'booking_availability_rules','booking_availability_overrides',
                       'coach_calendar_connections','booking_notifications','bookings')) as policies,
  (select count(*) from public.bookings where business_id is null or host_id is null or end_at is null) as unbackfilled,
  (select count(*) from pg_extension where extname='btree_gist') as btree_gist_must_be_zero;
```

Expected: `new_tables=8`, `policies=9`, `unbackfilled=0`, `btree_gist_must_be_zero=0`.

- [ ] **Step 5: Drive the real app and prove the admin surface survived**

RLS on `bookings` and seven new columns are exactly the kind of change that passes every mocked test and breaks a real page.

```bash
npm run dev > /private/tmp/claude-501/*/scratchpad/dev-server.log 2>&1 &
```

**Never pipe a long-running server to `head`** — it wedges, and every route then times out *after* working fine. Redirect to a file.

Sign in as an admin and capture, at the real routes:
1. `/admin/bookings` — the list, showing real rows
2. A contact detail page whose contact has a booking
3. `/admin/audit-logs` filtered to `commerce`, showing the booking audit rows

**It must be the exact app UI at the real route** — no preview harness, no isolated mount. Annotate the numbered markers and captions **into the PNG itself**, composed at the capture's exact pixel width so nothing is upscaled. Derive marker positions from `boundingBox() × devicePixelRatio` and make the helper warn loudly when a target does not match, rather than degrading into a silent no-op. The admin UI is light-only — `.dark` is a class variant these components were never built against — so capture light only and say so.

Save to `screenshots/calendly-per-coach/`.

- [ ] **Step 6: Commit the screenshots**

```bash
git add screenshots/calendly-per-coach/ scripts/capture-phase0-screenshots.mjs
git commit -m "test(bookings): annotated proof that the admin surface survives phase 0

Driven against the real routes in a real browser, not a harness: RLS on
bookings plus seven new columns is exactly the change that passes every mocked
test and breaks a real page. Light theme only — the admin UI is light-only and
.dark is a variant these components were never built against."
```

---

## Self-Review

**Spec coverage.** §2 → task 1. §3 → task 2. §4 items 1-2 → task 3; item 3 → task 4; items 1, 2, 8, 9 → task 5; items 5, 6 → task 6; item 4 → task 7; item 7 → task 8. §5 → task 9. §6 → tasks 4-8's test steps. §7 gates 1-4 → task 10 steps 1-4; gate 5 → task 10 step 5. §8's facts are constraints, already in Global Constraints. §9 is handoff, no task needed. **No gap found.**

**Type consistency.** `exitRunsForContact(contactId, reason, businessId)` with `SequenceExitReason` — defined in task 4, used in task 5. `BookingIngestInput.businessId/hostId/connectionId/chatConversationId/inviteeTimezone` — defined in task 5, used in tasks 6 and 8. `getActiveGoogleAdsAccounts(businessId?)` and `BookingConversionInput.business_id` — both task 8. `singletonHostId()` — defined and used in task 5. `IngestCtx` and the four stage functions — defined in task 3, threaded in task 5, extended in tasks 6 and 8. Consistent.

**Known soft spot, flagged rather than hidden.** Task 5 step 5 says to check the Calendly route's Zod schema for the invitee timezone's real field name instead of asserting one, and task 7 step 1 says to check the real `ContactEventSource` union. Those two are reads the implementer must do, not placeholders — the surrounding code is fully specified either way.
