-- supabase/migrations/00136_cross_channel_signals.sql
-- Weekly cross-channel synthesis written by the performance critic.
-- One row per ISO-week. Consumed by the chief strategist as the primary
-- input to next week's brief.

CREATE TABLE cross_channel_signals (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of                    DATE NOT NULL UNIQUE,
  winners                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  losers                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  anomalies                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  attribution_summary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations_for_brief  JSONB NOT NULL DEFAULT '[]'::jsonb,
  preflight_status           TEXT NOT NULL DEFAULT 'ok'
                                CHECK (preflight_status IN ('ok','failed')),
  preflight_reasons          JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale                  TEXT NOT NULL DEFAULT '',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cross_channel_signals_week ON cross_channel_signals (week_of DESC);

COMMENT ON TABLE cross_channel_signals IS
  'Weekly cross-channel performance synthesis. Written by performanceCriticCron, read by chiefStrategistCron.';

ALTER TABLE cross_channel_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on cross_channel_signals"
  ON cross_channel_signals FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins read all cross_channel_signals"
  ON cross_channel_signals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
