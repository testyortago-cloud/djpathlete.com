-- supabase/migrations/00086_video_transcripts_source.sql
-- Track whether a transcript came from speech-to-text (AssemblyAI) or from
-- Claude Vision analysis of sampled video frames (fallback for silent clips).

ALTER TABLE video_transcripts
  ADD COLUMN source text NOT NULL DEFAULT 'speech'
    CHECK (source IN ('speech', 'vision'));
