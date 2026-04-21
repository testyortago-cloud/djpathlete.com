-- Content Studio: video_uploads.thumbnail_path for Kanban card previews.
-- Thumbnail is generated client-side from the first second of playback when
-- the upload completes, and stored as a small JPG in Firebase Storage.

ALTER TABLE video_uploads
  ADD COLUMN thumbnail_path text;

COMMENT ON COLUMN video_uploads.thumbnail_path IS
  'Firebase Storage path of a small JPG thumbnail for this video.';
