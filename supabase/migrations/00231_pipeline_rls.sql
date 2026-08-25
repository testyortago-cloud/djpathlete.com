-- Row Level Security for the four pipeline tables.
--
-- Migration 00219 created `pipelines`, `pipeline_stages`, `opportunities` and
-- `opportunity_stage_events` without enabling RLS and without any policy. With
-- RLS off, PostgREST serves those tables to ANY caller holding the anon key --
-- and the anon key ships in the browser bundle by design. That exposes the deal
-- spine: every contact in the pipeline, the stage they sit in, and
-- `value_cents` for each one. It has been open since the Stage 3 handover.
--
-- SAFE TO ENABLE: every runtime read and write of these four tables goes through
-- lib/db/pipeline.ts, whose getClient() returns createServiceRoleClient(). The
-- service role bypasses RLS regardless, and the explicit policy below is belt
-- and braces plus documentation of intent. Checked before writing this:
--
--   * lib/db/pipeline.ts is the ONLY module issuing .from() against these four
--     tables (the tests and lib/automation/pipeline-reconcile.ts go through it).
--   * Its ten call sites are all server-side: four API routes, the admin page
--     server component, the reconciler, and the test suites.
--   * components/admin/pipeline-board.tsx is a client component, but it imports
--     `import type { BoardColumn, BoardCard }` only -- types are erased at
--     build, so the board makes no browser-side query. Enabling RLS cannot
--     blank it out.
--
-- No anon or authenticated policy is granted, deliberately. Nothing legitimate
-- reads these tables with those roles today, and adding a policy "just in case"
-- would reopen the hole this migration exists to close.
--
-- Mirrors the pattern migration 00228 used for the quiz tables, which -- unlike
-- 00219 -- wrote its RLS into the creating migration.

ALTER TABLE public.pipelines               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_stage_events ENABLE ROW LEVEL SECURITY;

-- NOTE: CREATE POLICY has no IF NOT EXISTS in Postgres. These statements are
-- therefore NOT re-runnable. Any local applier that replays migrations must
-- carry its own DROP POLICY guard -- do not add one to this file, or a replay
-- would silently drop and recreate a live policy.
CREATE POLICY "Service role full access on pipelines"
  ON public.pipelines FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on pipeline_stages"
  ON public.pipeline_stages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on opportunities"
  ON public.opportunities FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on opportunity_stage_events"
  ON public.opportunity_stage_events FOR ALL TO service_role USING (true) WITH CHECK (true);
