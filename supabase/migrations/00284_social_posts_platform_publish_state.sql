-- 00284_social_posts_platform_publish_state.sql
-- A post whose platform is still processing its media (Instagram video containers
-- are asynchronous). Reader and writer: lib/social/publish-runner.ts. NULL for every
-- post that is not mid-publish. Shape is owned by the platform plugin:
--   { "startedAt": ISO, "scheduledFor": ISO, "data": { ... } }
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS platform_publish_state jsonb;

COMMENT ON COLUMN social_posts.platform_publish_state IS
  'Plugin-owned state for a publish waiting on the platform (e.g. Instagram processing a video). Cleared on publish or failure.';
