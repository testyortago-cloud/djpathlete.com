-- supabase/migrations/00087_user_preferences.sql
-- Content Studio Phase 5: per-user preferences + full-text search on transcripts

CREATE TABLE user_preferences (
  user_id                    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  calendar_default_view      text NOT NULL DEFAULT 'month'
                             CHECK (calendar_default_view IN ('month', 'week', 'day')),
  last_pipeline_filters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  pipeline_lanes_collapsed   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own preferences"
  ON public.user_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Full-text search on transcripts: generated tsvector column + GIN index.
ALTER TABLE video_transcripts
  ADD COLUMN transcript_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(transcript_text, ''))) STORED;

CREATE INDEX idx_video_transcripts_tsv
  ON video_transcripts USING GIN (transcript_tsv);

-- ILIKE helpers for the remaining search targets (filenames + captions).
CREATE INDEX idx_video_uploads_filename_lower
  ON video_uploads (lower(original_filename));

CREATE INDEX idx_social_posts_content_lower
  ON social_posts (lower(content));
