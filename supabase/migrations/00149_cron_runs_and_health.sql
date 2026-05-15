-- 00149_cron_runs_and_health.sql
-- Phase 3 of broader-automations plan. cron_runs is a thin log of every
-- scheduled function run; automation_health_snapshots is the periodic
-- watchdog summary built from cron_runs + ai_jobs status counts.

CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running','success','failed')) DEFAULT 'running',
  detail JSONB
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_name_time ON cron_runs (cron_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS automation_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ai_jobs_failed_24h JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_jobs_pending_over_1h INTEGER NOT NULL DEFAULT 0,
  silent_crons JSONB NOT NULL DEFAULT '[]'::jsonb,
  alert_severity TEXT NOT NULL CHECK (alert_severity IN ('none','warning','critical')),
  alert_summary TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ahs_time ON automation_health_snapshots (snapshot_at DESC);

INSERT INTO system_settings (key, value, description) VALUES
  (
    'cron_automation_health_enabled',
    'false'::jsonb,
    'When true, the daily automationHealthCron (08:00 UTC) scans ai_jobs + cron_runs and writes an automation_health_snapshots row; emails an alert when severity=critical. Defaults off — flip on from /admin/automation once verified.'
  )
ON CONFLICT (key) DO NOTHING;

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_health_snapshots ENABLE ROW LEVEL SECURITY;
