-- 00151_inbox_sla_snapshots.sql
-- Phase 5 of broader-automations plan. Daily snapshot of coach inbox health.

CREATE TABLE IF NOT EXISTS inbox_sla_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unread_count INTEGER NOT NULL DEFAULT 0,
  awaiting_reply_over_24h INTEGER NOT NULL DEFAULT 0,
  awaiting_reply_over_48h INTEGER NOT NULL DEFAULT 0,
  mean_response_minutes_7d NUMERIC(10,2),
  oldest_unanswered JSONB NOT NULL DEFAULT '[]'::jsonb,
  fetch_status TEXT NOT NULL DEFAULT 'ok' CHECK (fetch_status IN ('ok','degraded','error')),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_iss_time ON inbox_sla_snapshots (snapshot_at DESC);

INSERT INTO system_settings (key, value, description) VALUES
  (
    'cron_inbox_sla_enabled',
    'false'::jsonb,
    'When true, the weekday inboxSlaCron (06:00 UTC) fetches GHL conversations and writes an inbox_sla_snapshots row. Defaults off.'
  )
ON CONFLICT (key) DO NOTHING;

ALTER TABLE inbox_sla_snapshots ENABLE ROW LEVEL SECURITY;
