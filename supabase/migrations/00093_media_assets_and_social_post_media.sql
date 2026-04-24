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
  'Join table linking social_posts to media_assets with ordering. position=0 is the primary asset, mirrored into social_posts.media_url via trg_social_post_media_mirror.';

-- ──────────────────────────────────────────────────────────────────────────
-- media_url mirror: keep social_posts.media_url equal to the public_url of
-- the social_post_media row at position 0. Existing UI and publishing code
-- reads media_url directly, so this keeps them working unchanged while the
-- new DAL writes through social_post_media.
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recompute_social_post_media_url(target_post_id uuid)
RETURNS void AS $$
DECLARE
  new_media_url text;
BEGIN
  IF target_post_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ma.public_url
    INTO new_media_url
    FROM social_post_media spm
    JOIN media_assets ma ON ma.id = spm.media_asset_id
   WHERE spm.social_post_id = target_post_id
     AND spm.position = 0;

  UPDATE social_posts
     SET media_url = new_media_url
   WHERE id = target_post_id
     AND media_url IS DISTINCT FROM new_media_url;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.sync_social_post_media_url()
RETURNS trigger AS $$
BEGIN
  -- Recompute for the NEW row's post (covers INSERT + UPDATE target + UPDATE no-op).
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recompute_social_post_media_url(NEW.social_post_id);
  END IF;

  -- Recompute for the OLD row's post too when it differs (covers DELETE + cross-post UPDATE).
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND NEW.social_post_id IS DISTINCT FROM OLD.social_post_id) THEN
    PERFORM public.recompute_social_post_media_url(OLD.social_post_id);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_social_post_media_mirror
  AFTER INSERT OR UPDATE OR DELETE ON social_post_media
  FOR EACH ROW EXECUTE FUNCTION public.sync_social_post_media_url();

-- ──────────────────────────────────────────────────────────────────────────
-- Backfill: for every social_posts row without a social_post_media row at
-- position 0, create a media_assets row from media_url/source_video_id and
-- link it. Idempotent — safe to re-run. Also normalises post_type for legacy
-- rows still at the default 'video'.
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.backfill_social_post_media()
RETURNS void AS $$
DECLARE
  rec record;
  inferred_kind text;
  new_asset_id  uuid;
  inferred_type text;
  video_storage text;
BEGIN
  FOR rec IN
    SELECT sp.id, sp.media_url, sp.source_video_id, sp.post_type
      FROM social_posts sp
      LEFT JOIN social_post_media spm
        ON spm.social_post_id = sp.id AND spm.position = 0
     WHERE spm.social_post_id IS NULL
  LOOP
    IF rec.media_url IS NULL AND rec.source_video_id IS NULL THEN
      -- Text-only post. No asset row; normalise post_type to 'text'.
      IF rec.post_type IS DISTINCT FROM 'text' THEN
        UPDATE social_posts SET post_type = 'text' WHERE id = rec.id;
      END IF;
      CONTINUE;
    END IF;

    -- Infer kind. Prefer source_video_id signal; fall back to URL extension.
    IF rec.source_video_id IS NOT NULL THEN
      inferred_kind := 'video';
      SELECT storage_path INTO video_storage FROM video_uploads WHERE id = rec.source_video_id;
    ELSIF rec.media_url ~* '\.(mp4|mov|webm|mkv)(\?|$)' THEN
      inferred_kind := 'video';
      video_storage := NULL;
    ELSIF rec.media_url ~* '\.(jpe?g|png|webp|gif)(\?|$)' THEN
      inferred_kind := 'image';
      video_storage := NULL;
    ELSE
      -- Unknown extension and no source video — assume image; safer than refusing.
      inferred_kind := 'image';
      video_storage := NULL;
    END IF;

    INSERT INTO media_assets (kind, storage_path, public_url, mime_type, bytes, derived_from_video_id)
    VALUES (
      inferred_kind,
      COALESCE(video_storage, rec.media_url),
      COALESCE(rec.media_url, video_storage),
      CASE WHEN inferred_kind = 'video' THEN 'video/mp4' ELSE 'image/jpeg' END,
      0,
      rec.source_video_id
    )
    RETURNING id INTO new_asset_id;

    INSERT INTO social_post_media (social_post_id, media_asset_id, position)
    VALUES (rec.id, new_asset_id, 0);

    -- Normalise post_type for legacy rows still at the default 'video'.
    inferred_type := CASE inferred_kind WHEN 'image' THEN 'image' ELSE 'video' END;
    IF rec.post_type = 'video' AND inferred_type <> 'video' THEN
      UPDATE social_posts SET post_type = inferred_type WHERE id = rec.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run the backfill once at migration time. On fresh databases this is a no-op.
SELECT public.backfill_social_post_media();
