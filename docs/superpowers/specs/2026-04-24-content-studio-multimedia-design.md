# Content Studio Multimedia — Umbrella Design

**Date:** 2026-04-24
**Status:** Approved for phased implementation
**Scope:** Add non-video content types (single images, carousels, stories) to the Content Studio
**Author:** Claude (via brainstorming) + Darren Paul

---

## 1. Problem

The Content Studio today is video-first end-to-end:

- `UploadModal` only handles video uploads (`VideoUploader`).
- `ManualPostDialog` takes caption + platform with no media picker.
- `SocialPost.media_url` is a **single** nullable string — no carousel or per-slide metadata.
- Platform plugins branch on image vs video by file extension but none implement carousels or Stories.
- The AI pipeline (transcribe → analyze → generate captions) only fires from videos.

Darren needs to post single photos, multi-image carousels, and Stories alongside video content. This design covers the full surface as one umbrella and phases implementation so each phase is independently mergeable.

## 2. Goals

- **First-class image assets** uploaded directly OR derived from videos.
- **Multi-slide posts** (carousels) with per-slide metadata.
- **Stories** as a lightweight post type with a compressed approval flow.
- **Full platform support** where the platform APIs allow it — IG, FB, TikTok, LinkedIn for images/carousels; IG + FB for Stories.
- **AI generation where it earns its keep** — vision-based alt-text and image captions; AI-generated carousels from video transcripts. Stories stay manual.
- **Schema stability** — decide the data model once, in Phase 0, so Phases 1–3 don't need to revisit it.

## 3. Non-goals

- YouTube Community Posts (not in the Content Posting API currently in use).
- TikTok Stories (doesn't exist as a platform concept).
- LinkedIn Stories (retired by LinkedIn in 2021).
- X/Twitter publishing (not currently a connected platform).
- AI-generated Stories (manual only; the format is too ephemeral to justify generation cost).
- Client-side image editing beyond text overlays (cropping, filters, stickers).

## 4. Phasing

| Phase | Ships | User-visible? |
|---|---|---|
| **0** | `media_assets` + `social_post_media` tables, `post_type` enum, `media_url` mirror trigger, backfill migration | No — schema only, hidden behind feature flag |
| **1** | Single-image posts (`post_type='image'`). Photo upload UI, vision alt-text, image publish paths for IG/FB/LinkedIn/TikTok | Yes |
| **2** | Carousels (`post_type='carousel'`). Carousel composer UI, "Extract still from video" action, AI quote-card carousel flow, multi-slide publish paths | Yes |
| **3** | Stories (`post_type='story'`). Lightweight pipeline (no edit/approve gate), text overlay composer, IG + FB Stories endpoints | Yes |

Phase 0 ships direct to `main` (solo developer). Each later phase may still ship as an atomic commit but is feature-flagged until QA passes.

## 5. Architecture

### 5.1 Data model

**New enum type `post_type_enum`** (Postgres enum):
```
'video' | 'image' | 'carousel' | 'story' | 'text'
```
`'text'` covers text-only posts (LinkedIn and Facebook allow them; Instagram and TikTok don't). Not introduced as a new UX affordance in any phase — it's here so the backfill can classify existing text-only posts accurately and so the fanout planner can reject text-only posts on platforms that don't support them.

**New table `media_assets`:**
```sql
create table media_assets (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null check (kind in ('video','image')),
  storage_path           text not null,                -- Supabase Storage key
  public_url             text not null,
  mime_type              text not null,
  width                  int,
  height                 int,
  duration_ms            int,                          -- null for images
  bytes                  bigint not null,
  derived_from_video_id  uuid references videos(id) on delete set null,
  ai_alt_text            text,
  ai_analysis            jsonb,
  created_by             uuid references users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index media_assets_kind_idx on media_assets (kind);
create index media_assets_derived_from_idx on media_assets (derived_from_video_id)
  where derived_from_video_id is not null;
```

**New table `social_post_media`:**
```sql
create table social_post_media (
  social_post_id    uuid not null references social_posts(id) on delete cascade,
  media_asset_id    uuid not null references media_assets(id) on delete restrict,
  position          int  not null check (position >= 0),
  overlay_text      text,
  overlay_metadata  jsonb,
  primary key (social_post_id, position),
  unique (social_post_id, media_asset_id)
);

create index social_post_media_asset_idx on social_post_media (media_asset_id);
```

`on delete restrict` on the asset FK: we don't want a post losing a slide silently when an asset is deleted. Asset deletion must first detach or cascade from the app layer.

**Changes to `social_posts`:**
```sql
alter table social_posts
  add column post_type post_type_enum not null default 'video';

-- media_url becomes a denormalized mirror of social_post_media at position 0.
-- A trigger keeps it in sync so existing plugins and UI continue to work.
create function sync_social_post_media_url() returns trigger as $$
begin
  update social_posts sp
     set media_url = (
       select ma.public_url
         from social_post_media spm
         join media_assets ma on ma.id = spm.media_asset_id
        where spm.social_post_id = coalesce(NEW.social_post_id, OLD.social_post_id)
          and spm.position = 0
     ),
     updated_at = now()
   where sp.id = coalesce(NEW.social_post_id, OLD.social_post_id);
  return null;
end;
$$ language plpgsql;

create trigger social_post_media_mirror
  after insert or update or delete on social_post_media
  for each row execute function sync_social_post_media_url();
```

### 5.2 Backfill migration

For every existing `social_posts` row:

1. If `source_video_id is not null`: find or create a `media_assets` row with `kind='video'`, `derived_from_video_id = source_video_id`, `public_url = media_url`, storage path looked up from the `videos` row.
2. Else if `media_url is not null`: create a `media_assets` row with `kind` inferred from the URL extension (mp4/mov/webm/mkv → video; jpg/jpeg/png/webp/gif → image).
3. Else: no media row (text-only post — LinkedIn/FB allow this).
4. Insert `social_post_media (post, asset, position=0)`.
5. Set `post_type`:
   - `media_url` ends in video extension → `'video'`
   - `media_url` ends in image extension → `'image'`
   - `media_url` is null → `'text'`

The migration is idempotent — safe to re-run if interrupted. A companion verification query ensures `count(social_posts) == count(distinct social_post_id from social_post_media) + count(text-only posts)`.

### 5.3 Asset lifecycle

Three entry paths into `media_assets`:

1. **Direct upload** (Phase 1+) — new `ImageUploader` component: drag/drop, client-side validation (≤ 8MB, JPEG/PNG/WebP), multipart upload to Supabase Storage bucket `media-assets/`, DAL insert.
2. **Video-derived** (Phase 2) — "Extract still at timestamp" action in the video drawer → server endpoint runs ffmpeg, uploads frame to Supabase, inserts asset with `derived_from_video_id` set.
3. **AI-generated quote cards** (Phase 2) — transcript analyzer produces N snippets → server-side `@vercel/og` renderer composes branded cards → inserts each as an asset with `ai_analysis.origin = 'quote_card'` and `derived_from_video_id` set.

**Vision alt-text (Phase 1):** on image asset insert, a background job calls Claude Sonnet 4.6 with vision enabled. The result populates `ai_alt_text` and `ai_analysis` (scene, objects, suggested hashtags). Non-blocking — posts can publish immediately without waiting for the job.

**Unified upload modal:** the existing `UploadModal` gains a type picker at the top (Video | Photo | Carousel | Story) routing to the appropriate uploader. "Story" picks from existing assets rather than uploading new.

### 5.4 Publishing plugins

`PublishInput` is extended:
```ts
export interface PublishInput {
  content: string
  mediaUrl: string | null             // backwards-compat, equal to media[0]?.url
  media: Array<{
    url: string
    kind: "image" | "video"
    overlayText?: string              // for Stories
    overlayMetadata?: Record<string, unknown>
  }>
  postType: "video" | "image" | "carousel" | "story" | "text"
  scheduledAt: string | null
  metadata?: Record<string, unknown>
}
```

Each plugin dispatches internally on `postType`. Existing video paths are unchanged.

**Support matrix (full design, phased rollout):**

| Plugin | Image | Carousel | Story |
|---|---|---|---|
| `instagram` | Phase 1 — existing image branch in `publish()` formalized | Phase 2 — 3-step container chain (`CAROUSEL` + `IMAGE` children) | Phase 3 — `media_type=STORIES` endpoint |
| `facebook` | Phase 1 — `/photos` endpoint | Phase 2 — `/feed` with `attached_media[]` | Phase 3 — `/me/photo_stories` endpoint |
| `linkedin` | Phase 1 — UGC post with `IMAGE` media type | Phase 2 — `/documents` endpoint (wraps multi-image as a doc) | — |
| `tiktok` | Phase 1 — Photo Mode endpoint (`/v2/post/publish/content/init/`) | Phase 2 — Photo Mode multi-image | — |
| `youtube` | — (video-only; plugin raises a validation error if `postType != 'video'`) | — | — |
| `youtube_shorts` | — | — | — |

**Validation:** the fanout planner (`lib/social/publish-runner.ts`) rejects unsupported `(platform, postType)` combinations at approval time, not publish time, so the error surfaces in the studio UI while the admin can still fix it.

### 5.5 Studio UX

- **`ManualPostDialog`** gains a content-type picker at the top (Video | Photo | Carousel | Story) and a media picker (`MediaAssetPicker`) that lists assets from `media_assets` with filter + inline "Upload new".
- **`PostCard` / `VideoCard`** in the pipeline board get a small content-type badge (video / photo / carousel / story) using the existing accent color system.
- **`PostChip`** in the calendar gets the same badge.
- **`DetailDrawer`** grows a **Media tab** showing all assets attached to a post with drag-reorder (for carousels) and per-slide overlay editor (for stories).
- **New tab in the studio shell: `/admin/content/assets`** — asset library listing all `media_assets` with filters (kind, origin, "used in N posts" count). Reuses the existing list/grid pattern from the videos tab. **Lands in Phase 2** (when carousels introduce the need for cross-slide asset reuse); not required in Phase 1 where each image post owns a single asset.

### 5.6 Approval pipeline — Stories variant

`SocialApprovalStatus` enum is unchanged. For `post_type='story'` the UI:

- Hides "Edit" and "Approve" actions.
- Shows "Publish now" and "Schedule" directly from `draft`.
- Allowed state transitions: `draft → scheduled`, `draft → published` (skipping `edited` and `approved`).

The existing `publish-runner` and `fanout` routes allow `draft → published` only when status is `approved`. For Stories we add a single bypass:
```ts
if (post.post_type === 'story') {
  // skip approval gate; Stories are lightweight
} else if (post.approval_status !== 'approved') {
  return error(...)
}
```

## 6. Interfaces (new / changed DAL functions)

```
lib/db/media-assets.ts   (new)
  createMediaAsset(input: CreateMediaAssetInput): Promise<MediaAsset>
  getMediaAssetById(id: string): Promise<MediaAsset | null>
  listMediaAssets(filters: MediaAssetFilters): Promise<MediaAsset[]>
  updateMediaAssetAiMetadata(id: string, analysis: MediaAssetAiAnalysis): Promise<void>
  deleteMediaAsset(id: string): Promise<void>        // refuses if referenced by any post

lib/db/social-post-media.ts   (new)
  attachMedia(socialPostId: string, mediaAssetId: string, position: number, overlay?): Promise<void>
  reorderMedia(socialPostId: string, positions: Array<{ assetId: string; position: number }>): Promise<void>
  detachMedia(socialPostId: string, mediaAssetId: string): Promise<void>
  listMediaForPost(socialPostId: string): Promise<SocialPostMediaRow[]>

lib/db/social-posts.ts   (modified)
  createSocialPost gains optional postType; defaults to 'video'
  getSocialPostById returns media[] alongside the existing fields
```

## 7. Testing strategy

- **Unit (Vitest):**
  - DAL functions for `media_assets`, `social_post_media` (inserts, reorder, FK integrity).
  - `media_url` mirror trigger — insert, update, delete of `social_post_media` rows correctly reflect on `social_posts.media_url`.
  - Backfill migration — seeded fixture with video posts, image posts, text-only posts, null posts; assert post-migration state matches expected.
  - Each plugin's new publish path (mocked HTTP with `fetchJson` stub) per Phase.
- **Component (Vitest + Testing Library):**
  - Upload type picker, `ImageUploader`, `MediaAssetPicker`, `Media` tab, content-type badges.
- **E2E (Playwright, Phase 1 only):**
  - Upload a photo → attach to new post → publish to IG (stubbed) → verify asset row and post row.
- **Feature flag:** reuse `lib/content-studio/feature-flag.ts` pattern. New flag env `NEXT_PUBLIC_CS_MULTIMEDIA` gates the new UI while Phase 0 schema can ship decoupled.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Backfill migration silently mis-classifies posts | Include a verification query + dry-run mode that prints the classification before running in prod |
| `media_url` mirror trigger causes race conditions under concurrent writes | Trigger is `AFTER` (post-commit on row); FK constraints serialize per post. Covered by a concurrency test |
| Plugin endpoints for carousels/stories have undocumented quotas | Wrap each new publish path with explicit error mapping; fail loudly rather than silently retrying |
| AI vision captioning blows out the Anthropic budget | Background job is rate-limited + skipped if `ai_alt_text is not null`; toggleable via env flag |
| TikTok Photo Mode requires a separate app review gate that we don't have yet | Phase 1 ships the plugin code but gates it behind `TIKTOK_PHOTO_MODE_ENABLED` until TikTok approves the app |

## 9. Open questions (deferred)

- Should Stories auto-expire on our side after 24h (hide from the calendar retroactively)? Deferred to Phase 3 design review.
- Do we want a "repost this asset on another platform" shortcut that reuses a `media_asset` across posts? Schema supports it; UX deferred until asset library lands in Phase 2.

## 10. Rollout

1. Phase 0 — ship schema migration + backfill to `main`. Verify prod data integrity.
2. Phase 1 — enable `NEXT_PUBLIC_CS_MULTIMEDIA=true` in preview, dogfood single-image flow, then flip prod.
3. Phase 2 — carousel composer + AI quote-card flow; keep Phase 1 flag.
4. Phase 3 — Stories UI + IG/FB Stories plugin paths.

Each phase produces its own implementation plan following this spec.
