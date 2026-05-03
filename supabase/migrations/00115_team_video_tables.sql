-- Team video review tables. Editors submit videos, admins review with
-- timecoded comments. Annotations table is created here so Plan 3
-- (drawing layer) can plug in without a schema change.

-- 1. Submissions: parent record per "video to review"
CREATE TABLE public.team_video_submissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  description         text,
  submitted_by        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN (
                        'draft','submitted','in_review',
                        'revision_requested','approved','locked'
                      )),
  current_version_id  uuid,  -- FK added after team_video_versions exists
  approved_at         timestamptz,
  approved_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  locked_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_video_submissions_status ON public.team_video_submissions(status);
CREATE INDEX idx_team_video_submissions_submitted_by ON public.team_video_submissions(submitted_by);
CREATE INDEX idx_team_video_submissions_created ON public.team_video_submissions(created_at DESC);

CREATE TRIGGER trg_team_video_submissions_updated_at
  BEFORE UPDATE ON public.team_video_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. Versions: one row per upload (v1, v2, ...)
CREATE TABLE public.team_video_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       uuid NOT NULL REFERENCES public.team_video_submissions(id) ON DELETE CASCADE,
  version_number      int NOT NULL,
  storage_path        text NOT NULL,
  original_filename   text NOT NULL,
  duration_seconds    numeric,
  size_bytes          bigint,
  mime_type           text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','uploaded','failed'
                      )),
  uploaded_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, version_number)
);

CREATE INDEX idx_team_video_versions_submission ON public.team_video_versions(submission_id);

-- Now wire up the FK that submissions had a placeholder for
ALTER TABLE public.team_video_submissions
  ADD CONSTRAINT fk_current_version
  FOREIGN KEY (current_version_id)
  REFERENCES public.team_video_versions(id)
  ON DELETE SET NULL;

-- 3. Comments: admin-write timecoded notes against a specific version
CREATE TABLE public.team_video_comments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id          uuid NOT NULL REFERENCES public.team_video_versions(id) ON DELETE CASCADE,
  author_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  timecode_seconds    numeric,         -- null = general comment, not pinned to a frame
  comment_text        text NOT NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_at         timestamptz,
  resolved_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_video_comments_version ON public.team_video_comments(version_id);
CREATE INDEX idx_team_video_comments_status ON public.team_video_comments(status);

CREATE TRIGGER trg_team_video_comments_updated_at
  BEFORE UPDATE ON public.team_video_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 4. Annotations: drawings linked 1:N to comments. Created here for Plan 3.
CREATE TABLE public.team_video_annotations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id          uuid NOT NULL REFERENCES public.team_video_comments(id) ON DELETE CASCADE,
  drawing_json        jsonb NOT NULL,  -- { paths: [{ tool, color, width, points }] }
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_video_annotations_comment ON public.team_video_annotations(comment_id);

-- 5. RLS — service-role bypasses; admin policies for completeness.
-- Note: this codebase uses NextAuth (not Supabase Auth), so auth.uid() is
-- always NULL for app sessions. The DAL uses createServiceRoleClient() which
-- bypasses RLS. These policies exist as belt-and-suspenders for any future
-- query that uses the anon/authed client.

ALTER TABLE public.team_video_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_video_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_video_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_video_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all team_video_submissions"
  ON public.team_video_submissions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "Admins manage all team_video_versions"
  ON public.team_video_versions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "Admins manage all team_video_comments"
  ON public.team_video_comments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "Admins manage all team_video_annotations"
  ON public.team_video_annotations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
