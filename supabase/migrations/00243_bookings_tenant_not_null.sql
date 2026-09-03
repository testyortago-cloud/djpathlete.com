-- supabase/migrations/00243_bookings_tenant_not_null.sql
-- Calendly per coach, phase 0c: the tightening. A LATER DEPLOY than 00241.
--
-- Setting a column NOT NULL while the previous build is still serving is how a
-- migration takes production down. 00241 added these nullable and backfilled
-- them; the code that writes all three shipped between the two. This is the
-- third of three deploys and it must not be folded into either of the others.
--
-- "Deploy" here means MERGED PULL REQUEST, not "separate file" — this repo's
-- .github/workflows/apply-migrations.yml applies every pending migration in
-- one unattended run on push to main, and nothing sequences that Action
-- against the Vercel build the same push triggers. Sitting this file on the
-- same branch as 00241 and the columns-nullable code, as it originally did on
-- feat/calendly-per-coach, would have run both migrations in one Action pass
-- the moment that branch merged — collapsing three deploys into one, and
-- 23502'ing every booking insert on both vendors for the window where the
-- OLD build (writing none of these columns) is still serving against the NEW
-- schema. This file must therefore be merged in its OWN pull request, on its
-- own branch (feat/calendly-per-coach-tighten), opened only after the pull
-- request carrying 00241 and the writers has merged AND the code deploy is
-- confirmed live on the target (not merely merged in git) — and only after
-- both preconditions below are read back against the target database at that
-- time, not assumed from an earlier run against the dev clone.
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
