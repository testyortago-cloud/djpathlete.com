-- supabase/migrations/00165_video_uploads_hook_text.sql
-- Stores the auto-generated (and later editable) opening hook title for a video's
-- reel. Written by the broll_generation job; read by the Split Reel render to burn
-- the hook card onto the first frame. Nullable, no default (null until generated).
alter table public.video_uploads
  add column if not exists hook_text text;
