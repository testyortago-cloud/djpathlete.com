-- supabase/migrations/00080_blog_posts_ai_extensions.sql
ALTER TABLE blog_posts
  ADD COLUMN source_video_id    uuid REFERENCES video_uploads(id) ON DELETE SET NULL,
  ADD COLUMN seo_metadata       jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN tavily_research    jsonb,
  ADD COLUMN fact_check_status  text CHECK (fact_check_status IN (
                                   'pending', 'passed', 'flagged', 'failed'
                                 ));

CREATE INDEX idx_blog_posts_source_video ON blog_posts(source_video_id) WHERE source_video_id IS NOT NULL;
CREATE INDEX idx_blog_posts_fact_check ON blog_posts(fact_check_status) WHERE fact_check_status IS NOT NULL;
