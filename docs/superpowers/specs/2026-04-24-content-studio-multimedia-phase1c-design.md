# Content Studio Multimedia — Phase 1c Sub-spec (LinkedIn Image Publishing)

**Date:** 2026-04-24
**Status:** Approved for implementation (auto mode)
**Scope:** Migrate LinkedIn plugin to the versioned Posts API and add image upload via the 3-step `/rest/images` flow.
**Parent:** [2026-04-24-content-studio-multimedia-phase1-design.md](./2026-04-24-content-studio-multimedia-phase1-design.md) — Phase 1c
**Sibling:** Phase 1a (core image flow) shipped in commits `6b120f9..cc70f0e`.

---

## 1. What this ships

- LinkedIn plugin rewritten against `/rest/posts` (versioned API, `LinkedIn-Version: 202604`).
- Text-only posts continue to work.
- Image posts now work end-to-end via `/rest/images?action=initializeUpload` → PUT bytes → `/rest/posts` with `content.media.id = urn:li:image:*`.
- `isPlatformPostTypeSupported` flips `linkedin.image` from `false` to `true` so the existing create-post route stops rejecting LinkedIn image submissions.

## 2. What this DOES NOT ship

- **LinkedIn video.** The legacy plugin routed video URLs through the ARTICLE link-preview path, which never actually posted a video. Fixing LinkedIn video needs a separate effort (Videos API is 3-step like Images but with synchronous-upload quirks). Phase 1c flips `linkedin.video = false` in the support matrix to reflect reality. When the admin picks LinkedIn + Video, they get a clear 400 at create time instead of a silent ARTICLE link-preview at publish time.
- **Article / link-preview posts.** The legacy `ARTICLE` path is dropped. The create-post API never constructs such posts (it only emits `video`, `image`, `text`), and LinkedIn's new Posts API requires a separately-uploaded thumbnail for articles — too much scope for this phase. Text posts handle short link-drop-in-caption use cases fine.
- **Multi-image carousels.** Single image only; carousel is Phase 2.
- **Member-profile posts.** Company Page (organization URN) only.

## 3. Background — LinkedIn's API state (research summary)

The existing plugin uses `/v2/ugcPosts` with `shareMediaCategory: "ARTICLE" | "NONE"`. LinkedIn marked that endpoint "Legacy" and migrated to `/rest/posts` with a `LinkedIn-Version: YYYYMM` header. Both endpoints still work today but the versioned API is the recommended path and the only one that cleanly supports the Images API flow.

**Image flow (3 steps, versioned API):**
1. `POST /rest/images?action=initializeUpload` returns `{ image: "urn:li:image:C4E10AQF...", uploadUrl, uploadUrlExpiresAt }`.
2. `PUT <uploadUrl>` with the image bytes + `Authorization: Bearer <token>`. Returns 201 with empty body.
3. `POST /rest/posts` with body `{ author, commentary, visibility, distribution, content: { media: { id: <urn from step 1>, altText } }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false }`. Returns 201; post URN is in the **`x-restli-id` response header** (not the body).

Asset readiness: after PUT, asset processes async. `GET /rest/images/{urn}` returns `status: "AVAILABLE" | "PROCESSING" | "WAITING_UPLOAD"`. Posting before `AVAILABLE` can publish the share without the image. We poll with short backoff up to ~15s.

## 4. Architecture

### 4.1 Plugin rewrite

`lib/social/plugins/linkedin.ts` is rewritten. Public signature (`PublishPlugin`) unchanged — callers are unaffected. Internal structure:

```ts
export function createLinkedInPlugin(credentials: LinkedInCredentials): PublishPlugin {
  // ...
  return {
    name: "linkedin",
    displayName: "LinkedIn",
    async connect(creds) { /* GET /v2/organizations/{id} — unchanged, still works */ },
    async publish(input: PublishInput): Promise<PublishResult> {
      const { content, mediaUrl } = input
      // Phase 1c: only text and image are supported. Video/article fall through
      // to the same text-only code path (ARTICLE removed, video returns an error).
      if (mediaUrl && isVideoUrl(mediaUrl)) {
        return { success: false, error: "LinkedIn video publishing is not supported in this release" }
      }
      if (mediaUrl && isImageUrl(mediaUrl)) {
        return publishImagePost({ accessToken, organizationId, caption: content, imageUrl: mediaUrl })
      }
      return publishTextPost({ accessToken, organizationId, caption: content })
    },
    async fetchAnalytics() { return {} },
    async disconnect() {},
    async getSetupInstructions() { /* existing copy */ }
  }
}
```

Image and text paths are pure functions exported (non-default) from the module so they're directly testable.

### 4.2 Image publish helper (`publishImagePost`)

Three steps, each with clear error surfacing:

```ts
async function publishImagePost({ accessToken, organizationId, caption, imageUrl }): Promise<PublishResult> {
  // Step 1: initialize upload
  const init = await initializeImageUpload({ accessToken, organizationId })
  if (!init.ok) return { success: false, error: init.error }
  const { imageUrn, uploadUrl } = init.data

  // Step 2: download the image from our Firebase signed URL, then PUT to LinkedIn
  const bytes = await fetchBinary(imageUrl)
  if (!bytes.ok) return { success: false, error: `Image fetch failed: ${bytes.error}` }
  const put = await putImageBytes({ accessToken, uploadUrl, body: bytes.data })
  if (!put.ok) return { success: false, error: put.error }

  // Step 3: poll for AVAILABLE (max 15s), then create the post
  const ready = await waitForImageReady({ accessToken, imageUrn })
  if (!ready.ok) return { success: false, error: ready.error }
  return createImagePost({ accessToken, organizationId, caption, imageUrn })
}
```

### 4.3 Text publish helper (`publishTextPost`)

```ts
async function publishTextPost({ accessToken, organizationId, caption }): Promise<PublishResult> {
  const response = await fetch(POSTS_URL, {
    method: "POST",
    headers: versionedHeaders(accessToken),
    body: JSON.stringify({
      author: `urn:li:organization:${organizationId}`,
      commentary: caption,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  })
  return extractPostResult(response)
}
```

`extractPostResult` reads `x-restli-id` from the response headers for the post URN. On non-2xx, extracts an error message from the JSON body.

### 4.4 Shared plumbing

- `API_VERSION = "202604"` — single source of truth.
- `versionedHeaders(token)` — returns `{Authorization, "X-Restli-Protocol-Version": "2.0.0", "LinkedIn-Version": API_VERSION, "Content-Type": "application/json"}`.
- `fetchBinary(url)` — small helper that fetches a URL and returns an `ArrayBuffer` (used to pull the Firebase signed URL for the image bytes). Handles HTTP errors.
- `waitForImageReady` — polls with backoff: initial 500ms, double each iteration, max 5 iterations totaling ~15s. Returns error if still not AVAILABLE.

### 4.5 Support matrix update

`lib/content-studio/post-type-support.ts`:
```ts
linkedin: { video: false, image: true, text: true },
```

Note: `video: false` is the **reality adjustment** (existing code never actually worked for video). A separate phase re-enables LinkedIn video after implementing `/rest/videos` flow.

## 5. Files

**Changed:**
- `lib/social/plugins/linkedin.ts` — complete rewrite, ~200 lines.
- `lib/content-studio/post-type-support.ts` — flip `linkedin.image = true`, flip `linkedin.video = false`.

**Created:**
- `__tests__/lib/social/linkedin.test.ts` — extend existing file if present; otherwise create. Covers text-only publish, image-publish happy path, init failure, PUT failure, polling timeout, correct header parsing.

**Unchanged:**
- All callers (plugin registry, publish runner, routes) — public plugin interface preserved.

## 6. Testing strategy

**Unit (Vitest, mocked HTTP via `fetch` mock):**
- Text post — correct body, correct headers, reads `x-restli-id`.
- Image post — all 3 steps called in order with correct payloads; final post body references the URN from step 1.
- Init failure — surfaces LinkedIn error message.
- PUT failure — does not proceed to step 3; surfaces error.
- Polling — retries then gives up; test shortens the timeout via injected clock.
- Support matrix — `isPlatformPostTypeSupported("linkedin", "image") === true`, `("linkedin", "video") === false`.

**Integration / smoke (manual):**
- Once merged, dev account with LinkedIn Company Page posts a real test image.

**Deliberately not tested:** live PUT to LinkedIn's CDN (rate-limited test account token would burn quota).

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| LinkedIn changes the versioned API before we smoke-test | `API_VERSION` is a single constant; trivial to bump. The API supports ≥1-year sliding window of versions. |
| Image fetch from our Firebase signed URL fails (URL expired mid-publish) | `resolve-media-url` returns a fresh 1-hour signed URL at each publish call; Phase 1c completes the flow well under that TTL. If it fails, the error path surfaces a clear "Image fetch failed" message. |
| Polling never resolves (asset stuck in PROCESSING) | 15-second timeout returns a clear error; the post is not created. Admin can retry. |
| Existing LinkedIn video posts in the pipeline start failing with the new "video not supported" error | Check before flipping the matrix: `SELECT * FROM social_posts WHERE platform = 'linkedin' AND post_type = 'video'` — if any exist in `scheduled` state, either reject the migration or mark them for admin review. Based on Phase 0 backfill data (6 video posts total on IG/TikTok, zero on LinkedIn), this is not a concern. |
| LinkedIn rejects the post because asset isn't ready despite AVAILABLE status | Edge case noted in docs; if it happens in smoke testing, add a small extra delay after AVAILABLE before posting. |

## 8. Rollout

1. Land the commits behind the same `CS_MULTIMEDIA_ENABLED` gate Phase 1a uses (no new flag needed — support matrix + existing route gate do the work).
2. Smoke test on staging with the dev LinkedIn Company Page: image post + text post.
3. Flip `CS_MULTIMEDIA_ENABLED=true` in prod if not already (may overlap with Phase 1a's rollout).
4. Dogfood one real LinkedIn image post.

## 9. Open questions

- Do we want asset-reuse in the LinkedIn flow (upload once, post many) the way IG kind of supports? Not for Phase 1c; Phase 2 asset library may surface this.
- Should LinkedIn analytics be implemented? Current `fetchAnalytics` returns `{}`. Out of scope for 1c.
