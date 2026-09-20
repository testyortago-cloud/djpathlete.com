-- supabase/migrations/00265_media_thumbnails.sql
-- Settable video thumbnails.
--
-- video_uploads.thumbnail_source records HOW the current thumbnail was chosen,
-- so the UI can label it and decide whether "Revert to auto" applies. Null on
-- every pre-existing row, which reads as "auto / unknown" and offers no revert.
--
-- A companion team_video_versions.thumbnail_path column was added here to
-- back a Team Media board preview column, then withdrawn: nothing in the repo
-- ever wrote it, so the column could never populate and the column was
-- removed from the board rather than ship a placeholder that always shows.

ALTER TABLE video_uploads
  ADD COLUMN thumbnail_source text;

COMMENT ON COLUMN video_uploads.thumbnail_source IS
  'How the current thumbnail was chosen: auto (1s canvas grab at upload), frame (operator picked a frame), upload (operator supplied an image). Null = auto/unknown, pre-dates the picker.';
