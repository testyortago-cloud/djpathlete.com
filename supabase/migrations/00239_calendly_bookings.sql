-- supabase/migrations/00239_calendly_bookings.sql
-- Full Engine phase 2: bookings can come from Calendly as well as GoHighLevel.
--
-- THREE NEW COLUMNS, NOT A REUSE OF ghl_appointment_id. Migration 00235 settled
-- this argument for stripe_session_id and the ruling carries: a column named
-- for one vendor holding another vendor's ids is a lie the schema tells every
-- future reader. calendly_event_uri holds the scheduled_event URI Calendly
-- puts on BOTH the invitee.created and the invitee.canceled delivery for one
-- booking, which is what lets the cancel find the row the create made.
--
-- THE UNIQUE INDEX IS PARTIAL (WHERE ... IS NOT NULL). Every existing row is a
-- GoHighLevel booking with NULL here; a plain UNIQUE would still admit them
-- (NULLs are distinct), but the partial form is what makes the intent
-- readable and keeps the index small. It is the redelivery guard: Calendly
-- re-sends a webhook it did not get a 2xx for, and two rows for one consult is
-- two pipeline cards.
--
-- CORRECTIONS TO THE DESIGN NOTE (docs/superpowers/specs/2026-09-01-full-
-- engine-phase2-calendly-booking-design.md §8), found by trying to write it:
--
--   1. "The ingest must upsert on it" cannot be a PostgREST upsert. Supabase's
--      .upsert(row, { onConflict: "calendly_event_uri" }) compiles to
--      INSERT ... ON CONFLICT (calendly_event_uri) DO UPDATE, and Postgres only
--      infers a PARTIAL unique index as the arbiter when the statement repeats
--      the predicate -- ON CONFLICT (calendly_event_uri) WHERE calendly_event_uri
--      IS NOT NULL -- which PostgREST has no syntax for. As written it fails with
--      "there is no unique or exclusion constraint matching the ON CONFLICT
--      specification". lib/bookings/ingest.ts therefore reads by key, updates
--      if found, inserts if not, and treats a 23505 on the insert (two
--      redeliveries racing past the read) as "the other one won" and re-reads.
--      The index is still the guard; the statement around it is not the one
--      the note named.
--
--   2. A reschedule is TWO deliveries, not a status change on one row: Calendly
--      cancels the old invitee (payload.rescheduled = true) and creates a new
--      one under a NEW scheduled_event URI, in no guaranteed order. So a
--      rescheduled consult is two rows here -- the old one cancelled with a
--      note, the new one scheduled -- and the cancel half must NOT reach the
--      pipeline, or a person who moved their call by a day gets a Lost card.
--      That rule lives in the ingest, not here, but it is why this key is the
--      scheduled_event URI and not something stable across a reschedule.
--
-- reschedule_url / cancel_url are the invitee's own Calendly links, shown as
-- row actions on /admin/bookings so a booking can be moved or cancelled without
-- logging into Calendly. They have a reader; that is the condition for storing
-- them.
--
-- THE DEPLOY RACE. This applies on push to main via a path-filtered Action
-- while Vercel builds the same push, unsequenced. Code that reads these
-- columns tolerates their absence for one deploy (the bookings SELECTs that
-- name them catch PostgREST's 42703 and fall back); the webhook that WRITES
-- them is registered with Calendly by hand after both have landed, so nothing
-- can arrive before the columns exist.

alter table public.bookings
  add column if not exists calendly_event_uri text,
  add column if not exists reschedule_url     text,
  add column if not exists cancel_url         text;

create unique index if not exists bookings_calendly_event_uri_key
  on public.bookings (calendly_event_uri)
  where calendly_event_uri is not null;

-- NO CHECK ON `source`. One was drafted here ('ghl' | 'calendly' | 'manual') and
-- removed before it was applied anywhere: production's bookings rows cannot be
-- read from this branch, so a CHECK is a bet on data nobody has looked at, and
-- a losing bet fails the migration Action mid-deploy. The column keeps its
-- 00050 shape; 'calendly' is simply a new value the ingest writes.
