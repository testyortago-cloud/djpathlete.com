-- supabase/migrations/00093_media_assets_and_social_post_media.sql
-- Phase 0 of the Content Studio Multimedia umbrella (see
-- docs/superpowers/specs/2026-04-24-content-studio-multimedia-design.md).
-- Introduces first-class media assets and a join table so posts can reference
-- multiple ordered media items. Adds post_type on social_posts so later phases
-- can ship image/carousel/story types without a second migration pass.

CREATE TABLE media_assets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   text NOT NULL CHECK (kind IN ('video', 'image')),
  storage_path           text NOT NULL,
  public_url             text NOT NULL,
  mime_type              text NOT NULL,
  width                  integer,
  height                 integer,
  duration_ms            integer,
  bytes                  bigint NOT NULL,
  derived_from_video_id  uuid REFERENCES video_uploads(id) ON DELETE SET NULL,
  ai_alt_text            text,
  ai_analysis            jsonb,
  created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_assets_kind ON media_assets(kind);
CREATE INDEX idx_media_assets_derived_from
  ON media_assets(derived_from_video_id)
  WHERE derived_from_video_id IS NOT NULL;
CREATE INDEX idx_media_assets_created
  ON media_assets(created_at DESC);

CREATE TRIGGER trg_media_assets_updated_at
  BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE social_post_media (
  social_post_id    uuid NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  media_asset_id    uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  position          integer NOT NULL CHECK (position >= 0),
  overlay_text      text,
  overlay_metadata  jsonb,
  PRIMARY KEY (social_post_id, position),
  UNIQUE (social_post_id, media_asset_id)
);

CREATE INDEX idx_social_post_media_asset
  ON social_post_media(media_asset_id);

ALTER TABLE social_posts
  ADD COLUMN post_type text NOT NULL DEFAULT 'video'
    CHECK (post_type IN ('video', 'image', 'carousel', 'story', 'text'));

CREATE INDEX idx_social_posts_post_type
  ON social_posts(post_type);

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_post_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all media_assets"
  ON public.media_assets FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "Admins manage all social_post_media"
  ON public.social_post_media FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

COMMENT ON TABLE media_assets IS
  'First-class media entity. Sources: direct upload (created_by set), video-derived (derived_from_video_id set), or AI-generated (ai_analysis.origin set). See spec 2026-04-24-content-studio-multimedia-design.md.';

COMMENT ON TABLE social_post_media IS
  'Join table linking social_posts to media_assets with ordering. position=0 is the primary asset (will be mirrored into social_posts.media_url via the trigger added in a later phase).';
