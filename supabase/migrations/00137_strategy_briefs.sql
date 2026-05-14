-- supabase/migrations/00137_strategy_briefs.sql
-- Weekly strategy brief written by the chief strategist. One row per ISO-week.
-- Read by SEO/Ads/Social agents as bias for action ranking. Coach approves
-- before specialists consume it.
-- Depends on cross_channel_signals (00136) for the signal_id FK.

CREATE TABLE strategy_briefs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of           DATE NOT NULL UNIQUE,
  themes            JSONB NOT NULL DEFAULT '[]'::jsonb,
  audience_focus    TEXT NOT NULL,
  priority_channel  TEXT NOT NULL CHECK (priority_channel IN ('seo','ads','social','balanced')),
  keywords_to_chase JSONB NOT NULL DEFAULT '[]'::jsonb,
  hooks_to_test     JSONB NOT NULL DEFAULT '[]'::jsonb,
  ctas              JSONB NOT NULL DEFAULT '[]'::jsonb,
  dont_do           JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale         TEXT NOT NULL,
  signal_id         UUID REFERENCES cross_channel_signals(id) ON DELETE SET NULL,
  approval_status   TEXT NOT NULL DEFAULT 'draft'
                       CHECK (approval_status IN ('draft','approved','rejected')),
  approved_at       TIMESTAMPTZ,
  approved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_strategy_briefs_week_status
  ON strategy_briefs (week_of DESC, approval_status);

COMMENT ON TABLE strategy_briefs IS
  'Weekly strategy brief written by chiefStrategistCron. Specialists read latest approved row to bias action ranking.';

ALTER TABLE strategy_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on strategy_briefs"
  ON strategy_briefs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins manage all strategy_briefs"
  ON strategy_briefs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
