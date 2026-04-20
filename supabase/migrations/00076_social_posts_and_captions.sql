-- supabase/migrations/00076_social_posts_and_captions.sql
CREATE TABLE social_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform          text NOT NULL CHECK (platform IN (
                      'facebook', 'instagram', 'tiktok', 'youtube', 'youtube_shorts', 'linkedin'
                    )),
  content           text NOT NULL,
  media_url         text,
  approval_status   text NOT NULL DEFAULT 'draft' CHECK (approval_status IN (
                      'draft', 'edited', 'approved', 'scheduled', 'published', 'rejected', 'awaiting_connection', 'failed'
                    )),
  scheduled_at      timestamptz,
  published_at      timestamptz,
  source_video_id   uuid,
  rejection_notes   text,
  platform_post_id  text,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_posts_platform ON social_posts(platform);
CREATE INDEX idx_social_posts_approval_status ON social_posts(approval_status);
CREATE INDEX idx_social_posts_scheduled_at ON social_posts(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX idx_social_posts_source_video ON social_posts(source_video_id) WHERE source_video_id IS NOT NULL;

CREATE TABLE social_captions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id    uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  caption_text      text NOT NULL,
  hashtags          text[] NOT NULL DEFAULT '{}',
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_captions_post ON social_captions(social_post_id);

CREATE TRIGGER trg_social_posts_updated_at
  BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_captions ENABLE ROW LEVEL SECURITY;

create policy "Admins manage all social_posts"
  on public.social_posts for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Admins manage all social_captions"
  on public.social_captions for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
