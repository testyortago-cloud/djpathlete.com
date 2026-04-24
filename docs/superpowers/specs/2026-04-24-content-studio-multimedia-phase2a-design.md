# Content Studio Multimedia — Phase 2a Sub-spec (Instagram Carousel)

**Date:** 2026-04-24
**Status:** Approved for implementation (auto mode)
**Scope:** Ship multi-image carousel posting to Instagram via the existing content-studio pipeline.
**Parent:** [2026-04-24-content-studio-multimedia-design.md](./2026-04-24-content-studio-multimedia-design.md) — Phase 2

---

## 1. What this ships

- Instagram image carousels (2–10 slides) end-to-end: admin picks "Carousel" in the manual-post dialog, uploads 2–10 images, adds a caption, submits. Post goes through the normal approval/scheduling pipeline. Publish-time, the plugin runs IG's 3-step carousel chain.
- Support matrix flips `instagram.carousel = true`.
- Create-post API gains a `postType: "carousel"` branch that accepts `mediaAssetIds: string[]` (2–10 entries) and attaches each asset at its array index via `attachMedia`.
- Data model: reuses Phase 0 as-is. No migrations.
- Feature flag: reuses existing `CS_MULTIMEDIA_ENABLED` — no new flag.

## 2. What this DOES NOT ship

| | Reason | Future phase |
|---|---|---|
| Facebook carousel | Separate plugin code path | Phase 2b |
| LinkedIn multi-image | LinkedIn treats this as a "document" attachment — different API surface | Phase 2c |
| TikTok Photo Mode multi-image | Separate Content Posting API family, still app-review gated | Phase 2d |
| Mixed image+video carousels | IG supports it; deferred to isolate failure modes | Phase 2e+ |
| AI "turn this video into a quote-card carousel" | Depends on server-side image rendering (e.g. @vercel/og) | Phase 2f |
| Drag-to-reorder in composer | Position up/down buttons are sufficient for MVP | Phase 2 polish |
| Per-slide overlay text or caption | Carousel slides on IG don't support per-slide captions anyway | Out of scope |

## 3. Goals

- Admin can build and publish a 2-10 image carousel to Instagram, matching the single-image UX for feel.
- Failures surface early: picking <2 or >10 slides, or a non-JPEG image, gets a clear 400 at create time — not a mysterious Meta error at publish time.
- Existing single-image and video IG flows are untouched.

## 4. Non-goals

- Video slides (out of scope — reduces IG plugin complexity; carousel MVP is image-only).
- Polling beyond ~10 seconds (image containers almost always report `FINISHED` within 1–3 polls; longer poll budgets become relevant with video, which is deferred).
- Asset library "pick existing image" for carousel slides — Phase 2a uses fresh uploads only. The asset library lands later.

## 5. Architecture

### 5.1 Create-post API route

`POST /api/admin/content-studio/posts` grows `postType: "carousel"` + `mediaAssetIds: string[]` handling:

- Validation:
  - `platform` must support `carousel` (matrix: only `instagram` in Phase 2a)
  - `mediaAssetIds` required, length 2–10
  - Each asset must exist (`getMediaAssetById` non-null), kind `image`
  - For IG platform: each asset's `mime_type` must be `image/jpeg` (IG rejects PNG/WebP in carousels). Clear error message on the first non-JPEG asset.
- Server flow:
  1. `createSocialPost({ post_type: "carousel", media_url: null, ... })`
  2. For each `mediaAssetId` at index `i`, `attachMedia(post.id, mediaAssetId, i)` — the Phase 0 mirror trigger copies slide 0's `public_url` into `social_posts.media_url`
  3. On any attachMedia failure, roll back the post (same pattern as Phase 1a image path)

### 5.2 Support matrix update

`lib/content-studio/post-type-support.ts`:
```ts
instagram: { video: true, image: true, carousel: true },  // added: carousel
// others unchanged — FB/LI/TT carousel false until 2b/2c/2d
```

### 5.3 Instagram plugin — carousel path

`lib/social/plugins/instagram.ts` gains a new internal helper `publishCarouselPost({ content, mediaUrls })` where `mediaUrls` is the ordered array of signed image URLs. Branch logic in the existing `publish()`:

- If `mediaUrl` is set and `input.metadata?.mediaUrls` is a non-empty array: carousel path (each URL in the array is a slide)
- Else: current single-image/video path (unchanged)

This requires extending the `PublishInput` shape in `lib/social/plugins/types.ts`:

```ts
export interface PublishInput {
  content: string
  mediaUrl: string | null
  scheduledAt: string | null
  metadata?: Record<string, unknown>
  mediaUrls?: string[]  // new: ordered signed URLs for carousel slides
}
```

Backcompat: `mediaUrls` is optional. Existing single-image/video code paths ignore it.

Carousel helper flow:
```
1. For each url in mediaUrls:
     POST {ig_user_id}/media with image_url=url, is_carousel_item=true
     → collect child_container_id
2. Poll each child: GET {child_id}?fields=status_code until FINISHED or timeout (10s, 500ms→2s backoff × 5)
3. POST {ig_user_id}/media with media_type=CAROUSEL, children=<comma-joined ids>, caption=content
   → parent_container_id
4. POST {ig_user_id}/media_publish with creation_id=parent_container_id
   → final IG media id
```

Error handling: each step surfaces the Meta error message. If any child poll fails with ERROR/EXPIRED, return a clear error without proceeding.

### 5.4 Publish runner — resolve carousel slide URLs

`lib/social/publish-runner.ts` currently calls `resolveMediaUrl({ source_video_id, media_url })` for a single URL. For carousel posts it needs to resolve ALL slides' URLs and pass them to the plugin.

Approach:
1. When `post.post_type === "carousel"`, call `getSocialPostWithMedia(post.id)` (Phase 0 helper) to get the ordered media array
2. For each slide, resolve its URL via `resolveMediaUrl({ source_video_id: null, media_url: slide.asset.public_url })`
3. Pass the full ordered array as `mediaUrls` in the `PublishInput`
4. For non-carousel posts (video, image, text), behavior unchanged

### 5.5 Carousel composer UI in ManualPostDialog

Small additions — the existing "Post type" picker in `ManualPostDialog` gets a third option "Carousel". When selected:

- A list of slide slots renders. Start with 1 slot; an "Add slide" button appends another.
- Each slot is an `ImageUploader` (reused from Phase 1a) — when upload completes, the slot shows a thumbnail + remove button.
- Position up/down buttons on each non-extreme slot (↑ not on slot 0, ↓ not on last slot).
- Submit is disabled until 2+ slots have uploaded images.
- On submit, send `postType: "carousel"`, `mediaAssetIds: [assetId0, assetId1, ...]` in order.

Validation messages:
- "Carousels need at least 2 images"
- "Carousels support up to 10 images"
- "Instagram requires JPEG images for carousels" (when user uploads PNG/WebP — shown inline on that specific slot)

To keep scope tight: **no drag-reorder in Phase 2a**. Position up/down buttons ship.

### 5.6 UI badges

`PostTypeBadge` already renders nothing for `"carousel"`. Extend it to render "Carousel" with a `Images` (plural) icon.

## 6. Files

**Changed:**
- `lib/content-studio/post-type-support.ts` — `instagram.carousel = true`
- `app/api/admin/content-studio/posts/route.ts` — carousel branch + JPEG check
- `lib/social/plugins/types.ts` — add `mediaUrls?: string[]` to `PublishInput`
- `lib/social/plugins/instagram.ts` — carousel helper + branch in `publish()`
- `lib/social/publish-runner.ts` — resolve all slide URLs for carousel posts
- `components/admin/content-studio/calendar/ManualPostDialog.tsx` — carousel composer
- `components/admin/content-studio/shared/PostTypeBadge.tsx` — carousel variant

**Created:**
- `components/admin/content-studio/upload/CarouselComposer.tsx` — new client component (reused inside ManualPostDialog; keeps dialog code readable)
- `__tests__/lib/social/instagram-carousel.test.ts` — dedicated test file for the new plugin path
- `__tests__/api/admin/content-studio/posts-carousel.test.ts`
- `__tests__/components/admin/content-studio/upload/CarouselComposer.test.tsx`

## 7. Testing strategy

- **Plugin unit** — mocked `fetch`: child creation (3 slides), child polling (all FINISHED), parent creation (comma-joined children body), publish. Error cases: child creation fails, poll times out, parent creation fails with invalid-children error.
- **API route unit** — accepts carousel payload with 2-10 JPEG assets; rejects <2, >10, non-JPEG for IG, unsupported platforms, non-image kinds.
- **Component** — CarouselComposer renders slide slots, add/remove/reorder, submit disabled until ≥2 uploaded.
- **Publish runner unit** — for a carousel post, resolveMediaUrl is called N times, plugin receives ordered `mediaUrls`.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| IG returns error 9007/2207027 "Media ID not available" because a child isn't FINISHED yet | Poll each child before creating the parent — up to 10s (images are usually ready in <2s). If still not ready, return error and don't publish. |
| Carousel with non-JPEG images silently fails at IG | Server-side validation rejects non-JPEG assets at create time when platform=instagram + postType=carousel |
| `publishCarouselPost` half-succeeds — children created but parent fails | No rollback of children containers possible (Meta doesn't expose a delete endpoint). Children expire after 24h anyway. Next admin retry creates fresh children. Document this in the error message. |
| `PublishInput.mediaUrls` shape change breaks other plugins that type-check against the old shape | Add as optional field. Existing plugins compile unchanged. |
| Admin uploads 11 slides in the UI | Composer enforces 10-slide limit client-side; API rejects server-side if admin bypasses UI |
| Image container polling exhausts the IG rate budget on large carousels | Worst case: 10 slides × 5 polls = 50 GETs. Well within IG's 50-posts-per-24h limit (which counts publishes, not reads). Reads are subject to separate quotas but much larger. |

## 9. Rollout

1. Land Phase 2a commits behind existing `CS_MULTIMEDIA_ENABLED` flag (no new flag).
2. Smoke test on staging: build a 3-image carousel, schedule, verify it publishes correctly on an IG test account.
3. Flip flag in prod (or keep on if Phase 1a already flipped it).
4. Dogfood one real carousel post.

## 10. Open questions (deferred)

- Should a carousel support mixed image+video? Deferred to Phase 2e.
- Should we offer "convert PNG to JPEG server-side" as a convenience? Adds image-processing dep. Not now.
- Caption length validation at create time (2200 char IG limit)? Current UI has no limit; add a soft warning later. Not a blocker.
