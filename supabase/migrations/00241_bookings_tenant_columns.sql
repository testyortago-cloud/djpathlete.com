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
