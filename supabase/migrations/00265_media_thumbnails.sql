-- supabase/migrations/00265_media_thumbnails.sql
-- Settable video thumbnails.
--
-- video_uploads.thumbnail_source records HOW the current thumbnail was chosen,
-- so the UI can label it and decide whether "Revert to auto" applies. Null on
-- every pre-existing row, which reads as "auto / unknown" and offers no revert.
--
-- team_video_versions.thumbnail_path gives the Team Media board the preview it
-- has never had. The file lives on the VERSION (team_video_versions.storage_path),
-- not the submission, so the thumbnail belongs here too.
--
-- No CHECK constraint on thumbnail_source on purpose: it is written by exactly
-- one route, which validates with Zod first, and a CHECK would sharpen the
-- one-deploy window where migration and code are out of step for no gain.

ALTER TABLE video_uploads
  ADD COLUMN thumbnail_source text;

COMMENT ON COLUMN video_uploads.thumbnail_source IS
  'How the current thumbnail was chosen: auto (1s canvas grab at upload), frame (operator picked a frame), upload (operator supplied an image). Null = auto/unknown, pre-dates the picker.';

ALTER TABLE team_video_versions
  ADD COLUMN thumbnail_path text;

COMMENT ON COLUMN team_video_versions.thumbnail_path IS
  'Firebase Storage path of a small JPG thumbnail for this cut; null until generated lazily on first view.';
