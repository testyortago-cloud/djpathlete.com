-- supabase/migrations/00283_social_posts_share_links.sql
-- Share to LinkedIn (spec docs/superpowers/specs/2026-09-29-share-to-linkedin-design.md).
--
-- WRITER: the social agent (functions/src/social-agent.ts), when it inserts a draft.
-- READERS: source_* -> findOpenShareDraft (lib/db/social-posts.ts), which the share route
--          uses to avoid drafting the same article twice;
--          link_*   -> buildPluginInput (lib/social/publish-runner.ts), which hands the
--          LinkedIn plugin a link card (LinkedIn's API never scrapes URLs itself).
--
-- SET NULL, not CASCADE: deleting a blog post or an issue must not delete the record of
-- what was published about it. Nullable, no default, no backfill.
--
-- social_posts still has no business_id: this sits in the platform seam the social agent
-- already uses (lib/tenancy/platform.ts). Flagged in the spec, not fixed here.
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS source_blog_post_id uuid REFERENCES public.blog_posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_newsletter_id uuid REFERENCES public.newsletters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_url text,
  ADD COLUMN IF NOT EXISTS link_title text,
  ADD COLUMN IF NOT EXISTS link_description text,
  ADD COLUMN IF NOT EXISTS link_image_url text;

ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_link_url_https
    CHECK (link_url IS NULL OR link_url LIKE 'https://%'),
  ADD CONSTRAINT social_posts_link_image_url_https
    CHECK (link_image_url IS NULL OR link_image_url LIKE 'https://%'),
  ADD CONSTRAINT social_posts_one_share_source
    CHECK (source_blog_post_id IS NULL OR source_newsletter_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_social_posts_source_blog_post
  ON public.social_posts(source_blog_post_id) WHERE source_blog_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_source_newsletter
  ON public.social_posts(source_newsletter_id) WHERE source_newsletter_id IS NOT NULL;
