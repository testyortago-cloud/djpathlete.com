# Instagram Video Publishing + Video Carousel Slides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instagram videos (Reels, video Stories, video carousel slides) publish only after Instagram finishes processing them, across 5-minute cron ticks; and carousels in the manual post box accept video slides for Instagram.

**Architecture:** The Instagram plugin returns a third outcome, `pending`, carrying plugin-owned JSON; the publish runner saves it on a new `social_posts.platform_publish_state` column, keeps the post `scheduled`, and hands the state back on the next tick until Instagram reports `FINISHED` (or 30 minutes pass). Carousel slides gain a `kind`, uploaded through the existing media-asset route, and flow to Instagram as `media_type=VIDEO` children.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (migrations in `supabase/migrations`), Vitest (+ jsdom for components), Instagram Graph API v22.0.

**Spec:** `docs/superpowers/specs/2026-09-30-instagram-video-publishing-design.md`

## Global Constraints

- Node 24 for every test run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run <files>` (Node 20 cannot load jsdom; `nvm use` is refused in the worktree session).
- Run ONLY the named test files per task. Never a folder, never the full suite.
- Timeout for a processing video: **30 minutes** from the first `pending`. Failure text: `Instagram is still processing the video after 30 minutes.` (built as `${plugin.displayName} is still processing the video after 30 minutes.`).
- Accepted carousel video types: `video/mp4` (`.mp4`) and `video/quicktime` (`.mov`). Video slides only for `instagram`.
- A mid-publish post keeps `approval_status = 'scheduled'`. No new status value, no CHECK change.
- Photo-only paths (single photo, photo carousel, photo Story) must send exactly the same Graph API calls as today.
- Commits: conventional style, no `Co-Authored-By` or any Claude attribution line. Never commit `JOURNAL.md`.
- Never `git stash`. Never push.

## Review Focus

1. A carousel with a video and Facebook/LinkedIn ticked: those platforms are skipped in the box AND refused by the route (Task 5, Task 6).
2. Instagram answers `ERROR`/`EXPIRED` for a processing video: the post fails with Instagram's status text and the saved state is cleared, so a retry starts fresh (Task 2, Task 3).
3. A post rescheduled or sent with "Publish now" while its video is processing: the old saved state belongs to the old `scheduled_at` and must be discarded, not resumed (Task 3).
4. Photo-only regressions: every existing Instagram carousel/story/photo test passes unchanged (Task 2).
5. A video slide chosen from the Library button (photos only) or a `.webm`/`.mkv` file: refused with a plain message, never uploaded as a slide (Task 4, Task 5).

---

### Task 1: Migration + types for the pending state

**Files:**
- Create: `supabase/migrations/00284_social_posts_platform_publish_state.sql`
- Modify: `types/database.ts` (interface `SocialPost`, ~line 1765)
- Modify: `lib/social/plugins/types.ts` (`PublishInput`, `PublishResult`)

**Interfaces:**
- Produces: `PendingPublish { startedAt: string; data: Record<string, unknown> }`; `PublishResult.pending?: PendingPublish`; `PublishInput.resumeState?: PendingPublish`; `PublishInput.mediaKinds?: Array<"image" | "video">`; `SocialPost.platform_publish_state?: Record<string, unknown> | null`.

- [ ] **Step 1: Write the migration**

```sql
-- 00284_social_posts_platform_publish_state.sql
-- A post whose platform is still processing its media (Instagram video containers
-- are asynchronous). Reader and writer: lib/social/publish-runner.ts. NULL for every
-- post that is not mid-publish. Shape is owned by the platform plugin:
--   { "startedAt": ISO, "scheduledFor": ISO, "data": { ... } }
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS platform_publish_state jsonb;

COMMENT ON COLUMN social_posts.platform_publish_state IS
  'Plugin-owned state for a publish waiting on the platform (e.g. Instagram processing a video). Cleared on publish or failure.';
```

- [ ] **Step 2: Add the types**

In `lib/social/plugins/types.ts`, after `PublishLink`:

```ts
/**
 * A publish that is waiting on the platform (e.g. Instagram processing a video
 * container). Returned by a plugin as `PublishResult.pending`, saved by the
 * publish runner, and handed back as `PublishInput.resumeState` on a later tick.
 */
export interface PendingPublish {
  /** ISO time the wait began. The runner gives up 30 minutes after it. */
  startedAt: string
  /** Opaque to the runner: only the plugin that wrote it reads it. */
  data: Record<string, unknown>
}
```

In `PublishInput` add:

```ts
  /**
   * Parallel to mediaUrls: what each slide is. Filled by the publish runner from
   * the media_assets rows, so plugins never guess from a file name.
   */
  mediaKinds?: Array<"image" | "video">
  /** Saved state from an earlier `pending` answer for this post. */
  resumeState?: PendingPublish
```

In `PublishResult` add:

```ts
  /** success=true + pending: the platform is still processing; publish later. */
  pending?: PendingPublish
```

In `types/database.ts`, interface `SocialPost`, after `link_image_url`:

```ts
  /** 00284. Plugin-owned JSON while the platform processes media; null otherwise. Optional: DB-defaulted. */
  platform_publish_state?: Record<string, unknown> | null
```

- [ ] **Step 3: Type-check the two files compile**

Run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json > /private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/1e068053-a6bf-48c7-a5cc-706a95d1c37d/scratchpad/tsc-t1.txt; grep -c "error TS" /private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/1e068053-a6bf-48c7-a5cc-706a95d1c37d/scratchpad/tsc-t1.txt`
Expected: 236 (this worktree's baseline), and `grep -E "plugins/types|types/database"` on the file finds nothing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00284_social_posts_platform_publish_state.sql types/database.ts lib/social/plugins/types.ts
git commit -m "feat(social): platform_publish_state for a publish waiting on the platform"
```

(Applying 00284 to the dev clone is done by the controller, not this task.)

---

### Task 2: Instagram plugin returns `pending` and resumes

**Files:**
- Modify: `lib/social/plugins/instagram.ts`
- Create: `__tests__/lib/social/instagram-video-processing.test.ts`
- Modify: `__tests__/lib/social/instagram.test.ts` (the REELS test only — it gains a status check)

**Interfaces:**
- Consumes: `PendingPublish`, `PublishInput.resumeState`, `PublishInput.mediaKinds` (Task 1).
- Produces: `createInstagramPlugin(credentials, deps?: { sleep?: (ms: number) => Promise<void>; now?: () => Date })`. `pending.data` is one of `{ step: "publish", containerId: string }` or `{ step: "children", childIds: string[], caption: string }`.

Behaviour:
- `waitBriefly(ids)`: the existing poll (5 attempts, 500ms doubling, via `deps.sleep`) over ALL ids; returns `{ state: "finished" } | { state: "in_progress" } | { state: "error"; error: string }`. Exhausting attempts = `in_progress` (was an error).
- `checkOnce(ids)`: one GET per id, no sleep, same union.
- Single post: photo → unchanged (create, publish). Video (`isVideoUrl`) → create REELS container, `waitBriefly([id])`: finished → publish; in_progress → `pending { step: "publish", containerId }`; error → failure.
- Story: create container, `waitBriefly`: finished → publish; in_progress → pending publish; error → failure.
- Carousel: child i is `{ media_type: "VIDEO", video_url, is_carousel_item: true }` when `mediaKinds?.[i] === "video"`, else `{ image_url, is_carousel_item: true }` (unchanged). `waitBriefly(children)`: finished → create parent; in_progress → `pending { step: "children", childIds, caption }`; error → failure. After creating the parent: if any child is a video, `waitBriefly([parent])` (finished → publish; in_progress → pending publish); photo-only → publish immediately (unchanged).
- Resume (`input.resumeState` set): `checkOnce` the waited ids. `step: "publish"`: finished → `media_publish(containerId)`. `step: "children"`: finished → create parent then as above. in_progress → same `pending` object (same `startedAt`). error → failure. Any new `pending` after a resume keeps the resumed `startedAt`.
- Error text: `Instagram could not process the media (${code}${status ? ": " + status : ""})` where `status` is the container's `status` field.

- [ ] **Step 1: Write the failing tests**

`__tests__/lib/social/instagram-video-processing.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createInstagramPlugin } from "@/lib/social/plugins/instagram"

const IG = "https://graph.facebook.com/v22.0"
const NOW = new Date("2026-10-01T10:00:00.000Z")

function jsonResp(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

function mockFetchSequence(responses: Array<() => Response>) {
  let i = 0
  const fetchMock = vi.fn().mockImplementation(async () => {
    if (i >= responses.length) throw new Error("fetch called more times than mocked")
    return responses[i++]()
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const inProgress = () => jsonResp({ status_code: "IN_PROGRESS" })
const finished = () => jsonResp({ status_code: "FINISHED" })
const plugin = () =>
  createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-1" }, { sleep: async () => {}, now: () => NOW })
const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)

describe("Instagram plugin — video processing", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("a Reel still processing answers pending instead of publishing", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "reel-c" }),
      inProgress, inProgress, inProgress, inProgress, inProgress,
    ])
    const result = await plugin().publish({ content: "cap", mediaUrl: "https://s.example/r.mp4?sig=1", scheduledAt: null })
    expect(result).toEqual({
      success: true,
      pending: { startedAt: NOW.toISOString(), data: { step: "publish", containerId: "reel-c" } },
    })
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/media_publish"))).toBe(false)
  })

  it("a Reel that finishes within the short window publishes in the same run", async () => {
    const fetchMock = mockFetchSequence([() => jsonResp({ id: "reel-c" }), inProgress, finished, () => jsonResp({ id: "ig-1-media" })])
    const result = await plugin().publish({ content: "cap", mediaUrl: "https://s.example/r.mp4", scheduledAt: null })
    expect(result).toEqual({ success: true, platform_post_id: "ig-1-media" })
    expect(body(fetchMock.mock.calls[3])).toEqual({ creation_id: "reel-c", access_token: "tok" })
  })

  it("resuming a finished container publishes it with one status check", async () => {
    const fetchMock = mockFetchSequence([finished, () => jsonResp({ id: "ig-2-media" })])
    const result = await plugin().publish({
      content: "cap",
      mediaUrl: "https://s.example/r.mp4",
      scheduledAt: null,
      resumeState: { startedAt: "2026-10-01T09:50:00.000Z", data: { step: "publish", containerId: "reel-c" } },
    })
    expect(result).toEqual({ success: true, platform_post_id: "ig-2-media" })
    expect(String(fetchMock.mock.calls[0][0])).toContain(`${IG}/reel-c?fields=status_code`)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("resuming a container still processing keeps the original start time", async () => {
    mockFetchSequence([inProgress])
    const saved = { startedAt: "2026-10-01T09:50:00.000Z", data: { step: "publish", containerId: "reel-c" } }
    const result = await plugin().publish({ content: "c", mediaUrl: "https://s.example/r.mp4", scheduledAt: null, resumeState: saved })
    expect(result).toEqual({ success: true, pending: saved })
  })

  it("resuming a container Instagram rejected fails with Instagram's reason", async () => {
    mockFetchSequence([() => jsonResp({ status_code: "ERROR", status: "Error: unsupported codec" })])
    const result = await plugin().publish({
      content: "c",
      mediaUrl: "https://s.example/r.mp4",
      scheduledAt: null,
      resumeState: { startedAt: NOW.toISOString(), data: { step: "publish", containerId: "reel-c" } },
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe("Instagram could not process the media (ERROR: Error: unsupported codec)")
  })

  it("a video Story still processing answers pending", async () => {
    mockFetchSequence([() => jsonResp({ id: "story-c" }), inProgress, inProgress, inProgress, inProgress, inProgress])
    const result = await plugin().publish({ content: "", mediaUrl: "https://s.example/s.mp4", postType: "story", scheduledAt: null })
    expect(result.pending?.data).toEqual({ step: "publish", containerId: "story-c" })
  })

  it("a mixed carousel sends the video slide as a VIDEO child and waits on it", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "c1" }),
      () => jsonResp({ id: "c2" }),
      finished, inProgress, // round 1: c1 done, c2 processing
      finished, inProgress,
      finished, inProgress,
      finished, inProgress,
      finished, inProgress,
    ])
    const result = await plugin().publish({
      content: "Swipe",
      mediaUrl: "https://s.example/a.jpg",
      mediaUrls: ["https://s.example/a.jpg", "https://s.example/b.mp4?sig=2"],
      mediaKinds: ["image", "video"],
      postType: "carousel",
      scheduledAt: null,
    })
    expect(body(fetchMock.mock.calls[0])).toMatchObject({ image_url: "https://s.example/a.jpg", is_carousel_item: true })
    expect(body(fetchMock.mock.calls[0]).media_type).toBeUndefined()
    expect(body(fetchMock.mock.calls[1])).toMatchObject({
      media_type: "VIDEO",
      video_url: "https://s.example/b.mp4?sig=2",
      is_carousel_item: true,
    })
    expect(body(fetchMock.mock.calls[1]).image_url).toBeUndefined()
    expect(result).toEqual({
      success: true,
      pending: { startedAt: NOW.toISOString(), data: { step: "children", childIds: ["c1", "c2"], caption: "Swipe" } },
    })
  })

  it("resuming finished carousel children creates the parent, waits on it, then publishes", async () => {
    const fetchMock = mockFetchSequence([
      finished, finished, // children check
      () => jsonResp({ id: "parent" }),
      finished, // parent (has a video child)
      () => jsonResp({ id: "ig-car" }),
    ])
    const result = await plugin().publish({
      content: "Swipe",
      mediaUrl: null,
      scheduledAt: null,
      postType: "carousel",
      resumeState: { startedAt: NOW.toISOString(), data: { step: "children", childIds: ["c1", "c2"], caption: "Swipe" } },
    })
    expect(result).toEqual({ success: true, platform_post_id: "ig-car" })
    expect(body(fetchMock.mock.calls[2])).toMatchObject({ media_type: "CAROUSEL", children: "c1,c2", caption: "Swipe" })
  })
})
```

In `__tests__/lib/social/instagram.test.ts`, retarget the test `publish() uses video_url + media_type=REELS when mediaUrl is a video`: its fetch mock must now answer a `{ status_code: "FINISHED" }` status GET between the container create and `media_publish`, and assert the second call's URL contains `?fields=status_code`. Keep its existing assertions on `video_url` and `media_type: "REELS"`. Pass `{ sleep: async () => {} }` as the plugin's second argument.

- [ ] **Step 2: Run to verify failure**

Run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run __tests__/lib/social/instagram-video-processing.test.ts __tests__/lib/social/instagram.test.ts`
Expected: the new file's tests FAIL (Reel publishes immediately; no `pending`; carousel child has `image_url`), and the retargeted REELS test FAILS (no status GET today).

- [ ] **Step 3: Implement**

Rework `lib/social/plugins/instagram.ts`:

```ts
import type { PublishPlugin, PublishInput, PublishResult, AnalyticsResult, ConnectResult, PendingPublish } from "./types"

export interface InstagramDeps {
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
}

type ContainerState = { state: "finished" } | { state: "in_progress" } | { state: "error"; error: string }

type IgPending =
  | { step: "publish"; containerId: string }
  | { step: "children"; childIds: string[]; caption: string }

function readIgPending(data: Record<string, unknown>): IgPending | null {
  if (data.step === "publish" && typeof data.containerId === "string") {
    return { step: "publish", containerId: data.containerId }
  }
  if (
    data.step === "children" &&
    Array.isArray(data.childIds) &&
    data.childIds.every((id) => typeof id === "string") &&
    typeof data.caption === "string"
  ) {
    return { step: "children", childIds: data.childIds as string[], caption: data.caption }
  }
  return null
}
```

Inside `createInstagramPlugin(credentials, deps: InstagramDeps = {})` define `const sleep = deps.sleep ?? defaultSleep; const now = deps.now ?? (() => new Date())` and closures:

```ts
    async function statusOf(containerId: string): Promise<ContainerState> {
      const response = await fetchJson<{ status_code?: string; status?: string }>(
        `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(access_token)}`,
        { method: "GET" },
      )
      if (!response.ok) return { state: "in_progress" } // a failed status read is retried next tick
      const code = response.data?.status_code
      if (code === "FINISHED") return { state: "finished" }
      if (code === "ERROR" || code === "EXPIRED") {
        const status = response.data?.status
        return { state: "error", error: `Instagram could not process the media (${code}${status ? `: ${status}` : ""})` }
      }
      return { state: "in_progress" }
    }

    async function checkOnce(ids: string[]): Promise<ContainerState> {
      let pending = false
      for (const id of ids) {
        const s = await statusOf(id)
        if (s.state === "error") return s
        if (s.state === "in_progress") pending = true
      }
      return pending ? { state: "in_progress" } : { state: "finished" }
    }

    async function waitBriefly(ids: string[]): Promise<ContainerState> {
      let delay = CAROUSEL_POLL_INITIAL_DELAY_MS
      for (let attempt = 0; attempt < CAROUSEL_POLL_MAX_ATTEMPTS; attempt += 1) {
        const s = await checkOnce(ids)
        if (s.state !== "in_progress") return s
        if (attempt < CAROUSEL_POLL_MAX_ATTEMPTS - 1) {
          await sleep(delay)
          delay *= 2
        }
      }
      return { state: "in_progress" }
    }

    function pendingResult(data: IgPending, startedAt: string): PublishResult {
      return { success: true, pending: { startedAt, data: data as unknown as Record<string, unknown> } }
    }

    async function publishContainer(creationId: string): Promise<PublishResult> {
      const res = await fetchJson<{ id?: string }>(`${GRAPH_API_BASE}/${ig_user_id}/media_publish`, {
        method: "POST",
        body: { creation_id: creationId, access_token },
      })
      if (!res.ok || !res.data?.id) return { success: false, error: extractIgError(res.errorText) }
      return { success: true, platform_post_id: res.data.id }
    }

    /** Waits (briefly) on one container, then publishes it or answers pending. */
    async function finishSingle(containerId: string, startedAt: string, wait: (ids: string[]) => Promise<ContainerState>) {
      const s = await wait([containerId])
      if (s.state === "error") return { success: false, error: s.error }
      if (s.state === "in_progress") return pendingResult({ step: "publish", containerId }, startedAt)
      return publishContainer(containerId)
    }

    async function createParent(childIds: string[], caption: string, hasVideo: boolean, startedAt: string) {
      const parent = await fetchJson<{ id?: string }>(`${GRAPH_API_BASE}/${ig_user_id}/media`, {
        method: "POST",
        body: { media_type: "CAROUSEL", children: childIds.join(","), caption, access_token },
      })
      if (!parent.ok || !parent.data?.id) return { success: false, error: extractIgError(parent.errorText) }
      if (!hasVideo) return publishContainer(parent.data.id) // photo-only: unchanged from before
      return finishSingle(parent.data.id, startedAt, waitBriefly)
    }

    async function resume(saved: PendingPublish): Promise<PublishResult> {
      const state = readIgPending(saved.data)
      if (!state) return { success: false, error: "Saved Instagram publish state is unreadable — schedule the post again." }
      if (state.step === "publish") return finishSingle(state.containerId, saved.startedAt, checkOnce)
      const s = await checkOnce(state.childIds)
      if (s.state === "error") return { success: false, error: s.error }
      if (s.state === "in_progress") return { success: true, pending: saved }
      return createParent(state.childIds, state.caption, true, saved.startedAt)
    }
```

Note `finishSingle(..., checkOnce)` on resume must return the SAME `saved` object when still processing: since `pendingResult({ step: "publish", containerId }, saved.startedAt)` rebuilds an equal object, `toEqual(saved)` holds.

In `publish(input)`: first line `if (input.resumeState) return resume(input.resumeState)`; `const startedAt = now().toISOString()`.
- Story branch: create container as today, then `return finishSingle(container.data.id, startedAt, waitBriefly)`.
- Carousel branch: replace `publishCarousel(...)` with an in-closure version: build children with `input.mediaKinds?.[i] === "video"` → `{ media_type: "VIDEO", video_url: url, is_carousel_item: true, access_token }` else `{ image_url: url, is_carousel_item: true, access_token }` (field order for the image child unchanged); then `const s = await waitBriefly(childIds)`; error → failure; in_progress → `pendingResult({ step: "children", childIds, caption: content }, startedAt)`; finished → `createParent(childIds, content, hasVideo, startedAt)`.
- Single branch: photo unchanged; video → after creating the REELS container `return finishSingle(container.data.id, startedAt, waitBriefly)`.
- Delete the old `publishStoryPost`, `publishCarousel`, `waitForContainerFinished` top-level functions (their logic now lives in the closures). Keep `sleep` as `defaultSleep`.

- [ ] **Step 4: Run the Instagram suites**

Run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run __tests__/lib/social/instagram-video-processing.test.ts __tests__/lib/social/instagram.test.ts __tests__/lib/social/instagram-carousel.test.ts __tests__/lib/social/instagram-story.test.ts __tests__/lib/social/instagram-video-story.test.ts`
Expected: all PASS. The carousel, story and video-story files are NOT edited (Review Focus 4). If an existing story/carousel test times out on real sleeps, pass `{ sleep: async () => {} }` ONLY IF the test already polls IN_PROGRESS; do not change its expected calls.

- [ ] **Step 5: Commit**

```bash
git add lib/social/plugins/instagram.ts __tests__/lib/social/instagram-video-processing.test.ts __tests__/lib/social/instagram.test.ts
git commit -m "fix(social): Instagram video waits for processing across runs instead of publishing unready"
```

---

### Task 3: Publish runner saves, resumes and times out the pending state

**Files:**
- Modify: `lib/social/publish-runner.ts`
- Test: `__tests__/lib/social/publish-runner.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `PublishResult.pending`, `PublishInput.resumeState`, `PublishInput.mediaKinds`, `SocialPost.platform_publish_state` (Task 1).
- Produces: saved column shape `{ startedAt: string; scheduledFor: string; data: Record<string, unknown> }`; exported const `PENDING_PUBLISH_LIMIT_MS = 30 * 60 * 1000`.

Rules:
- Saved state is used only if it parses (`startedAt` string, `scheduledFor` string, `data` object) AND `scheduledFor === post.scheduled_at`. Otherwise ignore it (Review Focus 3).
- `pending` answer: if `now - startedAt > PENDING_PUBLISH_LIMIT_MS` → `failed` with `${plugin.displayName ?? post.platform} is still processing the video after 30 minutes.` and `platform_publish_state: null`; else save `{ ...pending, scheduledFor: post.scheduled_at }` and count neither published nor failed.
- `published` and `failed` updates both set `platform_publish_state: null`.
- `buildPluginInput` sets `mediaKinds` for carousels from `slide.asset?.kind === "video" ? "video" : "image"`.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/social/publish-runner.test.ts`:

```ts
describe("runScheduledPublish — platform still processing", () => {
  beforeEach(() => vi.clearAllMocks())

  const base = {
    id: "p9",
    platform: "instagram",
    content: "reel",
    media_url: null,
    source_video_id: "v9",
    post_type: "video",
    approval_status: "scheduled",
    scheduled_at: "2026-10-01T10:00:00.000Z",
    published_at: null,
    rejection_notes: null,
    platform_post_id: null,
    created_by: null,
    created_at: "",
    updated_at: "",
  }

  function setup(post: Record<string, unknown>, answer: unknown) {
    listSocialPostsMock.mockResolvedValue([post])
    listPlatformConnectionsMock.mockResolvedValue([])
    getSocialPostWithMediaMock.mockResolvedValue({ ...post, media: [] })
    resolveMediaUrlMock.mockResolvedValue("https://signed.example/v9.mp4")
    const publish = vi.fn().mockResolvedValue(answer)
    registryGetMock.mockReturnValue({ publish, displayName: "Instagram" })
    return publish
  }

  it("saves a pending answer and leaves the post scheduled", async () => {
    const pending = { startedAt: "2026-10-01T10:05:00.000Z", data: { step: "publish", containerId: "c" } }
    setup(base, { success: true, pending })
    const result = await runScheduledPublish({ now: new Date("2026-10-01T10:05:00.000Z") })
    expect(result).toEqual({ considered: 1, published: 0, failed: 0 })
    expect(updateSocialPostMock).toHaveBeenCalledWith("p9", {
      platform_publish_state: { ...pending, scheduledFor: "2026-10-01T10:00:00.000Z" },
    })
  })

  it("hands the saved state back on the next run and publishes, clearing it", async () => {
    const saved = { startedAt: "2026-10-01T10:05:00.000Z", scheduledFor: "2026-10-01T10:00:00.000Z", data: { step: "publish", containerId: "c" } }
    const publish = setup({ ...base, platform_publish_state: saved }, { success: true, platform_post_id: "IG_9" })
    await runScheduledPublish({ now: new Date("2026-10-01T10:10:00.000Z") })
    expect(publish.mock.calls[0][0].resumeState).toEqual({ startedAt: saved.startedAt, data: saved.data })
    expect(updateSocialPostMock).toHaveBeenCalledWith("p9", expect.objectContaining({
      approval_status: "published",
      platform_post_id: "IG_9",
      platform_publish_state: null,
    }))
  })

  it("ignores saved state from an earlier schedule (rescheduled or Publish now)", async () => {
    const saved = { startedAt: "2026-10-01T09:00:00.000Z", scheduledFor: "2026-10-01T08:55:00.000Z", data: { step: "publish", containerId: "old" } }
    const publish = setup({ ...base, platform_publish_state: saved }, { success: true, platform_post_id: "IG_10" })
    await runScheduledPublish({ now: new Date("2026-10-01T10:10:00.000Z") })
    expect(publish.mock.calls[0][0].resumeState).toBeUndefined()
  })

  it("fails the post after 30 minutes of processing, clearing the state", async () => {
    const pending = { startedAt: "2026-10-01T10:00:00.000Z", data: { step: "publish", containerId: "c" } }
    setup({ ...base, platform_publish_state: { ...pending, scheduledFor: base.scheduled_at } }, { success: true, pending })
    const result = await runScheduledPublish({ now: new Date("2026-10-01T10:30:01.000Z") })
    expect(result).toEqual({ considered: 1, published: 0, failed: 1 })
    expect(updateSocialPostMock).toHaveBeenCalledWith("p9", {
      approval_status: "failed",
      rejection_notes: "Instagram is still processing the video after 30 minutes.",
      platform_publish_state: null,
    })
  })

  it("a platform failure clears saved state so a retry starts fresh", async () => {
    const saved = { startedAt: "2026-10-01T10:05:00.000Z", scheduledFor: base.scheduled_at, data: { step: "publish", containerId: "c" } }
    setup({ ...base, platform_publish_state: saved }, { success: false, error: "Instagram could not process the media (ERROR)" })
    await runScheduledPublish({ now: new Date("2026-10-01T10:10:00.000Z") })
    expect(updateSocialPostMock).toHaveBeenCalledWith("p9", {
      approval_status: "failed",
      rejection_notes: "Instagram could not process the media (ERROR)",
      platform_publish_state: null,
    })
  })

  it("tells the plugin which carousel slides are videos", async () => {
    const post = { ...base, post_type: "carousel", source_video_id: null }
    const publish = setup(post, { success: true, platform_post_id: "IG_C" })
    getSocialPostWithMediaMock.mockResolvedValue({
      ...post,
      media: [
        { position: 0, asset: { kind: "image", public_url: "images/u/a.jpg" } },
        { position: 1, asset: { kind: "video", public_url: "media-videos/u/b.mp4" } },
      ],
    })
    await runScheduledPublish({ now: new Date("2026-10-01T10:10:00.000Z") })
    expect(publish.mock.calls[0][0].mediaKinds).toEqual(["image", "video"])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run __tests__/lib/social/publish-runner.test.ts`
Expected: the six new tests FAIL; the existing ones FAIL only where their `published`/`failed` update expectations are exact objects (they use `objectContaining` today — if any uses an exact object, add `platform_publish_state: null` to it and say so in the report).

- [ ] **Step 3: Implement**

In `lib/social/publish-runner.ts`:

```ts
import type { PendingPublish, PublishInput } from "@/lib/social/plugins/types"

/** How long a platform may keep processing a post's media before the post is failed. */
export const PENDING_PUBLISH_LIMIT_MS = 30 * 60 * 1000

interface SavedPublishState extends PendingPublish {
  /** The scheduled_at this wait belongs to; a reschedule or "Publish now" starts fresh. */
  scheduledFor: string
}

function readSavedState(post: SocialPost): PendingPublish | null {
  const raw = post.platform_publish_state
  if (!raw || typeof raw !== "object") return null
  const { startedAt, scheduledFor, data } = raw as Partial<SavedPublishState>
  if (typeof startedAt !== "string" || typeof scheduledFor !== "string") return null
  if (!data || typeof data !== "object") return null
  if (scheduledFor !== post.scheduled_at) return null
  return { startedAt, data }
}
```

`runScheduledPublish` passes `now` into `publishOnePost(post, now)`; the loop counts `"published"`, `"failed"` and ignores `"pending"`. `publishOnePost` return type becomes `"published" | "failed" | "pending"`, and:

```ts
  const resumeState = readSavedState(post)
  const input: PublishInput = resumeState ? { ...built.input, resumeState } : built.input
  const publishResult = await plugin.publish(input)

  if (publishResult.success && publishResult.pending) {
    const waited = now.getTime() - Date.parse(publishResult.pending.startedAt)
    if (waited > PENDING_PUBLISH_LIMIT_MS) {
      await updateSocialPost(post.id, {
        approval_status: "failed",
        rejection_notes: `${plugin.displayName ?? post.platform} is still processing the video after 30 minutes.`,
        platform_publish_state: null,
      })
      return "failed"
    }
    const saved: SavedPublishState = { ...publishResult.pending, scheduledFor: post.scheduled_at as string }
    await updateSocialPost(post.id, { platform_publish_state: saved as unknown as Record<string, unknown> })
    return "pending"
  }
```

Add `platform_publish_state: null` to the existing `success=false` failure update and to the `published` update. In `buildPluginInput`'s carousel loop, collect `kinds.push(slide.asset?.kind === "video" ? "video" : "image")` and return `mediaKinds: kinds` alongside `mediaUrls` (leave it `undefined` for non-carousels).

- [ ] **Step 4: Run the runner suites**

Run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run __tests__/lib/social/publish-runner.test.ts __tests__/lib/social/build-plugin-input-link.test.ts __tests__/api/admin/social/schedule.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/social/publish-runner.ts __tests__/lib/social/publish-runner.test.ts
git commit -m "feat(social): publish runner keeps a processing post scheduled and resumes it next run"
```

---

### Task 4: Media upload route accepts MP4/MOV as video assets

**Files:**
- Modify: `lib/validators/media-asset.ts`
- Modify: `app/api/admin/media-assets/upload-url/route.ts`
- Create: `__tests__/api/admin/media-assets/upload-url-video.test.ts`

**Interfaces:**
- Produces: the route answers `{ mediaAssetId, uploadUrl, storagePath, expiresInSeconds }` for `video/mp4` / `video/quicktime`, with the row `kind: "video"` and `storage_path` under `media-videos/<userId>/`.

- [ ] **Step 1: Write the failing test**

First read one existing test under `__tests__/api/admin/media-assets/` (e.g. `ls __tests__/api/admin/media-assets`) and copy its mocks for `@/lib/auth`, `@/lib/firebase-admin`, `@/lib/db/media-assets`, `@/lib/ai-jobs`, `@/lib/permissions/guard`. Then:

```ts
it("accepts an MP4 as a video asset, under media-videos/, and skips the photo alt-text job", async () => {
  const res = await POST(req({ filename: "drill.mp4", contentType: "video/mp4" }))
  expect(res.status).toBe(201)
  expect(createMediaAssetMock).toHaveBeenCalledWith(expect.objectContaining({
    kind: "video",
    mime_type: "video/mp4",
    storage_path: expect.stringMatching(/^media-videos\/u-1\/\d+-drill\.mp4$/),
  }))
  expect(createAiJobMock).not.toHaveBeenCalled()
})

it("accepts a MOV (video/quicktime)", async () => {
  const res = await POST(req({ filename: "drill.MOV", contentType: "video/quicktime" }))
  expect(res.status).toBe(201)
})

it("still refuses other video types", async () => {
  const res = await POST(req({ filename: "drill.webm", contentType: "video/webm" }))
  expect(res.status).toBe(400)
  expect(createMediaAssetMock).not.toHaveBeenCalled()
})

it("refuses a mismatched name and type", async () => {
  const res = await POST(req({ filename: "drill.jpg", contentType: "video/mp4" }))
  expect(res.status).toBe(400)
})

it("photos are unchanged: kind image, images/ path, alt-text job queued", async () => {
  const res = await POST(req({ filename: "a.png", contentType: "image/png" }))
  expect(res.status).toBe(201)
  expect(createMediaAssetMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "image" }))
  expect(createAiJobMock).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run __tests__/api/admin/media-assets/upload-url-video.test.ts`
Expected: the MP4 and MOV tests FAIL with 400.

- [ ] **Step 3: Implement**

`lib/validators/media-asset.ts`:

```ts
const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const
const ALLOWED_VIDEO_MIME = ["video/mp4", "video/quicktime"] as const
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i
const VIDEO_EXTENSIONS = /\.(mp4|mov)$/i

export function isVideoMime(contentType: string): boolean {
  return (ALLOWED_VIDEO_MIME as readonly string[]).includes(contentType)
}

export const mediaAssetUploadUrlSchema = z
  .object({
    filename: z.string().min(1, "filename is required").max(200, "filename too long"),
    contentType: z.enum([...ALLOWED_IMAGE_MIME, ...ALLOWED_VIDEO_MIME]),
  })
  .refine(
    (v) => (isVideoMime(v.contentType) ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS).test(v.filename),
    { message: "filename must end in .jpg, .jpeg, .png, .webp, .mp4 or .mov, matching the file type", path: ["filename"] },
  )
```

Route: `const isVideo = isVideoMime(contentType)`; `const storagePath = isVideo ? \`media-videos/${session.user.id}/${Date.now()}-${safeFilename}\` : \`images/...\`` (existing); `kind: isVideo ? "video" : "image"`; wrap the `createAiJob` block in `if (!isVideo) { ... }` with the comment `// The vision alt-text job reads photos only.`

- [ ] **Step 4: Run**

Run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run __tests__/api/admin/media-assets/upload-url-video.test.ts` plus every existing file found by `grep -rl "media-assets/upload-url\|mediaAssetUploadUrlSchema" __tests__`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/media-asset.ts app/api/admin/media-assets/upload-url/route.ts __tests__/api/admin/media-assets/upload-url-video.test.ts
git commit -m "feat(content-studio): media uploads accept MP4 and MOV as video assets"
```

---

### Task 5: Manual post route allows video carousel slides for Instagram only

**Files:**
- Modify: `app/api/admin/content-studio/posts/route.ts` (carousel validation loop, ~lines 115-150)
- Test: `__tests__/api/admin/content-studio/posts-carousel.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Using that file's existing mocks for `getMediaAssetById`:

```ts
it("accepts a video slide on Instagram", async () => {
  // asset v1: kind video, mime video/mp4; asset i1: kind image, mime image/jpeg
  const res = await call({ platform: "instagram", postType: "carousel", caption: "c", mediaAssetIds: ["i1", "v1"] })
  expect(res.status).toBe(200)
})

it("accepts a MOV slide on Instagram", async () => { /* v2: video/quicktime */ })

it("refuses a video slide on Facebook with a plain reason", async () => {
  const res = await call({ platform: "facebook", postType: "carousel", caption: "c", mediaAssetIds: ["i1", "v1"] })
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe("Facebook carousels can only hold photos — videos in a carousel post to Instagram only.")
})

it("refuses a video slide on LinkedIn", async () => { /* same, "LinkedIn carousels can only hold photos — ..." */ })

it("refuses a non-MP4/MOV video slide on Instagram", async () => {
  // asset v3: kind video, mime video/webm
  const res = await call({ platform: "instagram", postType: "carousel", caption: "c", mediaAssetIds: ["i1", "v3"] })
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatch(/MP4 or MOV/)
})
```

Write each test body in full, mirroring the file's existing asset mock setup (the file already mocks `getMediaAssetById`; add the video rows to that mock's lookup).

- [ ] **Step 2: Run to verify failure**

Run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run __tests__/api/admin/content-studio/posts-carousel.test.ts`
Expected: the Instagram-video tests FAIL ("is not an image").

- [ ] **Step 3: Implement**

Replace the `if (asset.kind !== "image")` block in the carousel loop with:

```ts
      if (asset.kind === "video") {
        if (platform !== "instagram") {
          const name = platform === "linkedin" ? "LinkedIn" : platform === "facebook" ? "Facebook" : platform
          return NextResponse.json(
            { error: `${name} carousels can only hold photos — videos in a carousel post to Instagram only.` },
            { status: 400 },
          )
        }
        if (asset.mime_type !== "video/mp4" && asset.mime_type !== "video/quicktime") {
          return NextResponse.json(
            { error: `Instagram carousel videos must be MP4 or MOV — ${id} is ${asset.mime_type}` },
            { status: 400 },
          )
        }
        continue
      }
      if (asset.kind !== "image") {
        return NextResponse.json(
          { error: `mediaAsset ${id} is not an image (kind=${asset.kind})` },
          { status: 400 },
        )
      }
```

(The Instagram/LinkedIn image-mime checks below stay as they are and now only see images.)

- [ ] **Step 4: Run**

Run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run __tests__/api/admin/content-studio/posts-carousel.test.ts __tests__/api/content-studio/manual-post.test.ts __tests__/api/admin/content-studio/posts-image.test.ts __tests__/api/admin/content-studio/posts-story.test.ts __tests__/api/admin/content-studio/posts-text.test.ts __tests__/api/admin/content-studio/posts-edit-gate.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/content-studio/posts/route.ts __tests__/api/admin/content-studio/posts-carousel.test.ts
git commit -m "feat(content-studio): carousel video slides are accepted for Instagram only"
```

---

### Task 6: Carousel slots take a photo or video; the box skips non-Instagram platforms

**Files:**
- Modify: `components/admin/content-studio/upload/ImageUploader.tsx`
- Modify: `components/admin/content-studio/upload/CarouselComposer.tsx`
- Modify: `components/admin/content-studio/calendar/ManualPostDialog.tsx`
- Test: `__tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx` (append), and the existing CarouselComposer / ImageUploader test files if present (`grep -rl "CarouselComposer\|ImageUploader" __tests__`).

**Interfaces:**
- `ImageUploadedEvent` gains `kind: "image" | "video"` and `previewUrl?: string` (local object URL, video only).
- `ImageUploader` gains `allowVideo?: boolean` (default false). When true: `accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"`, label `Upload photo or video` / `Replace`, video files go through `uploadImageFile` (the route now accepts them) and emit `kind: "video"` with `previewUrl = URL.createObjectURL(file)`. Other video types → error `Videos must be MP4 or MOV.` The Library button stays photos-only and emits `kind: "image"`.
- `CarouselComposer` `onChange(ids: string[], meta: { hasVideo: boolean })`. Slots store `kind` and `previewUrl`; a filled video slot shows `<video src={previewUrl} controls playsInline preload="metadata" aria-label={`Preview of ${fileName}`} className="mt-2 max-h-40 w-full rounded bg-black object-contain" />` under its row. Object URLs are revoked when the slot is removed and on unmount. The emit key includes kinds so a same-ids change never re-fires.
- `ManualPostDialog`: new state `carouselHasVideo`; a platform is supported iff `isPlatformPostTypeSupported(p, postType) && !(postType === "carousel" && carouselHasVideo && p !== "instagram")`. When the only reason is the video, the warning reads `{list} {doesn't|don't} support videos in a carousel and will be skipped.`; the existing unsupported warning stays for the rest. Reset `carouselHasVideo` to false on post-type change. Pass `allowVideo` through `CarouselComposer` → `ImageUploader`.

- [ ] **Step 1: Write the failing tests** (in `ManualPostDialog.test.tsx`; mock `CarouselComposer` for the dialog-level tests)

```tsx
// at top, alongside the other mocks:
vi.mock("@/components/admin/content-studio/upload/CarouselComposer", () => ({
  CarouselComposer: ({ onChange }: { onChange: (ids: string[], meta: { hasVideo: boolean }) => void }) => (
    <div>
      <button type="button" onClick={() => onChange(["i1", "i2"], { hasVideo: false })}>Fake two photos</button>
      <button type="button" onClick={() => onChange(["i1", "v1"], { hasVideo: true })}>Fake photo and video</button>
    </div>
  ),
}))

it("a carousel with a video posts to Instagram only and says why Facebook is skipped", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "c-1" }), { status: 200 }))
  render(<ManualPostDialog dayKey="2099-01-01" onClose={vi.fn()} onCreated={vi.fn()} multimediaEnabled />)
  fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "carousel" } })
  fireEvent.click(screen.getByLabelText(/Post to facebook/i))
  fireEvent.click(screen.getByRole("button", { name: "Fake photo and video" }))
  expect(screen.getByText("facebook doesn't support videos in a carousel and will be skipped.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: /^create/i }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).platform).toBe("instagram")
})

it("a photo-only carousel still posts to Facebook too", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "c-2" }), { status: 200 }))
  render(<ManualPostDialog dayKey="2099-01-01" onClose={vi.fn()} onCreated={vi.fn()} multimediaEnabled />)
  fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "carousel" } })
  fireEvent.click(screen.getByLabelText(/Post to facebook/i))
  fireEvent.click(screen.getByRole("button", { name: "Fake two photos" }))
  fireEvent.click(screen.getByRole("button", { name: /^create/i }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
})
```

Retarget the two existing carousel tests (`shows the CarouselComposer…` looks for "add slide"; `carousel submit is disabled…`) to the mock: the first asserts the fake buttons render; the second asserts Create is disabled before either fake button is clicked. Say so in the commit.

For the composer/uploader, add `__tests__/components/admin/content-studio/upload/carousel-video-slide.test.tsx` (jsdom): mock `@/lib/firebase-client-upload` `uploadImageFile` → `{ mediaAssetId: "v1", storagePath: "media-videos/u/1-b.mp4" }`, stub `URL.createObjectURL`/`revokeObjectURL`, render `<CarouselComposer onChange={onChange} allowVideo />`, choose a `video/mp4` File on the slot's file input, then assert: `onChange` last called with `(["v1"], { hasVideo: true })`; a `video` with `aria-label="Preview of 1-b.mp4"` renders; clicking "Remove" revokes the URL. And: choosing a `video/webm` shows `Videos must be MP4 or MOV.` and `uploadImageFile` was not called. And: without `allowVideo`, the file input's `accept` is `image/jpeg,image/png,image/webp`.

- [ ] **Step 2: Run to verify failure**

Run: `/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node node_modules/vitest/vitest.mjs run __tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx __tests__/components/admin/content-studio/upload/carousel-video-slide.test.tsx`
Expected: new tests FAIL.

- [ ] **Step 3: Implement** per the Interfaces block above. In `ManualPostDialog`, the carousel block becomes:

```tsx
            <CarouselComposer
              allowVideo
              onChange={(ids, meta) => {
                setMediaAssetIds(ids)
                setCarouselHasVideo(meta.hasVideo)
              }}
            />
```

wrapped in `useCallback` if the composer's effect would otherwise loop (it compares an emit key, so identity changes are safe — verify with the tests).

- [ ] **Step 4: Run**

Run the two files above plus every file from `grep -rl "CarouselComposer\|ImageUploader\|ImageUploadedEvent" __tests__`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/upload/ImageUploader.tsx components/admin/content-studio/upload/CarouselComposer.tsx components/admin/content-studio/calendar/ManualPostDialog.tsx __tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx __tests__/components/admin/content-studio/upload/carousel-video-slide.test.tsx
git commit -m "feat(content-studio): carousel slides take a video, posting to Instagram only"
```

---

## After the tasks (controller)

1. Apply `00284` to the dev clone (supabase MCP `apply_migration`), then `npm run test:integration:drift` and `npm run test:integration:selects` (Node 24 on PATH).
2. Root `tsc`: count must equal the worktree baseline (236) with no error in a changed file.
3. Real-app captures on the dev clone: the player in the Video box, and a mixed carousel with Facebook skipped (upload PUTs answered by the script; created rows deleted).
4. Whole-branch review by a fresh reviewer.
5. Journal entry. Do not push.
