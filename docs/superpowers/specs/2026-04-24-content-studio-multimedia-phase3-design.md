# Content Studio Multimedia — Phase 3 Sub-spec (Image Stories on IG + FB)

**Date:** 2026-04-24
**Status:** Approved for implementation (auto mode)
**Scope:** Ship image Stories publishing to Instagram + Facebook via the existing content-studio pipeline.
**Parent:** [2026-04-24-content-studio-multimedia-design.md](./2026-04-24-content-studio-multimedia-design.md) — Phase 3

---

## 1. What this ships

- Admin picks **Story** in the manual-post dialog, uploads a single JPEG image, picks IG or FB, submits. Story publishes to the chosen platform.
- Support matrix flips `instagram.story = true`, `facebook.story = true`.
- Create-post API accepts `postType: "story"` + `mediaAssetId` (single-image Stories only for MVP).
- `PublishInput` gains optional `postType?: PostType` so the plugins can tell "this is a Story" apart from "this is a single-image feed post."
- Instagram plugin gets a Story branch: container with `media_type=STORIES`, publish. Reuses the existing `waitForContainerFinished` poller for safety.
- Facebook plugin gets a Story branch: `POST /photos?published=false` → `POST /photo_stories?photo_id=...`. Separate code path from feed/carousel.

## 2. What this DOES NOT ship

| | Reason | Future phase |
|---|---|---|
| Video Stories | FB needs 3-phase resumable upload; IG needs extended polling. Isolate to MVP | Phase 3b |
| Text overlays / stickers | Neither Meta API supports API-published overlays | Out of scope — app-only |
| Captions | Neither Meta API accepts a Story caption — it's silently ignored | The dialog still shows a caption field for internal records but with a helper "Captions aren't shown on Stories" |
| Lightweight UI gating (hide Edit/Approve for stories) | Pipeline still works — stories go through approved/scheduled/published like image posts. UI gating is polish | Phase 3c |
| IG Story user-tags / mentions stickers | Available on IG API but not essential for MVP | Phase 3d |
| Scheduling text at the API level | Neither platform supports it — we publish at scheduled time using our scheduler | N/A |

## 3. Goals

- An admin can publish a single-image Story to Instagram or Facebook from the studio.
- The scheduler can fire a "story scheduled for Tuesday 9am" post at exactly Tuesday 9am and publish via API — treating the scheduled_at as an app-level trigger, not an API field.
- The existing image-post, video-post, and carousel flows are untouched.

## 4. Non-goals

- Multi-image Stories (each IG/FB Story is a single media slot).
- Story reply / reaction analytics (separate API surface, out of scope).
- Media asset reuse across feed-post + Story (the "can't re-publish a container" rule makes this tricky — admin uploads fresh for Story).

## 5. Architecture

### 5.1 Support matrix

`lib/content-studio/post-type-support.ts`:
```ts
instagram: { video: true, image: true, carousel: true, story: true },
facebook:  { video: true, image: true, text: true, carousel: true, story: true },
```

Everything else stays unchanged. LinkedIn/TikTok/YouTube don't support Stories.

### 5.2 Create-post API route

Extends the existing route with a new `postType === "story"` branch:

- Validation: `mediaAssetId` required (single asset), asset must exist, asset's `kind` must be `"image"`. For IG, asset's `mime_type` must be `"image/jpeg"` (FB accepts JPEG/PNG; no extra MIME check needed there).
- Clamp `source_video_id` to null (same defensive pattern used for image + carousel).
- Create the post with `post_type: "story"`; attach the asset at position 0 via `attachMedia`. Mirror trigger copies the path to `social_posts.media_url` just like image posts.
- Approval status flow identical to images: `scheduled` if `scheduled_at`, else `approved`.

### 5.3 `PublishInput` — add `postType`

`lib/social/plugins/types.ts`:
```ts
export interface PublishInput {
  content: string
  mediaUrl: string | null
  mediaUrls?: string[]
  postType?: PostType    // new — null/undefined means legacy "whatever the URL suggests"
  scheduledAt: string | null
  metadata?: Record<string, unknown>
}
```

Import `PostType` from `@/types/database`. Non-breaking: existing plugins already ignore fields they don't care about.

### 5.4 Publish-runner — thread `postType` through

`lib/social/publish-runner.ts`'s `publishOnePost` already computes `mediaUrls` for carousel posts. Add one line to pass `postType` through:

```ts
const publishResult = await plugin.publish({
  content: post.content,
  mediaUrl,
  mediaUrls,
  postType: post.post_type,
  scheduledAt: null,
})
```

No behavior change for non-Story posts — plugins ignore the field.

### 5.5 Instagram plugin — Story branch

In `publish()`, branch on `postType === "story"` BEFORE the existing carousel/single-media branches. Calls into `publishStoryPost`:

```ts
async function publishStoryPost({ accessToken, igUserId, imageUrl }): Promise<PublishResult> {
  // Step 1: create Story container
  const container = await fetchJson<{ id?: string; error?: { message: string } }>(
    `${GRAPH_API_BASE}/${igUserId}/media`,
    {
      method: "POST",
      body: { image_url: imageUrl, media_type: "STORIES", access_token: accessToken },
    },
  )
  if (!container.ok || !container.data?.id) {
    return { success: false, error: extractIgError(container.errorText) }
  }

  // Step 2: (optional) poll until FINISHED. Safe for small JPEGs but cheap insurance.
  const ready = await waitForContainerFinished({ accessToken, containerId: container.data.id })
  if (!ready.ok) return { success: false, error: ready.error }

  // Step 3: publish
  const publishRes = await fetchJson<{ id?: string }>(
    `${GRAPH_API_BASE}/${igUserId}/media_publish`,
    { method: "POST", body: { creation_id: container.data.id, access_token: accessToken } },
  )
  if (!publishRes.ok || !publishRes.data?.id) {
    return { success: false, error: extractIgError(publishRes.errorText) }
  }
  return { success: true, platform_post_id: publishRes.data.id }
}
```

Caption (`input.content`) is NOT passed to the container — IG silently ignores it on Stories.

### 5.6 Facebook plugin — Story branch

Separate endpoints from feed/carousel. New `publishPhotoStory` helper:

```ts
async function publishPhotoStory({ accessToken, pageId, imageUrl }): Promise<PublishResult> {
  // Step 1: upload unpublished photo (same as Phase 2b's carousel helper Step 1)
  const photo = await fetchJson<{ id?: string; error?: { message: string } }>(
    `${GRAPH_API_BASE}/${pageId}/photos`,
    { method: "POST", body: { url: imageUrl, published: false, access_token: accessToken } },
  )
  if (!photo.ok || !photo.data?.id) {
    return { success: false, error: extractFbError(photo.errorText) }
  }

  // Step 2: attach to Story
  const story = await fetchJson<{ post_id?: string; success?: boolean; error?: { message: string } }>(
    `${GRAPH_API_BASE}/${pageId}/photo_stories`,
    { method: "POST", body: { photo_id: photo.data.id, access_token: accessToken } },
  )
  if (!story.ok || !story.data?.post_id) {
    return { success: false, error: extractFbError(story.errorText) }
  }
  return { success: true, platform_post_id: story.data.post_id }
}
```

Caption not passed — `photo_stories` doesn't accept one.

In `publish()`, branch order: Story first, then carousel (`mediaUrls`), then single media.

### 5.7 UI changes

`ManualPostDialog` gains "Story" in the post-type picker. When selected:
- Reuses `ImageUploader` (single image).
- Caption field stays visible but shows a helper: "Captions are ignored on Stories." (Render a tiny `<p>` below the textarea when `postType === "story"`.)
- Submit disabled until one image is uploaded.

`PostTypeBadge` gains a "Story" variant with a distinct icon (e.g. `CircleDot` from lucide — represents ephemeral/circular frame).

## 6. Files

**Changed:**
- `lib/content-studio/post-type-support.ts` — story flags
- `app/api/admin/content-studio/posts/route.ts` — story validation + attach
- `lib/social/plugins/types.ts` — add `postType?: PostType`
- `lib/social/publish-runner.ts` — pass `postType` through
- `lib/social/plugins/instagram.ts` — Story branch + helper
- `lib/social/plugins/facebook.ts` — Story branch + helper
- `components/admin/content-studio/calendar/ManualPostDialog.tsx` — Story option + caption helper
- `components/admin/content-studio/shared/PostTypeBadge.tsx` — Story variant

**Created:**
- `__tests__/lib/social/instagram-story.test.ts`
- `__tests__/lib/social/facebook-story.test.ts`
- `__tests__/api/admin/content-studio/posts-story.test.ts`

## 7. Testing strategy

- Matrix test: IG + FB story = true; others false.
- Create-post route: accepts story + mediaAssetId, rejects platforms without support, rejects story with source_video_id (it gets clamped to null), rejects non-image asset, rejects non-JPEG for IG.
- IG plugin: happy path (container → poll → publish), polling timeout, publish failure.
- FB plugin: happy path (photo unpublished → photo_stories), photo upload failure short-circuits, photo_stories failure.
- Publish-runner: already threads `postType` through — no new test needed beyond confirming existing tests still green.
- Component: dialog renders Story option and the "Captions are ignored" helper text.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| FB Story endpoint requires extra app review we don't have | Smoke test before flipping the flag in prod. The plugin code ships but the admin simply sees a FB permission error until review clears. |
| Admin expects caption to show on Story | Inline helper text in the dialog makes this explicit before submit |
| Scheduled Story fires at exactly the scheduled time but FB/IG can't actually schedule → race with the 24h Story window | Not a real issue for the scheduler (fires at time X and publishes immediately), but admins expecting "scheduled for later" must understand the Story starts its 24h clock at that exact moment. UI copy can clarify if needed. |
| Media re-use: an admin uploads an image, posts it as an image feed, then tries to post as a Story | IG refuses to re-publish the same media id. The admin needs to upload a fresh asset. Surface the API error verbatim. |
| `postType` on PublishInput might conflict if a plugin already has its own meaning for a field named `postType` | Grep confirmed no plugin defines `postType`; the field is new. |

## 9. Rollout

1. Land Phase 3 commits behind `CS_MULTIMEDIA_ENABLED` (no new flag).
2. Smoke test on staging: image Story to IG test account, image Story to FB test Page.
3. Flip prod flag if not already, dogfood a real Story.

## 10. Open questions (deferred)

- Video Story support → Phase 3b.
- Lightweight approval UI gating (hide Edit/Approve for stories) → Phase 3c.
- Story analytics (story views, reach, replies) → Phase 3d.
