-- 00147_client_engagement_snapshots.sql
-- Phase 1 of broader-automations plan (docs/superpowers/plans/2026-05-16-broader-automations.md).
-- Adds: client_engagement_snapshots table, last_renewal_conversation_at column
-- on program_assignments, and the cron_client_risk_scan_enabled flag.

-- 1) Snapshot table — one row per (client_id, snapshot_date).
CREATE TABLE IF NOT EXISTS client_engagement_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  -- raw signals (names match the reconciled risk model)
  days_since_last_session INTEGER NOT NULL,
  session_frequency_pct_14d NUMERIC(5,2),
  open_form_review_days INTEGER,
  open_performance_assessment_days INTEGER,
  program_ending_in_days INTEGER,
  last_renewal_conversation_at TIMESTAMPTZ,

  -- scored
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('none','low','medium','high')),
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_ces_snapshot_date
  ON client_engagement_snapshots (snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_ces_risk_tier
  ON client_engagement_snapshots (risk_tier, snapshot_date DESC)
  WHERE risk_tier IN ('high','medium');

-- 2) Renewal conversation timestamp on program_assignments.
ALTER TABLE program_assignments
  ADD COLUMN IF NOT EXISTS last_renewal_conversation_at TIMESTAMPTZ;

-- 3) Feature flag (off by default).
-- Note: existing cron flags store a raw boolean in `value` (consumed by
-- isCronSkipped({ defaultEnabled }) → getSetting<boolean>). Keep the shape
-- consistent so the same helper works for every cron.
INSERT INTO system_settings (key, value, description) VALUES
  (
    'cron_client_risk_scan_enabled',
    'false'::jsonb,
    'When true, the daily clientRiskScanCron (05:00 UTC) scans active clients and writes risk snapshots to client_engagement_snapshots. Defaults to false — flip on from /admin/automation once verified.'
  )
ON CONFLICT (key) DO NOTHING;

-- 4) RLS on; service-role bypasses, no public policies needed.
ALTER TABLE client_engagement_snapshots ENABLE ROW LEVEL SECURITY;
