# Content Studio Multimedia — Phase 1 Sub-spec (Single-Image Posts)

**Date:** 2026-04-24
**Status:** Approved for implementation (auto mode)
**Scope:** Ship single-image post creation + publishing through the existing content-studio pipeline. User-visible.
**Parent:** [2026-04-24-content-studio-multimedia-design.md](./2026-04-24-content-studio-multimedia-design.md) — Phase 1
**Phase 0 predecessor:** [2026-04-24-content-studio-multimedia-phase0.md](../plans/2026-04-24-content-studio-multimedia-phase0.md)

---

## 1. Scope & sub-phasing

Phase 1 in the umbrella spec bundles five things: image upload, image UI flow, vision AI alt-text, and image publishing on IG + FB + LinkedIn + TikTok. Existing-code research reveals the scope is uneven — IG's image path is already there, TikTok's Photo Mode is an entirely separate API family, and vision AI is a Firebase Functions workstream separate from the Next.js app.

Split into three deliverables for clean shipping:

| Sub-phase | Ships | Notes |
|---|---|---|
| **1a — Core image flow + IG/FB publishing** | Image uploader UI + asset DAL wiring + ManualPostDialog type picker + API route updates. Verified IG image publish (already branches on extension) and FB image publish (already has `/photos` endpoint branch). Feature-flagged. | This spec. |
| **1b — Vision AI alt-text** | Firebase Function that runs Claude Sonnet 4.6 vision on new image assets; stores `ai_alt_text` + `ai_analysis`. Background, non-blocking. | Separate sub-spec. |
| **1c — LinkedIn image publish** | LinkedIn UGC requires a 3-step asset-registration flow (registerUpload → PUT bytes → ugcPost with `IMAGE` category). Current plugin treats media URLs as ARTICLE/link-preview only. | Separate sub-spec because it's a meaningful plugin rewrite, not a small branch. |
| **1d — TikTok Photo Mode** | TikTok plugin gets a separate code path calling the Content Posting API's `content/init` with `post_mode=DIRECT_POST` + `media_type=PHOTO`. | Separate sub-spec because TikTok Photo requires distinct app-review gating. |

This document covers **Phase 1a only.** The other three land after Phase 1a is in prod and dogfooded.

**Pre-flight plugin audit (performed during spec drafting):**
- `lib/social/plugins/instagram.ts` lines 54-59: already branches on video vs image extension; images post to `/media` with `image_url`.
- `lib/social/plugins/facebook.ts` lines 51-59: already branches on image vs video; images post to `/{page_id}/photos`.
- `lib/social/plugins/linkedin.ts` lines 37-50: does NOT support image uploads. Uses `shareMediaCategory: "ARTICLE"` with `originalUrl`, which is LinkedIn's link-preview pattern, not image upload. Implementing real image publish is Phase 1c.
- `lib/social/plugins/tiktok.ts`: video-only via existing Content Posting API; Photo Mode requires a different init call — Phase 1d.

## 2. Deviations from the umbrella spec

- **Storage:** umbrella said Supabase Storage bucket `media-assets/`. Research shows existing code uses **Firebase Storage** (videos at `videos/{userId}/{ts}-{name}`). To keep one storage system, images use **Firebase Storage at `images/{userId}/{ts}-{name}`**. Update to `media_assets.public_url`: stores the Firebase `storage_path`; `resolve-media-url.ts` handles signed-URL resolution at publish time (same flow as videos).
- **Feature flag:** umbrella called for `NEXT_PUBLIC_CS_MULTIMEDIA`. Research shows the existing pattern is server-only `CONTENT_STUDIO_ENABLED`. Use server-only `CS_MULTIMEDIA_ENABLED` for consistency. Gated at the UI shell (hides new controls) and at the create-post route (rejects `post_type=image` payloads). No client-side split.

## 3. Goals

- An admin can upload a photo in the studio, attach a caption, and publish to Instagram or Facebook on demand or via scheduled publishing.
- The new flow reuses the existing pipeline (draft/edited/approved/scheduled/published) unchanged — image posts aren't a separate lifecycle.
- Existing video post flow is untouched.
- The API route rejects `postType=image` for LinkedIn and TikTok platforms with a clear error, so admins aren't silently blocked mid-publish.

## 4. Non-goals

- TikTok Photo Mode (Phase 1c).
- Vision AI alt-text on asset upload (Phase 1b).
- Carousels or Stories (Phase 2/3).
- Client-side image editing (cropping, filters).
- Auto-derivation of images from videos (Phase 2).

## 5. Architecture

### 5.1 Upload path

Mirrors the video upload flow end-to-end, swapping video-specific pieces for image-specific ones:

1. **`<ImageUploader />`** client component — file input restricted to `image/*`, client-side validation: MIME starts with `image/`, max 8 MB. Calls the existing upload-URL API.
2. **`POST /api/admin/media-assets/upload-url`** — new server route: auths admin, generates a Firebase signed PUT URL (15-min TTL) at `images/{userId}/{timestamp}-{sanitized_filename}`, inserts a `media_assets` row (kind=image, storage_path, public_url=`firebase://<path>` placeholder), returns `{mediaAssetId, uploadUrl, storagePath}`.
3. **Direct PUT** from client to signed URL.
4. **`PATCH /api/admin/media-assets/:id`** — client calls with `{width, height, bytes, mime_type}` after successful upload to populate asset dimensions. (Optional in Phase 1a — if it slips, dimensions stay null until vision AI lands.)

**Not done in Phase 1a:** the `media_assets.public_url` column stores the `storage_path` as a placeholder string, not a real URL. `resolve-media-url.ts` is extended to detect image assets and generate signed URLs the same way it does for videos. This matches the existing `source_video_id → storage_path → signed URL` pattern.

### 5.2 Manual post creation flow

`ManualPostDialog` grows a "content type" row above the platform picker:

```
┌ Video — upload new video ──── Photo — upload or pick image ┐
```

When **Photo** is selected:
- The dialog embeds `<ImageUploader />` with an "Or pick existing image" button (Phase 1a: uploader only; "pick existing" stubbed to a simple `<select>` listing the admin's recent image assets).
- After upload completes, the returned `mediaAssetId` is held in dialog state.
- On submit, `POST /api/admin/content-studio/posts` payload gains `mediaAssetId` and `postType: "image"`.

When **Video** is selected: unchanged flow.

### 5.3 Create-post API route

`POST /api/admin/content-studio/posts` (existing) extends its validator:

- New payload fields: `postType: "video" | "image" | "text"` (default `"video"` for backcompat), `mediaAssetId?: string`.
- Validation: if `postType === "image"`, `mediaAssetId` is required; if `postType === "video"`, `source_video_id` is required; `"text"` requires neither.
- Server flow:
  1. Create the `social_posts` row with `post_type` set (via `createSocialPost({ post_type, source_video_id, media_url: null, ... })`).
  2. If `mediaAssetId` is set, call `attachMedia(newPostId, mediaAssetId, 0)`. The mirror trigger sets `social_posts.media_url`.
  3. Return the existing `{id, approval_status}` response shape.

Gate with `CS_MULTIMEDIA_ENABLED` — when flag is off, reject `postType` other than `"video"` with 400.

### 5.4 Publish path

**No plugin code changes required for Phase 1a.** The pre-flight audit confirmed:

- `instagram.ts:54-59` — already branches on video vs image extension; image URLs publish to `/media` with `image_url`.
- `facebook.ts:51-59` — already branches on image vs video vs text; image URLs publish to `/{page_id}/photos`.

Phase 1a relies on both branches already being exercised by the existing code. The task list includes smoke tests to confirm end-to-end.

**Platform-level rejection for unsupported combinations:** the create-post API route validates `(platform, postType)` pairs. For Phase 1a:

| Platform | image | video | text |
|---|---|---|---|
| instagram | ✓ | ✓ | ✗ (IG rejects text-only) |
| facebook | ✓ | ✓ | ✓ |
| linkedin | ✗ 400 — defer to Phase 1c | ✓ | ✓ |
| tiktok | ✗ 400 — defer to Phase 1d | ✓ | ✗ |
| youtube / youtube_shorts | ✗ 400 | ✓ | ✗ |

Rejecting at the API layer keeps admins from creating posts that will silently fail at publish time. When later sub-phases land, they update this validation table accordingly.

**PublishInput shape change is deferred.** The umbrella spec calls for extending `PublishInput` with `media[]` + `postType`. Phase 1a ships single-image posts through the existing `mediaUrl` field (carousel-ready structural changes move to Phase 2 where multi-media actually matters). This keeps the Phase 1a blast radius small.

### 5.5 `resolve-media-url.ts` extension

Current shape: `{source_video_id, media_url} → signed URL | null`.
Extended: `{source_video_id, media_url, media_asset_id?} → signed URL | null`. When `media_asset_id` is present and points to an image asset, resolve its Firebase `storage_path` the same way videos are resolved.

In Phase 1a this mostly manifests through the mirror trigger — `media_url` on the post row already holds the `storage_path` placeholder set by the mirror. The resolver detects `firebase://` prefixes (or absence of `http`) and signs accordingly.

**Implementation note:** to keep this simple, the upload route stores the Firebase storage *path* (not a `firebase://` URL) into `public_url`. The resolver checks for "does not start with http" and treats it as a Firebase path. This matches how existing video posts work today (where `media_url` is null and `source_video_id` drives resolution) — for image posts, `media_url` is the Firebase path.

### 5.6 Feature flag

New server-only flag `CS_MULTIMEDIA_ENABLED`:
```ts
// lib/content-studio/feature-flag.ts
export function isContentStudioMultimediaEnabled(): boolean {
  return process.env.CS_MULTIMEDIA_ENABLED === "true"
}
```

Gates:
- `ManualPostDialog` hides the content-type picker when flag is off (falls back to current video-only UX).
- `POST /api/admin/content-studio/posts` rejects `postType === "image"` with 400 when flag is off.

Prod rollout: flag starts `false`; enable after smoke test on staging.

### 5.7 Studio UX (small touches)

- `PostCard` (pipeline) + `PostChip` (calendar) gain a content-type badge (photo / video). Reuse existing accent color system. Tiny — just an icon + one-line type.
- `DetailDrawer`'s existing tabs stay unchanged for Phase 1a. (A dedicated Media tab lands in Phase 2 with carousels.)

## 6. New files

- `components/admin/content-studio/upload/ImageUploader.tsx` — client component, parallel to `VideoUploader.tsx`.
- `lib/firebase-client-upload.ts` gets a new export `uploadImageFile(file, {onProgress})` mirroring `uploadVideoFile`.
- `app/api/admin/media-assets/upload-url/route.ts` — server route to issue the signed PUT URL + create the asset row.
- `app/api/admin/media-assets/[id]/route.ts` — PATCH route for dimension backfill.
- `lib/validators/media-asset.ts` — Zod schemas for upload-url payload + patch payload.

## 7. Changed files

- `components/admin/content-studio/upload/UploadModal.tsx` — adds content-type picker (Video | Photo); routes to the appropriate uploader.
- `components/admin/content-studio/calendar/ManualPostDialog.tsx` — adds content-type picker + media picker for image type.
- `app/api/admin/content-studio/posts/route.ts` — accepts `postType`, `mediaAssetId`; validates by type; feature-flag gate.
- `lib/content-studio/feature-flag.ts` — adds `isContentStudioMultimediaEnabled`.
- `lib/social/resolve-media-url.ts` — handles Firebase-path values in `media_url`.
- `components/admin/content-studio/pipeline/PostCard.tsx` / `VideoCard.tsx` / `calendar/PostChip.tsx` — small content-type badge.

## 8. Testing strategy

- **Unit** (Vitest):
  - `lib/validators/media-asset.ts` schemas
  - `lib/content-studio/feature-flag.ts` new function
  - `lib/social/resolve-media-url.ts` Firebase-path branch
  - Platform-type validator for the create-post route (rejects unsupported combinations)
- **Integration** (against remote Supabase, existing pattern):
  - `POST /api/admin/content-studio/posts` with `postType=image` — creates post + `social_post_media` row + mirror fires
  - `POST /api/admin/media-assets/upload-url` — issues signed URL, inserts asset row
- **Component** (Vitest + Testing Library):
  - `ImageUploader` renders, validates MIME, calls upload helper
  - `UploadModal` type-picker routes correctly
  - `ManualPostDialog` with type=image renders the image picker
- **Smoke** (manual): upload a photo, create a post, publish to Instagram sandbox or real dev account.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Image asset inserted but PUT to Firebase fails — leaves an "empty" asset row | Upload-url route inserts the asset row; if the client's PUT fails, the asset is orphaned. Acceptable in Phase 1a (admin-only; next upload just creates a new row). A janitor for orphan assets lands later if it becomes a hygiene issue. |
| Admin creates LinkedIn or TikTok image post and is surprised by a publish-time error | API route rejects unsupported `(platform, postType)` pairs with a 400 + clear message at create time, not publish time. |
| Feature flag off in prod, admin UI exposes new control | Flag gates are at UI + server-route level; both must be on to take effect |
| Existing video publish tests break if PublishInput shape accidentally changes | Phase 1a explicitly does NOT change PublishInput signature; the plugin code is untouched entirely. |

## 10. Open questions (deferred to Phase 1b/1c or cleanup)

- Should `media_assets.public_url` eventually be reworked into a separate `resolvable_via` enum or kept as "string that resolve-media-url.ts interprets"? Defer.
- Vision AI's Firebase Function cold-start cost when the upload-url route pushes a new job — measure in Phase 1b.
- Image asset sharing across multiple posts (intentional per schema) — UX surface lands in Phase 2 with the asset library.

## 11. Rollout

1. Build Phase 1a tasks against a feature branch or directly on `main` behind `CS_MULTIMEDIA_ENABLED=false`.
2. Enable the flag in a local/staging env; manually upload + publish an image to an IG sandbox.
3. Enable the flag in prod; dogfood one real image post to IG.
4. Once confirmed working end-to-end, Phase 1b (vision AI) and Phase 1c (TikTok Photo Mode) enter planning.

---

**Self-review pass:**
- No "TBD"/"TODO" placeholders.
- Open questions listed explicitly, not hidden in body.
- Scope is narrower than the umbrella Phase 1; this is called out in Section 1.
- Storage deviation from umbrella (Supabase → Firebase) flagged in Section 2 with justification.
- PublishInput shape change deferral flagged in Section 5.4 with Phase 2 pointer.
