# Content Studio Multimedia — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the schema foundation (`media_assets`, `social_post_media`, `post_type` column, `media_url` mirror trigger, and idempotent backfill) so future phases can introduce image/carousel/story content types without touching the data model again.

**Architecture:** A new `media_assets` table becomes the first-class home for uploaded-or-derived files. A `social_post_media` join table links posts to assets with ordering and per-slide overlay metadata. `social_posts` grows a `post_type` column (CHECK-constrained to match existing conventions) and `media_url` is kept synchronized to `social_post_media.position=0` via an `AFTER` trigger so the existing publishing/UI code paths keep working unchanged.

**Tech Stack:** PostgreSQL + plpgsql (migrations), Supabase (service-role client in DAL), TypeScript strict, Vitest for tests.

**Spec:** [docs/superpowers/specs/2026-04-24-content-studio-multimedia-design.md](../specs/2026-04-24-content-studio-multimedia-design.md)

---

## File structure

- Create: `supabase/migrations/00093_media_assets_and_social_post_media.sql`
- Modify: `types/database.ts` — add `PostType`, `MediaAsset`, `MediaAssetKind`, `SocialPostMediaRow`; extend `SocialPost` with `post_type`
- Create: `lib/db/media-assets.ts` — DAL for the assets table
- Create: `lib/db/social-post-media.ts` — DAL for the join table
- Modify: `lib/db/social-posts.ts` — new `getSocialPostWithMedia` helper
- Modify: `lib/db/index.ts` — re-export the two new modules
- Create: `__tests__/migrations/00093_media_assets.test.ts` — schema + trigger + backfill tests
- Create: `__tests__/db/media-assets.test.ts` — DAL tests
- Create: `__tests__/db/social-post-media.test.ts` — DAL tests

---

## Task 1: Migration — core tables and `post_type` column

**Files:**
- Create: `supabase/migrations/00093_media_assets_and_social_post_media.sql`
- Create: `__tests__/migrations/00093_media_assets.test.ts`

- [ ] **Step 1: Write the failing migration test (schema shape only)**

Create `__tests__/migrations/00093_media_assets.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("migration 00093 — media_assets + social_post_media + post_type", () => {
  const supabase = createServiceRoleClient()

  it("creates a media_assets row with expected columns", async () => {
    const { data, error } = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/test-00093.jpg",
        public_url: "https://example.invalid/test-00093.jpg",
        mime_type: "image/jpeg",
        bytes: 1024,
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    expect(data?.kind).toBe("image")
    expect(data?.ai_alt_text).toBeNull()
    expect(data?.derived_from_video_id).toBeNull()

    if (data?.id) await supabase.from("media_assets").delete().eq("id", data.id)
  })

  it("rejects invalid media kind via CHECK constraint", async () => {
    const { data, error } = await supabase
      .from("media_assets")
      .insert({
        kind: "audio",
        storage_path: "media-assets/bogus.mp3",
        public_url: "https://example.invalid/bogus.mp3",
        mime_type: "audio/mpeg",
        bytes: 1,
      })
      .select()
      .single()

    expect(error).not.toBeNull()
    if (data?.id) await supabase.from("media_assets").delete().eq("id", data.id)
  })

  it("adds post_type column to social_posts with default 'video'", async () => {
    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "post_type default check", approval_status: "draft" })
      .select()
      .single()

    expect(post.error).toBeNull()
    expect((post.data as { post_type?: string } | null)?.post_type).toBe("video")

    if (post.data?.id) await supabase.from("social_posts").delete().eq("id", post.data.id)
  })

  it("rejects invalid post_type via CHECK constraint", async () => {
    const { data, error } = await supabase
      .from("social_posts")
      .insert({
        platform: "instagram",
        content: "bad type",
        approval_status: "draft",
        post_type: "livestream",
      })
      .select()
      .single()

    expect(error).not.toBeNull()
    if (data?.id) await supabase.from("social_posts").delete().eq("id", data.id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/migrations/00093_media_assets.test.ts`
Expected: FAIL — `media_assets` table does not exist, `post_type` column does not exist.

- [ ] **Step 3: Write the migration SQL (tables + post_type column only)**

Create `supabase/migrations/00093_media_assets_and_social_post_media.sql`:

```sql
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
  'Join table linking social_posts to media_assets with ordering. position=0 is the primary asset (mirrored into social_posts.media_url via trigger).';
```

- [ ] **Step 4: Apply the migration locally**

Run: `npx supabase db push` (or the project's equivalent migration command)
Expected: migration 00093 applied without error.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- __tests__/migrations/00093_media_assets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00093_media_assets_and_social_post_media.sql __tests__/migrations/00093_media_assets.test.ts
git commit -m "feat(content-studio): add media_assets, social_post_media, post_type (schema only)"
```

---

## Task 2: Migration — `media_url` mirror trigger

**Files:**
- Modify: `supabase/migrations/00093_media_assets_and_social_post_media.sql` (append trigger)
- Modify: `__tests__/migrations/00093_media_assets.test.ts` (add trigger tests)

- [ ] **Step 1: Add failing trigger tests to the migration test file**

Append inside the existing `describe(...)` block in `__tests__/migrations/00093_media_assets.test.ts`:

```ts
  it("mirrors media_url from social_post_media at position 0 on insert", async () => {
    const asset = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/mirror-1.jpg",
        public_url: "https://example.invalid/mirror-1.jpg",
        mime_type: "image/jpeg",
        bytes: 10,
      })
      .select()
      .single()
    expect(asset.error).toBeNull()

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "mirror test", approval_status: "draft", post_type: "image" })
      .select()
      .single()
    expect(post.error).toBeNull()

    try {
      const join = await supabase.from("social_post_media").insert({
        social_post_id: post.data!.id,
        media_asset_id: asset.data!.id,
        position: 0,
      })
      expect(join.error).toBeNull()

      const after = await supabase
        .from("social_posts")
        .select("media_url")
        .eq("id", post.data!.id)
        .single()
      expect(after.data?.media_url).toBe("https://example.invalid/mirror-1.jpg")
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
      await supabase.from("media_assets").delete().eq("id", asset.data!.id)
    }
  })

  it("leaves media_url untouched when only non-zero-position media changes", async () => {
    const a0 = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/mirror-2a.jpg",
        public_url: "https://example.invalid/mirror-2a.jpg",
        mime_type: "image/jpeg",
        bytes: 10,
      })
      .select()
      .single()
    const a1 = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/mirror-2b.jpg",
        public_url: "https://example.invalid/mirror-2b.jpg",
        mime_type: "image/jpeg",
        bytes: 10,
      })
      .select()
      .single()

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "nonzero", approval_status: "draft", post_type: "carousel" })
      .select()
      .single()

    try {
      await supabase.from("social_post_media").insert([
        { social_post_id: post.data!.id, media_asset_id: a0.data!.id, position: 0 },
        { social_post_id: post.data!.id, media_asset_id: a1.data!.id, position: 1 },
      ])

      const detach1 = await supabase
        .from("social_post_media")
        .delete()
        .eq("social_post_id", post.data!.id)
        .eq("position", 1)
      expect(detach1.error).toBeNull()

      const after = await supabase
        .from("social_posts")
        .select("media_url")
        .eq("id", post.data!.id)
        .single()
      expect(after.data?.media_url).toBe("https://example.invalid/mirror-2a.jpg")
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
      await supabase.from("media_assets").delete().in("id", [a0.data!.id, a1.data!.id])
    }
  })

  it("clears media_url when position 0 is detached and no other media exist", async () => {
    const asset = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/mirror-3.jpg",
        public_url: "https://example.invalid/mirror-3.jpg",
        mime_type: "image/jpeg",
        bytes: 10,
      })
      .select()
      .single()

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "detach", approval_status: "draft", post_type: "image" })
      .select()
      .single()

    try {
      await supabase.from("social_post_media").insert({
        social_post_id: post.data!.id,
        media_asset_id: asset.data!.id,
        position: 0,
      })
      await supabase
        .from("social_post_media")
        .delete()
        .eq("social_post_id", post.data!.id)
        .eq("position", 0)

      const after = await supabase
        .from("social_posts")
        .select("media_url")
        .eq("id", post.data!.id)
        .single()
      expect(after.data?.media_url).toBeNull()
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
      await supabase.from("media_assets").delete().eq("id", asset.data!.id)
    }
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/migrations/00093_media_assets.test.ts`
Expected: three new tests FAIL — `media_url` not being updated by `social_post_media` writes.

- [ ] **Step 3: Append the trigger to the migration file**

Append to `supabase/migrations/00093_media_assets_and_social_post_media.sql`:

```sql
-- ──────────────────────────────────────────────────────────────────────────
-- media_url mirror: keep social_posts.media_url equal to the public_url of
-- the social_post_media row at position 0. Existing UI and publishing code
-- reads media_url directly, so this keeps them working unchanged while the
-- new DAL writes through social_post_media.
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_social_post_media_url()
RETURNS trigger AS $$
DECLARE
  target_post_id uuid := COALESCE(NEW.social_post_id, OLD.social_post_id);
  new_media_url  text;
BEGIN
  SELECT ma.public_url
    INTO new_media_url
    FROM social_post_media spm
    JOIN media_assets ma ON ma.id = spm.media_asset_id
   WHERE spm.social_post_id = target_post_id
     AND spm.position = 0;

  UPDATE social_posts
     SET media_url  = new_media_url,
         updated_at = now()
   WHERE id = target_post_id
     AND media_url IS DISTINCT FROM new_media_url;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_social_post_media_mirror
  AFTER INSERT OR UPDATE OR DELETE ON social_post_media
  FOR EACH ROW EXECUTE FUNCTION public.sync_social_post_media_url();
```

- [ ] **Step 4: Apply the updated migration**

This migration hasn't been deployed to prod yet, so we can drop and re-apply locally:

Run: `npx supabase db reset` (or re-run `npx supabase db push` if the dev DB allows replay of 00093 — the project's convention applies)
Expected: migration 00093 applies including the trigger.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/migrations/00093_media_assets.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00093_media_assets_and_social_post_media.sql __tests__/migrations/00093_media_assets.test.ts
git commit -m "feat(content-studio): add media_url mirror trigger tied to social_post_media"
```

---

## Task 3: Migration — idempotent backfill function and one-time invocation

**Files:**
- Modify: `supabase/migrations/00093_media_assets_and_social_post_media.sql` (append backfill function + CALL)
- Modify: `__tests__/migrations/00093_media_assets.test.ts` (backfill test)

- [ ] **Step 1: Add failing backfill test**

Append to `__tests__/migrations/00093_media_assets.test.ts`:

```ts
  it("backfills a legacy post with an image media_url into media_assets + social_post_media", async () => {
    // Simulate a legacy-shape row: social_post has media_url but no join row.
    // Directly bypass the normal flow by inserting the post, then manually
    // clearing any join rows the future normal flow would create.
    const post = await supabase
      .from("social_posts")
      .insert({
        platform: "instagram",
        content: "legacy image",
        approval_status: "draft",
        media_url: "https://example.invalid/legacy.jpg",
      })
      .select()
      .single()
    expect(post.error).toBeNull()

    await supabase.from("social_post_media").delete().eq("social_post_id", post.data!.id)

    try {
      const rpc = await supabase.rpc("backfill_social_post_media")
      expect(rpc.error).toBeNull()

      const join = await supabase
        .from("social_post_media")
        .select("media_asset_id, position")
        .eq("social_post_id", post.data!.id)
        .single()
      expect(join.error).toBeNull()
      expect(join.data?.position).toBe(0)

      const asset = await supabase
        .from("media_assets")
        .select("kind, public_url")
        .eq("id", join.data!.media_asset_id)
        .single()
      expect(asset.data?.kind).toBe("image")
      expect(asset.data?.public_url).toBe("https://example.invalid/legacy.jpg")

      const sp = await supabase
        .from("social_posts")
        .select("post_type")
        .eq("id", post.data!.id)
        .single()
      expect((sp.data as { post_type?: string })?.post_type).toBe("image")
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
    }
  })

  it("backfill is idempotent — running twice yields a single join row", async () => {
    const post = await supabase
      .from("social_posts")
      .insert({
        platform: "instagram",
        content: "idempotent",
        approval_status: "draft",
        media_url: "https://example.invalid/idem.mp4",
      })
      .select()
      .single()
    await supabase.from("social_post_media").delete().eq("social_post_id", post.data!.id)

    try {
      await supabase.rpc("backfill_social_post_media")
      await supabase.rpc("backfill_social_post_media")

      const rows = await supabase
        .from("social_post_media")
        .select("position")
        .eq("social_post_id", post.data!.id)
      expect(rows.data?.length).toBe(1)

      const sp = await supabase
        .from("social_posts")
        .select("post_type")
        .eq("id", post.data!.id)
        .single()
      expect((sp.data as { post_type?: string })?.post_type).toBe("video")
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
    }
  })

  it("backfills a text-only post (no media_url) by setting post_type to 'text'", async () => {
    const post = await supabase
      .from("social_posts")
      .insert({
        platform: "linkedin",
        content: "text-only post",
        approval_status: "draft",
      })
      .select()
      .single()

    try {
      await supabase.rpc("backfill_social_post_media")

      const sp = await supabase
        .from("social_posts")
        .select("post_type, media_url")
        .eq("id", post.data!.id)
        .single()
      expect((sp.data as { post_type?: string })?.post_type).toBe("text")
      expect(sp.data?.media_url).toBeNull()

      const rows = await supabase
        .from("social_post_media")
        .select("position")
        .eq("social_post_id", post.data!.id)
      expect(rows.data?.length).toBe(0)
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
    }
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/migrations/00093_media_assets.test.ts`
Expected: backfill tests FAIL — `backfill_social_post_media` RPC does not exist.

- [ ] **Step 3: Append the backfill function and invocation to the migration**

Append to `supabase/migrations/00093_media_assets_and_social_post_media.sql`:

```sql
-- ──────────────────────────────────────────────────────────────────────────
-- Backfill: for every social_posts row without a social_post_media row,
-- create a media_assets row from media_url/source_video_id and link it.
-- Idempotent — safe to re-run; only inserts join rows for posts that don't
-- already have one at position 0. Also normalises post_type for legacy rows.
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
      rec.media_url,
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
```

- [ ] **Step 4: Re-apply the migration**

Run: `npx supabase db reset` (dev-only; drops and re-applies all migrations)
Expected: 00093 applies cleanly including backfill.

- [ ] **Step 5: Run the migration tests**

Run: `npm run test:run -- __tests__/migrations/00093_media_assets.test.ts`
Expected: all 10 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00093_media_assets_and_social_post_media.sql __tests__/migrations/00093_media_assets.test.ts
git commit -m "feat(content-studio): idempotent backfill for legacy social_posts media"
```

---

## Task 4: TypeScript types

**Files:**
- Modify: `types/database.ts`

- [ ] **Step 1: Add new type definitions**

Open `types/database.ts`. Locate the Phase 1 Starter AI Automation section (around line 1123) and update:

Find:
```ts
export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "youtube" | "youtube_shorts" | "linkedin"
```

Leave it unchanged. Immediately after it, add:

```ts
export type PostType = "video" | "image" | "carousel" | "story" | "text"

export type MediaAssetKind = "video" | "image"

export interface MediaAsset {
  id: string
  kind: MediaAssetKind
  storage_path: string
  public_url: string
  mime_type: string
  width: number | null
  height: number | null
  duration_ms: number | null
  bytes: number
  derived_from_video_id: string | null
  ai_alt_text: string | null
  ai_analysis: Record<string, unknown> | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SocialPostMediaRow {
  social_post_id: string
  media_asset_id: string
  position: number
  overlay_text: string | null
  overlay_metadata: Record<string, unknown> | null
}
```

- [ ] **Step 2: Extend the `SocialPost` interface with `post_type`**

Find the existing `SocialPost` interface:
```ts
export interface SocialPost {
  id: string
  platform: SocialPlatform
  content: string
  media_url: string | null
  approval_status: SocialApprovalStatus
  scheduled_at: string | null
  published_at: string | null
  source_video_id: string | null
  rejection_notes: string | null
  platform_post_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
```

Replace with:
```ts
export interface SocialPost {
  id: string
  platform: SocialPlatform
  content: string
  media_url: string | null
  post_type: PostType
  approval_status: SocialApprovalStatus
  scheduled_at: string | null
  published_at: string | null
  source_video_id: string | null
  rejection_notes: string | null
  platform_post_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 3: Verify the project type-checks**

Run: `npx tsc --noEmit`
Expected: any fallout from `post_type` being newly required lands in files that construct `SocialPost` literals. The DAL's `createSocialPost` accepts `Omit<SocialPost, ...>` without `post_type` excluded, so existing call sites that didn't set `post_type` will now need it. The migration defaults it to `'video'` server-side, but TypeScript will require it in the Omit signature. Mark `post_type` optional in the DAL `Omit` in Task 5.

If `tsc` reports errors unrelated to `post_type` being required at call sites (i.e., in `lib/db/social-posts.ts` or its callers), note them for Task 5. Do not fix them here.

- [ ] **Step 4: Commit**

```bash
git add types/database.ts
git commit -m "feat(content-studio): add PostType, MediaAsset, SocialPostMediaRow types"
```

---

## Task 5: DAL — `lib/db/media-assets.ts`

**Files:**
- Create: `lib/db/media-assets.ts`
- Create: `__tests__/db/media-assets.test.ts`

- [ ] **Step 1: Write failing tests for create + get**

Create `__tests__/db/media-assets.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"
import {
  createMediaAsset,
  getMediaAssetById,
  listMediaAssets,
  updateMediaAssetAiMetadata,
  deleteMediaAsset,
} from "@/lib/db/media-assets"

describe("lib/db/media-assets", () => {
  const supabase = createServiceRoleClient()
  const createdIds: string[] = []

  afterEach(async () => {
    if (createdIds.length > 0) {
      await supabase.from("media_assets").delete().in("id", createdIds)
      createdIds.length = 0
    }
  })

  it("creates an image asset and returns the persisted row", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/dal-1.jpg",
      public_url: "https://example.invalid/dal-1.jpg",
      mime_type: "image/jpeg",
      bytes: 2048,
      width: 1080,
      height: 1080,
      duration_ms: null,
      derived_from_video_id: null,
      ai_alt_text: null,
      ai_analysis: null,
      created_by: null,
    })
    createdIds.push(asset.id)
    expect(asset.kind).toBe("image")
    expect(asset.public_url).toBe("https://example.invalid/dal-1.jpg")
  })

  it("reads an asset by id and returns null for unknown ids", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/dal-2.jpg",
      public_url: "https://example.invalid/dal-2.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null,
      height: null,
      duration_ms: null,
      derived_from_video_id: null,
      ai_alt_text: null,
      ai_analysis: null,
      created_by: null,
    })
    createdIds.push(asset.id)

    const found = await getMediaAssetById(asset.id)
    expect(found?.id).toBe(asset.id)

    const missing = await getMediaAssetById("00000000-0000-0000-0000-000000000000")
    expect(missing).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/db/media-assets.test.ts`
Expected: FAIL — `lib/db/media-assets` module not found.

- [ ] **Step 3: Implement create + get**

Create `lib/db/media-assets.ts`:

```ts
// lib/db/media-assets.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { MediaAsset } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export type CreateMediaAssetInput = Omit<MediaAsset, "id" | "created_at" | "updated_at">

export async function createMediaAsset(input: CreateMediaAssetInput): Promise<MediaAsset> {
  const supabase = getClient()
  const { data, error } = await supabase.from("media_assets").insert(input).select().single()
  if (error) throw error
  return data as MediaAsset
}

export async function getMediaAssetById(id: string): Promise<MediaAsset | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("media_assets")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as MediaAsset | null) ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/db/media-assets.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/media-assets.ts __tests__/db/media-assets.test.ts
git commit -m "feat(content-studio): DAL for media_assets (create + get)"
```

- [ ] **Step 6: Add failing tests for list + updateAiMetadata + delete**

Append inside the existing `describe(...)` block in `__tests__/db/media-assets.test.ts`:

```ts
  it("lists media assets filtered by kind and ordered by created_at desc", async () => {
    const image = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/list-img.jpg",
      public_url: "https://example.invalid/list-img.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(image.id)

    const video = await createMediaAsset({
      kind: "video",
      storage_path: "media-assets/list-vid.mp4",
      public_url: "https://example.invalid/list-vid.mp4",
      mime_type: "video/mp4",
      bytes: 1,
      width: null, height: null, duration_ms: 5000,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(video.id)

    const imagesOnly = await listMediaAssets({ kind: "image" })
    expect(imagesOnly.some((a) => a.id === image.id)).toBe(true)
    expect(imagesOnly.some((a) => a.id === video.id)).toBe(false)
  })

  it("updates ai_alt_text and ai_analysis via updateMediaAssetAiMetadata", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/ai.jpg",
      public_url: "https://example.invalid/ai.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(asset.id)

    await updateMediaAssetAiMetadata(asset.id, {
      ai_alt_text: "A squat demonstration with a barbell",
      ai_analysis: { scene: "gym", objects: ["barbell", "rack"] },
    })

    const fresh = await getMediaAssetById(asset.id)
    expect(fresh?.ai_alt_text).toBe("A squat demonstration with a barbell")
    expect(fresh?.ai_analysis).toEqual({ scene: "gym", objects: ["barbell", "rack"] })
  })

  it("deletes a media asset that is not referenced by any post", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/del.jpg",
      public_url: "https://example.invalid/del.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    // Don't push to createdIds — we're deleting explicitly.

    await deleteMediaAsset(asset.id)

    const fresh = await getMediaAssetById(asset.id)
    expect(fresh).toBeNull()
  })

  it("refuses to delete a media asset referenced by a social_post_media row", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/ref.jpg",
      public_url: "https://example.invalid/ref.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(asset.id)

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "ref", approval_status: "draft", post_type: "image" })
      .select()
      .single()
    await supabase.from("social_post_media").insert({
      social_post_id: post.data!.id,
      media_asset_id: asset.id,
      position: 0,
    })

    try {
      await expect(deleteMediaAsset(asset.id)).rejects.toBeDefined()
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
    }
  })
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/db/media-assets.test.ts`
Expected: 4 new tests FAIL — functions not yet implemented.

- [ ] **Step 8: Implement list + updateAiMetadata + delete**

Append to `lib/db/media-assets.ts`:

```ts
export interface ListMediaAssetsFilters {
  kind?: MediaAsset["kind"]
  derivedFromVideoId?: string
}

export async function listMediaAssets(filters: ListMediaAssetsFilters = {}): Promise<MediaAsset[]> {
  const supabase = getClient()
  let query = supabase.from("media_assets").select("*").order("created_at", { ascending: false })
  if (filters.kind) query = query.eq("kind", filters.kind)
  if (filters.derivedFromVideoId) query = query.eq("derived_from_video_id", filters.derivedFromVideoId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as MediaAsset[]
}

export interface MediaAssetAiMetadata {
  ai_alt_text: string | null
  ai_analysis: Record<string, unknown> | null
}

export async function updateMediaAssetAiMetadata(
  id: string,
  metadata: MediaAssetAiMetadata,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("media_assets").update(metadata).eq("id", id)
  if (error) throw error
}

export async function deleteMediaAsset(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("media_assets").delete().eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/db/media-assets.test.ts`
Expected: 6 PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/db/media-assets.ts __tests__/db/media-assets.test.ts
git commit -m "feat(content-studio): DAL for media_assets (list, updateAiMetadata, delete)"
```

---

## Task 6: DAL — `lib/db/social-post-media.ts`

**Files:**
- Create: `lib/db/social-post-media.ts`
- Create: `__tests__/db/social-post-media.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/db/social-post-media.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"
import { createMediaAsset, deleteMediaAsset } from "@/lib/db/media-assets"
import {
  attachMedia,
  listMediaForPost,
  reorderMedia,
  detachMedia,
} from "@/lib/db/social-post-media"

describe("lib/db/social-post-media", () => {
  const supabase = createServiceRoleClient()
  const postIds: string[] = []
  const assetIds: string[] = []

  afterEach(async () => {
    if (postIds.length > 0) {
      await supabase.from("social_posts").delete().in("id", postIds)
      postIds.length = 0
    }
    for (const id of assetIds) {
      try { await deleteMediaAsset(id) } catch { /* asset may still be referenced */ }
    }
    assetIds.length = 0
  })

  async function newPost(post_type: string = "image"): Promise<string> {
    const res = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "t", approval_status: "draft", post_type })
      .select()
      .single()
    postIds.push(res.data!.id)
    return res.data!.id
  }

  async function newAsset(label: string) {
    const a = await createMediaAsset({
      kind: "image",
      storage_path: `media-assets/${label}.jpg`,
      public_url: `https://example.invalid/${label}.jpg`,
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    assetIds.push(a.id)
    return a
  }

  it("attaches an asset at position 0 and mirrors media_url", async () => {
    const postId = await newPost("image")
    const a = await newAsset("attach-1")

    await attachMedia(postId, a.id, 0)

    const media = await listMediaForPost(postId)
    expect(media).toHaveLength(1)
    expect(media[0].media_asset_id).toBe(a.id)
    expect(media[0].position).toBe(0)
  })

  it("lists media ordered by position ascending", async () => {
    const postId = await newPost("carousel")
    const a = await newAsset("order-a")
    const b = await newAsset("order-b")
    const c = await newAsset("order-c")

    await attachMedia(postId, b.id, 1)
    await attachMedia(postId, c.id, 2)
    await attachMedia(postId, a.id, 0)

    const media = await listMediaForPost(postId)
    expect(media.map((m) => m.media_asset_id)).toEqual([a.id, b.id, c.id])
  })

  it("reorders attached media via reorderMedia", async () => {
    const postId = await newPost("carousel")
    const a = await newAsset("re-a")
    const b = await newAsset("re-b")

    await attachMedia(postId, a.id, 0)
    await attachMedia(postId, b.id, 1)

    await reorderMedia(postId, [
      { assetId: b.id, position: 0 },
      { assetId: a.id, position: 1 },
    ])

    const media = await listMediaForPost(postId)
    expect(media.map((m) => m.media_asset_id)).toEqual([b.id, a.id])
  })

  it("detaches an asset from a post", async () => {
    const postId = await newPost("image")
    const a = await newAsset("detach")
    await attachMedia(postId, a.id, 0)

    await detachMedia(postId, a.id)

    const media = await listMediaForPost(postId)
    expect(media).toHaveLength(0)
  })

  it("rejects attaching the same asset twice to one post", async () => {
    const postId = await newPost("carousel")
    const a = await newAsset("dup")

    await attachMedia(postId, a.id, 0)
    await expect(attachMedia(postId, a.id, 1)).rejects.toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/db/social-post-media.test.ts`
Expected: FAIL — `lib/db/social-post-media` module not found.

- [ ] **Step 3: Implement the DAL**

Create `lib/db/social-post-media.ts`:

```ts
// lib/db/social-post-media.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialPostMediaRow } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface AttachMediaOptions {
  overlayText?: string | null
  overlayMetadata?: Record<string, unknown> | null
}

export async function attachMedia(
  socialPostId: string,
  mediaAssetId: string,
  position: number,
  options: AttachMediaOptions = {},
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("social_post_media").insert({
    social_post_id: socialPostId,
    media_asset_id: mediaAssetId,
    position,
    overlay_text: options.overlayText ?? null,
    overlay_metadata: options.overlayMetadata ?? null,
  })
  if (error) throw error
}

export async function listMediaForPost(socialPostId: string): Promise<SocialPostMediaRow[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_post_media")
    .select("*")
    .eq("social_post_id", socialPostId)
    .order("position", { ascending: true })
  if (error) throw error
  return (data ?? []) as SocialPostMediaRow[]
}

export async function reorderMedia(
  socialPostId: string,
  positions: Array<{ assetId: string; position: number }>,
): Promise<void> {
  const supabase = getClient()
  // Two-phase update to avoid tripping the (social_post_id, position) PK on intermediate
  // states: first shift all rows to a negative-offset position, then write the targets.
  const current = await supabase
    .from("social_post_media")
    .select("media_asset_id")
    .eq("social_post_id", socialPostId)
  if (current.error) throw current.error

  const tempOffset = -1000
  for (let i = 0; i < (current.data ?? []).length; i += 1) {
    const row = current.data![i]
    const { error } = await supabase
      .from("social_post_media")
      .update({ position: tempOffset - i })
      .eq("social_post_id", socialPostId)
      .eq("media_asset_id", row.media_asset_id)
    if (error) throw error
  }

  for (const { assetId, position } of positions) {
    const { error } = await supabase
      .from("social_post_media")
      .update({ position })
      .eq("social_post_id", socialPostId)
      .eq("media_asset_id", assetId)
    if (error) throw error
  }
}

export async function detachMedia(socialPostId: string, mediaAssetId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("social_post_media")
    .delete()
    .eq("social_post_id", socialPostId)
    .eq("media_asset_id", mediaAssetId)
  if (error) throw error
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/db/social-post-media.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/social-post-media.ts __tests__/db/social-post-media.test.ts
git commit -m "feat(content-studio): DAL for social_post_media (attach, list, reorder, detach)"
```

---

## Task 7: Wire new modules into `lib/db/index.ts` and add `getSocialPostWithMedia`

**Files:**
- Modify: `lib/db/index.ts`
- Modify: `lib/db/social-posts.ts`
- Modify: `__tests__/db/social-posts.test.ts` (extend if exists; otherwise extend `__tests__/db/social-post-media.test.ts`)

- [ ] **Step 1: Re-export the new modules**

Open `lib/db/index.ts`. After the existing `export * from "./social-captions"` line, add:

```ts
export * from "./media-assets"
export * from "./social-post-media"
```

- [ ] **Step 2: Write a failing test for `getSocialPostWithMedia`**

Append inside the existing `describe(...)` block in `__tests__/db/social-post-media.test.ts`:

```ts
  it("getSocialPostWithMedia returns the post together with ordered media rows", async () => {
    const { getSocialPostWithMedia } = await import("@/lib/db/social-posts")

    const postId = await newPost("carousel")
    const a = await newAsset("with-a")
    const b = await newAsset("with-b")
    await attachMedia(postId, a.id, 0)
    await attachMedia(postId, b.id, 1)

    const result = await getSocialPostWithMedia(postId)
    expect(result?.id).toBe(postId)
    expect(result?.post_type).toBe("carousel")
    expect(result?.media.map((m) => m.media_asset_id)).toEqual([a.id, b.id])
    expect(result?.media[0].asset?.public_url).toBe("https://example.invalid/with-a.jpg")
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:run -- __tests__/db/social-post-media.test.ts`
Expected: FAIL — `getSocialPostWithMedia` does not exist.

- [ ] **Step 4: Update the DAL to support the `post_type` column and add the helper**

Open `lib/db/social-posts.ts`. Change the `createSocialPost` signature to make `post_type` optional (defaulted server-side). Find:

```ts
export async function createSocialPost(
  post: Omit<
    SocialPost,
    "id" | "created_at" | "updated_at" | "published_at" | "platform_post_id" | "rejection_notes"
  >,
): Promise<SocialPost> {
```

Replace with:

```ts
export async function createSocialPost(
  post: Omit<
    SocialPost,
    "id" | "created_at" | "updated_at" | "published_at" | "platform_post_id" | "rejection_notes" | "post_type"
  > & { post_type?: SocialPost["post_type"] },
): Promise<SocialPost> {
```

Then append to the bottom of `lib/db/social-posts.ts`:

```ts
export interface SocialPostMediaWithAsset {
  media_asset_id: string
  position: number
  overlay_text: string | null
  overlay_metadata: Record<string, unknown> | null
  asset: {
    id: string
    kind: "video" | "image"
    public_url: string
    storage_path: string
    mime_type: string
    width: number | null
    height: number | null
    duration_ms: number | null
  } | null
}

export interface SocialPostWithMedia extends SocialPost {
  media: SocialPostMediaWithAsset[]
}

export async function getSocialPostWithMedia(id: string): Promise<SocialPostWithMedia | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_posts")
    .select(
      "*, social_post_media(media_asset_id, position, overlay_text, overlay_metadata, media_assets(id, kind, public_url, storage_path, mime_type, width, height, duration_ms))",
    )
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const raw = data as SocialPost & {
    social_post_media?: Array<{
      media_asset_id: string
      position: number
      overlay_text: string | null
      overlay_metadata: Record<string, unknown> | null
      media_assets: SocialPostMediaWithAsset["asset"] | null
    }>
  }
  const media: SocialPostMediaWithAsset[] = (raw.social_post_media ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((m) => ({
      media_asset_id: m.media_asset_id,
      position: m.position,
      overlay_text: m.overlay_text,
      overlay_metadata: m.overlay_metadata,
      asset: m.media_assets,
    }))

  const { social_post_media: _drop, ...rest } = raw as SocialPost & {
    social_post_media?: unknown
  }
  return { ...(rest as SocialPost), media }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/db/social-post-media.test.ts __tests__/db/social-posts.test.ts __tests__/migrations/00093_media_assets.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Verify project type-checks**

Run: `npx tsc --noEmit`
Expected: no new TypeScript errors. (Existing call sites that construct `SocialPost` without `post_type` still type-check because the DAL signature makes it optional; reads will always include it because the DB column is NOT NULL.)

- [ ] **Step 7: Commit**

```bash
git add lib/db/index.ts lib/db/social-posts.ts __tests__/db/social-post-media.test.ts
git commit -m "feat(content-studio): getSocialPostWithMedia helper + DAL exports"
```

---

## Task 8: Regression sweep

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: no regressions. Pay attention to `__tests__/api/admin/social/*` and `__tests__/lib/social/*` — they read `media_url` and should be unaffected because the trigger keeps `media_url` in sync.

- [ ] **Step 2: If any pre-existing test now reads `post_type` but expects a specific value**

Patch it to expect `'video'` (the default) or `'text'` if the fixture creates a null-media post. Each patched test gets its own commit:

```bash
git add <file>
git commit -m "test: expect post_type on <name> fixture"
```

- [ ] **Step 3: Run lint and formatter**

Run: `npm run lint && npm run format`
Expected: clean.

- [ ] **Step 4: Final commit if formatter touched files**

```bash
git add -u
git commit -m "chore: apply prettier formatting"
```

---

## Self-review

**Spec coverage (against 2026-04-24-content-studio-multimedia-design.md):**

| Spec requirement | Covered by |
|---|---|
| `media_assets` table with `kind`, `derived_from_video_id`, `ai_alt_text`, `ai_analysis` | Task 1 |
| `social_post_media` join table with `position`, `overlay_text`, `overlay_metadata` | Task 1 |
| `post_type` enum on `social_posts` incl. `'text'` | Task 1 |
| `media_url` mirror trigger | Task 2 |
| Idempotent backfill covering video/image/text cases | Task 3 |
| RLS policies (admin-only) on new tables | Task 1 |
| `MediaAsset`, `SocialPostMediaRow`, `PostType` types | Task 4 |
| DAL for `media_assets` | Task 5 |
| DAL for `social_post_media` | Task 6 |
| `getSocialPostWithMedia` helper | Task 7 |
| Export new DAL modules | Task 7 |
| `media_url` stays writable, backfills pre-existing posts | Tasks 1-3 |

**Placeholder scan:** No "TBD" / "TODO" / "handle appropriate errors" — each step shows the full code or command.

**Type consistency:**
- `MediaAssetKind = "video" | "image"` used consistently in `MediaAsset.kind`, migration CHECK, and filters.
- `PostType` union matches the CHECK constraint (`video|image|carousel|story|text`).
- `SocialPostMediaRow` field names match the migration columns (`social_post_id`, `media_asset_id`, `position`, `overlay_text`, `overlay_metadata`).
- DAL function names used in tests match exports: `createMediaAsset`, `getMediaAssetById`, `listMediaAssets`, `updateMediaAssetAiMetadata`, `deleteMediaAsset`, `attachMedia`, `listMediaForPost`, `reorderMedia`, `detachMedia`, `getSocialPostWithMedia`.
- `CreateMediaAssetInput` is used identically in tests (Task 5) and implementation.
