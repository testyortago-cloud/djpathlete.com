-- 00301_social_posts_tiktok_settings.sql
-- The coach's own choices for one TikTok post: who can view it, whether comments, duets
-- and stitches are on, and the commercial-content disclosure. TikTok's Direct Post rules
-- require these to be chosen per post by the person posting, never defaulted.

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS tiktok_settings jsonb;

COMMENT ON COLUMN social_posts.tiktok_settings IS
  'Per-post TikTok settings (shape: lib/validators/tiktok-post-settings.ts). Writer: PUT /api/admin/social/posts/[id]/tiktok. Reader: buildPluginInput -> the TikTok plugin, which refuses to post while this is NULL. NULL means the coach has not been through the Post to TikTok dialog for this post.';
