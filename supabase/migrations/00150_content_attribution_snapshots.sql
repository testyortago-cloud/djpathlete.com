-- 00150_content_attribution_snapshots.sql
-- Phase 4 of broader-automations plan. Weekly per-blog-post attribution.

CREATE TABLE IF NOT EXISTS content_attribution_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of DATE NOT NULL,
  blog_post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  gsc_clicks_7d INTEGER NOT NULL DEFAULT 0,
  gsc_impressions_7d INTEGER NOT NULL DEFAULT 0,
  sessions_from_post_7d INTEGER NOT NULL DEFAULT 0,
  bookings_attributed INTEGER NOT NULL DEFAULT 0,
  revenue_attributed_cents BIGINT NOT NULL DEFAULT 0,
  attribution_model TEXT NOT NULL DEFAULT 'first_touch_landing',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (week_of, blog_post_id, attribution_model)
);

CREATE INDEX IF NOT EXISTS idx_cas_revenue ON content_attribution_snapshots (revenue_attributed_cents DESC);
CREATE INDEX IF NOT EXISTS idx_cas_week ON content_attribution_snapshots (week_of DESC);

INSERT INTO system_settings (key, value, description) VALUES
  (
    'cron_content_attribution_enabled',
    'false'::jsonb,
    'When true, the weekly contentAttributionCron (Sun 22:00 UTC) joins blog_posts × marketing_attribution × payments and writes content_attribution_snapshots rows. Defaults off.'
  )
ON CONFLICT (key) DO NOTHING;

ALTER TABLE content_attribution_snapshots ENABLE ROW LEVEL SECURITY;
