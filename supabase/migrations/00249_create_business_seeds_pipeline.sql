-- supabase/migrations/00249_create_business_seeds_pipeline.sql
--
-- create_business() seeds a settings row, a booking host and an owner
-- membership -- and no pipeline. So `/admin/pipeline` answered 500 for every
-- business it has ever created:
--
--   Error [PipelineNotConfiguredError]: pipeline not configured:
--     no seeded board for key "coaching"
--       at resolvePipeline (lib/db/pipeline.ts:90)
--       at readBoard (lib/db/pipeline.ts:995)
--       at PipelinePage (app/(admin)/admin/pipeline/page.tsx:30)
--
-- The singleton has a pipeline because 00185 seeded it directly; nothing ever
-- gave one to a business created afterwards. Read back on the dev clone before
-- writing this: Primary has 1 pipeline and 4 stages, and all three businesses
-- created through create_business() have 0 and 0.
--
-- This was reachable before today -- an operator switching the business picker
-- to a new tenant hit the same 500 -- but it was invisible, because
-- `/admin/pipeline` was unmapped in PATH_PERMISSIONS and no coach could get
-- there. Making that screen reachable makes this a coach's front door, so it
-- is fixed here rather than left as a phase-1 leftover.
--
-- FOUND BY LOOKING AT THE SCREENSHOT, not by a test. Every page-tenancy test
-- mocks `readBoard`, so all of them were green against a page that cannot
-- render. A test that mocks the read cannot see the read failing.
--
-- DB-ONLY, so it needs no staged deploy. It replaces a function and backfills
-- rows; no application code reads or writes anything new, and the app is
-- already asking for exactly these rows and erroring when they are absent.
-- Contrast 00243, which had a code half and therefore its own pull request.

-- ---------------------------------------------------------------------------
-- 1. The function, now seeding the board it always should have.
-- ---------------------------------------------------------------------------

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
  v_pipeline uuid;
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

  -- The 'coaching' board. The KEY is what lib/db/pipeline.ts resolves on, and
  -- it is the same for every tenant on purpose -- resolvePipeline() looks a
  -- board up by (business_id, key), so the key identifies the KIND of board,
  -- not the business. The four stages mirror the singleton's exactly, read
  -- back from it rather than invented, because `kind` is load-bearing: the
  -- move route decides "is this a close?" from kind in ('won','lost'), and a
  -- board with no won stage can never close a deal.
  insert into public.pipelines (business_id, key, name, status)
  values (v_business.id, 'coaching', 'Coaching', 'active')
  returning id into v_pipeline;

  insert into public.pipeline_stages
    (business_id, pipeline_id, key, name, position, kind, amber_after_days, red_after_days)
  values
    (v_business.id, v_pipeline, 'consult_booked', 'Consult Booked', 1, 'open', 3,    7),
    (v_business.id, v_pipeline, 'consulted',      'Consulted',      2, 'open', 5,   14),
    (v_business.id, v_pipeline, 'won',            'Won',            3, 'won',  null, null),
    (v_business.id, v_pipeline, 'lost',           'Lost',           4, 'lost', null, null);

  return v_business;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The grants. NOT redundant, and NOT copy-paste noise.
-- ---------------------------------------------------------------------------
-- `create or replace` above re-fires the per-project default privilege every
-- Supabase project carries (`alter default privileges ... grant execute on
-- functions to anon, authenticated, service_role`), which grants anon and
-- authenticated EXECUTE again on the NEW function even though 00244 revoked
-- it from the old one. Privileges do not survive a replace on their own.
--
-- This function is `security definer` and PostgREST auto-exposes anything
-- carrying an EXECUTE grant at /rest/v1/rpc/create_business -- so omitting
-- these three lines would silently reopen an unauthenticated write path that
-- can create arbitrary tenants and name any existing user id as 'owner'. See
-- 00244's own comment, which explains the same trap at more length.
revoke all      on function public.create_business(text, text, text, text, text, uuid) from public;
revoke execute  on function public.create_business(text, text, text, text, text, uuid) from anon, authenticated;
grant  execute  on function public.create_business(text, text, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill the businesses that never got one.
-- ---------------------------------------------------------------------------
-- Keyed on the ABSENCE of a 'coaching' board rather than on a list of ids, so
-- it is correct on any database it runs against and is a no-op on a second run
-- -- the dev clone and production hold different businesses, and a migration
-- that names ids read from one of them matches nothing on the other.
do $$
declare
  b record;
  v_pipeline uuid;
begin
  for b in
    select id from public.businesses
    where not exists (
      select 1 from public.pipelines p
      where p.business_id = businesses.id and p.key = 'coaching'
    )
  loop
    insert into public.pipelines (business_id, key, name, status)
    values (b.id, 'coaching', 'Coaching', 'active')
    returning id into v_pipeline;

    -- A business could in principle hold stage rows with no board (nothing
    -- creates that state today), so this inserts only stages whose key is not
    -- already present on the board just created.
    insert into public.pipeline_stages
      (business_id, pipeline_id, key, name, position, kind, amber_after_days, red_after_days)
    values
      (b.id, v_pipeline, 'consult_booked', 'Consult Booked', 1, 'open', 3,    7),
      (b.id, v_pipeline, 'consulted',      'Consulted',      2, 'open', 5,   14),
      (b.id, v_pipeline, 'won',            'Won',            3, 'won',  null, null),
      (b.id, v_pipeline, 'lost',           'Lost',           4, 'lost', null, null);
  end loop;
end $$;
