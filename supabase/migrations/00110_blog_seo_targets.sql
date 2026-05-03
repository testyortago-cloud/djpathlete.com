-- supabase/migrations/00110_blog_seo_targets.sql
-- Phase 2 of blog-generation-quality rollout.
-- Adds SEO target columns so the generator can write to a declared keyword
-- and the renderer (Phase 3+) can validate keyword density / coverage.
-- All columns are additive and nullable/defaulted — legacy posts unaffected.

ALTER TABLE blog_posts
  ADD COLUMN primary_keyword text,
  ADD COLUMN secondary_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN search_intent text
    CHECK (search_intent IN ('informational', 'commercial', 'transactional'));

CREATE INDEX idx_blog_posts_primary_keyword ON blog_posts(primary_keyword);

COMMENT ON COLUMN blog_posts.primary_keyword IS
  'Target search keyword for the post; required on AI generations after Phase 2 deploy, NULL on legacy posts.';
COMMENT ON COLUMN blog_posts.secondary_keywords IS
  'Up to 5 supporting keywords distributed across body sections.';
COMMENT ON COLUMN blog_posts.search_intent IS
  'informational | commercial | transactional. Drives title formula and CTA selection.';
