-- 00135_team_submission_images.sql
-- Extends the team-video submission pipeline to also carry image-set
-- submissions (1-10 photos per version). Adds a kind discriminator to
-- submissions, relaxes file-field constraints on versions, and creates a
-- per-image join table with a trigger-maintained count.

-- 1. Submission kind discriminator.
ALTER TABLE public.team_video_submissions
  ADD COLUMN kind text NOT NULL DEFAULT 'video'
    CHECK (kind IN ('video', 'image_set'));

CREATE INDEX idx_team_video_submissions_kind
  ON public.team_video_submissions(kind);

-- 2. Relax version columns so image_set versions can omit file-level fields.
--    Existing video rows already have non-null values and stay that way.
ALTER TABLE public.team_video_versions
  ALTER COLUMN mime_type DROP NOT NULL,
  ALTER COLUMN size_bytes DROP NOT NULL,
  ALTER COLUMN original_filename DROP NOT NULL,
  ALTER COLUMN storage_path DROP NOT NULL,
  ADD COLUMN image_count int
    CHECK (image_count IS NULL OR (image_count >= 1 AND image_count <= 10));

-- 3. Per-image rows for image_set versions.
CREATE TABLE public.team_submission_images (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id         uuid NOT NULL REFERENCES public.team_video_versions(id) ON DELETE CASCADE,
  position           int  NOT NULL CHECK (position >= 0 AND position <= 9),
  storage_path       text NOT NULL,
  original_filename  text NOT NULL,
  mime_type          text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes         bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  width              int,
  height             int,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, position)
);

CREATE INDEX idx_team_submission_images_version
  ON public.team_submission_images(version_id);

-- 4. Trigger keeps team_video_versions.image_count = COUNT(*) of images for
--    that version. Runs AFTER so the version row is always consistent post-commit.
CREATE OR REPLACE FUNCTION public.sync_team_version_image_count()
RETURNS trigger AS $$
DECLARE
  target_version uuid;
BEGIN
  target_version := COALESCE(NEW.version_id, OLD.version_id);
  IF target_version IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.team_video_versions
     SET image_count = (
       SELECT COUNT(*) FROM public.team_submission_images
        WHERE version_id = target_version
     )
   WHERE id = target_version;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_team_submission_images_count
  AFTER INSERT OR UPDATE OR DELETE ON public.team_submission_images
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_version_image_count();

-- 5. RLS — service-role bypasses, admin policy for completeness (same pattern
--    as 00115_team_video_tables.sql).
ALTER TABLE public.team_submission_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all team_submission_images"
  ON public.team_submission_images FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
