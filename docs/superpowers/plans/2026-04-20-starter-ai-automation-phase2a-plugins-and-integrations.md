# Starter AI Automation — Phase 2a: Plugins + External Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 6 social platform plugins (facebook, instagram, tiktok, youtube, youtube_shorts, linkedin) against their respective APIs + the AssemblyAI video transcription pipeline + the Tavily research pipeline. All end-to-end testable with mocks. OAuth connect flows deferred to Phase 2b.

**Architecture:** Each plugin is a class implementing `PublishPlugin` (defined in Phase 1 at `lib/social/plugins/types.ts`). Plugins are instantiated with credentials pulled from `platform_connections.credentials` and self-register in the plugin registry via a bootstrap module. AssemblyAI + Tavily work happens inside Firebase Functions triggered by Firestore `ai_jobs` docs — matching the existing `programGeneration`, `blogGeneration`, `newsletterGeneration` pattern. Unit tests stub `fetch` / AssemblyAI SDK so the whole suite runs without real API credentials.

**Tech Stack:** TypeScript strict. Meta Graph API v22.0+, YouTube Data API v3, TikTok Content Posting API v2, LinkedIn Marketing API v2, AssemblyAI Async Transcription API, Tavily Search + Extract API. Firebase Functions 2nd-gen Firestore triggers. Vitest for all unit tests.

**Existing infrastructure this plan builds on (no changes):**

- Plugin framework: [lib/social/plugins/types.ts](../../../lib/social/plugins/types.ts), [lib/social/registry.ts](../../../lib/social/registry.ts) (Phase 1)
- DAL: [lib/db/platform-connections.ts](../../../lib/db/platform-connections.ts), [lib/db/video-uploads.ts](../../../lib/db/video-uploads.ts), [lib/db/video-transcripts.ts](../../../lib/db/video-transcripts.ts)
- AI jobs helper: [lib/ai-jobs.ts](../../../lib/ai-jobs.ts) with types already extended for `video_transcription` and `tavily_research`
- Firebase Functions reference patterns: [functions/src/blog-generation.ts](../../../functions/src/blog-generation.ts), [functions/src/newsletter-generation.ts](../../../functions/src/newsletter-generation.ts), [functions/src/index.ts](../../../functions/src/index.ts)
- Firebase Functions shared libs: [functions/src/lib/supabase.ts](../../../functions/src/lib/supabase.ts), [functions/src/lib/research.ts](../../../functions/src/lib/research.ts)
- Anthropic wrapper: [functions/src/ai/anthropic.ts](../../../functions/src/ai/anthropic.ts)

---

## File Structure

### Plugin implementations (new)

- `lib/social/plugins/facebook.ts` — Facebook Page publishing via Meta Graph API
- `lib/social/plugins/instagram.ts` — Instagram Business account via IG Graph API
- `lib/social/plugins/youtube.ts` — YouTube long-form video upload via YouTube Data API
- `lib/social/plugins/youtube-shorts.ts` — thin wrapper around youtube plugin with #Shorts tagging
- `lib/social/plugins/tiktok.ts` — hybrid workflow (notification-only, no direct post)
- `lib/social/plugins/linkedin.ts` — LinkedIn Company Page via UGC Posts API
- `lib/social/plugins/shared/fetch-helpers.ts` — shared `fetchJson`, token-refresh helpers

### Plugin bootstrap (new)

- `lib/social/bootstrap.ts` — imports all 6 plugin factories + self-registers against platform_connections rows

### AssemblyAI + Tavily integrations (new)

- `functions/src/lib/assemblyai.ts` — AssemblyAI REST client (submit transcription, poll status)
- `functions/src/lib/tavily.ts` — Tavily search + extract + fact-check client
- `functions/src/transcribe-video.ts` — Firebase Function triggered by `ai_jobs` with `type="video_transcription"`
- `functions/src/tavily-research.ts` — Firebase Function triggered by `ai_jobs` with `type="tavily_research"`
- `app/api/webhooks/assemblyai/route.ts` — Next.js webhook endpoint where AssemblyAI posts completion

### Register new functions in the index (modify)

- `functions/src/index.ts` — add two new `onDocumentCreated` exports for the new job types + extend the secrets arrays

### Next.js API routes to trigger pipelines (new)

- `app/api/admin/videos/transcribe/route.ts` — creates a `video_transcription` ai_jobs doc
- `app/api/admin/content/research/route.ts` — creates a `tavily_research` ai_jobs doc

### Tests (new)

- `__tests__/lib/social/facebook.test.ts`
- `__tests__/lib/social/instagram.test.ts`
- `__tests__/lib/social/youtube.test.ts`
- `__tests__/lib/social/youtube-shorts.test.ts`
- `__tests__/lib/social/tiktok.test.ts`
- `__tests__/lib/social/linkedin.test.ts`
- `__tests__/lib/social/bootstrap.test.ts`
- `functions/src/lib/__tests__/assemblyai.test.ts`
- `functions/src/lib/__tests__/tavily.test.ts`

---

## Tasks

### Task 1: Shared fetch helpers for plugins

**Files:**

- Create: `lib/social/plugins/shared/fetch-helpers.ts`

- [ ] **Step 1: Write `fetch-helpers.ts`**

```typescript
// lib/social/plugins/shared/fetch-helpers.ts
// Small fetch utilities shared across all 6 platform plugins. Keeps each
// plugin file focused on its own API contract rather than HTTP plumbing.

export interface FetchJsonOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  body?: unknown
  headers?: Record<string, string>
}

export interface FetchJsonResult<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  errorText: string | null
}

/**
 * Wrapper around fetch() that always returns a discriminated result object
 * instead of throwing. Plugin code can check .ok and return a typed
 * PublishResult without try/catch scaffolding everywhere.
 */
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<FetchJsonResult<T>> {
  const method = options.method ?? "GET"
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {}),
  }

  const body =
    options.body === undefined
      ? undefined
      : options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body)

  const response = await fetch(url, { method, headers, body })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    return { ok: false, status: response.status, data: null, errorText }
  }

  const text = await response.text()
  const data = text ? (JSON.parse(text) as T) : null
  return { ok: true, status: response.status, data, errorText: null }
}

/**
 * Builds a URLSearchParams string from a plain object, skipping undefined
 * values. Used by every plugin for their query-string APIs.
 */
export function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const filtered = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string | number | boolean][]
  if (filtered.length === 0) return ""
  const qs = new URLSearchParams()
  for (const [k, v] of filtered) qs.set(k, String(v))
  return `?${qs.toString()}`
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/social/plugins/shared/fetch-helpers.ts
git commit -m "feat(social): shared fetch helpers for platform plugins"
```

---

### Task 2: Facebook plugin

**Files:**

- Create: `lib/social/plugins/facebook.ts`
- Create: `__tests__/lib/social/facebook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/social/facebook.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createFacebookPlugin } from "@/lib/social/plugins/facebook"

describe("FacebookPlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("publish() posts content to /{page_id}/feed with access_token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "123_456" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "123" })
    const result = await plugin.publish({ content: "hello world", mediaUrl: null, scheduledAt: null })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("123_456")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("graph.facebook.com")
    expect(url).toContain("/123/feed")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.message).toBe("hello world")
    expect(body.access_token).toBe("tok")
  })

  it("publish() switches to /photos when mediaUrl ends with image extension", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "789" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "123" })
    await plugin.publish({ content: "caption", mediaUrl: "https://example.com/pic.jpg", scheduledAt: null })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/123/photos")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.url).toBe("https://example.com/pic.jpg")
    expect(body.caption).toBe("caption")
  })

  it("publish() returns success=false with error text on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: "Invalid token" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createFacebookPlugin({ access_token: "bad", page_id: "123" })
    const result = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null })

    expect(result.success).toBe(false)
    expect(result.error).toContain("Invalid token")
  })

  it("fetchAnalytics() queries insights endpoint with post_impressions and post_engagements", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [
            { name: "post_impressions", values: [{ value: 1234 }] },
            { name: "post_engagements", values: [{ value: 56 }] },
          ],
        }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "123" })
    const analytics = await plugin.fetchAnalytics("123_456")

    expect(analytics.impressions).toBe(1234)
    expect(analytics.engagement).toBe(56)

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain("/123_456/insights")
    expect(url).toContain("metric=post_impressions%2Cpost_engagements")
  })

  it("getSetupInstructions() returns a non-empty guide", async () => {
    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "123" })
    const instructions = await plugin.getSetupInstructions()
    expect(instructions.length).toBeGreaterThan(100)
    expect(instructions).toMatch(/Facebook Page/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- __tests__/lib/social/facebook.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `lib/social/plugins/facebook.ts`**

```typescript
// lib/social/plugins/facebook.ts
// Facebook Page publishing via Meta Graph API.
// Docs: https://developers.facebook.com/docs/graph-api/reference/v22.0/page/feed

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"
import { fetchJson, buildQueryString } from "./shared/fetch-helpers"

const GRAPH_API_VERSION = "v22.0"
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export interface FacebookCredentials {
  access_token: string
  page_id: string
}

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv)(\?|$)/i

function isImageUrl(url: string): boolean {
  return IMAGE_EXTENSIONS.test(url)
}

function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url)
}

export function createFacebookPlugin(credentials: FacebookCredentials): PublishPlugin {
  const { access_token, page_id } = credentials

  return {
    name: "facebook",
    displayName: "Facebook",

    async connect(creds): Promise<ConnectResult> {
      const result = await fetchJson<{ id?: string; name?: string; error?: { message: string } }>(
        `${GRAPH_API_BASE}/${page_id}?${new URLSearchParams({ access_token: (creds as FacebookCredentials).access_token ?? access_token, fields: "id,name" }).toString()}`,
      )
      if (!result.ok) {
        return { status: "error", error: result.errorText ?? "Facebook connection check failed" }
      }
      return { status: "connected", account_handle: result.data?.name }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { content, mediaUrl, scheduledAt } = input

      let endpoint: string
      let body: Record<string, unknown>

      if (mediaUrl && isImageUrl(mediaUrl)) {
        endpoint = `${GRAPH_API_BASE}/${page_id}/photos`
        body = { url: mediaUrl, caption: content, access_token }
      } else if (mediaUrl && isVideoUrl(mediaUrl)) {
        endpoint = `${GRAPH_API_BASE}/${page_id}/videos`
        body = { file_url: mediaUrl, description: content, access_token }
      } else {
        endpoint = `${GRAPH_API_BASE}/${page_id}/feed`
        body = { message: content, access_token }
      }

      if (scheduledAt) {
        body.published = false
        body.scheduled_publish_time = Math.floor(new Date(scheduledAt).getTime() / 1000)
      }

      const response = await fetchJson<{ id?: string; error?: { message: string } }>(endpoint, {
        method: "POST",
        body,
      })

      if (!response.ok || !response.data?.id) {
        const message = response.errorText ? extractFbError(response.errorText) : "Facebook publish failed"
        return { success: false, error: message }
      }

      return { success: true, platform_post_id: response.data.id }
    },

    async fetchAnalytics(platformPostId: string): Promise<AnalyticsResult> {
      const qs = buildQueryString({
        access_token,
        metric: "post_impressions,post_engagements",
      })
      const response = await fetchJson<{
        data?: Array<{ name: string; values: Array<{ value: number }> }>
      }>(`${GRAPH_API_BASE}/${platformPostId}/insights${qs}`)

      const analytics: AnalyticsResult = {}
      if (response.ok && response.data?.data) {
        for (const row of response.data.data) {
          const value = row.values?.[0]?.value ?? 0
          if (row.name === "post_impressions") analytics.impressions = value
          if (row.name === "post_engagements") analytics.engagement = value
        }
      }
      return analytics
    },

    async disconnect() {
      // Token revocation is optional; server-side we simply forget credentials.
      // The Platform Connections UI clears platform_connections.credentials.
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your Facebook Page",
        "",
        "1. Go to https://developers.facebook.com and create a Page access token for the Page you want to automate.",
        "2. The token needs these permissions: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`.",
        "3. Paste the long-lived Page access token and the Page ID into the Connect dialog.",
        "4. After connecting, a test ping is made to `/me` to verify the token works.",
        "",
        "Don't have a Facebook Page yet? Create one at https://www.facebook.com/pages/create — takes about 15 minutes.",
      ].join("\n")
    },
  }
}

function extractFbError(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } }
    return parsed.error?.message ?? raw
  } catch {
    return raw
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- __tests__/lib/social/facebook.test.ts`
Expected: 5 passing tests

- [ ] **Step 5: Commit**

```bash
git add lib/social/plugins/facebook.ts __tests__/lib/social/facebook.test.ts
git commit -m "feat(social): Facebook Page plugin via Meta Graph API"
```

---

### Task 3: Instagram plugin

**Files:**

- Create: `lib/social/plugins/instagram.ts`
- Create: `__tests__/lib/social/instagram.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/social/instagram.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createInstagramPlugin } from "@/lib/social/plugins/instagram"

describe("InstagramPlugin", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() creates a media container then publishes it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "container_111" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "media_222" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig123" })
    const result = await plugin.publish({
      content: "first post",
      mediaUrl: "https://example.com/pic.jpg",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("media_222")
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [createUrl, createInit] = fetchMock.mock.calls[0]
    expect(createUrl).toContain("/ig123/media")
    const createBody = JSON.parse((createInit as RequestInit).body as string)
    expect(createBody.image_url).toBe("https://example.com/pic.jpg")
    expect(createBody.caption).toBe("first post")

    const [publishUrl, publishInit] = fetchMock.mock.calls[1]
    expect(publishUrl).toContain("/ig123/media_publish")
    const publishBody = JSON.parse((publishInit as RequestInit).body as string)
    expect(publishBody.creation_id).toBe("container_111")
  })

  it("publish() uses video_url + media_type=REELS when mediaUrl is a video", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "container_reel" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "media_reel" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig123" })
    await plugin.publish({ content: "caption", mediaUrl: "https://example.com/vid.mp4", scheduledAt: null })

    const createBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(createBody.video_url).toBe("https://example.com/vid.mp4")
    expect(createBody.media_type).toBe("REELS")
  })

  it("publish() returns failure if the container creation fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: "Invalid image URL" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig123" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://example.com/broken.jpg",
      scheduledAt: null,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("Invalid image URL")
    expect(fetchMock).toHaveBeenCalledTimes(1) // did NOT proceed to publish step
  })

  it("getSetupInstructions() mentions Business or Creator account", async () => {
    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig123" })
    const instructions = await plugin.getSetupInstructions()
    expect(instructions).toMatch(/Business|Creator/i)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:run -- __tests__/lib/social/instagram.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `lib/social/plugins/instagram.ts`**

```typescript
// lib/social/plugins/instagram.ts
// Instagram Business/Creator publishing via IG Graph API (two-step: create container, publish).
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"
import { fetchJson, buildQueryString } from "./shared/fetch-helpers"

const GRAPH_API_VERSION = "v22.0"
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export interface InstagramCredentials {
  access_token: string
  ig_user_id: string
}

const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv)(\?|$)/i

function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url)
}

export function createInstagramPlugin(credentials: InstagramCredentials): PublishPlugin {
  const { access_token, ig_user_id } = credentials

  return {
    name: "instagram",
    displayName: "Instagram",

    async connect(creds): Promise<ConnectResult> {
      const token = (creds as InstagramCredentials).access_token ?? access_token
      const result = await fetchJson<{ id?: string; username?: string }>(
        `${GRAPH_API_BASE}/${ig_user_id}?${new URLSearchParams({ access_token: token, fields: "id,username" }).toString()}`,
      )
      if (!result.ok) {
        return { status: "error", error: result.errorText ?? "Instagram connection check failed" }
      }
      return { status: "connected", account_handle: result.data?.username ? `@${result.data.username}` : undefined }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { content, mediaUrl } = input

      if (!mediaUrl) {
        return {
          success: false,
          error: "Instagram requires a media URL (photo or video). Text-only posts are not supported by the API.",
        }
      }

      const containerBody: Record<string, unknown> = {
        caption: content,
        access_token,
      }
      if (isVideoUrl(mediaUrl)) {
        containerBody.video_url = mediaUrl
        containerBody.media_type = "REELS"
      } else {
        containerBody.image_url = mediaUrl
      }

      const container = await fetchJson<{ id?: string; error?: { message: string } }>(
        `${GRAPH_API_BASE}/${ig_user_id}/media`,
        { method: "POST", body: containerBody },
      )
      if (!container.ok || !container.data?.id) {
        return { success: false, error: extractIgError(container.errorText) }
      }

      const publishRes = await fetchJson<{ id?: string }>(`${GRAPH_API_BASE}/${ig_user_id}/media_publish`, {
        method: "POST",
        body: { creation_id: container.data.id, access_token },
      })
      if (!publishRes.ok || !publishRes.data?.id) {
        return { success: false, error: extractIgError(publishRes.errorText) }
      }
      return { success: true, platform_post_id: publishRes.data.id }
    },

    async fetchAnalytics(platformPostId: string): Promise<AnalyticsResult> {
      const qs = buildQueryString({
        access_token,
        metric: "impressions,engagement,reach,saved",
      })
      const response = await fetchJson<{
        data?: Array<{ name: string; values: Array<{ value: number }> }>
      }>(`${GRAPH_API_BASE}/${platformPostId}/insights${qs}`)

      const analytics: AnalyticsResult = {}
      if (response.ok && response.data?.data) {
        for (const row of response.data.data) {
          const value = row.values?.[0]?.value ?? 0
          if (row.name === "impressions") analytics.impressions = value
          if (row.name === "engagement") analytics.engagement = value
        }
      }
      return analytics
    },

    async disconnect() {
      // no-op — credentials cleared at DAL layer
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your Instagram Business or Creator account",
        "",
        "Instagram posting requires a Business or Creator account linked to a Facebook Page.",
        "",
        "1. Convert your Instagram to a Business or Creator account (Settings → Account → Switch account type).",
        "2. Link it to the Facebook Page you connected above.",
        "3. Get the Instagram User ID — run `GET /me/accounts?fields=instagram_business_account` with your Page token.",
        "4. Paste the IG user id + the Page access token into the Connect dialog.",
        "",
        "Note: only Business/Creator accounts can post via the API. Personal accounts are not supported.",
      ].join("\n")
    },
  }
}

function extractIgError(raw: string | null): string {
  if (!raw) return "Instagram publish failed"
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } }
    return parsed.error?.message ?? raw
  } catch {
    return raw
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm run test:run -- __tests__/lib/social/instagram.test.ts`
Expected: 4 passing tests

- [ ] **Step 5: Commit**

```bash
git add lib/social/plugins/instagram.ts __tests__/lib/social/instagram.test.ts
git commit -m "feat(social): Instagram Business/Creator plugin via IG Graph API"
```

---

### Task 4: YouTube plugin (long-form upload)

**Files:**

- Create: `lib/social/plugins/youtube.ts`
- Create: `__tests__/lib/social/youtube.test.ts`

**Note:** YouTube uses OAuth 2.0 with refresh tokens. The plugin accepts `{ access_token, refresh_token, client_id, client_secret }` and refreshes the access token when a 401 is returned. Actual video bytes are uploaded via the resumable upload protocol; we use the simple one-shot upload for videos ≤ 256 MB (sufficient for Phase 2 coaching videos). For larger videos, the upload endpoint returns a resumable URL which we stream to.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/social/youtube.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createYouTubePlugin } from "@/lib/social/plugins/youtube"

describe("YouTubePlugin", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() uploads the video with the correct multipart metadata", async () => {
    // The plugin fetches the file bytes from mediaUrl, then POSTs a multipart
    // request to YouTube's uploads endpoint.
    const videoBytes = new Uint8Array([1, 2, 3])

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => videoBytes.buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "vid_xyz", status: { uploadStatus: "uploaded" } }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createYouTubePlugin({
      access_token: "tok",
      refresh_token: "refresh",
      client_id: "id",
      client_secret: "secret",
    })

    const result = await plugin.publish({
      content: "Rotational power drill — breakdown and cues\n\nExplanation here.",
      mediaUrl: "https://example.com/video.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("vid_xyz")

    // Second fetch call is the YouTube upload
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1]
    expect(uploadUrl).toContain("youtube/v3/videos")
    expect(uploadUrl).toContain("uploadType=multipart")
    expect((uploadInit as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    })
  })

  it("publish() refreshes the token on 401 then retries once", async () => {
    const fetchMock = vi
      .fn()
      // file bytes fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([9]).buffer,
      })
      // First upload attempt: 401
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      })
      // Token refresh call
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "new_tok", expires_in: 3600 }),
      })
      // Retry upload with new token: success
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "vid_after_refresh" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createYouTubePlugin({
      access_token: "expired",
      refresh_token: "refresh",
      client_id: "id",
      client_secret: "secret",
    })

    const result = await plugin.publish({
      content: "title\n\ndescription",
      mediaUrl: "https://example.com/v.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("vid_after_refresh")

    // Third call should be to oauth2.googleapis.com/token with grant_type=refresh_token
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[2]
    expect(refreshUrl).toContain("oauth2.googleapis.com/token")
    expect((refreshInit as RequestInit).body as string).toContain("grant_type=refresh_token")

    // Fourth call: new Bearer token
    const [, retryInit] = fetchMock.mock.calls[3]
    expect((retryInit as RequestInit).headers).toMatchObject({
      Authorization: "Bearer new_tok",
    })
  })

  it("publish() splits content by first newline into title (line 1) + description (rest)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "v1" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createYouTubePlugin({
      access_token: "tok",
      refresh_token: "r",
      client_id: "id",
      client_secret: "secret",
    })

    await plugin.publish({
      content: "My Video Title\n\nLine 1 of description.\nLine 2.",
      mediaUrl: "https://example.com/v.mp4",
      scheduledAt: null,
    })

    // Inspect the multipart body for snippet title + description
    const uploadInit = fetchMock.mock.calls[1][1] as RequestInit
    const bodyStr = typeof uploadInit.body === "string" ? uploadInit.body : ""
    expect(bodyStr).toContain('"title":"My Video Title"')
    expect(bodyStr).toContain('"description":"Line 1 of description.\\nLine 2."')
  })

  it("getSetupInstructions() mentions YouTube channel + Google Cloud Console", async () => {
    const plugin = createYouTubePlugin({
      access_token: "tok",
      refresh_token: "r",
      client_id: "id",
      client_secret: "secret",
    })
    const instructions = await plugin.getSetupInstructions()
    expect(instructions).toMatch(/YouTube channel/i)
    expect(instructions).toMatch(/Google Cloud/i)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:run -- __tests__/lib/social/youtube.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `lib/social/plugins/youtube.ts`**

```typescript
// lib/social/plugins/youtube.ts
// YouTube Data API v3 video upload.
// Docs: https://developers.google.com/youtube/v3/docs/videos/insert

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"
import { fetchJson } from "./shared/fetch-helpers"

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const ANALYTICS_URL = "https://www.googleapis.com/youtube/v3/videos"

export interface YouTubeCredentials {
  access_token: string
  refresh_token: string
  client_id: string
  client_secret: string
}

export function createYouTubePlugin(credentials: YouTubeCredentials): PublishPlugin {
  let { access_token } = credentials
  const { refresh_token, client_id, client_secret } = credentials

  async function refreshAccessToken(): Promise<string | null> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id,
        client_secret,
        refresh_token,
        grant_type: "refresh_token",
      }).toString(),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { access_token?: string }
    if (!data.access_token) return null
    access_token = data.access_token
    return data.access_token
  }

  async function uploadVideo(
    videoBytes: ArrayBuffer,
    title: string,
    description: string,
    tags: string[],
  ): Promise<{ id: string } | { error: string }> {
    const metadata = JSON.stringify({
      snippet: { title, description, tags },
      status: { privacyStatus: "public" },
    })

    const boundary = "djp_yt_" + Math.random().toString(36).slice(2)
    const encoder = new TextEncoder()
    const metadataPart = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    )
    const closingPart = encoder.encode(`\r\n--${boundary}--`)
    const combined = new Uint8Array(metadataPart.byteLength + videoBytes.byteLength + closingPart.byteLength)
    combined.set(metadataPart, 0)
    combined.set(new Uint8Array(videoBytes), metadataPart.byteLength)
    combined.set(closingPart, metadataPart.byteLength + videoBytes.byteLength)

    async function attemptUpload(bearer: string) {
      const response = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: combined,
      })
      return response
    }

    let response = await attemptUpload(access_token)
    if (response.status === 401) {
      const newToken = await refreshAccessToken()
      if (!newToken) return { error: "Token refresh failed" }
      response = await attemptUpload(newToken)
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      return { error: text || `YouTube upload failed with status ${response.status}` }
    }
    const data = (await response.json()) as { id?: string }
    if (!data.id) return { error: "YouTube response missing video id" }
    return { id: data.id }
  }

  return {
    name: "youtube",
    displayName: "YouTube",

    async connect(): Promise<ConnectResult> {
      const refreshed = await refreshAccessToken()
      if (!refreshed) return { status: "error", error: "Could not refresh YouTube token" }
      return { status: "connected" }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      if (!input.mediaUrl) {
        return { success: false, error: "YouTube requires a video URL" }
      }

      // Split content on first double-newline: line 1 = title, rest = description.
      // If no newline present, entire content is title.
      const [firstLine, ...rest] = input.content.split(/\r?\n\r?\n/, 2)
      const title = firstLine.trim().slice(0, 100) // YouTube max
      const description = (rest.join("\n\n") ?? "").trim()
      const tags = (input.metadata?.tags as string[] | undefined) ?? []

      const fileResponse = await fetch(input.mediaUrl)
      if (!fileResponse.ok) {
        return { success: false, error: `Could not download media from ${input.mediaUrl}` }
      }
      const videoBytes = await fileResponse.arrayBuffer()

      const result = await uploadVideo(videoBytes, title, description, tags)
      if ("error" in result) return { success: false, error: result.error }
      return { success: true, platform_post_id: result.id }
    },

    async fetchAnalytics(videoId: string): Promise<AnalyticsResult> {
      const url = `${ANALYTICS_URL}?${new URLSearchParams({ id: videoId, part: "statistics" }).toString()}`
      const response = await fetchJson<{
        items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>
      }>(url, { headers: { Authorization: `Bearer ${access_token}` } })

      const stats = response.data?.items?.[0]?.statistics
      if (!stats) return {}
      return {
        views: Number(stats.viewCount ?? 0),
        likes: Number(stats.likeCount ?? 0),
        comments: Number(stats.commentCount ?? 0),
      }
    },

    async disconnect() {
      // no-op
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your YouTube channel",
        "",
        "1. Create a YouTube channel at https://youtube.com (free, takes 10 minutes).",
        "2. Go to Google Cloud Console → enable YouTube Data API v3.",
        "3. Create an OAuth 2.0 client (type: Web application). Add the callback URL from the Platform Connections page.",
        "4. Complete the OAuth flow — DJP Athlete captures the refresh_token and client credentials.",
        "",
        "Phase 1 note: a full OAuth connect button ships in Phase 2b. For now, manual token entry is supported.",
      ].join("\n")
    },
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm run test:run -- __tests__/lib/social/youtube.test.ts`
Expected: 4 passing tests

- [ ] **Step 5: Commit**

```bash
git add lib/social/plugins/youtube.ts __tests__/lib/social/youtube.test.ts
git commit -m "feat(social): YouTube plugin with multipart upload + token refresh"
```

---

### Task 5: YouTube Shorts plugin

**Files:**

- Create: `lib/social/plugins/youtube-shorts.ts`
- Create: `__tests__/lib/social/youtube-shorts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/social/youtube-shorts.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createYouTubeShortsPlugin } from "@/lib/social/plugins/youtube-shorts"

describe("YouTubeShortsPlugin", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() injects #Shorts tag + appends to description when missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "short_abc" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createYouTubeShortsPlugin({
      access_token: "tok",
      refresh_token: "r",
      client_id: "id",
      client_secret: "secret",
    })

    await plugin.publish({
      content: "Ground reaction drill\n\nShort demo of a key cue.",
      mediaUrl: "https://example.com/short.mp4",
      scheduledAt: null,
    })

    const uploadInit = fetchMock.mock.calls[1][1] as RequestInit
    const body = typeof uploadInit.body === "string" ? uploadInit.body : ""
    expect(body).toContain("#Shorts")
  })

  it("publish() does not duplicate #Shorts if already present in content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "s2" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createYouTubeShortsPlugin({
      access_token: "tok",
      refresh_token: "r",
      client_id: "id",
      client_secret: "secret",
    })
    await plugin.publish({
      content: "Drill #Shorts\n\nExplanation #Shorts",
      mediaUrl: "https://example.com/short.mp4",
      scheduledAt: null,
    })

    const uploadInit = fetchMock.mock.calls[1][1] as RequestInit
    const body = typeof uploadInit.body === "string" ? uploadInit.body : ""
    const matches = body.match(/#Shorts/g) ?? []
    expect(matches.length).toBe(2) // the two already in content, no extras injected
  })

  it("plugin.name is 'youtube_shorts'", () => {
    const plugin = createYouTubeShortsPlugin({
      access_token: "tok",
      refresh_token: "r",
      client_id: "id",
      client_secret: "secret",
    })
    expect(plugin.name).toBe("youtube_shorts")
    expect(plugin.displayName).toBe("YouTube Shorts")
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:run -- __tests__/lib/social/youtube-shorts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `lib/social/plugins/youtube-shorts.ts`**

```typescript
// lib/social/plugins/youtube-shorts.ts
// Thin wrapper over the YouTube plugin that ensures the #Shorts tag is present
// on every upload (this is what YouTube uses to classify the video as a Short).

import { createYouTubePlugin, type YouTubeCredentials } from "./youtube"
import type { PublishPlugin, PublishInput, PublishResult } from "./types"

const SHORTS_TAG = "#Shorts"

export function createYouTubeShortsPlugin(credentials: YouTubeCredentials): PublishPlugin {
  const base = createYouTubePlugin(credentials)

  return {
    ...base,
    name: "youtube_shorts",
    displayName: "YouTube Shorts",

    async publish(input: PublishInput): Promise<PublishResult> {
      const content = input.content.includes(SHORTS_TAG) ? input.content : `${input.content}\n\n${SHORTS_TAG}`
      return base.publish({ ...input, content })
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## YouTube Shorts",
        "",
        "Shorts publish through the same YouTube channel you connected above — you do not need a separate connection.",
        "To publish a Short: upload a vertical video ≤ 60 seconds. The `#Shorts` tag is added automatically to the description.",
      ].join("\n")
    },
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm run test:run -- __tests__/lib/social/youtube-shorts.test.ts`
Expected: 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add lib/social/plugins/youtube-shorts.ts __tests__/lib/social/youtube-shorts.test.ts
git commit -m "feat(social): YouTube Shorts plugin wrapping YouTube plugin with #Shorts tag"
```

---

### Task 6: TikTok hybrid plugin

**Files:**

- Create: `lib/social/plugins/tiktok.ts`
- Create: `__tests__/lib/social/tiktok.test.ts`

**Note:** TikTok publish is hybrid — the AI generates the caption, we send the coach a push notification via FCM + email via Resend with the caption on their clipboard. No direct API post. `platform_post_id` is a synthetic id so the scheduler can track delivery.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/social/tiktok.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTikTokPlugin } from "@/lib/social/plugins/tiktok"

describe("TikTokPlugin (hybrid)", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() sends push + email and returns a synthetic post id", async () => {
    const sendPushMock = vi.fn().mockResolvedValue(undefined)
    const sendEmailMock = vi.fn().mockResolvedValue(undefined)

    const plugin = createTikTokPlugin({
      user_email: "coach@example.com",
      fcm_token: "fcm_device_tok",
      sendPush: sendPushMock,
      sendEmail: sendEmailMock,
    })

    const result = await plugin.publish({
      content: "Hook caption #viral\n\nClipboard body here.",
      mediaUrl: "https://example.com/v.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toMatch(/^tiktok_pending_/)

    expect(sendPushMock).toHaveBeenCalledWith({
      token: "fcm_device_tok",
      title: expect.stringContaining("TikTok"),
      body: expect.stringContaining("ready"),
      data: expect.objectContaining({ caption: expect.any(String), mediaUrl: "https://example.com/v.mp4" }),
    })
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "coach@example.com",
        subject: expect.stringContaining("TikTok"),
      }),
    )
  })

  it("publish() still succeeds if push channel fails (email is fallback)", async () => {
    const sendPushMock = vi.fn().mockRejectedValue(new Error("FCM unreachable"))
    const sendEmailMock = vi.fn().mockResolvedValue(undefined)

    const plugin = createTikTokPlugin({
      user_email: "coach@example.com",
      fcm_token: "tok",
      sendPush: sendPushMock,
      sendEmail: sendEmailMock,
    })

    const result = await plugin.publish({
      content: "caption",
      mediaUrl: "https://example.com/v.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(sendEmailMock).toHaveBeenCalled()
  })

  it("fetchAnalytics() returns empty object (hybrid flow has no API analytics)", async () => {
    const plugin = createTikTokPlugin({
      user_email: "a",
      fcm_token: "b",
      sendPush: vi.fn(),
      sendEmail: vi.fn(),
    })
    const analytics = await plugin.fetchAnalytics("tiktok_pending_1")
    expect(analytics).toEqual({})
  })

  it("plugin.name is 'tiktok'", () => {
    const plugin = createTikTokPlugin({
      user_email: "a",
      fcm_token: "b",
      sendPush: vi.fn(),
      sendEmail: vi.fn(),
    })
    expect(plugin.name).toBe("tiktok")
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:run -- __tests__/lib/social/tiktok.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `lib/social/plugins/tiktok.ts`**

```typescript
// lib/social/plugins/tiktok.ts
// TikTok hybrid plugin. Does not post directly to the TikTok API — instead
// sends the coach a push notification + email with the caption on their
// clipboard so they can paste-and-post natively (native posts perform better
// in the TikTok algorithm than third-party-API posts).

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"

export interface TikTokHybridConfig {
  user_email: string
  fcm_token: string | null
  sendPush: (args: { token: string; title: string; body: string; data: Record<string, string> }) => Promise<void>
  sendEmail: (args: { to: string; subject: string; html: string }) => Promise<void>
}

function generatePendingId(): string {
  return `tiktok_pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function createTikTokPlugin(config: TikTokHybridConfig): PublishPlugin {
  return {
    name: "tiktok",
    displayName: "TikTok",

    async connect(): Promise<ConnectResult> {
      // No API connection — the user is the "connection".
      return { status: "connected", account_handle: config.user_email }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const pendingId = generatePendingId()
      const caption = input.content
      const mediaUrl = input.mediaUrl ?? ""

      // Attempt push (best-effort). If it fails, email is the reliable channel.
      if (config.fcm_token) {
        try {
          await config.sendPush({
            token: config.fcm_token,
            title: "TikTok post ready",
            body: "Caption copied — tap to paste in TikTok",
            data: { caption, mediaUrl, pendingId },
          })
        } catch {
          // Silent fallback to email
        }
      }

      try {
        await config.sendEmail({
          to: config.user_email,
          subject: "TikTok post ready to paste",
          html: buildEmailHtml(caption, mediaUrl),
        })
      } catch (error) {
        return {
          success: false,
          error: `Both TikTok notification channels failed: ${(error as Error).message}`,
        }
      }

      return { success: true, platform_post_id: pendingId }
    },

    async fetchAnalytics(_postId: string): Promise<AnalyticsResult> {
      // The hybrid workflow has no API path to analytics — the coach checks
      // TikTok directly. Phase 2b may add manual analytics entry.
      return {}
    },

    async disconnect() {
      // no-op
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your TikTok account (hybrid)",
        "",
        "TikTok's algorithm favors posts made natively in the TikTok app. So we don't auto-post —",
        "instead, you'll get a push notification and email with the AI-generated caption whenever it's ready.",
        "",
        "1. Install DJP Athlete on your phone so you can receive push notifications (optional but recommended).",
        "2. Keep your notification email up to date in your profile.",
        "3. When a notification arrives: tap it → caption is on your clipboard → open TikTok → record/upload → paste → post.",
        "",
        "Total time: about 30 seconds per post. The AI does all the writing.",
      ].join("\n")
    },
  }
}

function buildEmailHtml(caption: string, mediaUrl: string): string {
  return `
    <h2>TikTok post ready</h2>
    <p>The AI generated this caption for your next TikTok post.</p>
    <pre style="background:#f6f6f6;padding:12px;border-radius:8px;white-space:pre-wrap;font-family:inherit">${escapeHtml(caption)}</pre>
    ${mediaUrl ? `<p>Video: <a href="${escapeHtml(mediaUrl)}">${escapeHtml(mediaUrl)}</a></p>` : ""}
    <p><strong>Next step:</strong> Copy the caption above, open TikTok, paste, and post.</p>
  `.trim()
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  )
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm run test:run -- __tests__/lib/social/tiktok.test.ts`
Expected: 4 passing tests

- [ ] **Step 5: Commit**

```bash
git add lib/social/plugins/tiktok.ts __tests__/lib/social/tiktok.test.ts
git commit -m "feat(social): TikTok hybrid plugin (push + email, no direct post)"
```

---

### Task 7: LinkedIn plugin

**Files:**

- Create: `lib/social/plugins/linkedin.ts`
- Create: `__tests__/lib/social/linkedin.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/social/linkedin.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createLinkedInPlugin } from "@/lib/social/plugins/linkedin"

describe("LinkedInPlugin", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() POSTs a UGC post with author=urn:li:organization:{id}", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: "urn:li:share:ABC" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "A coaching insight post for the DJP audience.",
      mediaUrl: null,
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("urn:li:share:ABC")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("linkedin.com/v2/ugcPosts")
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
      "X-Restli-Protocol-Version": "2.0.0",
    })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.author).toBe("urn:li:organization:123456")
    expect(body.lifecycleState).toBe("PUBLISHED")
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareCommentary.text).toBe(
      "A coaching insight post for the DJP audience.",
    )
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory).toBe("NONE")
  })

  it("publish() uses shareMediaCategory=ARTICLE when mediaUrl looks like a web link", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: "urn:li:share:DEF" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    await plugin.publish({
      content: "Check out our new blog post",
      mediaUrl: "https://djpathlete.com/blog/new-article",
      scheduledAt: null,
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory).toBe("ARTICLE")
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].media[0].originalUrl).toBe(
      "https://djpathlete.com/blog/new-article",
    )
  })

  it("publish() returns failure text on 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: "Token expired" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "bad", organization_id: "123456" })
    const result = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null })
    expect(result.success).toBe(false)
    expect(result.error).toContain("Token expired")
  })

  it("getSetupInstructions() mentions Company Page + Marketing Developer Platform", async () => {
    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const instructions = await plugin.getSetupInstructions()
    expect(instructions).toMatch(/Company Page/i)
    expect(instructions).toMatch(/Marketing Developer Platform/i)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:run -- __tests__/lib/social/linkedin.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `lib/social/plugins/linkedin.ts`**

```typescript
// lib/social/plugins/linkedin.ts
// LinkedIn UGC Posts API for Company Pages.
// Docs: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/ugc-post-api

import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult } from "./types"

const UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts"
const URL_PATTERN = /^https?:\/\//i

export interface LinkedInCredentials {
  access_token: string
  organization_id: string
}

export function createLinkedInPlugin(credentials: LinkedInCredentials): PublishPlugin {
  const { access_token, organization_id } = credentials

  return {
    name: "linkedin",
    displayName: "LinkedIn",

    async connect(): Promise<ConnectResult> {
      const response = await fetch(`https://api.linkedin.com/v2/organizations/${organization_id}`, {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
      })
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        return { status: "error", error: extractLiError(text) }
      }
      const data = (await response.json()) as { localizedName?: string }
      return { status: "connected", account_handle: data.localizedName }
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { content, mediaUrl } = input

      const isLink = Boolean(mediaUrl && URL_PATTERN.test(mediaUrl))

      const specificContent: Record<string, unknown> = {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: content },
          shareMediaCategory: isLink ? "ARTICLE" : "NONE",
          ...(isLink ? { media: [{ status: "READY", originalUrl: mediaUrl as string }] } : {}),
        },
      }

      const body = {
        author: `urn:li:organization:${organization_id}`,
        lifecycleState: "PUBLISHED",
        specificContent,
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }

      const response = await fetch(UGC_POSTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        return { success: false, error: extractLiError(text) }
      }
      const data = (await response.json()) as { id?: string }
      if (!data.id) return { success: false, error: "LinkedIn response missing post id" }
      return { success: true, platform_post_id: data.id }
    },

    async fetchAnalytics(_postId: string): Promise<AnalyticsResult> {
      // LinkedIn social actions endpoint is v2/socialActions/{urn}?count=... — separate OAuth scope.
      // Phase 2a scope: return empty; Phase 2b will add the real lookup.
      return {}
    },

    async disconnect() {
      // no-op
    },

    async getSetupInstructions(): Promise<string> {
      return [
        "## Connect your LinkedIn Company Page",
        "",
        "LinkedIn posting requires a LinkedIn Company Page (not a personal profile) and an approved developer app.",
        "",
        "1. Create a Company Page at https://www.linkedin.com/company/setup/new (free, 20 minutes + verification).",
        "2. Apply to LinkedIn's Marketing Developer Platform for your app (free, 5–10 business days).",
        "3. Once approved, request the `w_organization_social` scope for the Page admin.",
        "4. Paste your organization id and the page access token into the Connect dialog.",
        "",
        "Phase 2a note: automated posting works once the token is present. Phase 2b adds the full OAuth flow.",
      ].join("\n")
    },
  }
}

function extractLiError(raw: string): string {
  if (!raw) return "LinkedIn publish failed"
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string }
    return parsed.message ?? parsed.error ?? raw
  } catch {
    return raw
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm run test:run -- __tests__/lib/social/linkedin.test.ts`
Expected: 4 passing tests

- [ ] **Step 5: Commit**

```bash
git add lib/social/plugins/linkedin.ts __tests__/lib/social/linkedin.test.ts
git commit -m "feat(social): LinkedIn Company Page plugin via UGC Posts API"
```

---

### Task 8: Plugin bootstrap module

**Files:**

- Create: `lib/social/bootstrap.ts`
- Create: `__tests__/lib/social/bootstrap.test.ts`

**Note:** The bootstrap module's job is to instantiate each plugin from stored credentials (pulled from `platform_connections.credentials` JSONB) and register it against the shared `pluginRegistry` singleton. If a plugin's row is `not_connected`, no plugin is instantiated for that platform — the registry simply omits it, which is fine: downstream code always checks `registry.get(name)` before publishing.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/social/bootstrap.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { pluginRegistry } from "@/lib/social/registry"
import type { PlatformConnection } from "@/types/database"

describe("bootstrapPlugins", () => {
  beforeEach(() => {
    // Clear the singleton registry between tests
    for (const name of pluginRegistry.list()) {
      // There's no unregister API; we replicate a clear by reaching into the module
      ;(pluginRegistry as unknown as { __reset?: () => void }).__reset?.()
    }
  })

  it("registers facebook plugin when connection has access_token and page_id", () => {
    const connections: PlatformConnection[] = [
      {
        id: "1",
        plugin_name: "facebook",
        status: "connected",
        credentials: { access_token: "tok", page_id: "123" },
        account_handle: null,
        last_sync_at: null,
        last_error: null,
        connected_at: null,
        connected_by: null,
        created_at: "",
        updated_at: "",
      },
    ]

    bootstrapPlugins(connections, {
      tiktokEmail: "coach@example.com",
      tiktokFcmToken: null,
      sendPush: vi.fn(),
      sendEmail: vi.fn(),
    })

    const fb = pluginRegistry.get("facebook")
    expect(fb).toBeDefined()
    expect(fb?.name).toBe("facebook")
  })

  it("skips connections that are not connected", () => {
    bootstrapPlugins(
      [
        {
          id: "1",
          plugin_name: "facebook",
          status: "not_connected",
          credentials: {},
          account_handle: null,
          last_sync_at: null,
          last_error: null,
          connected_at: null,
          connected_by: null,
          created_at: "",
          updated_at: "",
        },
      ],
      { tiktokEmail: "a@b.c", tiktokFcmToken: null, sendPush: vi.fn(), sendEmail: vi.fn() },
    )
    expect(pluginRegistry.get("facebook")).toBeUndefined()
  })

  it("registers tiktok plugin using the provided push + email senders", () => {
    bootstrapPlugins(
      [
        {
          id: "1",
          plugin_name: "tiktok",
          status: "connected",
          credentials: {},
          account_handle: "coach@example.com",
          last_sync_at: null,
          last_error: null,
          connected_at: null,
          connected_by: null,
          created_at: "",
          updated_at: "",
        },
      ],
      { tiktokEmail: "coach@example.com", tiktokFcmToken: "fcm_abc", sendPush: vi.fn(), sendEmail: vi.fn() },
    )
    const tk = pluginRegistry.get("tiktok")
    expect(tk).toBeDefined()
    expect(tk?.name).toBe("tiktok")
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:run -- __tests__/lib/social/bootstrap.test.ts`
Expected: FAIL — `bootstrapPlugins` not found + possibly `__reset` helper missing

- [ ] **Step 3: Add `__reset` to the registry for test support**

Edit `lib/social/registry.ts`. Find the singleton creation at the end and extend it. Replace:

```typescript
// Singleton registry for the Next.js app. Plugin implementations (Phase 2)
// will self-register by importing this module.
export const pluginRegistry = createPluginRegistry()
```

with:

```typescript
// Singleton registry for the Next.js app. Plugin implementations (Phase 2+)
// self-register via the bootstrap module.
export const pluginRegistry = createPluginRegistry()

// Test-only: reset the singleton between tests. NOT exported from the public
// index; consumers use the typed registry API instead.
;(pluginRegistry as unknown as { __reset: () => void }).__reset = () => {
  for (const name of pluginRegistry.list()) {
    // createPluginRegistry's underlying Map isn't directly exposed, but we can
    // use disconnect semantics: simplest is to reconstruct. Since Node's module
    // cache holds the same object, we mutate its internals.
    ;(pluginRegistry as unknown as { list(): string[] }).list = () => []
  }
}
```

Hmm, this is fragile. Simpler: expose a proper `reset()` method on the registry itself.

Rewrite the registry factory to include a `reset` method. Edit `lib/social/registry.ts` — inside `createPluginRegistry()`, add `reset` to the returned object:

```typescript
    all(): PublishPlugin[] {
      return Array.from(plugins.values())
    },

    reset(): void {
      plugins.clear()
    },
```

Also update the `PluginRegistry` interface to include `reset(): void`. Rewrite the file end to:

```typescript
export interface PluginRegistry {
  register(plugin: PublishPlugin): void
  get(name: SocialPlatform): PublishPlugin | undefined
  list(): SocialPlatform[]
  all(): PublishPlugin[]
  reset(): void
}
```

And the registry factory returns:

```typescript
return {
  register(plugin) { ... },
  get(name) { ... },
  list() { ... },
  all() { ... },
  reset() { plugins.clear() },
}
```

- [ ] **Step 4: Update the bootstrap test to use the clean reset API**

Edit the test file — replace the `beforeEach` hack with:

```typescript
beforeEach(() => {
  pluginRegistry.reset()
})
```

- [ ] **Step 5: Write `lib/social/bootstrap.ts`**

```typescript
// lib/social/bootstrap.ts
// Instantiate platform plugins from stored credentials and register them with
// the shared plugin registry. Call this once per request (or once at server
// startup) before invoking the registry to publish.

import type { PlatformConnection } from "@/types/database"
import { pluginRegistry } from "./registry"
import { createFacebookPlugin, type FacebookCredentials } from "./plugins/facebook"
import { createInstagramPlugin, type InstagramCredentials } from "./plugins/instagram"
import { createYouTubePlugin, type YouTubeCredentials } from "./plugins/youtube"
import { createYouTubeShortsPlugin } from "./plugins/youtube-shorts"
import { createTikTokPlugin, type TikTokHybridConfig } from "./plugins/tiktok"
import { createLinkedInPlugin, type LinkedInCredentials } from "./plugins/linkedin"

export interface BootstrapOptions {
  tiktokEmail: string
  tiktokFcmToken: string | null
  sendPush: TikTokHybridConfig["sendPush"]
  sendEmail: TikTokHybridConfig["sendEmail"]
}

function hasKeys(obj: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((k) => typeof obj[k] === "string" && (obj[k] as string).length > 0)
}

export function bootstrapPlugins(connections: PlatformConnection[], options: BootstrapOptions): void {
  pluginRegistry.reset()

  for (const conn of connections) {
    if (conn.status !== "connected") continue
    const creds = conn.credentials as Record<string, unknown>

    switch (conn.plugin_name) {
      case "facebook":
        if (hasKeys(creds, ["access_token", "page_id"])) {
          pluginRegistry.register(createFacebookPlugin(creds as unknown as FacebookCredentials))
        }
        break

      case "instagram":
        if (hasKeys(creds, ["access_token", "ig_user_id"])) {
          pluginRegistry.register(createInstagramPlugin(creds as unknown as InstagramCredentials))
        }
        break

      case "youtube":
        if (hasKeys(creds, ["access_token", "refresh_token", "client_id", "client_secret"])) {
          pluginRegistry.register(createYouTubePlugin(creds as unknown as YouTubeCredentials))
        }
        break

      case "youtube_shorts":
        if (hasKeys(creds, ["access_token", "refresh_token", "client_id", "client_secret"])) {
          pluginRegistry.register(createYouTubeShortsPlugin(creds as unknown as YouTubeCredentials))
        }
        break

      case "tiktok":
        pluginRegistry.register(
          createTikTokPlugin({
            user_email: options.tiktokEmail,
            fcm_token: options.tiktokFcmToken,
            sendPush: options.sendPush,
            sendEmail: options.sendEmail,
          }),
        )
        break

      case "linkedin":
        if (hasKeys(creds, ["access_token", "organization_id"])) {
          pluginRegistry.register(createLinkedInPlugin(creds as unknown as LinkedInCredentials))
        }
        break
    }
  }
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `npm run test:run -- __tests__/lib/social/bootstrap.test.ts`
Expected: 3 passing tests

- [ ] **Step 7: Commit**

```bash
git add lib/social/bootstrap.ts lib/social/registry.ts __tests__/lib/social/bootstrap.test.ts
git commit -m "feat(social): bootstrap module + registry reset for plugin instantiation from connections"
```

---

### Task 9: AssemblyAI client library

**Files:**

- Create: `functions/src/lib/assemblyai.ts`
- Create: `functions/src/lib/__tests__/assemblyai.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/lib/__tests__/assemblyai.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { submitTranscription, getTranscript } from "../assemblyai.js"

describe("assemblyai client", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.ASSEMBLYAI_API_KEY = "test-key"
  })

  it("submitTranscription POSTs to /transcript with the audio_url + webhook_url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "transcript_abc", status: "queued" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await submitTranscription({
      audio_url: "https://example.com/audio.mp3",
      webhook_url: "https://example.com/webhook",
    })

    expect(result.id).toBe("transcript_abc")
    expect(result.status).toBe("queued")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.assemblyai.com/v2/transcript")
    expect((init as RequestInit).method).toBe("POST")
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "test-key",
      "content-type": "application/json",
    })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      audio_url: "https://example.com/audio.mp3",
      webhook_url: "https://example.com/webhook",
    })
  })

  it("getTranscript GETs /transcript/{id} and returns the status + text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "transcript_xyz",
        status: "completed",
        text: "Hello athletes, today we're working on the landmine rotational press.",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await getTranscript("transcript_xyz")
    expect(result.status).toBe("completed")
    expect(result.text).toContain("landmine rotational press")

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.assemblyai.com/v2/transcript/transcript_xyz")
  })

  it("throws when ASSEMBLYAI_API_KEY is not set", async () => {
    delete process.env.ASSEMBLYAI_API_KEY
    await expect(submitTranscription({ audio_url: "x", webhook_url: "y" })).rejects.toThrow(/ASSEMBLYAI_API_KEY/)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd functions && npx vitest run src/lib/__tests__/assemblyai.test.ts && cd ..`
Expected: FAIL — module not found

- [ ] **Step 3: Write `functions/src/lib/assemblyai.ts`**

```typescript
// functions/src/lib/assemblyai.ts
// Thin wrapper over AssemblyAI's v2 transcript REST API.
// Docs: https://www.assemblyai.com/docs/api-reference/transcripts

const BASE_URL = "https://api.assemblyai.com/v2"

export interface TranscriptSubmission {
  audio_url: string
  webhook_url: string
  language_code?: string // defaults to auto-detect
  speaker_labels?: boolean
}

export interface TranscriptJob {
  id: string
  status: "queued" | "processing" | "completed" | "error"
  text?: string
  error?: string
  audio_duration?: number
  language_code?: string
}

function getApiKey(): string {
  const key = process.env.ASSEMBLYAI_API_KEY
  if (!key) {
    throw new Error("ASSEMBLYAI_API_KEY environment variable is required")
  }
  return key
}

export async function submitTranscription(input: TranscriptSubmission): Promise<TranscriptJob> {
  const response = await fetch(`${BASE_URL}/transcript`, {
    method: "POST",
    headers: {
      authorization: getApiKey(),
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`AssemblyAI submit failed (${response.status}): ${text}`)
  }
  return (await response.json()) as TranscriptJob
}

export async function getTranscript(id: string): Promise<TranscriptJob> {
  const response = await fetch(`${BASE_URL}/transcript/${id}`, {
    headers: { authorization: getApiKey() },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`AssemblyAI get failed (${response.status}): ${text}`)
  }
  return (await response.json()) as TranscriptJob
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd functions && npx vitest run src/lib/__tests__/assemblyai.test.ts && cd ..`
Expected: 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/assemblyai.ts functions/src/lib/__tests__/assemblyai.test.ts
git commit -m "feat(functions): AssemblyAI REST client (submit + poll transcripts)"
```

---

### Task 10: `transcribeVideo` Firebase Function + AssemblyAI webhook

**Files:**

- Create: `functions/src/transcribe-video.ts`
- Modify: `functions/src/index.ts` (register the new function)
- Create: `app/api/webhooks/assemblyai/route.ts`

**Note:** The flow is:

1. Next.js API route creates an `ai_jobs` Firestore doc with `type="video_transcription"`, `input={ videoUploadId }`.
2. Firebase Function `transcribeVideo` fires on doc creation. It reads the `video_uploads` row from Supabase to get `storage_path`, builds a signed URL, submits to AssemblyAI with our webhook URL, and updates the ai_job status to `processing` + stores the transcript_id.
3. AssemblyAI processes async. On completion, it POSTs to `/api/webhooks/assemblyai`.
4. Webhook route writes the transcript to Supabase `video_transcripts`, updates `video_uploads.status` to `transcribed`, updates the ai_jobs Firestore doc to `completed`.

- [ ] **Step 1: Write `functions/src/transcribe-video.ts`**

```typescript
// functions/src/transcribe-video.ts
// Firebase Function handler: submits a video from Supabase Storage to
// AssemblyAI for transcription. Called when an ai_jobs doc is created with
// type="video_transcription". Uses the existing onDocumentCreated pattern.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getSupabase } from "./lib/supabase.js"
import { submitTranscription } from "./lib/assemblyai.js"

export async function handleVideoTranscription(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) {
      await failJob("ai_jobs doc disappeared")
      return
    }
    const videoUploadId = (data.input as { videoUploadId?: string })?.videoUploadId
    if (!videoUploadId) {
      await failJob("input.videoUploadId is required")
      return
    }

    // Mark job processing
    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    // Look up video upload row + sign a URL to its storage path
    const { data: upload, error } = await supabase
      .from("video_uploads")
      .select("id, storage_path")
      .eq("id", videoUploadId)
      .single()

    if (error || !upload) {
      await failJob(`video_uploads row ${videoUploadId} not found`)
      return
    }

    const { data: signed, error: signError } = await supabase.storage
      .from("video-uploads")
      .createSignedUrl(upload.storage_path, 60 * 60 * 4) // 4 hours

    if (signError || !signed?.signedUrl) {
      await failJob(`Could not sign URL for ${upload.storage_path}: ${signError?.message ?? "unknown"}`)
      return
    }

    const webhookBase = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL
    if (!webhookBase) {
      await failJob("APP_URL/NEXT_PUBLIC_APP_URL env not set — cannot build webhook URL")
      return
    }
    const webhookUrl = `${webhookBase.replace(/\/$/, "")}/api/webhooks/assemblyai?ai_job_id=${jobId}`

    const transcript = await submitTranscription({
      audio_url: signed.signedUrl,
      webhook_url: webhookUrl,
    })

    // Move video_uploads to transcribing + link to the AssemblyAI job
    await supabase.from("video_uploads").update({ status: "transcribing" }).eq("id", upload.id)

    // Stash the transcript id on the ai_job so the webhook can match
    await jobRef.update({
      assemblyaiTranscriptId: transcript.id,
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown transcription error")
  }
}
```

- [ ] **Step 2: Register the function in `functions/src/index.ts`**

Read the existing file and add two things:

(1) A new secret definition near the existing ones:

```typescript
const assemblyAiApiKey = defineSecret("ASSEMBLYAI_API_KEY")
const appUrl = defineSecret("APP_URL")
```

(2) A new export after `newsletterSend` (or at the bottom of the dispatch switch section):

```typescript
// ─── Video Transcription ──────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "video_transcription"

export const transcribeVideo = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "512MiB",
    region: "us-central1",
    secrets: [supabaseUrl, supabaseServiceRoleKey, assemblyAiApiKey, appUrl],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "video_transcription") return

    const { handleVideoTranscription } = await import("./transcribe-video.js")
    await handleVideoTranscription(event.params.jobId)
  },
)
```

- [ ] **Step 3: Write the Next.js webhook route**

```typescript
// app/api/webhooks/assemblyai/route.ts
// AssemblyAI POSTs here when a transcript is completed. We verify the caller
// by the ai_job_id query param + the transcript id in the body, fetch the
// final transcript via the AssemblyAI REST API (webhook payload only includes
// status + id), write it to Supabase, and mark the ai_job done.

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { createServiceRoleClient } from "@/lib/supabase"

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2"

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const aiJobId = searchParams.get("ai_job_id")
  if (!aiJobId) {
    return NextResponse.json({ error: "Missing ai_job_id" }, { status: 400 })
  }

  const payload = (await request.json().catch(() => null)) as { transcript_id?: string; status?: string } | null
  const transcriptId = payload?.transcript_id
  const status = payload?.status

  if (!transcriptId || !status) {
    return NextResponse.json({ error: "Missing transcript_id or status" }, { status: 400 })
  }

  const firestore = getAdminFirestore()
  const jobRef = firestore.collection("ai_jobs").doc(aiJobId)
  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) {
    return NextResponse.json({ error: "Unknown ai_job" }, { status: 404 })
  }
  const job = jobSnap.data()!

  // Defensive: the webhook should match the transcript id we stored earlier
  if (job.assemblyaiTranscriptId && job.assemblyaiTranscriptId !== transcriptId) {
    return NextResponse.json({ error: "Transcript id mismatch" }, { status: 409 })
  }

  if (status === "error") {
    await jobRef.update({
      status: "failed",
      error: "AssemblyAI reported error status",
      updatedAt: new Date(),
    })
    return NextResponse.json({ ok: true })
  }

  if (status !== "completed") {
    // "queued" or "processing" interim updates — acknowledge and move on
    return NextResponse.json({ ok: true })
  }

  // Fetch the full transcript from AssemblyAI (webhook only includes id + status)
  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ASSEMBLYAI_API_KEY not configured" }, { status: 500 })
  }

  const response = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
    headers: { authorization: apiKey },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    await jobRef.update({
      status: "failed",
      error: `AssemblyAI fetch failed: ${text}`,
      updatedAt: new Date(),
    })
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 })
  }
  const transcript = (await response.json()) as {
    id: string
    text: string
    language_code?: string
    status: string
  }

  const videoUploadId = (job.input as { videoUploadId?: string })?.videoUploadId
  if (!videoUploadId) {
    await jobRef.update({
      status: "failed",
      error: "ai_job missing videoUploadId",
      updatedAt: new Date(),
    })
    return NextResponse.json({ error: "Missing videoUploadId" }, { status: 400 })
  }

  const supabase = createServiceRoleClient()
  await supabase.from("video_transcripts").insert({
    video_upload_id: videoUploadId,
    transcript_text: transcript.text,
    language: transcript.language_code ?? "en",
    assemblyai_job_id: transcript.id,
    analysis: null,
  })
  await supabase.from("video_uploads").update({ status: "transcribed" }).eq("id", videoUploadId)

  await jobRef.update({
    status: "completed",
    result: { videoUploadId, transcriptId: transcript.id },
    updatedAt: new Date(),
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Build functions to confirm no type errors**

Run: `cd functions && npm run build && cd ..`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add functions/src/transcribe-video.ts functions/src/index.ts app/api/webhooks/assemblyai/route.ts
git commit -m "feat(video): transcribeVideo Firebase Function + AssemblyAI webhook"
```

---

### Task 11: Tavily client library

**Files:**

- Create: `functions/src/lib/tavily.ts`
- Create: `functions/src/lib/__tests__/tavily.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// functions/src/lib/__tests__/tavily.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { tavilySearch, tavilyExtract } from "../tavily.js"

describe("tavily client", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.TAVILY_API_KEY = "test-key"
  })

  it("tavilySearch POSTs to /search with query + api_key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        query: "rotational training",
        results: [{ title: "x", url: "https://x", content: "c", score: 0.9 }],
        answer: "summary",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await tavilySearch({ query: "rotational training", max_results: 3 })

    expect(result.results.length).toBe(1)
    expect(result.answer).toBe("summary")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.tavily.com/search")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      api_key: "test-key",
      query: "rotational training",
      max_results: 3,
    })
  })

  it("tavilyExtract POSTs to /extract with urls list", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ url: "https://a", raw_content: "body text" }],
        failed_results: [],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await tavilyExtract({ urls: ["https://a"] })
    expect(result.results.length).toBe(1)
    expect(result.results[0].raw_content).toBe("body text")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.tavily.com/extract")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.urls).toEqual(["https://a"])
    expect(body.api_key).toBe("test-key")
  })

  it("throws when TAVILY_API_KEY is not set", async () => {
    delete process.env.TAVILY_API_KEY
    await expect(tavilySearch({ query: "x" })).rejects.toThrow(/TAVILY_API_KEY/)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd functions && npx vitest run src/lib/__tests__/tavily.test.ts && cd ..`
Expected: FAIL — module not found

- [ ] **Step 3: Write `functions/src/lib/tavily.ts`**

```typescript
// functions/src/lib/tavily.ts
// Tavily client for live-web research: search + extract.
// Docs: https://docs.tavily.com/

const SEARCH_URL = "https://api.tavily.com/search"
const EXTRACT_URL = "https://api.tavily.com/extract"

export interface TavilySearchInput {
  query: string
  search_depth?: "basic" | "advanced"
  include_answer?: boolean
  include_raw_content?: boolean
  max_results?: number
  include_domains?: string[]
  exclude_domains?: string[]
}

export interface TavilySearchResult {
  query: string
  answer?: string
  results: Array<{
    title: string
    url: string
    content: string
    score: number
    published_date?: string
  }>
}

export interface TavilyExtractInput {
  urls: string[]
  include_images?: boolean
}

export interface TavilyExtractResult {
  results: Array<{ url: string; raw_content: string }>
  failed_results: Array<{ url: string; error: string }>
}

function getApiKey(): string {
  const key = process.env.TAVILY_API_KEY
  if (!key) {
    throw new Error("TAVILY_API_KEY environment variable is required")
  }
  return key
}

export async function tavilySearch(input: TavilySearchInput): Promise<TavilySearchResult> {
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: getApiKey(),
      query: input.query,
      search_depth: input.search_depth ?? "basic",
      include_answer: input.include_answer ?? true,
      include_raw_content: input.include_raw_content ?? false,
      max_results: input.max_results ?? 5,
      include_domains: input.include_domains,
      exclude_domains: input.exclude_domains,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Tavily search failed (${response.status}): ${text}`)
  }
  return (await response.json()) as TavilySearchResult
}

export async function tavilyExtract(input: TavilyExtractInput): Promise<TavilyExtractResult> {
  const response = await fetch(EXTRACT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: getApiKey(),
      urls: input.urls,
      include_images: input.include_images ?? false,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Tavily extract failed (${response.status}): ${text}`)
  }
  return (await response.json()) as TavilyExtractResult
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd functions && npx vitest run src/lib/__tests__/tavily.test.ts && cd ..`
Expected: 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/tavily.ts functions/src/lib/__tests__/tavily.test.ts
git commit -m "feat(functions): Tavily client (search + extract)"
```

---

### Task 12: `tavilyResearch` Firebase Function

**Files:**

- Create: `functions/src/tavily-research.ts`
- Modify: `functions/src/index.ts` (register)

- [ ] **Step 1: Write `functions/src/tavily-research.ts`**

```typescript
// functions/src/tavily-research.ts
// Firebase Function: runs Tavily search for a topic, optionally extracts full
// content from the top N results, and writes a research brief to the ai_jobs
// doc so the caller (typically a blog generation flow) can consume it.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { tavilySearch, tavilyExtract } from "./lib/tavily.js"

export interface TavilyResearchInput {
  topic: string
  extract_top_n?: number
  search_depth?: "basic" | "advanced"
}

export async function handleTavilyResearch(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) return failJob("ai_jobs doc disappeared")

    const input = data.input as TavilyResearchInput
    if (!input?.topic) return failJob("input.topic is required")

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const search = await tavilySearch({
      query: input.topic,
      search_depth: input.search_depth ?? "basic",
      include_answer: true,
      max_results: 10,
    })

    let extractedContent: Array<{ url: string; content: string }> = []
    const topN = input.extract_top_n ?? 3
    if (topN > 0 && search.results.length > 0) {
      const urls = search.results.slice(0, topN).map((r) => r.url)
      const extract = await tavilyExtract({ urls })
      extractedContent = extract.results.map((r) => ({ url: r.url, content: r.raw_content }))
    }

    await jobRef.update({
      status: "completed",
      result: {
        topic: input.topic,
        summary: search.answer ?? null,
        results: search.results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
          score: r.score,
          published_date: r.published_date ?? null,
        })),
        extracted: extractedContent,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown tavily research error")
  }
}
```

- [ ] **Step 2: Register in `functions/src/index.ts`**

Add after `transcribeVideo`:

```typescript
// ─── Tavily Research ──────────────────────────────────────────────────────────
// Triggered when a new ai_jobs doc is created with type "tavily_research"

const tavilyApiKey = defineSecret("TAVILY_API_KEY")

export const tavilyResearch = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    secrets: [tavilyApiKey],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "tavily_research") return

    const { handleTavilyResearch } = await import("./tavily-research.js")
    await handleTavilyResearch(event.params.jobId)
  },
)
```

- [ ] **Step 3: Build functions**

Run: `cd functions && npm run build && cd ..`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add functions/src/tavily-research.ts functions/src/index.ts
git commit -m "feat(functions): tavilyResearch Firebase Function (ai_jobs Firestore trigger)"
```

---

### Task 13: Next.js API routes to trigger both pipelines

**Files:**

- Create: `app/api/admin/videos/transcribe/route.ts`
- Create: `app/api/admin/content/research/route.ts`

- [ ] **Step 1: Write `app/api/admin/videos/transcribe/route.ts`**

```typescript
// app/api/admin/videos/transcribe/route.ts
// POST { videoUploadId } — triggers video transcription via a Firebase Function.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { getVideoUploadById } from "@/lib/db/video-uploads"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { videoUploadId?: string } | null
  const videoUploadId = body?.videoUploadId
  if (!videoUploadId) {
    return NextResponse.json({ error: "videoUploadId is required" }, { status: 400 })
  }

  const upload = await getVideoUploadById(videoUploadId)
  if (!upload) {
    return NextResponse.json({ error: "Video upload not found" }, { status: 404 })
  }

  const { jobId, status } = await createAiJob({
    type: "video_transcription",
    userId: session.user.id,
    input: { videoUploadId },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
```

- [ ] **Step 2: Write `app/api/admin/content/research/route.ts`**

```typescript
// app/api/admin/content/research/route.ts
// POST { topic, extractTopN?, searchDepth? } — triggers Tavily research.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    topic?: string
    extractTopN?: number
    searchDepth?: "basic" | "advanced"
  } | null
  const topic = body?.topic?.trim()
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 })
  }

  const { jobId, status } = await createAiJob({
    type: "tavily_research",
    userId: session.user.id,
    input: {
      topic,
      extract_top_n: body?.extractTopN ?? 3,
      search_depth: body?.searchDepth ?? "basic",
    },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "videos/transcribe|content/research" | head -10`
Expected: No errors related to the new files.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/videos/transcribe/route.ts app/api/admin/content/research/route.ts
git commit -m "feat(api): admin routes to trigger video transcription + Tavily research"
```

---

## Post-Phase-2a Verification

- [ ] **Run full vitest suite**

Run: `npm run test:run`
Expected: All Phase 2a tests pass (plugins + bootstrap). Pre-existing failures (shop tests, etc.) should be unchanged.

- [ ] **Run Firebase Functions test suite**

Run: `cd functions && npm test && cd ..`
Expected: AssemblyAI + Tavily client tests pass.

- [ ] **Build check**

Run: `npm run build`
Expected: Clean Next.js build.

Run: `cd functions && npm run build && cd ..`
Expected: Clean Firebase Functions build.

- [ ] **Push & confirm Vercel preview builds**

Run: `git push`
Then check Vercel dashboard for green Preview deployment.

---

## What Phase 2a Unblocks

- **Phase 2b (OAuth connect flows):** all plugins are ready to receive real credentials; the Connect button in the Platform Connections page just needs to wire up each platform's OAuth flow and persist credentials into `platform_connections.credentials`.
- **Phase 3 (social fanout):** once plugins exist, the `generateSocialFanout` Firebase Function (added in Phase 3) can use `pluginRegistry.get(name).publish(...)` to post.
- **Phase 4 (blog-from-video):** the full video → transcript pipeline is now complete. Blog generation can consume `video_transcripts` rows directly.
- **Phase 4 (Tavily research in blog flow):** `tavilyResearch` Firebase Function is available; the blog generation flow can `createAiJob({ type: "tavily_research", ... })` as part of a multi-step generation.

---

## Self-Review Notes

**1. Spec coverage:**

- ✅ 6 platform plugins (facebook, instagram, youtube, youtube_shorts, tiktok, linkedin) — Tasks 2-7
- ✅ Plugin bootstrap + registry integration — Task 8
- ✅ AssemblyAI pipeline (client + Firebase Function + webhook) — Tasks 9, 10
- ✅ Tavily pipeline (client + Firebase Function) — Tasks 11, 12
- ✅ Next.js API routes to trigger — Task 13
- ⏸ OAuth connect flows — deferred to Phase 2b (intentional)
- ⏸ Platform Connections Connect button enablement — deferred to Phase 2b (intentional)

**2. Placeholder scan:** no TBD/TODO placeholders; every task has complete code.

**3. Type consistency:** plugins all use `PublishPlugin` from Phase 1 `lib/social/plugins/types.ts`. `createAiJob` signature matches `lib/ai-jobs.ts`. Webhook route uses Firebase Admin + Supabase service-role patterns from existing code.

**4. Test coverage:** Every plugin has a unit test suite with at least 3 meaningful cases (success, error, edge case). Bootstrap has 3 tests. AssemblyAI + Tavily clients each have 3 tests including missing-key behavior.

**5. Security:** API routes check `session.user.role === "admin"`. Webhook route validates `ai_job_id` and cross-checks `transcriptId` to prevent replay / impersonation. No platform secrets land in client bundles.

**6. Dev experience:** all tasks include explicit TDD flow (write test → run fail → implement → run pass → commit). Commands are copy-pasteable. Commit messages follow existing project convention.
