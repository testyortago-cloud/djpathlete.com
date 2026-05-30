-- supabase/migrations/00159_video_uploads_source_submission.sql
-- Back-reference from a Content Studio video_uploads row to the team submission
-- it was promoted from. Lets promote-or-reuse dedupe instead of inserting a
-- duplicate row on a repeated "Send to Content Studio" / "Generate Captioned
-- Cut". Nullable: direct admin uploads have no submission.

alter table public.video_uploads
  add column if not exists source_submission_id uuid
    references public.team_video_submissions(id) on delete set null;

create index if not exists idx_video_uploads_source_submission
  on public.video_uploads(source_submission_id);
