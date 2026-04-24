# Content Studio Multimedia — Phase 3b Sub-spec (Video Stories)

**Date:** 2026-04-24
**Status:** Approved for implementation (auto mode)
**Scope:** Extend the Story pipeline shipped in Phase 3 to support video content in addition to images, on Instagram + Facebook.
**Parent:** [2026-04-24-content-studio-multimedia-design.md](./2026-04-24-content-studio-multimedia-design.md) — Phase 3

---

## 1. What this ships

Admin picks Story in the manual-post dialog → chooses **Video** (new sub-picker) → the existing VideoUploader uploads a video → submits. On publish:
- Instagram: 2-step `/media` (with `video_url` + `media_type=STORIES`) → poll → publish
- Facebook: 3-phase `/video_stories` (`upload_phase=start` → PUT with `file_url` header → `upload_phase=finish`)

No new endpoints from LinkedIn/TikTok/YouTube — Stories stay IG+FB-only per the platform reality.

Concrete deliverables:
- Create-post route accepts **either** `mediaAssetId` (image story) **or** `source_video_id` (video story) for `postType=story`. Exactly one required.
- `ManualPostDialog` Story branch adds a nested **Photo | Video** sub-picker; Photo renders the existing `ImageUploader`, Video renders the existing `VideoUploader`.
- Instagram plugin's Story branch detects video vs image URL and routes accordingly; video path uses `video_url` + `media_type=STORIES` and reuses the existing `waitForContainerFinished` poller (which already tolerates minutes-long waits).
- Facebook plugin's Story branch detects video vs image URL; video path hits `/video_stories` with the 3-phase pattern using the URL-upload variant (no byte chunking — Meta fetches from our Firebase signed URL via the `file_url` header on phase 2).

## 2. What this DOES NOT ship

| | Reason | Future |
|---|---|---|
| IG Story stickers/links/mentions via API | Not API-publishable; app-only | Out of scope |
| Story scheduled_publish_time on IG/FB | Neither platform's Story API supports scheduling; current behavior already publishes at scheduler-fire time | Keep as-is |
| FB video_stories chunked byte upload | URL-upload variant works for our Firebase-hosted videos | Byte chunking only if URL upload proves unreliable |
| Mixed story sequences (auto-post 3 stories in order) | Single Story per post; sequence = admin posts multiple | Future phase |
| IG Reels as a separate post_type | Phase 3b stays scoped to Stories | Out of scope |

## 3. Goals

- A video uploaded in the studio can be published as an IG Story or FB Story via the normal create-post → scheduled → runner flow.
- The existing image Story flow is untouched.
- No changes to support matrix — IG and FB were already `story: true`; video Story is gated by the plugin picking the right endpoint based on URL extension.

## 4. Non-goals

- Video Story for LinkedIn (no API support)
- Video Story for TikTok (TikTok has no Stories product)
- Support matrix changes

## 5. Architecture

### 5.1 Data model — re-allow source_video_id for stories

Phase 3 clamped `source_video_id` to null for story posts because stories were image-only. Revise the clamp: for `postType=story`, allow EITHER `mediaAssetId` OR `source_video_id` but not both, and not neither.

Validation block in the create-post route:
```ts
if (postType === "story") {
  const hasAsset = !!body?.mediaAssetId
  const hasVideo = !!body?.source_video_id
  if (hasAsset === hasVideo) {
    return 400 — "Story posts require exactly one of mediaAssetId (image) or source_video_id (video)"
  }
  if (hasAsset) {
    // existing kind=image + IG-JPEG check, unchanged
  } else {
    // verify source_video_id references an existing video_uploads row
    const video = await getVideoUploadById(body.source_video_id)
    if (!video) return 400 — "source_video_id not found"
  }
}
```

Un-clamp `source_video_id` for story posts in the `sourceVideoId` computation:
```ts
const sourceVideoId =
  postType === "image" || postType === "carousel"
    ? null
    : body?.source_video_id ?? null
```

(Story no longer clamps; image + carousel still do.)

Attach step: image story stays the same. Video story doesn't attach a `media_asset` — the existing `source_video_id` column handles it, and `resolve-media-url.ts` already signs videos from `source_video_id` first.

### 5.2 Route validation changes

- `postType=story` + no `mediaAssetId` + no `source_video_id` → 400 with the XOR error
- `postType=story` + both set → 400 with the XOR error
- `postType=story` + `source_video_id` + missing video row → 400 "source_video_id not found"

### 5.3 ManualPostDialog

Current Story branch renders `<ImageUploader>` only. Add a Photo|Video sub-picker:

```tsx
{postType === "story" && multimediaEnabled ? (
  <div className="mb-3">
    <label className="block text-xs text-muted-foreground mb-2">
      Story media
      <select
        aria-label="Story media type"
        value={storyMediaType}
        onChange={(e) => {
          setStoryMediaType(e.target.value as "image" | "video")
          setMediaAssetId(null)
          setSourceVideoId(null)
        }}
        className="mt-1 block w-full rounded border border-border px-2 py-1 text-sm"
      >
        <option value="image">Photo</option>
        <option value="video">Video</option>
      </select>
    </label>
    {storyMediaType === "image" ? (
      <ImageUploader onUploaded={(e) => setMediaAssetId(e.mediaAssetId)} />
    ) : (
      <VideoUploader onUploaded={(e) => setSourceVideoId(e.videoUploadId)} />
    )}
    {/* existing "platform does not support stories" warning */}
  </div>
) : null}
```

Submit payload:
```ts
body: JSON.stringify({
  platform, caption, scheduled_at, postType,
  mediaAssetId: (postType === "image" || (postType === "story" && storyMediaType === "image")) ? mediaAssetId : undefined,
  source_video_id: postType === "story" && storyMediaType === "video" ? sourceVideoId : undefined,
  mediaAssetIds: postType === "carousel" ? mediaAssetIds : undefined,
})
```

### 5.4 Instagram plugin

Existing Story path assumes image URL. Update `publishStoryPost` to accept `{imageUrl?, videoUrl?}` OR take a single `mediaUrl` and infer type by extension. The latter matches other plugin branches.

New shape:
```ts
async function publishStoryPost({ accessToken, igUserId, mediaUrl }): Promise<PublishResult> {
  const isVideo = VIDEO_EXTENSIONS.test(mediaUrl)
  const containerBody = isVideo
    ? { video_url: mediaUrl, media_type: "STORIES", access_token: accessToken }
    : { image_url: mediaUrl, media_type: "STORIES", access_token: accessToken }
  // ... rest identical: create container, poll, publish
}
```

No change to the poller (already used by carousel path for minute-long waits).

### 5.5 Facebook plugin

Current Story branch calls `publishPhotoStory` (upload photo unpublished → `/photo_stories`). Add `publishVideoStory` using the URL-upload variant:

```ts
async function publishVideoStory({ accessToken, pageId, videoUrl }): Promise<PublishResult> {
  // Step 1: upload_phase=start
  const start = await fetchJson<{ video_id?: string; upload_url?: string; error?: {message: string} }>(
    `${GRAPH_API_BASE}/${pageId}/video_stories`,
    {
      method: "POST",
      body: { upload_phase: "start", access_token: accessToken },
    },
  )
  if (!start.ok || !start.data?.video_id || !start.data?.upload_url) {
    return { success: false, error: extractFbError(start.errorText) }
  }

  // Step 2: POST to upload_url with file_url header (Meta fetches from our URL)
  const uploadResp = await fetch(start.data.upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_url: videoUrl,
    },
  })
  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => "")
    return { success: false, error: `video story upload ${uploadResp.status}: ${text.slice(0, 200)}` }
  }

  // Step 3: upload_phase=finish
  const finish = await fetchJson<{ post_id?: string; success?: boolean; error?: {message: string} }>(
    `${GRAPH_API_BASE}/${pageId}/video_stories`,
    {
      method: "POST",
      body: { upload_phase: "finish", video_id: start.data.video_id, access_token: accessToken },
    },
  )
  if (!finish.ok || !finish.data?.post_id) {
    return { success: false, error: extractFbError(finish.errorText) }
  }
  return { success: true, platform_post_id: finish.data.post_id }
}
```

Dispatch inside the existing Story branch:
```ts
if (postType === "story") {
  if (!mediaUrl) return error
  const isVideo = VIDEO_EXTENSIONS.test(mediaUrl)
  return isVideo
    ? publishVideoStory({accessToken, pageId, videoUrl: mediaUrl})
    : publishPhotoStory({accessToken, pageId, imageUrl: mediaUrl})
}
```

`VIDEO_EXTENSIONS` regex already exists in the plugin.

### 5.6 resolve-media-url — no changes

Already handles both `source_video_id` (signs from `video_uploads`) and `media_url` paths. Video stories arrive with `source_video_id` set and `media_url` null; `resolveMediaUrl` returns the signed video URL; plugin receives it as `mediaUrl`; VIDEO_EXTENSIONS matches; video Story branch executes.

## 6. Files

**Changed:**
- `app/api/admin/content-studio/posts/route.ts` — unclamp story source_video_id; XOR validation
- `components/admin/content-studio/calendar/ManualPostDialog.tsx` — sub-picker + VideoUploader import
- `lib/social/plugins/instagram.ts` — Story branch dispatches by URL extension
- `lib/social/plugins/facebook.ts` — Story branch adds video path with 3-phase flow

**New tests:**
- `__tests__/lib/social/instagram-video-story.test.ts`
- `__tests__/lib/social/facebook-video-story.test.ts`
- Existing `posts-story.test.ts` gets new cases: source_video_id path, XOR validation

## 7. Testing

- **IG video Story unit** — mock fetch sequence: container create with `video_url`, poll returns FINISHED, publish succeeds. Assert `media_type=STORIES` and `video_url` on container body.
- **FB video Story unit** — mock 3-phase sequence: start returns video_id+upload_url, PUT with file_url header returns 200, finish returns post_id. Assert headers/body on each.
- **Route XOR validation** — story without either required field → 400; story with both → 400; story with only mediaAssetId → 200 (existing); story with only source_video_id → 200.
- **Route source_video_id not found** — 400 when video doesn't exist.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| FB video_stories endpoint needs extra app review we don't have | Smoke test with real FB Page token; if denied, the plugin returns the error verbatim. No code change needed to disable it. |
| URL-upload variant rejects our Firebase signed URL | 1-hour TTL of signed URLs + typical processing well within that window. If it fails, fall back to the chunked byte variant in a follow-up. |
| `VideoUploader` component has different props/signature than expected | Read it before writing the dialog change — `components/admin/videos/VideoUploader.tsx` from earlier phases. |
| Story video size limits (100MB max on FB, 4GB on IG) | Large uploads would fail at the respective PUT/container step with a clear platform error. No pre-flight check in this phase. |

## 9. Rollout

1. Land Phase 3b behind existing `CS_MULTIMEDIA_ENABLED`.
2. Smoke test: upload a short video → Story to IG Business sandbox → Story to FB Page.
3. Dogfood a real IG/FB video Story.
4. Monitor publish runner logs for FB video_stories errors (first week).
