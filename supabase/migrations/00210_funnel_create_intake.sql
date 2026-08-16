-- 00210_funnel_create_intake.sql
--
-- Template-driven funnel creation.
-- Spec: docs/superpowers/specs/2026-08-16-funnel-create-templates-design.md
--
-- The create dialog used to collect a description naming three steps and then
-- make the owner add three steps by hand. These columns are what a template
-- writes down so it does not have to.

ALTER TABLE funnels
  ADD COLUMN IF NOT EXISTS template            text,
  ADD COLUMN IF NOT EXISTS audience            text,
  ADD COLUMN IF NOT EXISTS offer_kind          text,
  ADD COLUMN IF NOT EXISTS offer_ref           text,
  ADD COLUMN IF NOT EXISTS starts_at           timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at             timestamptz,
  ADD COLUMN IF NOT EXISTS auto_offline_at_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_emails       text[];

-- `template` deliberately has NO CHECK constraint, breaking the local
-- convention that `kind`, `goal` and `status` all follow. Those are closed
-- unions the app queries and branches on. This is provenance: the code registry
-- (lib/funnels/templates.ts) owns the vocabulary, and a CHECK here would mean a
-- migration for every new template — defeating the reason the registry is code
-- rather than a table. Unknown values degrade to no badge, never to an error.

ALTER TABLE funnels
  ADD CONSTRAINT funnels_offer_kind_check
    CHECK (offer_kind IS NULL OR offer_kind IN ('program','session_pack','event')),
  -- An offer is a kind AND a ref, or it is neither. Half of one renders as a
  -- dead CTA the owner cannot see is dead.
  ADD CONSTRAINT funnels_offer_paired_check
    CHECK ((offer_kind IS NULL) = (offer_ref IS NULL)),
  ADD CONSTRAINT funnels_run_window_check
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);

-- The goal a step is FOR. This is the honest home for the fact the 2026-08-12
-- spec already identified as belonging to steps rather than to the container,
-- and it is what lets step 3 know it is the payment step when the builder opens
-- it. Same vocabulary as funnels.goal.
ALTER TABLE funnel_steps
  ADD COLUMN IF NOT EXISTS goal text;

ALTER TABLE funnel_steps
  ADD CONSTRAINT funnel_steps_goal_check
    CHECK (goal IS NULL OR goal IN ('leads','booking','program','session_pack','event'));

-- The window closer scans only opted-in published funnels, so the index covers
-- exactly that predicate rather than every row with an end date.
CREATE INDEX IF NOT EXISTS funnels_auto_offline_idx
  ON funnels (ends_at)
  WHERE auto_offline_at_end AND status = 'published';
