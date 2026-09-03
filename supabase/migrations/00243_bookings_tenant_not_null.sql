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
