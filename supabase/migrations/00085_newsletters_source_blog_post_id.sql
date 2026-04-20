-- supabase/migrations/00085_newsletters_source_blog_post_id.sql
-- Phase 4c — link auto-drafted newsletters back to the blog post that spawned them.

ALTER TABLE newsletters
  ADD COLUMN source_blog_post_id uuid REFERENCES blog_posts(id) ON DELETE SET NULL;

CREATE INDEX idx_newsletters_source_blog_post
  ON newsletters(source_blog_post_id)
  WHERE source_blog_post_id IS NOT NULL;
