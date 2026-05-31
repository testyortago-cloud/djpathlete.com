-- supabase/migrations/00160_video_uploads_needs_edit.sql
-- Edit gate: a video marked needs_edit=true cannot be posted/scheduled until a
-- captioned cut is rendered (auto-clears the gate) or it is manually marked ready.
-- No backfill: existing rows take the gated default; Content Studio data is wiped
-- during testing.
alter table public.video_uploads
  add column if not exists needs_edit boolean not null default true;
