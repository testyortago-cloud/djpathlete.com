-- supabase/migrations/00089_social_analytics.sql
-- Phase 5a — Analytics data layer.
--
-- Time-series snapshots of per-post engagement metrics. One row per
-- (social_post, sync run). Written by the syncPlatformAnalytics Firebase
-- Function on its nightly schedule.

CREATE TABLE social_analytics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id     uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  platform           text NOT NULL CHECK (platform IN (
                       'facebook', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin'
                     )),
  platform_post_id   text NOT NULL,
  impressions        bigint,
  engagement         bigint,
  likes              bigint,
  comments           bigint,
  shares             bigint,
  views              bigint,
  extra              jsonb,
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_analytics_post_recorded_desc
  ON social_analytics (social_post_id, recorded_at DESC);

CREATE INDEX idx_social_analytics_platform_recorded_desc
  ON social_analytics (platform, recorded_at DESC);

COMMENT ON TABLE social_analytics IS
  'Time-series snapshots of engagement metrics per published social_post. One row per post per sync run. Written by the syncPlatformAnalytics Firebase Function.';

ALTER TABLE social_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all social_analytics"
  ON public.social_analytics FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
