-- supabase/migrations/00079_video_uploads_and_transcripts.sql
CREATE TABLE video_uploads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path        text NOT NULL,
  original_filename   text NOT NULL,
  duration_seconds    integer,
  size_bytes          bigint,
  mime_type           text,
  title               text,
  uploaded_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'uploaded' CHECK (status IN (
                        'uploaded', 'transcribing', 'transcribed', 'analyzed', 'failed'
                      )),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_uploads_status ON video_uploads(status);
CREATE INDEX idx_video_uploads_created ON video_uploads(created_at DESC);

CREATE TRIGGER trg_video_uploads_updated_at
  BEFORE UPDATE ON video_uploads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE video_transcripts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_upload_id     uuid NOT NULL REFERENCES video_uploads(id) ON DELETE CASCADE,
  transcript_text     text NOT NULL,
  language            text NOT NULL DEFAULT 'en',
  assemblyai_job_id   text,
  analysis            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_transcripts_video ON video_transcripts(video_upload_id);

ALTER TABLE video_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_transcripts ENABLE ROW LEVEL SECURITY;

create policy "Admins manage all video_uploads"
  on public.video_uploads for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Admins manage all video_transcripts"
  on public.video_transcripts for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- Add FK from social_posts.source_video_id to video_uploads(id) (could not be set in 00076 since video_uploads did not yet exist)
ALTER TABLE social_posts
  ADD CONSTRAINT fk_social_posts_source_video
  FOREIGN KEY (source_video_id)
  REFERENCES video_uploads(id)
  ON DELETE SET NULL;
