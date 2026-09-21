-- 00274 — Enable row level security on the thirteen public tables that had none.
--
-- WHAT WAS MEASURED, on production, 2026-09-21.
--
--   Thirteen tables in `public` had `pg_class.relrowsecurity = false` and zero
--   policies. Supabase's own linter flags all thirteen as `rls_disabled_in_public`
--   at ERROR / EXTERNAL. Their grant is `anon=arwdDxtm/postgres` -- that is
--   INSERT, SELECT, UPDATE, DELETE and TRUNCATE, not SELECT alone.
--
--   RLS DOES NOT COVER ALL OF THAT, which is why this migration does two
--   things rather than one. Row level security constrains SELECT, INSERT,
--   UPDATE and DELETE. It does NOT constrain TRUNCATE, REFERENCES, TRIGGER or
--   MAINTAIN -- those are decided by the grant alone, and `ENABLE ROW LEVEL
--   SECURITY` leaves `relacl` completely untouched. Enabling RLS and stopping
--   there would leave `anon` holding TRUNCATE on all thirteen while the
--   migration header claimed the internet was denied. PostgREST exposes no
--   TRUNCATE verb, so it was not reachable over the REST API today, but an
--   unreachable grant is not the same as an absent one and the next component
--   to speak Postgres directly inherits it. So the four privileges RLS cannot
--   reach are revoked outright below.
--
--   Reachability was PROVEN, not inferred, with the public publishable key and
--   `Prefer: count=exact` + `limit=0` so no row of anyone's data was read:
--
--     program_week_access       HTTP 206  content-range */500
--     generated_exercise_usage  HTTP 206  content-range */5687
--     repo_migrations           HTTP 206  content-range */276
--     assessment_questions      HTTP 206  content-range */10
--     contacts  (CONTROL, RLS on) HTTP 200  content-range */0
--
--   The control is the point: an RLS-protected table answers */0. These answer
--   with their true count, so the probe discriminates.
--
--   `assessment_results` and `event_signups` are EMPTY -- 0 rows each. They are
--   a fuse, not a live leak: they light the first time someone submits an
--   assessment or signs up for a camp. They are closed here so that never
--   happens.
--
-- DO NOT use `information_schema` to check any of this. `role_table_grants`
-- returns ZERO rows for anon/authenticated/service_role across the whole
-- schema, which reads as "nothing is exposed, stand down". It filters by what
-- the querying role can see. `has_table_privilege` is no better as a signal
-- here -- it returns true on all 188 public tables, so it does not
-- discriminate either. The discriminating column is `pg_class.relrowsecurity`,
-- which is what the verification below reads.
--
-- WHY NO POLICIES.
--
--   Every reader of all thirteen goes through `createServiceRoleClient()`.
--   `createBrowserSupabaseClient` and `createServerSupabaseClient` have ZERO
--   callers in the repo, so nothing in this product ever queries these tables
--   as `anon` or `authenticated`. `service_role` carries `rolbypassrls = true`,
--   so RLS with no policy denies the internet and changes nothing for the app.
--   Twenty-eight tables here already run exactly this configuration
--   (`audit_logs`, `funnels`, `cron_runs` among them), which is the empirical
--   proof that it works.
--
--   A `select using (true)` policy on the reference tables (`events`,
--   `membership_plans`, `assessment_questions`) was considered and REJECTED: it
--   would preserve the anon read this migration exists to close, and buy
--   nothing, because those pages render server-side through the service-role
--   client. If a genuinely browser-side reader is ever added, it needs a policy
--   written for that reader -- not a blanket `true` left behind here.
--
-- NOT USED: `FORCE ROW LEVEL SECURITY`. It strips the table-owner exemption
-- only; `service_role` bypasses by role attribute regardless, so FORCE would
-- change owner-side behaviour that nothing here has measured, for no gain.
--
-- The RPC half of this exposure -- five SECURITY DEFINER functions callable by
-- `anon` over /rest/v1/rpc/ with no caller authorization -- is migration 00275.

DO $$
DECLARE
  t             text;
  tables        text[] := ARRAY[
                    'agent_tool_baselines',
                    'assessment_questions',
                    'assessment_results',
                    'chief_strategist_memos',
                    'coach_ai_policy',
                    'event_signups',
                    'events',
                    'exercise_blocks',
                    'generated_exercise_usage',
                    'membership_plans',
                    'program_week_access',
                    'program_week_pricing',
                    'repo_migrations'
                  ];
  -- The ONLY table allowed to be missing. The dev clone
  -- (anjvztjiokcgiyhobknq) has 12 of the 13: it carries no
  -- `public.repo_migrations`, because that ledger is created by the migration
  -- runner against production. An unguarded ALTER would abort the whole
  -- migration there, so the production change could never be rehearsed.
  --
  -- An ALLOWLIST, not a blanket skip. A bare `to_regclass IS NULL -> CONTINUE`
  -- tolerates ANY subset being absent, and the `still_off` read-back below
  -- filters on the same array -- so a table that was renamed, or misspelled
  -- here, would be skipped, never verified, and reported as success. That is
  -- the failure mode where this migration says it closed thirteen tables and
  -- actually closed twelve.
  may_be_absent text[] := ARRAY['repo_migrations'];
  enabled_count int    := 0;
  absent        text[] := '{}';
  still_off     text[];
  still_open    text[];
  with_policies text[];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      IF NOT (t = ANY (may_be_absent)) THEN
        RAISE EXCEPTION '00274: table public.% does not exist and is not on the may-be-absent list', t;
      END IF;
      absent := absent || t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- The privileges RLS cannot constrain. See the header: `relacl` is
    -- untouched by ENABLE ROW LEVEL SECURITY, so without this `anon` keeps
    -- TRUNCATE on every one of these tables.
    -- MAINTAIN is included because both production and the dev clone run
    -- PostgreSQL 17.6 (`server_version_num` 170006), where it is a grantable
    -- privilege and is present in `relacl` as the `m` in `anon=arwdDxtm`. On
    -- 16 or earlier this clause would be a syntax error.
    EXECUTE format(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.%I FROM anon, authenticated', t);

    enabled_count := enabled_count + 1;
  END LOOP;

  IF cardinality(absent) > 0 THEN
    RAISE NOTICE '00274: not present in this database, skipped: %', absent;
  END IF;

  -- If every name were misspelled, `to_regclass` would skip all thirteen, the
  -- read-back below would find no matching row still disabled, and this
  -- migration would finish green having done nothing at all.
  IF enabled_count = 0 THEN
    RAISE EXCEPTION '00274: enabled nothing -- none of the % named tables exist in public', cardinality(tables);
  END IF;

  -- Verify the END STATE from pg_class rather than trusting the loop.
  SELECT array_agg(c.relname::text ORDER BY c.relname)
    INTO still_off
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname = ANY (tables)
     AND NOT c.relrowsecurity;

  IF still_off IS NOT NULL THEN
    RAISE EXCEPTION '00274: RLS still disabled on %', still_off;
  END IF;

  -- Deny-all has to be MEASURED. RLS enabled plus a permissive policy is not
  -- a closed table, and the whole security claim of this migration is that
  -- these thirteen end up with none.
  SELECT array_agg(DISTINCT c.relname::text)
    INTO with_policies
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = ANY (tables);

  IF with_policies IS NOT NULL THEN
    RAISE EXCEPTION '00274: unexpected policies on % -- deny-all not achieved', with_policies;
  END IF;

  -- And the privileges RLS cannot reach are actually gone. Without this the
  -- REVOKE above is an unverified claim, and TRUNCATE is exactly the one that
  -- would be silently retained.
  SELECT array_agg(DISTINCT c.relname::text)
    INTO still_open
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname = ANY (tables)
     AND (
           has_table_privilege('anon', c.oid, 'TRUNCATE')
        OR has_table_privilege('anon', c.oid, 'REFERENCES')
        OR has_table_privilege('anon', c.oid, 'TRIGGER')
        OR has_table_privilege('authenticated', c.oid, 'TRUNCATE')
         );

  IF still_open IS NOT NULL THEN
    RAISE EXCEPTION '00274: anon/authenticated still hold RLS-exempt privileges on %', still_open;
  END IF;

  RAISE NOTICE '00274: RLS enabled on % tables, 0 policies, RLS-exempt privileges revoked', enabled_count;
END;
$$;
