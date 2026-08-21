-- Content scheduling for blog posts and newsletters.
-- Adds a third lifecycle state to each table plus the intended fire time.
-- Mirrors social_posts.scheduled_at, which has worked this way since Phase 5.

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_failed_reason TEXT;

ALTER TABLE blog_posts DROP CONSTRAINT IF EXISTS blog_posts_status_check;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check
  CHECK (status IN ('draft', 'scheduled', 'published'));

-- Partial index: the every-5-min checker only ever reads scheduled rows.
CREATE INDEX IF NOT EXISTS idx_blog_posts_scheduled
  ON blog_posts (scheduled_at) WHERE status = 'scheduled';

ALTER TABLE newsletters
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_failed_reason TEXT;

ALTER TABLE newsletters DROP CONSTRAINT IF EXISTS newsletters_status_check;
ALTER TABLE newsletters ADD CONSTRAINT newsletters_status_check
  CHECK (status IN ('draft', 'scheduled', 'sent'));

CREATE INDEX IF NOT EXISTS idx_newsletters_scheduled
  ON newsletters (scheduled_at) WHERE status = 'scheduled';

-- Defaults TRUE, unlike most new cron flags. A scheduler whose checker is
-- off is not a dormant feature — it is a UI that accepts a time and then
-- does nothing. The /schedule routes refuse while this is false, so the
-- combination "accepts schedules, never fires them" cannot occur.
INSERT INTO system_settings (key, value, description)
VALUES ('cron_content_schedule_enabled', 'true'::jsonb,
        'Publish scheduled blog posts and send scheduled newsletters when their time arrives')
ON CONFLICT (key) DO NOTHING;
