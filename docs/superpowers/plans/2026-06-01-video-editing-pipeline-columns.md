# Video-editing Pipeline Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the captioned-cut video-editing stage as three kanban columns (Needs Edit → Rendering → Edited) on the Content Studio Videos lane, with quick-action buttons and live render progress.

**Architecture:** All edit state is *derived* from existing data (`video.status`, `needs_edit`, the latest `video_caption_render` ai_job, and whether a `captioned_cut` media asset exists) — no DB migration. A flag (`feature_captioned_cut_enabled`) switches the lane between today's 5-column layout and a new 7-column layout via parallel `*WithEdit` functions, leaving the existing 5-column functions (and their pinned tests) untouched. Liveness reuses the existing `useAiJob` Firestore listener + `router.refresh()`; a new `RenderWatcher` component isolates that Firebase usage.

**Tech Stack:** Next.js 16 App Router (server + client components), React 19, TypeScript strict, Vitest + Testing Library, Tailwind v4, Lucide, Sonner, Firebase Firestore (admin SDK server-side, client SDK via `useAiJob`).

---

## File Structure

**Modify:**
- `lib/content-studio/pipeline-columns.ts` — add `VIDEO_COLUMNS_WITH_EDIT`, labels, tones, `videoColumnForWithEdit`, `videosByColumnWithEdit`. Originals unchanged.
- `lib/ai-jobs.ts` — add `listRecentCaptionRenders`.
- `lib/content-studio/pipeline-data.ts` — add `captionedCutEnabled`, `renderJobIdByVideo`, `failedRenderVideoIds` to `PipelineData`; add pure reducer `deriveRenderSignals`; wire the new query behind the flag.
- `lib/help-copy.ts` — add `needsEditColumn`, `renderingColumn`, `editedColumn`.
- `components/admin/content-studio/pipeline/VideoCard.tsx` — `"use client"`, stretched-link refactor, per-column action row / rendering UI.
- `components/admin/content-studio/pipeline/VideosLane.tsx` — pick column set + derivation by flag; pass new props; mount `RenderWatcher`.

**Create:**
- `components/admin/content-studio/pipeline/RenderWatcher.tsx` — `RenderWatcher` + `JobWatch` (isolates `useAiJob` + `router.refresh()`).
- `__tests__/lib/content-studio/pipeline-columns-with-edit.test.ts`
- `__tests__/lib/content-studio/derive-render-signals.test.ts`
- `__tests__/components/admin/content-studio/pipeline/VideoCard-actions.test.tsx`
- `__tests__/components/admin/content-studio/pipeline/RenderWatcher.test.tsx`

**Untouched (regression guard):** `__tests__/lib/content-studio/pipeline-columns.test.ts`, `__tests__/components/admin/content-studio/pipeline/VideoCard*.test.tsx` must keep passing.

---

## Task 1: Edit-column constants, labels, tones

**Files:**
- Modify: `lib/content-studio/pipeline-columns.ts`

- [ ] **Step 1: Add the new column array, type, labels, and tones**

Append to `lib/content-studio/pipeline-columns.ts` (after the existing `VIDEO_COLUMN_LABELS` block, before `POST_COLUMNS`). Do NOT modify `VIDEO_COLUMNS`, `VideoColumn`, or `VIDEO_COLUMN_LABELS`.

```typescript
// ── 7-column variant: shown when feature_captioned_cut_enabled is on. The three
// edit columns (needs_edit/rendering/edited) replace the single "transcribed"
// column, since a transcribed video is needs_edit=true by default and so is
// immediately "needs edit". The original VIDEO_COLUMNS path is the flag-off
// fallback and is left untouched.
export const VIDEO_COLUMNS_WITH_EDIT = [
  "uploaded",
  "transcribing",
  "needs_edit",
  "rendering",
  "edited",
  "generated",
  "complete",
] as const
export type VideoColumnWithEdit = (typeof VIDEO_COLUMNS_WITH_EDIT)[number]

export const VIDEO_COLUMN_WITH_EDIT_LABELS: Record<VideoColumnWithEdit, string> = {
  uploaded: "Uploaded",
  transcribing: "Transcribing",
  needs_edit: "Needs Edit",
  rendering: "Rendering",
  edited: "Edited",
  generated: "Generated",
  complete: "Complete",
}

/** Per-video signals the 7-column derivation needs that aren't on the row itself. */
export interface VideoEditSignals {
  /** A rendered captioned-cut asset exists for this video. */
  hasCut: boolean
  /** An in-flight (pending/processing) video_caption_render job exists. */
  isRendering: boolean
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from `pipeline-columns.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/content-studio/pipeline-columns.ts
git commit -m "feat(content-studio): add 7-column edit-lane constants"
```

---

## Task 2: `videoColumnForWithEdit` + `videosByColumnWithEdit` (TDD)

**Files:**
- Modify: `lib/content-studio/pipeline-columns.ts`
- Test: `__tests__/lib/content-studio/pipeline-columns-with-edit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/pipeline-columns-with-edit.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import {
  videoColumnForWithEdit,
  videosByColumnWithEdit,
  VIDEO_COLUMNS_WITH_EDIT,
  type VideoEditSignals,
} from "@/lib/content-studio/pipeline-columns"
import type { SocialPost, VideoUpload } from "@/types/database"

const video = (id: string, o: Partial<VideoUpload> = {}): VideoUpload => ({
  id,
  storage_path: "p",
  original_filename: `${id}.mp4`,
  duration_seconds: 10,
  size_bytes: 100,
  mime_type: null,
  title: id,
  uploaded_by: null,
  status: "transcribed",
  needs_edit: true,
  created_at: "",
  updated_at: "",
  ...o,
})

const post = (id: string, o: Partial<SocialPost> = {}): SocialPost => ({
  id,
  platform: "instagram",
  content: "x",
  media_url: null,
  post_type: "text",
  approval_status: "draft",
  scheduled_at: null,
  published_at: null,
  source_video_id: null,
  rejection_notes: null,
  platform_post_id: null,
  created_by: null,
  created_at: "",
  updated_at: "",
  ...o,
})

const sig = (o: Partial<VideoEditSignals> = {}): VideoEditSignals => ({
  hasCut: false,
  isRendering: false,
  ...o,
})

describe("videoColumnForWithEdit", () => {
  it("keeps the pre-edit statuses", () => {
    expect(videoColumnForWithEdit(video("v", { status: "uploaded" }), [], sig())).toBe("uploaded")
    expect(videoColumnForWithEdit(video("v", { status: "transcribing" }), [], sig())).toBe("transcribing")
    expect(videoColumnForWithEdit(video("v", { status: "failed" }), [], sig())).toBe("transcribing")
  })

  it("routes a gated transcribed video with no cut/render to needs_edit", () => {
    expect(videoColumnForWithEdit(video("v", { status: "transcribed", needs_edit: true }), [], sig())).toBe("needs_edit")
    expect(videoColumnForWithEdit(video("v", { status: "analyzed", needs_edit: true }), [], sig())).toBe("needs_edit")
  })

  it("routes to rendering when a render is in flight (even if a cut already exists)", () => {
    expect(videoColumnForWithEdit(video("v", { status: "transcribed" }), [], sig({ isRendering: true }))).toBe("rendering")
    expect(videoColumnForWithEdit(video("v", { status: "transcribed" }), [], sig({ isRendering: true, hasCut: true }))).toBe("rendering")
  })

  it("routes to edited when postable (has cut) and no render in flight", () => {
    expect(videoColumnForWithEdit(video("v", { status: "transcribed", needs_edit: true }), [], sig({ hasCut: true }))).toBe("edited")
  })

  it("routes to edited when marked ready (needs_edit=false) with no cut", () => {
    expect(videoColumnForWithEdit(video("v", { status: "transcribed", needs_edit: false }), [], sig())).toBe("edited")
  })

  it("still uses post state for generated/complete", () => {
    const v = video("v1", { status: "transcribed" })
    expect(
      videoColumnForWithEdit(v, [post("p", { source_video_id: "v1", approval_status: "approved" })], sig()),
    ).toBe("generated")
    expect(
      videoColumnForWithEdit(v, [post("p", { source_video_id: "v1", approval_status: "published" })], sig()),
    ).toBe("complete")
  })
})

describe("videosByColumnWithEdit", () => {
  it("groups by derived edit column using per-video signals", () => {
    const vs = [
      video("v1", { status: "transcribed", needs_edit: true }),
      video("v2", { status: "transcribed" }),
      video("v3", { status: "transcribed", needs_edit: false }),
    ]
    const grouped = videosByColumnWithEdit(vs, [], {
      cutVideoIds: new Set<string>(),
      renderingVideoIds: new Set<string>(["v2"]),
    })
    expect(grouped.needs_edit.map((v) => v.id)).toEqual(["v1"])
    expect(grouped.rendering.map((v) => v.id)).toEqual(["v2"])
    expect(grouped.edited.map((v) => v.id)).toEqual(["v3"])
  })

  it("returns an empty array for every column when given no videos", () => {
    const grouped = videosByColumnWithEdit([], [], { cutVideoIds: new Set(), renderingVideoIds: new Set() })
    for (const col of VIDEO_COLUMNS_WITH_EDIT) expect(grouped[col]).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/content-studio/pipeline-columns-with-edit.test.ts`
Expected: FAIL — `videoColumnForWithEdit`/`videosByColumnWithEdit` are not exported.

- [ ] **Step 3: Implement the two functions**

Append to `lib/content-studio/pipeline-columns.ts`. Import `isVideoPostable` at the top of the file (add to the existing import line region):

```typescript
import { isVideoPostable } from "@/lib/content-studio/edit-gate"
```

Then add:

```typescript
export function videoColumnForWithEdit(
  video: VideoUpload,
  posts: SocialPost[],
  signals: VideoEditSignals,
): VideoColumnWithEdit {
  const myPosts = posts.filter((p) => p.source_video_id === video.id)
  if (myPosts.length > 0) {
    return myPosts.every((p) => p.approval_status === "published") ? "complete" : "generated"
  }

  switch (video.status) {
    case "uploaded":
      return "uploaded"
    case "transcribing":
    case "failed":
      return "transcribing"
    case "transcribed":
    case "analyzed":
      // Render-in-flight wins over an existing cut (covers re-renders).
      if (signals.isRendering) return "rendering"
      if (isVideoPostable(video, signals.hasCut)) return "edited"
      return "needs_edit"
  }
}

export function videosByColumnWithEdit(
  videos: VideoUpload[],
  posts: SocialPost[],
  lookups: { cutVideoIds: Set<string>; renderingVideoIds: Set<string> },
): Record<VideoColumnWithEdit, VideoUpload[]> {
  const out: Record<VideoColumnWithEdit, VideoUpload[]> = {
    uploaded: [],
    transcribing: [],
    needs_edit: [],
    rendering: [],
    edited: [],
    generated: [],
    complete: [],
  }
  for (const v of videos) {
    const col = videoColumnForWithEdit(v, posts, {
      hasCut: lookups.cutVideoIds.has(v.id),
      isRendering: lookups.renderingVideoIds.has(v.id),
    })
    out[col].push(v)
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/content-studio/pipeline-columns-with-edit.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Run the original column test to confirm no regression**

Run: `npx vitest run __tests__/lib/content-studio/pipeline-columns.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add lib/content-studio/pipeline-columns.ts __tests__/lib/content-studio/pipeline-columns-with-edit.test.ts
git commit -m "feat(content-studio): derive needs_edit/rendering/edited columns"
```

---

## Task 3: `listRecentCaptionRenders` batch query

**Files:**
- Modify: `lib/ai-jobs.ts`

> The existing `lib/ai-jobs.ts` tests mock the admin Firestore; this query's *shape* is hard to unit-test meaningfully (it's a thin Firestore wrapper), so the testable logic lives in Task 4's pure reducer. This task only adds the wrapper.

- [ ] **Step 1: Add the query function**

Append to `lib/ai-jobs.ts` (after `findInFlightCaptionRender`):

```typescript
export interface RecentCaptionRender {
  jobId: string
  videoUploadId: string
  status: AiJobStatus
}

export type AiJobStatus = "pending" | "processing" | "streaming" | "completed" | "failed" | "cancelled"

/**
 * Recent captioned-cut render jobs (newest first), for deriving the Videos-lane
 * edit columns. Ordered by createdAt desc so the first row seen per videoUploadId
 * is its latest render. Requires a Firestore composite index on
 * (type ASC, createdAt DESC) — Firestore prints a one-click "create index" link
 * the first time this runs.
 */
export async function listRecentCaptionRenders(limit = 300): Promise<RecentCaptionRender[]> {
  const db = getAdminFirestore()
  const snap = await db
    .collection("ai_jobs")
    .where("type", "==", "video_caption_render")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get()
  const out: RecentCaptionRender[] = []
  for (const doc of snap.docs) {
    const data = doc.data()
    const videoUploadId = data?.input?.videoUploadId
    if (typeof videoUploadId !== "string") continue
    out.push({ jobId: doc.id, videoUploadId, status: data.status as AiJobStatus })
  }
  return out
}
```

> Note: if an `AiJobStatus` type already exists elsewhere and is exported, import it instead of redeclaring. Check with: `npx grep` is unavailable — use the editor search for `AiJobStatus` in `lib/`. The client `hooks/use-ai-job.ts` defines its own `AiJobStatus`; that one is client-side. Keep this server-side copy local to `lib/ai-jobs.ts` only if no server-side `AiJobStatus` is already exported. If adding it causes a duplicate-identifier error, remove the local declaration and import the existing one.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. If "Cannot redeclare AiJobStatus", delete the local `export type AiJobStatus = …` line and import the existing one.

- [ ] **Step 3: Commit**

```bash
git add lib/ai-jobs.ts
git commit -m "feat(ai-jobs): list recent captioned-cut renders for the pipeline"
```

---

## Task 4: `deriveRenderSignals` pure reducer (TDD)

**Files:**
- Modify: `lib/content-studio/pipeline-data.ts`
- Test: `__tests__/lib/content-studio/derive-render-signals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/derive-render-signals.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { deriveRenderSignals } from "@/lib/content-studio/pipeline-data"
import type { RecentCaptionRender } from "@/lib/ai-jobs"

const r = (videoUploadId: string, status: RecentCaptionRender["status"], jobId: string): RecentCaptionRender => ({
  jobId,
  videoUploadId,
  status,
})

describe("deriveRenderSignals", () => {
  it("maps an in-flight render to renderJobIdByVideo (newest row per video wins)", () => {
    // Rows arrive newest-first. v1's latest is pending.
    const renders = [r("v1", "pending", "job-new"), r("v1", "failed", "job-old")]
    const { renderJobIdByVideo, failedRenderVideoIds } = deriveRenderSignals(renders, new Set())
    expect(renderJobIdByVideo).toEqual({ v1: "job-new" })
    expect([...failedRenderVideoIds]).toEqual([])
  })

  it("treats processing as in-flight", () => {
    const { renderJobIdByVideo } = deriveRenderSignals([r("v1", "processing", "j1")], new Set())
    expect(renderJobIdByVideo).toEqual({ v1: "j1" })
  })

  it("flags a video whose latest render failed and that has no cut", () => {
    const { renderJobIdByVideo, failedRenderVideoIds } = deriveRenderSignals([r("v1", "failed", "j1")], new Set())
    expect(renderJobIdByVideo).toEqual({})
    expect([...failedRenderVideoIds]).toEqual(["v1"])
  })

  it("does NOT flag a failed render when the video already has a cut", () => {
    const { failedRenderVideoIds } = deriveRenderSignals([r("v1", "failed", "j1")], new Set(["v1"]))
    expect([...failedRenderVideoIds]).toEqual([])
  })

  it("does NOT flag failed when the latest render succeeded after an earlier failure", () => {
    const renders = [r("v1", "completed", "j-new"), r("v1", "failed", "j-old")]
    const { renderJobIdByVideo, failedRenderVideoIds } = deriveRenderSignals(renders, new Set())
    expect(renderJobIdByVideo).toEqual({})
    expect([...failedRenderVideoIds]).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/content-studio/derive-render-signals.test.ts`
Expected: FAIL — `deriveRenderSignals` not exported.

- [ ] **Step 3: Implement the reducer**

Add to `lib/content-studio/pipeline-data.ts`. Add the import at the top:

```typescript
import type { RecentCaptionRender } from "@/lib/ai-jobs"
```

Then add the pure helper (above `getPipelineData`):

```typescript
const IN_FLIGHT_RENDER_STATUSES: ReadonlySet<RecentCaptionRender["status"]> = new Set([
  "pending",
  "processing",
  "streaming",
])

export interface RenderSignals {
  /** videoUploadId → in-flight render job id. Keys are also the "rendering" set. */
  renderJobIdByVideo: Record<string, string>
  /** Videos whose LATEST render failed and that have no rendered cut. */
  failedRenderVideoIds: Set<string>
}

/**
 * Reduce recent render rows (newest-first) to per-video edit signals. Only the
 * latest render per video matters: if it's in flight → rendering; if it failed and
 * no cut exists → show the failed badge; otherwise no render signal.
 */
export function deriveRenderSignals(
  recentRenders: RecentCaptionRender[],
  cutVideoIds: Set<string>,
): RenderSignals {
  const renderJobIdByVideo: Record<string, string> = {}
  const failedRenderVideoIds = new Set<string>()
  const seen = new Set<string>()

  for (const render of recentRenders) {
    if (seen.has(render.videoUploadId)) continue // newest-first: skip older rows
    seen.add(render.videoUploadId)

    if (IN_FLIGHT_RENDER_STATUSES.has(render.status)) {
      renderJobIdByVideo[render.videoUploadId] = render.jobId
    } else if (render.status === "failed" && !cutVideoIds.has(render.videoUploadId)) {
      failedRenderVideoIds.add(render.videoUploadId)
    }
  }

  return { renderJobIdByVideo, failedRenderVideoIds }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/content-studio/derive-render-signals.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/content-studio/pipeline-data.ts __tests__/lib/content-studio/derive-render-signals.test.ts
git commit -m "feat(content-studio): pure reducer for per-video render signals"
```

---

## Task 5: Wire render signals + flag into `getPipelineData`

**Files:**
- Modify: `lib/content-studio/pipeline-data.ts`

- [ ] **Step 1: Extend the `PipelineData` interface**

In `lib/content-studio/pipeline-data.ts`, add three fields to the `PipelineData` interface (after `cutVideoIds`):

```typescript
  /** True when feature_captioned_cut_enabled is on — switches the lane to 7 columns. */
  captionedCutEnabled: boolean
  /** videoUploadId → in-flight render job id (keys = the "rendering" column). */
  renderJobIdByVideo: Record<string, string>
  /** Videos whose latest render failed and that have no cut (failed badge). */
  failedRenderVideoIds: Set<string>
```

- [ ] **Step 2: Add imports**

At the top of the file, add:

```typescript
import { getSetting } from "@/lib/db/system-settings"
import { listRecentCaptionRenders } from "@/lib/ai-jobs"
```

- [ ] **Step 3: Fetch the flag, then conditionally fetch renders, and return the new fields**

Replace the body of `getPipelineData` from the first `Promise.all` through the `return` with:

```typescript
  const [videos, posts, cutVideoIds, captionedCutEnabled] = await Promise.all([
    listVideoUploads({ limit: 200 }),
    listSocialPostsForPipeline(),
    listCaptionedCutVideoIds(),
    getSetting<boolean>("feature_captioned_cut_enabled", false),
  ])

  // Render signals only matter when the edit lane is active.
  let renderJobIdByVideo: Record<string, string> = {}
  let failedRenderVideoIds = new Set<string>()
  if (captionedCutEnabled) {
    const recentRenders = await listRecentCaptionRenders()
    const signals = deriveRenderSignals(recentRenders, cutVideoIds)
    renderJobIdByVideo = signals.renderJobIdByVideo
    failedRenderVideoIds = signals.failedRenderVideoIds
  }

  const postCountsByVideo: Record<string, PostCounts> = {}
  for (const p of posts) {
    if (!p.source_video_id) continue
    const counts = (postCountsByVideo[p.source_video_id] ??= emptyCounts())
    counts.total += 1
    switch (p.approval_status) {
      case "approved":
      case "awaiting_connection":
        counts.approved += 1
        break
      case "scheduled":
        counts.scheduled += 1
        break
      case "published":
        counts.published += 1
        break
      case "failed":
        counts.failed += 1
        break
      case "draft":
      case "edited":
        counts.needs_review += 1
        break
    }
  }

  const thumbnailUrlsByVideo = await signThumbnailUrls(videos)

  return {
    videos,
    posts,
    postCountsByVideo,
    thumbnailUrlsByVideo,
    cutVideoIds,
    captionedCutEnabled,
    renderJobIdByVideo,
    failedRenderVideoIds,
  }
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (Consumers of `PipelineData` that build it in tests — see Task 8 — will be updated there.)

- [ ] **Step 5: Run the full unit suite to catch consumers that construct `PipelineData`**

Run: `npx vitest run __tests__/lib __tests__/components/admin/content-studio`
Expected: PASS, OR a clear failure in a test that hand-builds `PipelineData` missing the new fields. If so, note them for Task 8 (VideosLane already tolerates missing optional fields only if typed optional — but we typed them required, so any such test must add the fields). Fix any such fixtures by adding `captionedCutEnabled: false, renderJobIdByVideo: {}, failedRenderVideoIds: new Set()`.

- [ ] **Step 6: Commit**

```bash
git add lib/content-studio/pipeline-data.ts
git commit -m "feat(content-studio): fetch render signals + flag in pipeline data"
```

---

## Task 6: Help copy for the new columns

**Files:**
- Modify: `lib/help-copy.ts`

- [ ] **Step 1: Add three entries**

In `lib/help-copy.ts`, inside the `HELP_COPY` object, in the "Content Studio — video columns" group, add:

```typescript
  needsEditColumn:
    "Transcribed and waiting on a captioned cut before it can post. Hit Render cut to make one, or Mark ready to skip editing. A failed render shows a retry badge here.",
  renderingColumn:
    "The captioned cut is rendering in the background (usually ~2–4 min). The card moves to Edited on its own when the render finishes.",
  editedColumn:
    "Has a rendered cut (or was marked ready) and is clear to post. Open the video to generate platform captions — they'll appear under Generated.",
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/help-copy.ts
git commit -m "feat(content-studio): help copy for edit columns"
```

---

## Task 7: `RenderWatcher` live-listener component (TDD)

**Files:**
- Create: `components/admin/content-studio/pipeline/RenderWatcher.tsx`
- Test: `__tests__/components/admin/content-studio/pipeline/RenderWatcher.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/pipeline/RenderWatcher.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

// Mock the live-job hook: return a status driven per-jobId from a controllable map.
const statusByJob: Record<string, string> = {}
vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: (jobId: string | null) => ({ status: jobId ? statusByJob[jobId] ?? "processing" : "pending", error: null }),
}))

// Capture router.refresh calls.
const refreshMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

import { RenderWatcher } from "@/components/admin/content-studio/pipeline/RenderWatcher"

describe("RenderWatcher", () => {
  beforeEach(() => {
    refreshMock.mockClear()
    for (const k of Object.keys(statusByJob)) delete statusByJob[k]
  })

  it("does not refresh while jobs are still processing", () => {
    statusByJob["j1"] = "processing"
    render(<RenderWatcher jobIds={["j1"]} />)
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it("refreshes when a watched job has completed", () => {
    statusByJob["j1"] = "completed"
    render(<RenderWatcher jobIds={["j1"]} />)
    expect(refreshMock).toHaveBeenCalled()
  })

  it("refreshes when a watched job has failed", () => {
    statusByJob["j1"] = "failed"
    render(<RenderWatcher jobIds={["j1"]} />)
    expect(refreshMock).toHaveBeenCalled()
  })

  it("renders nothing visible", () => {
    statusByJob["j1"] = "processing"
    const { container } = render(<RenderWatcher jobIds={["j1"]} />)
    expect(container.textContent).toBe("")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/admin/content-studio/pipeline/RenderWatcher.test.tsx`
Expected: FAIL — module `RenderWatcher` does not exist.

- [ ] **Step 3: Implement `RenderWatcher`**

Create `components/admin/content-studio/pipeline/RenderWatcher.tsx`:

```tsx
"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAiJob } from "@/hooks/use-ai-job"

/**
 * Invisible live-watcher for in-flight captioned-cut renders. One <JobWatch> per
 * render job listens via useAiJob (Firestore onSnapshot); when a job reaches a
 * terminal state we refresh the route so the server re-derives the Videos lane and
 * the card advances out of the Rendering column. Isolating Firebase here keeps
 * VideoCard free of Firestore imports.
 */
export function RenderWatcher({ jobIds }: { jobIds: string[] }) {
  const router = useRouter()
  return (
    <>
      {jobIds.map((id) => (
        <JobWatch key={id} jobId={id} onDone={() => router.refresh()} />
      ))}
    </>
  )
}

function JobWatch({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const { status } = useAiJob(jobId)
  useEffect(() => {
    if (status === "completed" || status === "failed") onDone()
  }, [status, onDone])
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/components/admin/content-studio/pipeline/RenderWatcher.test.tsx`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/pipeline/RenderWatcher.tsx __tests__/components/admin/content-studio/pipeline/RenderWatcher.test.tsx
git commit -m "feat(content-studio): RenderWatcher live-advances rendering cards"
```

---

## Task 8: VideoCard — stretched-link refactor + per-column actions (TDD)

**Files:**
- Modify: `components/admin/content-studio/pipeline/VideoCard.tsx`
- Test: `__tests__/components/admin/content-studio/pipeline/VideoCard-actions.test.tsx`

> The card becomes a client component. `next/navigation` is already globally mocked in `__tests__/setup.tsx` (so `useRouter().refresh` is a no-op `vi.fn`). The new tests mock `global.fetch` and `sonner`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/pipeline/VideoCard-actions.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { VideoCard } from "@/components/admin/content-studio/pipeline/VideoCard"
import type { VideoUpload } from "@/types/database"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))

const video: VideoUpload = {
  id: "v1",
  storage_path: "u/v1.mp4",
  original_filename: "clip.mp4",
  duration_seconds: 30,
  size_bytes: null,
  mime_type: "video/mp4",
  title: "Clip",
  uploaded_by: null,
  status: "transcribed",
  needs_edit: true,
  created_at: "2026-05-31T00:00:00Z",
  updated_at: "2026-05-31T00:00:00Z",
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ jobId: "j1" }) }),
  )
})

describe("VideoCard — edit-column actions", () => {
  it("shows Render cut + Mark ready in the needs_edit column", () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" />)
    expect(screen.getByRole("button", { name: /render cut/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /mark ready/i })).toBeInTheDocument()
  })

  it("POSTs to the captioned-cut endpoint when Render cut is clicked", () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" />)
    fireEvent.click(screen.getByRole("button", { name: /render cut/i }))
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/content-studio/captioned-cut",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("PATCHes the videos endpoint when Mark ready is clicked", () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" />)
    fireEvent.click(screen.getByRole("button", { name: /mark ready/i }))
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/videos/v1",
      expect.objectContaining({ method: "PATCH" }),
    )
  })

  it("shows a render-failed badge and Retry render when renderFailed is set", () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" renderFailed />)
    expect(screen.getByText(/render failed/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /retry render/i })).toBeInTheDocument()
  })

  it("shows an elapsed timer (no action buttons) in the rendering column", () => {
    render(<VideoCard video={video} counts={null} column="rendering" renderJobId="j1" />)
    expect(screen.queryByRole("button", { name: /render cut/i })).toBeNull()
    expect(screen.getByText(/0:0\d/)).toBeInTheDocument()
  })

  it("renders the legacy card (single link, no action buttons) when column is omitted", () => {
    render(<VideoCard video={video} counts={null} />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/content/v1")
    expect(screen.queryByRole("button", { name: /render cut/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/admin/content-studio/pipeline/VideoCard-actions.test.tsx`
Expected: FAIL — `column` prop unsupported; buttons not found.

- [ ] **Step 3: Rewrite `VideoCard.tsx`**

Replace the full contents of `components/admin/content-studio/pipeline/VideoCard.tsx` with:

```tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Film, AlertCircle, Clock, Loader2, CheckCircle, Clapperboard, Scissors, RefreshCw } from "lucide-react"
import type { VideoUpload } from "@/types/database"
import type { PostCounts } from "@/lib/content-studio/pipeline-data"
import type { VideoColumnWithEdit } from "@/lib/content-studio/pipeline-columns"
import { formatElapsed } from "@/lib/content-studio/render-progress"
import { accentStyle } from "@/lib/content-studio/video-accent"
import { cn } from "@/lib/utils"

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function StatusBadge({ status }: { status: VideoUpload["status"] }) {
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-error px-1.5 py-0.5 rounded bg-error/10">
        <AlertCircle className="size-3" /> Error
      </span>
    )
  }
  if (status === "transcribing") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10">
        <Loader2 className="size-3 animate-spin" /> Transcribing
      </span>
    )
  }
  if (status === "transcribed" || status === "analyzed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success px-1.5 py-0.5 rounded bg-success/10">
        <CheckCircle className="size-3" /> Transcribed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded bg-muted/50">
      <Film className="size-3" /> Uploaded
    </span>
  )
}

interface VideoCardProps {
  video: VideoUpload
  counts: PostCounts | null
  thumbnailUrl?: string | null
  hasCut?: boolean
  /** Edit-lane column this card is grouped under. Omit for the legacy 5-column lane. */
  column?: VideoColumnWithEdit
  /** In-flight render job id (present when column === "rendering"). */
  renderJobId?: string | null
  /** True when this video's latest render failed and it has no cut. */
  renderFailed?: boolean
}

export function VideoCard({
  video,
  counts,
  thumbnailUrl,
  hasCut = false,
  column,
  renderFailed = false,
}: VideoCardProps) {
  const title = video.title ?? video.original_filename
  const isFailed = video.status === "failed"

  return (
    <div
      style={accentStyle(video.id)}
      data-video-id={video.id}
      className={cn(
        "group relative block overflow-hidden rounded-lg border border-border bg-white",
        "pl-[11px] pr-3 py-3 space-y-2.5",
        "transition hover:border-primary/40 hover:shadow-[0_2px_8px_-3px_rgba(15,23,42,0.1)]",
        isFailed && "border-error/40",
      )}
    >
      {/* Stretched link: whole card opens detail, but sits below interactive buttons. */}
      <Link
        href={`/admin/content/${video.id}`}
        aria-label={title}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      {/* color-chip strip — same hue appears on every post from this video */}
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-[color:var(--video-accent)] z-10" />

      <div className="relative z-10 pointer-events-none space-y-2.5">
        <div className="aspect-video rounded-md overflow-hidden ring-1 ring-border/60 bg-muted/40 flex items-center justify-center">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <Film className="size-6 text-muted-foreground/60" strokeWidth={1.5} />
          )}
        </div>
        <div className="space-y-0.5">
          <p className="font-heading text-[13px] font-medium text-primary leading-snug line-clamp-2" title={title}>
            {title}
          </p>
          <p className="font-mono text-[10.5px] text-muted-foreground truncate" title={video.original_filename}>
            {video.original_filename}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground pt-0.5">
          <StatusBadge status={video.status} />
          <div className="inline-flex items-center gap-2">
            {video.needs_edit && !hasCut && column === undefined && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10" title="This video still needs editing before it can be posted">
                <Scissors className="size-3" /> Needs edit
              </span>
            )}
            {hasCut && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-foreground px-1.5 py-0.5 rounded bg-accent/15" title="This video has a rendered captioned cut">
                <Clapperboard className="size-3" /> Cut
              </span>
            )}
            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
              <Clock className="size-3" /> {formatDuration(video.duration_seconds)}
            </span>
          </div>
        </div>
        {counts && counts.total > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border/70 pt-2 text-[10.5px] font-mono tabular-nums text-muted-foreground">
            <span className="font-medium text-primary">{counts.total} posts</span>
            {counts.approved > 0 && (
              <span className="text-success">· ✓{counts.approved}<span className="sr-only"> approved</span></span>
            )}
            {counts.scheduled > 0 && (
              <span className="text-accent-foreground">· ⏱{counts.scheduled}<span className="sr-only"> scheduled</span></span>
            )}
            {counts.published > 0 && (
              <span className="text-primary">· ●{counts.published}<span className="sr-only"> published</span></span>
            )}
            {counts.failed > 0 && (
              <span className="text-error">· ✗{counts.failed}<span className="sr-only"> failed</span></span>
            )}
          </div>
        )}
      </div>

      {column !== undefined && (
        <EditControls videoId={video.id} column={column} renderFailed={renderFailed} hasCut={hasCut} needsEdit={video.needs_edit} />
      )}
    </div>
  )
}

function EditControls({
  videoId,
  column,
  renderFailed,
  hasCut,
  needsEdit,
}: {
  videoId: string
  column: VideoColumnWithEdit
  renderFailed: boolean
  hasCut: boolean
  needsEdit: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function renderCut() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/content-studio/captioned-cut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: videoId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      toast.message("Rendering captioned cut… runs in the background (a few minutes).")
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message || "Failed to start render")
    } finally {
      setBusy(false)
    }
  }

  async function markReady() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/videos/${videoId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ needs_edit: false }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      toast.success("Marked ready")
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message || "Failed to mark ready")
    } finally {
      setBusy(false)
    }
  }

  if (column === "rendering") {
    return (
      <div className="relative z-10 pt-1">
        <RenderingTimer />
      </div>
    )
  }

  if (column === "edited") {
    return (
      <div className="relative z-10 pt-1 text-[10px] font-medium text-success inline-flex items-center gap-1">
        <Clapperboard className="size-3" /> {hasCut ? "Cut ready" : "Marked ready"}
      </div>
    )
  }

  if (column === "needs_edit") {
    return (
      <div className="relative z-10 flex flex-wrap items-center gap-1.5 pt-1">
        {renderFailed && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-error px-1.5 py-0.5 rounded bg-error/10">
            <AlertCircle className="size-3" /> render failed
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void renderCut()
          }}
          className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {renderFailed ? <RefreshCw className="size-3" /> : <Clapperboard className="size-3" />}
          {renderFailed ? "Retry render" : "Render cut"}
        </button>
        {!renderFailed && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void markReady()
            }}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-surface disabled:opacity-60"
          >
            Mark ready
          </button>
        )}
      </div>
    )
  }

  return null
}

function RenderingTimer() {
  const [elapsedMs, setElapsedMs] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsedMs(Date.now() - start), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-primary">
      <Loader2 className="size-3 animate-spin" /> Rendering…
      <span className="font-mono tabular-nums text-muted-foreground" aria-label="Elapsed time">
        {formatElapsed(elapsedMs)}
      </span>
    </span>
  )
}
```

> Note: `Date.now()` is fine in app/runtime code; the workflow-script restriction does not apply here. `accentStyle` and `video-accent` are unchanged.

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run __tests__/components/admin/content-studio/pipeline/VideoCard-actions.test.tsx`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Run the existing VideoCard tests for regression**

Run: `npx vitest run __tests__/components/admin/content-studio/pipeline/VideoCard.test.tsx __tests__/components/admin/content-studio/pipeline/VideoCard-needs-edit.test.tsx __tests__/components/admin/content-studio/pipeline/VideoCard-cut.test.tsx`
Expected: PASS. (Legacy path: `column` omitted → single stretched link with href `/admin/content/v1`, "Needs edit"/"Cut"/"Error" badges, no buttons.)

- [ ] **Step 6: Commit**

```bash
git add components/admin/content-studio/pipeline/VideoCard.tsx __tests__/components/admin/content-studio/pipeline/VideoCard-actions.test.tsx
git commit -m "feat(content-studio): VideoCard edit-column actions + rendering timer"
```

---

## Task 9: VideosLane — switch column set by flag, wire props + RenderWatcher

**Files:**
- Modify: `components/admin/content-studio/pipeline/VideosLane.tsx`

- [ ] **Step 1: Rewrite `VideosLane.tsx`**

Replace the full contents of `components/admin/content-studio/pipeline/VideosLane.tsx` with:

```tsx
"use client"

import {
  VIDEO_COLUMNS,
  VIDEO_COLUMN_LABELS,
  videosByColumn,
  VIDEO_COLUMNS_WITH_EDIT,
  VIDEO_COLUMN_WITH_EDIT_LABELS,
  videosByColumnWithEdit,
  type VideoColumnWithEdit,
} from "@/lib/content-studio/pipeline-columns"
import { HELP_COPY } from "@/lib/help-copy"
import { Lane, LaneColumn, type LaneTone } from "./Lane"
import { VideoCard } from "./VideoCard"
import { RenderWatcher } from "./RenderWatcher"
import type { PipelineData } from "@/lib/content-studio/pipeline-data"

interface VideosLaneProps {
  data: PipelineData
}

const VIDEO_COLUMN_TONES: Record<string, LaneTone> = {
  uploaded: "neutral",
  transcribing: "progress",
  transcribed: "success",
  needs_edit: "warning",
  rendering: "progress",
  edited: "success",
  generated: "progress",
  complete: "published",
}

const VIDEO_COLUMN_HELP: Record<string, string> = {
  uploaded: HELP_COPY.uploadedColumn,
  transcribing: HELP_COPY.transcribingColumn,
  transcribed: HELP_COPY.transcribedColumn,
  needs_edit: HELP_COPY.needsEditColumn,
  rendering: HELP_COPY.renderingColumn,
  edited: HELP_COPY.editedColumn,
  generated: HELP_COPY.generatedColumn,
  complete: HELP_COPY.completeColumn,
}

export function VideosLane({ data }: VideosLaneProps) {
  const videoCount = data.videos.length
  const withPosts = Object.keys(data.postCountsByVideo).length

  const meta =
    videoCount > 0 ? `${videoCount} total${withPosts > 0 ? ` · ${withPosts} with posts` : ""}` : undefined

  if (!data.captionedCutEnabled) {
    const grouped = videosByColumn(data.videos, data.posts)
    return (
      <Lane title="Videos" subtitle="Auto-advance based on transcription + fanout state" tone="neutral" help={HELP_COPY.videosLane} meta={meta}>
        {VIDEO_COLUMNS.map((col) => (
          <LaneColumn key={col} id={`video-${col}`} label={VIDEO_COLUMN_LABELS[col]} count={grouped[col].length} accepts={false} tone={VIDEO_COLUMN_TONES[col] ?? "neutral"} help={VIDEO_COLUMN_HELP[col]}>
            {grouped[col].map((v) => (
              <VideoCard key={v.id} video={v} counts={data.postCountsByVideo[v.id] ?? null} thumbnailUrl={data.thumbnailUrlsByVideo[v.id] ?? null} hasCut={data.cutVideoIds.has(v.id)} />
            ))}
            {grouped[col].length === 0 && <div className="py-6 text-center text-[11px] text-muted-foreground/50 italic">empty</div>}
          </LaneColumn>
        ))}
      </Lane>
    )
  }

  const renderingVideoIds = new Set(Object.keys(data.renderJobIdByVideo))
  const grouped = videosByColumnWithEdit(data.videos, data.posts, {
    cutVideoIds: data.cutVideoIds,
    renderingVideoIds,
  })

  return (
    <Lane title="Videos" subtitle="Auto-advance through transcription, editing, and fanout" tone="neutral" help={HELP_COPY.videosLane} meta={meta}>
      <RenderWatcher jobIds={Object.values(data.renderJobIdByVideo)} />
      {VIDEO_COLUMNS_WITH_EDIT.map((col: VideoColumnWithEdit) => (
        <LaneColumn key={col} id={`video-${col}`} label={VIDEO_COLUMN_WITH_EDIT_LABELS[col]} count={grouped[col].length} accepts={false} tone={VIDEO_COLUMN_TONES[col] ?? "neutral"} help={VIDEO_COLUMN_HELP[col]}>
          {grouped[col].map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              counts={data.postCountsByVideo[v.id] ?? null}
              thumbnailUrl={data.thumbnailUrlsByVideo[v.id] ?? null}
              hasCut={data.cutVideoIds.has(v.id)}
              column={col}
              renderJobId={data.renderJobIdByVideo[v.id] ?? null}
              renderFailed={data.failedRenderVideoIds.has(v.id)}
            />
          ))}
          {grouped[col].length === 0 && <div className="py-6 text-center text-[11px] text-muted-foreground/50 italic">empty</div>}
        </LaneColumn>
      ))}
    </Lane>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors in the touched files.

- [ ] **Step 4: Commit**

```bash
git add components/admin/content-studio/pipeline/VideosLane.tsx
git commit -m "feat(content-studio): render edit columns on the Videos lane behind flag"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 2: Run the entire unit suite**

Run: `npm run test:run`
Expected: PASS. Pay attention to any test that constructs a `PipelineData` literal — it must now include `captionedCutEnabled`, `renderJobIdByVideo`, `failedRenderVideoIds`. Fix any such fixture by adding `captionedCutEnabled: false, renderJobIdByVideo: {}, failedRenderVideoIds: new Set()`.

- [ ] **Step 3: Lint + format check**

Run: `npm run lint` then `npm run format:check`
Expected: PASS. If format fails, run `npm run format` and re-stage.

- [ ] **Step 4: Manual smoke (flag off → on)**

Run: `npm run dev` and open `http://localhost:3050/admin/content`.
- With `feature_captioned_cut_enabled` **off**: Videos lane shows the original 5 columns (`Uploaded → Transcribing → Transcribed → Generated → Complete`), no action buttons. Expected.
- Flip the flag **on** in `/admin/settings` (or the `system_settings` row): lane now shows 7 columns; a transcribed gated video appears in **Needs Edit** with `Render cut` / `Mark ready`. Clicking `Render cut` toasts and the card moves to **Rendering** with a ticking timer; when the render finishes it advances to **Edited**. A failed render shows the red badge + `Retry render` in **Needs Edit**.

- [ ] **Step 5: Commit (only if Step 2/3 required fixture/format fixes)**

```bash
git add -A
git commit -m "test(content-studio): update pipeline fixtures for render signals"
```

---

## Self-Review notes (for the author)

- **Spec coverage:** column model (Tasks 1–2), flag fallback (Tasks 5, 9), data layer + reducer (Tasks 3–5), help copy (Task 6), live updates via `useAiJob`/`RenderWatcher` (Task 7, 9), VideoCard actions + rendering UI + edge cases (Task 8), testing (every task), out-of-scope items are simply not built. ✓
- **No new endpoint / no migration:** confirmed — uses existing `POST /api/admin/content-studio/captioned-cut` and `PATCH /api/admin/videos/[id]`. ✓
- **Type consistency:** `VideoEditSignals { hasCut, isRendering }`, `RenderSignals { renderJobIdByVideo, failedRenderVideoIds }`, `RecentCaptionRender { jobId, videoUploadId, status }`, `VideoColumnWithEdit`, and the `VideoCard` props (`column`, `renderJobId`, `renderFailed`, `hasCut`) are used consistently across tasks. ✓
- **Regression guard:** original `videoColumnFor`/`videosByColumn`/`VIDEO_COLUMNS` and all existing tests are untouched; legacy `VideoCard` (no `column`) keeps a single stretched link to `/admin/content/[id]`. ✓
