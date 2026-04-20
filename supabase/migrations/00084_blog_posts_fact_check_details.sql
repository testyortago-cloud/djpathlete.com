-- supabase/migrations/00084_blog_posts_fact_check_details.sql
-- Phase 4b — fact-check result details (flagged claims) stored alongside the
-- coarser fact_check_status enum added in migration 00080.

ALTER TABLE blog_posts
  ADD COLUMN fact_check_details jsonb;

CREATE INDEX idx_blog_posts_flagged_posts
  ON blog_posts(fact_check_status)
  WHERE fact_check_status IN ('flagged', 'failed');
