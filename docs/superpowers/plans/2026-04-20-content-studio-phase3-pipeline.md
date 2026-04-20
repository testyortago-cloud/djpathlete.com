# Content Studio Phase 3 — Pipeline Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 1 Pipeline placeholder with a two-lane Kanban board at `/admin/content` (and Videos / Posts tabs with flat list views). The Videos lane (top) shows videos auto-advancing through `Uploaded → Transcribing → Transcribed → Generated → Complete`. The Posts lane (bottom) shows post cards in `Needs Review → Approved → Scheduled → Published → Failed` that users manually advance via drag-drop or action buttons. Bulk approve, top-bar filters (platform / status / date range / source video), and retry-on-failure are all included. The board and list views open the Phase 2 drawer when cards are clicked.

**Architecture:**

- **Data.** A single server-side fetcher `getPipelineData(filters)` returns `{ videos, posts, postCountsByVideo }` — videos joined with an aggregate of their child posts, and posts joined with a `source_video_filename` projection so the cards do not need a second round-trip. Pipeline data is refetched on `router.refresh()` after mutations (Phase 3 does not introduce realtime subscriptions; the spec explicitly calls this as a deferred decision).
- **Lanes.** `<VideosLane>` and `<PostsLane>` each render their fixed column definitions. Cards are grouped client-side using pure derivation functions (easy to unit test).
- **Drag-drop.** `@dnd-kit/core` (already a dependency — see `components/admin/calendar/WeekGrid.tsx:7`). Each post card is a `useDraggable`, each column is a `useDroppable`. Dropping updates `approval_status` via existing API endpoints (`/approve`, `/reject`, `/publish-now`). A post going to `Scheduled` still needs a date/time — this phase forbids direct drag into Scheduled (user must use the schedule action on the card, which opens the existing `SchedulePickerDialog`). A post going to `Approved → Calendar-tab` is handled in Phase 4.
- **Bulk select.** Checkbox on each card; a floating action bar appears when ≥1 is selected showing `Approve N` / `Clear`.
- **Filters.** URL-driven search params (`?platform=`, `?status=`, `?from=`, `?to=`, `?sourceVideo=`). A pure `filterPostsAndVideos()` function applies them. Persisting them across sessions is Phase 5.
- **List views.** Videos and Posts tabs get minimal sortable tables that click through to the drawer. They reuse the same filter URL params.

**Tech Stack:** Next.js 16 App Router (React 19), TypeScript strict, Tailwind v4, `@dnd-kit/core` + `@dnd-kit/sortable`, Vitest + Testing Library, Playwright.

**Spec:** [docs/superpowers/specs/2026-04-20-content-studio-design.md](../specs/2026-04-20-content-studio-design.md) — see "Pipeline Board" section.

**Prerequisite:** Phase 1 (shell) and Phase 2 (drawer) complete.

---

## File Structure

**Create:**

- `lib/content-studio/pipeline-data.ts` — `getPipelineData(filters)` server fetcher
- `lib/content-studio/pipeline-columns.ts` — pure derivation functions `videosByColumn()` + `postsByColumn()`
- `lib/content-studio/pipeline-filters.ts` — pure `parseFilters()`, `applyFilters()`, `filtersToSearchParams()`
- `__tests__/lib/content-studio/pipeline-columns.test.ts`
- `__tests__/lib/content-studio/pipeline-filters.test.ts`
- `components/admin/content-studio/pipeline/VideoCard.tsx`
- `components/admin/content-studio/pipeline/PostCard.tsx`
- `components/admin/content-studio/pipeline/Lane.tsx`
- `components/admin/content-studio/pipeline/VideosLane.tsx`
- `components/admin/content-studio/pipeline/PostsLane.tsx`
- `components/admin/content-studio/pipeline/PipelineBoard.tsx`
- `components/admin/content-studio/pipeline/BulkActionsBar.tsx`
- `components/admin/content-studio/pipeline/PipelineFilters.tsx`
- `components/admin/content-studio/list/VideosList.tsx`
- `components/admin/content-studio/list/PostsList.tsx`
- `app/api/admin/content-studio/posts/[id]/status/route.ts` — unified status-transition endpoint used by drag-drop
- `__tests__/components/admin/content-studio/pipeline/VideoCard.test.tsx`
- `__tests__/components/admin/content-studio/pipeline/PostCard.test.tsx`
- `__tests__/components/admin/content-studio/pipeline/PipelineBoard.test.tsx`
- `__tests__/components/admin/content-studio/pipeline/BulkActionsBar.test.tsx`
- `__tests__/components/admin/content-studio/pipeline/PipelineFilters.test.tsx`
- `__tests__/components/admin/content-studio/list/VideosList.test.tsx`
- `__tests__/components/admin/content-studio/list/PostsList.test.tsx`
- `__tests__/api/content-studio/posts-status.test.ts`
- `__tests__/e2e/content-studio-pipeline.spec.ts`

**Modify:**

- `app/(admin)/admin/content/page.tsx` — mount PipelineBoard / VideosList / PostsList based on `?tab=`
- `app/(admin)/admin/content/[videoId]/page.tsx` — mount the same tab content behind the drawer so closing the drawer leaves the correct lane visible
- `lib/db/social-posts.ts` — add `listSocialPostsForPipeline(filters)` helper with joined source-video filename

---

## Task 1: Pipeline filters — pure derivation

**Files:**
- Create: `lib/content-studio/pipeline-filters.ts`
- Test: `__tests__/lib/content-studio/pipeline-filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/pipeline-filters.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import {
  parseFilters,
  filtersToSearchParams,
  applyFilters,
  type PipelineFilters,
} from "@/lib/content-studio/pipeline-filters"
import type { SocialPost, VideoUpload } from "@/types/database"

const video = (id: string, overrides: Partial<VideoUpload> = {}): VideoUpload => ({
  id,
  storage_path: `u/${id}.mp4`,
  original_filename: `${id}.mp4`,
  duration_seconds: 10,
  size_bytes: 100,
  mime_type: "video/mp4",
  title: id,
  uploaded_by: null,
  status: "transcribed",
  created_at: "2026-04-15T12:00:00Z",
  updated_at: "2026-04-15T12:00:00Z",
  ...overrides,
})

const post = (id: string, overrides: Partial<SocialPost> = {}): SocialPost => ({
  id,
  platform: "instagram",
  content: "x",
  media_url: null,
  approval_status: "needs_review",
  scheduled_at: null,
  published_at: null,
  source_video_id: "v1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: "u",
  created_at: "2026-04-15T12:00:00Z",
  updated_at: "2026-04-15T12:00:00Z",
  ...overrides,
})

describe("parseFilters", () => {
  it("returns empty filters when nothing is set", () => {
    expect(parseFilters(new URLSearchParams(""))).toEqual({
      platforms: [],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: null,
    })
  })

  it("splits comma-separated platform and status lists", () => {
    const f = parseFilters(new URLSearchParams("platform=instagram,tiktok&status=approved,scheduled"))
    expect(f.platforms).toEqual(["instagram", "tiktok"])
    expect(f.statuses).toEqual(["approved", "scheduled"])
  })

  it("drops unknown platform and status tokens", () => {
    const f = parseFilters(new URLSearchParams("platform=instagram,nope&status=approved,bogus"))
    expect(f.platforms).toEqual(["instagram"])
    expect(f.statuses).toEqual(["approved"])
  })

  it("parses from/to ISO dates", () => {
    const f = parseFilters(new URLSearchParams("from=2026-04-01&to=2026-04-30"))
    expect(f.from).toBe("2026-04-01")
    expect(f.to).toBe("2026-04-30")
  })

  it("parses sourceVideoId", () => {
    const f = parseFilters(new URLSearchParams("sourceVideo=video-abc"))
    expect(f.sourceVideoId).toBe("video-abc")
  })
})

describe("filtersToSearchParams", () => {
  it("round-trips a full filter set", () => {
    const f: PipelineFilters = {
      platforms: ["instagram", "tiktok"],
      statuses: ["approved"],
      from: "2026-04-01",
      to: "2026-04-30",
      sourceVideoId: "video-1",
    }
    const sp = filtersToSearchParams(f)
    expect(sp.get("platform")).toBe("instagram,tiktok")
    expect(sp.get("status")).toBe("approved")
    expect(sp.get("from")).toBe("2026-04-01")
    expect(sp.get("to")).toBe("2026-04-30")
    expect(sp.get("sourceVideo")).toBe("video-1")
  })

  it("omits keys with empty values", () => {
    const f: PipelineFilters = {
      platforms: [],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: null,
    }
    const sp = filtersToSearchParams(f)
    expect(sp.toString()).toBe("")
  })
})

describe("applyFilters", () => {
  const posts: SocialPost[] = [
    post("p1", { platform: "instagram", approval_status: "approved", source_video_id: "v1" }),
    post("p2", { platform: "tiktok", approval_status: "scheduled", source_video_id: "v2", scheduled_at: "2026-04-20T10:00:00Z" }),
    post("p3", { platform: "facebook", approval_status: "published", source_video_id: "v1", published_at: "2026-04-01T10:00:00Z" }),
  ]
  const videos: VideoUpload[] = [video("v1"), video("v2")]

  it("filters posts by platform", () => {
    const { posts: filtered } = applyFilters(videos, posts, {
      platforms: ["instagram"],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: null,
    })
    expect(filtered.map((p) => p.id)).toEqual(["p1"])
  })

  it("filters posts by status", () => {
    const { posts: filtered } = applyFilters(videos, posts, {
      platforms: [],
      statuses: ["scheduled", "published"],
      from: null,
      to: null,
      sourceVideoId: null,
    })
    expect(filtered.map((p) => p.id).sort()).toEqual(["p2", "p3"])
  })

  it("filters posts by date range against scheduled_at OR published_at OR created_at", () => {
    const { posts: filtered } = applyFilters(videos, posts, {
      platforms: [],
      statuses: [],
      from: "2026-04-15",
      to: "2026-04-21",
      sourceVideoId: null,
    })
    // p2 scheduled 2026-04-20 — in range; p3 published 2026-04-01 — out; p1 created_at 2026-04-15 — in
    expect(filtered.map((p) => p.id).sort()).toEqual(["p1", "p2"])
  })

  it("filters posts by sourceVideoId", () => {
    const { posts: filtered } = applyFilters(videos, posts, {
      platforms: [],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: "v2",
    })
    expect(filtered.map((p) => p.id)).toEqual(["p2"])
  })

  it("filters videos to only those whose child posts pass the filter", () => {
    const { videos: filtered } = applyFilters(videos, posts, {
      platforms: ["tiktok"],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: null,
    })
    expect(filtered.map((v) => v.id)).toEqual(["v2"])
  })

  it("when no filters are set, returns everything", () => {
    const out = applyFilters(videos, posts, {
      platforms: [],
      statuses: [],
      from: null,
      to: null,
      sourceVideoId: null,
    })
    expect(out.videos.length).toBe(2)
    expect(out.posts.length).toBe(3)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:run -- __tests__/lib/content-studio/pipeline-filters.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/content-studio/pipeline-filters.ts`:

```typescript
import type { SocialPost, SocialPlatform, SocialApprovalStatus, VideoUpload } from "@/types/database"

const ALL_PLATFORMS: readonly SocialPlatform[] = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "youtube_shorts",
  "linkedin",
]
const ALL_STATUSES: readonly SocialApprovalStatus[] = [
  "draft",
  "edited",
  "approved",
  "scheduled",
  "published",
  "rejected",
  "awaiting_connection",
  "failed",
]

export interface PipelineFilters {
  platforms: SocialPlatform[]
  statuses: SocialApprovalStatus[]
  /** ISO-date "YYYY-MM-DD" or null. Inclusive. */
  from: string | null
  to: string | null
  sourceVideoId: string | null
}

export function parseFilters(sp: URLSearchParams): PipelineFilters {
  const platforms = (sp.get("platform") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SocialPlatform => (ALL_PLATFORMS as readonly string[]).includes(s))
  const statuses = (sp.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SocialApprovalStatus => (ALL_STATUSES as readonly string[]).includes(s))
  return {
    platforms,
    statuses,
    from: sp.get("from")?.trim() || null,
    to: sp.get("to")?.trim() || null,
    sourceVideoId: sp.get("sourceVideo")?.trim() || null,
  }
}

export function filtersToSearchParams(filters: PipelineFilters): URLSearchParams {
  const sp = new URLSearchParams()
  if (filters.platforms.length) sp.set("platform", filters.platforms.join(","))
  if (filters.statuses.length) sp.set("status", filters.statuses.join(","))
  if (filters.from) sp.set("from", filters.from)
  if (filters.to) sp.set("to", filters.to)
  if (filters.sourceVideoId) sp.set("sourceVideo", filters.sourceVideoId)
  return sp
}

function postMatchesTimeRange(post: SocialPost, from: string | null, to: string | null): boolean {
  if (!from && !to) return true
  // Pick the most-meaningful time axis for this post.
  const ref = post.scheduled_at ?? post.published_at ?? post.created_at
  const d = new Date(ref).getTime()
  if (Number.isNaN(d)) return true
  if (from) {
    const fromTs = new Date(`${from}T00:00:00Z`).getTime()
    if (d < fromTs) return false
  }
  if (to) {
    const toTs = new Date(`${to}T23:59:59.999Z`).getTime()
    if (d > toTs) return false
  }
  return true
}

export function applyFilters(
  videos: VideoUpload[],
  posts: SocialPost[],
  filters: PipelineFilters,
): { videos: VideoUpload[]; posts: SocialPost[] } {
  const filteredPosts = posts.filter((p) => {
    if (filters.platforms.length && !filters.platforms.includes(p.platform)) return false
    if (filters.statuses.length && !filters.statuses.includes(p.approval_status)) return false
    if (filters.sourceVideoId && p.source_video_id !== filters.sourceVideoId) return false
    if (!postMatchesTimeRange(p, filters.from, filters.to)) return false
    return true
  })

  // A video is included if any of its child posts match, OR if the user has not
  // supplied any post-scoped filter (platforms, statuses, source, time range).
  const hasPostScopedFilter =
    filters.platforms.length > 0 ||
    filters.statuses.length > 0 ||
    filters.sourceVideoId !== null ||
    filters.from !== null ||
    filters.to !== null

  const allowedVideoIds = new Set(filteredPosts.map((p) => p.source_video_id).filter((id): id is string => !!id))
  const filteredVideos = hasPostScopedFilter
    ? videos.filter((v) => allowedVideoIds.has(v.id))
    : videos

  return { videos: filteredVideos, posts: filteredPosts }
}
```

- [ ] **Step 4: Run and verify**

```bash
npm run test:run -- __tests__/lib/content-studio/pipeline-filters.test.ts
```

Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/content-studio/pipeline-filters.ts __tests__/lib/content-studio/pipeline-filters.test.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): pipeline filters — pure parse/apply/serialize

URL-driven filter state. Parsing and predicate logic is pure so the tests run
without DB or router stubs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pipeline columns — pure derivation

**Files:**
- Create: `lib/content-studio/pipeline-columns.ts`
- Test: `__tests__/lib/content-studio/pipeline-columns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/pipeline-columns.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import {
  videoColumnFor,
  videosByColumn,
  postColumnFor,
  postsByColumn,
  VIDEO_COLUMNS,
  POST_COLUMNS,
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
  status: "uploaded",
  created_at: "",
  updated_at: "",
  ...o,
})

const post = (id: string, o: Partial<SocialPost> = {}): SocialPost => ({
  id,
  platform: "instagram",
  content: "x",
  media_url: null,
  approval_status: "needs_review",
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

describe("videoColumnFor", () => {
  it("maps status to column", () => {
    expect(videoColumnFor(video("v1", { status: "uploaded" }), [])).toBe("uploaded")
    expect(videoColumnFor(video("v1", { status: "transcribing" }), [])).toBe("transcribing")
    expect(videoColumnFor(video("v1", { status: "transcribed" }), [])).toBe("transcribed")
    expect(videoColumnFor(video("v1", { status: "failed" }), [])).toBe("transcribing") // fails sit in the transcribing column with a badge
  })

  it("moves video to 'generated' when it has posts but none are published", () => {
    const v = video("v1", { status: "transcribed" })
    const posts = [post("p1", { source_video_id: "v1", approval_status: "approved" })]
    expect(videoColumnFor(v, posts)).toBe("generated")
  })

  it("moves video to 'complete' when ALL child posts are published", () => {
    const v = video("v1", { status: "analyzed" })
    const posts = [
      post("p1", { source_video_id: "v1", approval_status: "published" }),
      post("p2", { source_video_id: "v1", approval_status: "published" }),
    ]
    expect(videoColumnFor(v, posts)).toBe("complete")
  })
})

describe("videosByColumn", () => {
  it("groups videos by their derived column", () => {
    const vs = [video("v1", { status: "uploaded" }), video("v2", { status: "transcribing" })]
    const grouped = videosByColumn(vs, [])
    expect(grouped.uploaded.map((v) => v.id)).toEqual(["v1"])
    expect(grouped.transcribing.map((v) => v.id)).toEqual(["v2"])
  })

  it("returns empty arrays for columns with no matches", () => {
    const grouped = videosByColumn([], [])
    for (const col of VIDEO_COLUMNS) expect(grouped[col]).toEqual([])
  })
})

describe("postColumnFor", () => {
  it("maps approval_status to post columns", () => {
    expect(postColumnFor(post("p", { approval_status: "needs_review" }))).toBe("needs_review")
    expect(postColumnFor(post("p", { approval_status: "draft" }))).toBe("needs_review")
    expect(postColumnFor(post("p", { approval_status: "edited" }))).toBe("needs_review")
    expect(postColumnFor(post("p", { approval_status: "approved" }))).toBe("approved")
    expect(postColumnFor(post("p", { approval_status: "awaiting_connection" }))).toBe("approved")
    expect(postColumnFor(post("p", { approval_status: "scheduled" }))).toBe("scheduled")
    expect(postColumnFor(post("p", { approval_status: "published" }))).toBe("published")
    expect(postColumnFor(post("p", { approval_status: "failed" }))).toBe("failed")
    expect(postColumnFor(post("p", { approval_status: "rejected" }))).toBe(null)
  })
})

describe("postsByColumn", () => {
  it("excludes rejected posts by default", () => {
    const ps = [post("p1", { approval_status: "needs_review" }), post("p2", { approval_status: "rejected" })]
    const grouped = postsByColumn(ps)
    expect(grouped.needs_review.map((p) => p.id)).toEqual(["p1"])
    for (const col of POST_COLUMNS) {
      expect(grouped[col].find((p) => p.id === "p2")).toBeUndefined()
    }
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:run -- __tests__/lib/content-studio/pipeline-columns.test.ts
```

- [ ] **Step 3: Write implementation**

Create `lib/content-studio/pipeline-columns.ts`:

```typescript
import type { SocialPost, VideoUpload } from "@/types/database"

export const VIDEO_COLUMNS = [
  "uploaded",
  "transcribing",
  "transcribed",
  "generated",
  "complete",
] as const
export type VideoColumn = (typeof VIDEO_COLUMNS)[number]

export const VIDEO_COLUMN_LABELS: Record<VideoColumn, string> = {
  uploaded: "Uploaded",
  transcribing: "Transcribing",
  transcribed: "Transcribed",
  generated: "Generated",
  complete: "Complete",
}

export const POST_COLUMNS = [
  "needs_review",
  "approved",
  "scheduled",
  "published",
  "failed",
] as const
export type PostColumn = (typeof POST_COLUMNS)[number]

export const POST_COLUMN_LABELS: Record<PostColumn, string> = {
  needs_review: "Needs Review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
}

export function videoColumnFor(video: VideoUpload, posts: SocialPost[]): VideoColumn {
  const myPosts = posts.filter((p) => p.source_video_id === video.id)
  if (myPosts.length > 0) {
    const allPublished = myPosts.every((p) => p.approval_status === "published")
    if (allPublished) return "complete"
    return "generated"
  }

  switch (video.status) {
    case "uploaded":
      return "uploaded"
    case "transcribing":
    case "failed":
      return "transcribing"
    case "transcribed":
    case "analyzed":
      return "transcribed"
  }
}

export function videosByColumn(
  videos: VideoUpload[],
  posts: SocialPost[],
): Record<VideoColumn, VideoUpload[]> {
  const out: Record<VideoColumn, VideoUpload[]> = {
    uploaded: [],
    transcribing: [],
    transcribed: [],
    generated: [],
    complete: [],
  }
  for (const v of videos) out[videoColumnFor(v, posts)].push(v)
  return out
}

export function postColumnFor(post: SocialPost): PostColumn | null {
  switch (post.approval_status) {
    case "draft":
    case "edited":
    case "needs_review":
      return "needs_review"
    case "approved":
    case "awaiting_connection":
      return "approved"
    case "scheduled":
      return "scheduled"
    case "published":
      return "published"
    case "failed":
      return "failed"
    case "rejected":
      return null
  }
}

export function postsByColumn(posts: SocialPost[]): Record<PostColumn, SocialPost[]> {
  const out: Record<PostColumn, SocialPost[]> = {
    needs_review: [],
    approved: [],
    scheduled: [],
    published: [],
    failed: [],
  }
  for (const p of posts) {
    const col = postColumnFor(p)
    if (col) out[col].push(p)
  }
  return out
}
```

Note: the spec uses `Needs Review` as the human label — the DB enum adds `draft` and `edited` from the existing fanout flow so we lump them here too.

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/lib/content-studio/pipeline-columns.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/content-studio/pipeline-columns.ts __tests__/lib/content-studio/pipeline-columns.test.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): pipeline column derivation functions

Pure derivation — given videos + posts, return which column they belong in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Pipeline data fetcher + DAL helper

**Files:**
- Modify: `lib/db/social-posts.ts`
- Create: `lib/content-studio/pipeline-data.ts`

- [ ] **Step 1: Add DAL helper that joins the source-video filename**

Append to `lib/db/social-posts.ts`:

```typescript
export interface PipelinePostRow extends SocialPost {
  source_video_filename: string | null
}

export async function listSocialPostsForPipeline(): Promise<PipelinePostRow[]> {
  const supabase = getClient()
  // Supabase's select() projection can pull related rows via the FK named fk_social_posts_source_video
  // (see migration 00079). We project just the filename column.
  const { data, error } = await supabase
    .from("social_posts")
    .select("*, video_uploads(original_filename)")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: SocialPost & { video_uploads?: { original_filename: string } | null }) => ({
    ...(row as SocialPost),
    source_video_filename: row.video_uploads?.original_filename ?? null,
  }))
}
```

- [ ] **Step 2: Write the pipeline data fetcher**

Create `lib/content-studio/pipeline-data.ts`:

```typescript
import { listVideoUploads } from "@/lib/db/video-uploads"
import { listSocialPostsForPipeline, type PipelinePostRow } from "@/lib/db/social-posts"
import type { VideoUpload } from "@/types/database"

export interface PipelineData {
  videos: VideoUpload[]
  posts: PipelinePostRow[]
  /** {videoId: {total, approved, scheduled, published, failed}} */
  postCountsByVideo: Record<string, PostCounts>
}

export interface PostCounts {
  total: number
  approved: number
  scheduled: number
  published: number
  failed: number
  needs_review: number
}

function emptyCounts(): PostCounts {
  return { total: 0, approved: 0, scheduled: 0, published: 0, failed: 0, needs_review: 0 }
}

export async function getPipelineData(): Promise<PipelineData> {
  const [videos, posts] = await Promise.all([
    listVideoUploads({ limit: 200 }),
    listSocialPostsForPipeline(),
  ])

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
      case "needs_review":
        counts.needs_review += 1
        break
    }
  }

  return { videos, posts, postCountsByVideo }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/db/social-posts.ts lib/content-studio/pipeline-data.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): pipeline data fetcher + post-counts aggregator

Joins social_posts to video_uploads.original_filename for the card corner
badge, and derives per-video approval/scheduled/published/failed tallies for
the lane card summary line.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: VideoCard component

**Files:**
- Create: `components/admin/content-studio/pipeline/VideoCard.tsx`
- Test: `__tests__/components/admin/content-studio/pipeline/VideoCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/pipeline/VideoCard.test.tsx`:

```typescript
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { VideoCard } from "@/components/admin/content-studio/pipeline/VideoCard"
import type { VideoUpload } from "@/types/database"

const video: VideoUpload = {
  id: "v1",
  storage_path: "u/v1.mp4",
  original_filename: "rotational-reboot.mp4",
  duration_seconds: 65,
  size_bytes: 5_000_000,
  mime_type: "video/mp4",
  title: "Rotational Reboot",
  uploaded_by: null,
  status: "transcribed",
  created_at: "2026-04-15T00:00:00Z",
  updated_at: "2026-04-15T00:00:00Z",
}

describe("<VideoCard>", () => {
  it("renders filename and duration", () => {
    render(<VideoCard video={video} counts={null} />)
    expect(screen.getByText(/Rotational Reboot/)).toBeInTheDocument()
    expect(screen.getByText(/1:05/)).toBeInTheDocument()
  })

  it("renders the status badge", () => {
    render(<VideoCard video={video} counts={null} />)
    expect(screen.getByText(/transcribed/i)).toBeInTheDocument()
  })

  it("renders the post summary line when counts are present", () => {
    render(
      <VideoCard
        video={video}
        counts={{ total: 6, approved: 4, scheduled: 2, published: 0, failed: 0, needs_review: 0 }}
      />,
    )
    expect(screen.getByText(/6 posts/)).toBeInTheDocument()
    expect(screen.getByText(/4.*approved/i)).toBeInTheDocument()
    expect(screen.getByText(/2.*scheduled/i)).toBeInTheDocument()
  })

  it("links to /admin/content/[videoId] so clicking opens the drawer", () => {
    render(<VideoCard video={video} counts={null} />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/content/v1")
  })

  it("renders a red error badge when video status is 'failed'", () => {
    render(<VideoCard video={{ ...video, status: "failed" }} counts={null} />)
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:run -- __tests__/components/admin/content-studio/pipeline/VideoCard.test.tsx
```

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/pipeline/VideoCard.tsx`:

```typescript
import Link from "next/link"
import { Film, AlertCircle, Clock, Loader2, CheckCircle } from "lucide-react"
import type { VideoUpload } from "@/types/database"
import type { PostCounts } from "@/lib/content-studio/pipeline-data"
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
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded bg-muted/40">
      <Film className="size-3" /> Uploaded
    </span>
  )
}

interface VideoCardProps {
  video: VideoUpload
  counts: PostCounts | null
}

export function VideoCard({ video, counts }: VideoCardProps) {
  const title = video.title ?? video.original_filename
  const isFailed = video.status === "failed"

  return (
    <Link
      href={`/admin/content/${video.id}`}
      className={cn(
        "group block rounded-lg border border-border bg-white hover:border-primary/50 transition p-3 space-y-2",
        isFailed && "border-error/40",
      )}
    >
      <div className="aspect-video bg-muted/50 rounded-md overflow-hidden flex items-center justify-center">
        <Film className="size-6 text-muted-foreground/60" strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-sm font-medium text-primary truncate" title={title}>
          {title}
        </p>
        <p className="text-[11px] text-muted-foreground truncate" title={video.original_filename}>
          {video.original_filename}
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <StatusBadge status={video.status} />
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> {formatDuration(video.duration_seconds)}
        </span>
      </div>
      {counts && counts.total > 0 && (
        <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
          {counts.total} posts ·{" "}
          <span className="text-success">✓{counts.approved} approved</span>
          {counts.scheduled > 0 && (
            <>
              {" · "}
              <span className="text-accent">⏱{counts.scheduled} scheduled</span>
            </>
          )}
          {counts.published > 0 && (
            <>
              {" · "}
              <span className="text-primary">●{counts.published} published</span>
            </>
          )}
          {counts.failed > 0 && (
            <>
              {" · "}
              <span className="text-error">✗{counts.failed} failed</span>
            </>
          )}
        </p>
      )}
    </Link>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/pipeline/VideoCard.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/pipeline/VideoCard.tsx __tests__/components/admin/content-studio/pipeline/VideoCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): VideoCard — thumbnail + filename + status + post summary

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: PostCard component (draggable)

**Files:**
- Create: `components/admin/content-studio/pipeline/PostCard.tsx`
- Test: `__tests__/components/admin/content-studio/pipeline/PostCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/pipeline/PostCard.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { PostCard } from "@/components/admin/content-studio/pipeline/PostCard"
import type { PipelinePostRow } from "@/lib/db/social-posts"

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

const post = (overrides: Partial<PipelinePostRow> = {}): PipelinePostRow => ({
  id: "p1",
  platform: "instagram",
  content: "Great caption body goes here for preview.",
  media_url: null,
  approval_status: "approved",
  scheduled_at: null,
  published_at: null,
  source_video_id: "v1",
  source_video_filename: "rotational-reboot.mp4",
  rejection_notes: null,
  platform_post_id: null,
  created_by: null,
  created_at: "2026-04-15T00:00:00Z",
  updated_at: "2026-04-15T00:00:00Z",
  ...overrides,
})

describe("<PostCard>", () => {
  it("renders platform icon + 2-line caption + source video filename", () => {
    render(wrap(<PostCard post={post()} selected={false} onToggleSelected={vi.fn()} />))
    expect(screen.getByText(/Great caption/)).toBeInTheDocument()
    expect(screen.getByText(/rotational-reboot\.mp4/)).toBeInTheDocument()
  })

  it("renders a scheduled-for line when scheduled_at is set", () => {
    render(
      wrap(
        <PostCard
          post={post({ approval_status: "scheduled", scheduled_at: "2026-04-20T10:00:00Z" })}
          selected={false}
          onToggleSelected={vi.fn()}
        />,
      ),
    )
    expect(screen.getByText(/2026|Apr/)).toBeInTheDocument()
  })

  it("selection checkbox toggles via callback", () => {
    const onToggle = vi.fn()
    render(wrap(<PostCard post={post()} selected={false} onToggleSelected={onToggle} />))
    fireEvent.click(screen.getByRole("checkbox"))
    expect(onToggle).toHaveBeenCalledWith("p1", true)
  })

  it("links header to /admin/content/post/[postId]", () => {
    render(wrap(<PostCard post={post()} selected={false} onToggleSelected={vi.fn()} />))
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/content/post/p1")
  })

  it("renders a red border + retry hint when failed", () => {
    const { container } = render(
      wrap(
        <PostCard
          post={post({ approval_status: "failed", rejection_notes: "FB 500" })}
          selected={false}
          onToggleSelected={vi.fn()}
        />,
      ),
    )
    expect(container.firstChild).toHaveClass(/border-error/)
    expect(screen.getByText(/FB 500/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:run -- __tests__/components/admin/content-studio/pipeline/PostCard.test.tsx
```

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/pipeline/PostCard.tsx`:

```typescript
"use client"

import Link from "next/link"
import { useDraggable } from "@dnd-kit/core"
import {
  Facebook,
  Instagram,
  Music2,
  Youtube,
  Linkedin,
  Film,
  Clock,
  AlertCircle,
} from "lucide-react"
import type { PipelinePostRow } from "@/lib/db/social-posts"
import type { SocialPlatform } from "@/types/database"
import { cn } from "@/lib/utils"

const PLATFORM_ICONS: Record<SocialPlatform, typeof Facebook> = {
  facebook: Facebook,
  instagram: Instagram,
  tiktok: Music2,
  youtube: Youtube,
  youtube_shorts: Youtube,
  linkedin: Linkedin,
}

interface PostCardProps {
  post: PipelinePostRow
  selected: boolean
  onToggleSelected: (postId: string, selected: boolean) => void
}

export function PostCard({ post, selected, onToggleSelected }: PostCardProps) {
  const isPublished = post.approval_status === "published"
  const isFailed = post.approval_status === "failed"
  const isDraggable = !isPublished

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: post.id,
    disabled: !isDraggable,
  })
  const Icon = PLATFORM_ICONS[post.platform]

  const scheduled = post.scheduled_at
    ? new Date(post.scheduled_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null

  return (
    <div
      ref={setNodeRef}
      {...(isDraggable ? { ...attributes, ...listeners } : {})}
      className={cn(
        "group relative rounded-lg border border-border bg-white p-3 transition",
        isDraggable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        isFailed && "border-error/40 bg-error/5",
        isPublished && "opacity-75",
      )}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelected(post.id, e.target.checked)}
          onPointerDown={(e) => e.stopPropagation()} // don't start a drag
          aria-label={`Select post ${post.id}`}
          className="mt-0.5 size-4 rounded border-border text-primary focus:ring-primary/30"
        />
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="size-4 text-primary" />
        </div>
        <Link
          href={`/admin/content/post/${post.id}`}
          className="flex-1 min-w-0"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-primary line-clamp-2" title={post.content}>
            {post.content}
          </p>
        </Link>
      </div>
      {post.source_video_filename && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
          <Film className="size-3 shrink-0" /> {post.source_video_filename}
        </p>
      )}
      {scheduled && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-accent">
          <Clock className="size-3" /> {scheduled}
        </p>
      )}
      {isFailed && post.rejection_notes && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-error">
          <AlertCircle className="size-3 shrink-0 mt-0.5" />
          <span className="line-clamp-2">{post.rejection_notes}</span>
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/pipeline/PostCard.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/pipeline/PostCard.tsx __tests__/components/admin/content-studio/pipeline/PostCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): PostCard — draggable + selectable + source-video corner

Clicking the caption body opens the post-only drawer route; clicking the
checkbox selects without starting a drag; published cards are non-draggable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Lane + Column primitives

**Files:**
- Create: `components/admin/content-studio/pipeline/Lane.tsx`

- [ ] **Step 1: Write the implementation**

This component is trivial composition; the Playwright e2e in Task 14 covers integration. Create `components/admin/content-studio/pipeline/Lane.tsx`:

```typescript
"use client"

import { useDroppable } from "@dnd-kit/core"
import { cn } from "@/lib/utils"

export function LaneColumn({
  id,
  label,
  count,
  accepts,
  children,
}: {
  id: string
  label: string
  count: number
  /** If false, this column is read-only; drops are ignored. */
  accepts: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !accepts })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-lg bg-surface/40 min-h-[200px] min-w-[260px] w-[260px] transition",
        accepts && isOver && "bg-primary/5 ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide">{label}</p>
        <span className="text-[11px] text-muted-foreground">{count}</span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">{children}</div>
    </div>
  )
}

export function Lane({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <div>
        <h3 className="font-heading text-sm text-primary uppercase tracking-wide">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">{children}</div>
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/content-studio/pipeline/Lane.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): Lane + LaneColumn primitives (droppable, horizontal)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Unified post status-transition API

Drag-drop needs a single endpoint that can move a post between any columns. Today the codebase has `/approve`, `/reject`, `/unschedule`, and `/publish-now` — they are all specific. We add one umbrella endpoint that validates the target column and routes to the correct write.

**Files:**
- Create: `app/api/admin/content-studio/posts/[id]/status/route.ts`
- Test: `__tests__/api/content-studio/posts-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/content-studio/posts-status.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u", role: "admin" } })),
}))

const mockGetPost = vi.fn()
const mockUpdatePost = vi.fn()

vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (...args: unknown[]) => mockGetPost(...args),
  updateSocialPost: (...args: unknown[]) => mockUpdatePost(...args),
}))

import { POST } from "@/app/api/admin/content-studio/posts/[id]/status/route"

function req(body: unknown): Request {
  return new Request("http://localhost/api/admin/content-studio/posts/p1/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const basePost = {
  id: "p1",
  platform: "instagram",
  content: "x",
  media_url: null,
  approval_status: "needs_review",
  scheduled_at: null,
  published_at: null,
  source_video_id: "v1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: null,
  created_at: "",
  updated_at: "",
}

describe("POST /api/admin/content-studio/posts/[id]/status", () => {
  beforeEach(() => {
    mockGetPost.mockReset()
    mockUpdatePost.mockReset()
  })

  it("rejects an unknown target column", async () => {
    const res = await POST(req({ targetColumn: "bogus" }), { params: Promise.resolve({ id: "p1" }) })
    expect(res.status).toBe(400)
  })

  it("needs_review → approved: updates approval_status=approved", async () => {
    mockGetPost.mockResolvedValueOnce(basePost)
    mockUpdatePost.mockResolvedValueOnce({ ...basePost, approval_status: "approved" })
    const res = await POST(
      req({ targetColumn: "approved" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(200)
    expect(mockUpdatePost).toHaveBeenCalledWith("p1", expect.objectContaining({ approval_status: "approved" }))
  })

  it("approved → needs_review: moves back", async () => {
    mockGetPost.mockResolvedValueOnce({ ...basePost, approval_status: "approved" })
    mockUpdatePost.mockResolvedValueOnce({ ...basePost, approval_status: "needs_review" })
    const res = await POST(
      req({ targetColumn: "needs_review" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(200)
    expect(mockUpdatePost).toHaveBeenCalledWith("p1", expect.objectContaining({ approval_status: "needs_review" }))
  })

  it("rejects a drop directly into 'scheduled' (requires date picker)", async () => {
    mockGetPost.mockResolvedValueOnce({ ...basePost, approval_status: "approved" })
    const res = await POST(
      req({ targetColumn: "scheduled" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(409)
    expect(mockUpdatePost).not.toHaveBeenCalled()
  })

  it("rejects a drop into 'published' (server-side side effect only)", async () => {
    mockGetPost.mockResolvedValueOnce({ ...basePost, approval_status: "approved" })
    const res = await POST(
      req({ targetColumn: "published" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(409)
  })

  it("failed → needs_review: clears rejection_notes", async () => {
    mockGetPost.mockResolvedValueOnce({ ...basePost, approval_status: "failed", rejection_notes: "boom" })
    mockUpdatePost.mockResolvedValueOnce({ ...basePost, approval_status: "needs_review", rejection_notes: null })
    const res = await POST(
      req({ targetColumn: "needs_review" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(200)
    expect(mockUpdatePost).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ approval_status: "needs_review", rejection_notes: null }),
    )
  })

  it("404 when the post does not exist", async () => {
    mockGetPost.mockResolvedValueOnce(null)
    const res = await POST(req({ targetColumn: "approved" }), { params: Promise.resolve({ id: "p1" }) })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:run -- __tests__/api/content-studio/posts-status.test.ts
```

- [ ] **Step 3: Write the route handler**

Create `app/api/admin/content-studio/posts/[id]/status/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import type { SocialApprovalStatus } from "@/types/database"

const ALLOWED_COLUMNS = ["needs_review", "approved", "scheduled", "published", "failed"] as const
type TargetColumn = (typeof ALLOWED_COLUMNS)[number]

function isColumn(v: unknown): v is TargetColumn {
  return typeof v === "string" && (ALLOWED_COLUMNS as readonly string[]).includes(v)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { targetColumn?: string } | null
  const target = body?.targetColumn
  if (!isColumn(target)) {
    return NextResponse.json({ error: "targetColumn must be one of needs_review|approved|scheduled|published|failed" }, { status: 400 })
  }

  // Scheduled requires a date/time picker — reject direct drag.
  // Published is a server-side side effect of the publish worker — reject.
  if (target === "scheduled") {
    return NextResponse.json(
      { error: "Use the schedule dialog to pick a date/time" },
      { status: 409 },
    )
  }
  if (target === "published") {
    return NextResponse.json(
      { error: "Posts publish automatically — use Publish Now instead" },
      { status: 409 },
    )
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

  // Map target column → resulting approval_status
  const nextStatus: SocialApprovalStatus =
    target === "needs_review" ? "needs_review" : target === "approved" ? "approved" : "failed"

  const patch: Parameters<typeof updateSocialPost>[1] = { approval_status: nextStatus }
  if (target === "needs_review" && post.approval_status === "failed") {
    patch.rejection_notes = null
    patch.scheduled_at = null
  }

  const updated = await updateSocialPost(id, patch)
  return NextResponse.json({ id: updated.id, approval_status: updated.approval_status })
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/api/content-studio/posts-status.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/content-studio/posts/\[id\]/status/route.ts __tests__/api/content-studio/posts-status.test.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): unified post-status-transition API for drag-drop

Single endpoint that validates the target column and either updates
approval_status directly or rejects (scheduled/published) as out-of-scope
for a raw drag. Clears rejection_notes when moving a failed post back to
needs_review.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: VideosLane — read-only

**Files:**
- Create: `components/admin/content-studio/pipeline/VideosLane.tsx`

- [ ] **Step 1: Write the implementation**

Videos auto-advance from backend state — this lane is read-only (no drag). Create `components/admin/content-studio/pipeline/VideosLane.tsx`:

```typescript
"use client"

import { VIDEO_COLUMNS, VIDEO_COLUMN_LABELS, videosByColumn } from "@/lib/content-studio/pipeline-columns"
import { Lane, LaneColumn } from "./Lane"
import { VideoCard } from "./VideoCard"
import type { PipelineData } from "@/lib/content-studio/pipeline-data"

interface VideosLaneProps {
  data: PipelineData
}

export function VideosLane({ data }: VideosLaneProps) {
  const grouped = videosByColumn(data.videos, data.posts)

  return (
    <Lane title="Videos" subtitle="Auto-advance based on transcription + fanout state">
      {VIDEO_COLUMNS.map((col) => (
        <LaneColumn
          key={col}
          id={`video-${col}`}
          label={VIDEO_COLUMN_LABELS[col]}
          count={grouped[col].length}
          accepts={false}
        >
          {grouped[col].map((v) => (
            <VideoCard key={v.id} video={v} counts={data.postCountsByVideo[v.id] ?? null} />
          ))}
          {grouped[col].length === 0 && (
            <div className="py-6 text-center text-[11px] text-muted-foreground/60 italic">
              empty
            </div>
          )}
        </LaneColumn>
      ))}
    </Lane>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/content-studio/pipeline/VideosLane.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): VideosLane — read-only columns keyed off backend status

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: PostsLane with drag-drop

**Files:**
- Create: `components/admin/content-studio/pipeline/PostsLane.tsx`

- [ ] **Step 1: Write the implementation**

Create `components/admin/content-studio/pipeline/PostsLane.tsx`:

```typescript
"use client"

import { useState } from "react"
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { POST_COLUMNS, POST_COLUMN_LABELS, postsByColumn } from "@/lib/content-studio/pipeline-columns"
import { Lane, LaneColumn } from "./Lane"
import { PostCard } from "./PostCard"
import type { PipelinePostRow } from "@/lib/db/social-posts"

interface PostsLaneProps {
  posts: PipelinePostRow[]
  selectedIds: Set<string>
  onToggleSelected: (postId: string, selected: boolean) => void
}

export function PostsLane({ posts: initialPosts, selectedIds, onToggleSelected }: PostsLaneProps) {
  const [posts, setPosts] = useState(initialPosts)
  const router = useRouter()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const grouped = postsByColumn(posts)

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const overId = String(over.id)
    if (!overId.startsWith("post-")) return
    const targetColumn = overId.slice("post-".length)

    const post = posts.find((p) => p.id === active.id)
    if (!post) return

    // Reject unsupported direct drops (also blocked by the API, fail fast on client)
    if (targetColumn === "scheduled" || targetColumn === "published") {
      toast.info(
        targetColumn === "scheduled"
          ? "Use the Schedule action on the card to pick a date"
          : "Posts publish automatically when scheduled time arrives",
      )
      return
    }

    const prevStatus = post.approval_status
    // Optimistic update — map target column to a valid approval_status
    const optimistic =
      targetColumn === "needs_review" ? "needs_review" : targetColumn === "approved" ? "approved" : "failed"
    setPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, approval_status: optimistic } : p)),
    )

    try {
      const res = await fetch(`/api/admin/content-studio/posts/${post.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetColumn }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Move failed")
      toast.success(`Moved to ${POST_COLUMN_LABELS[optimistic as keyof typeof POST_COLUMN_LABELS]}`)
      router.refresh()
    } catch (err) {
      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, approval_status: prevStatus } : p)),
      )
      toast.error((err as Error).message || "Move failed")
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <Lane title="Posts" subtitle="Drag between columns to approve, reject, or retry">
        {POST_COLUMNS.map((col) => (
          <LaneColumn
            key={col}
            id={`post-${col}`}
            label={POST_COLUMN_LABELS[col]}
            count={grouped[col].length}
            accepts={col !== "scheduled" && col !== "published"}
          >
            {grouped[col].map((p) => (
              <PostCard
                key={p.id}
                post={p}
                selected={selectedIds.has(p.id)}
                onToggleSelected={onToggleSelected}
              />
            ))}
            {grouped[col].length === 0 && (
              <div className="py-6 text-center text-[11px] text-muted-foreground/60 italic">
                empty
              </div>
            )}
          </LaneColumn>
        ))}
      </Lane>
    </DndContext>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/content-studio/pipeline/PostsLane.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): PostsLane with drag-drop between columns

Optimistic update, server-side truth reload via router.refresh(),
scheduled/published are non-drop columns (their transitions require the
schedule picker / publish worker respectively).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: BulkActionsBar + bulk approve

**Files:**
- Create: `components/admin/content-studio/pipeline/BulkActionsBar.tsx`
- Test: `__tests__/components/admin/content-studio/pipeline/BulkActionsBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/pipeline/BulkActionsBar.test.tsx`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { BulkActionsBar } from "@/components/admin/content-studio/pipeline/BulkActionsBar"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  Object.assign(global, { fetch: fetchMock })
})

describe("<BulkActionsBar>", () => {
  it("does not render when no ids are selected", () => {
    const { container } = render(<BulkActionsBar selectedIds={new Set()} onClear={vi.fn()} onApproved={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows an Approve N button when selection is non-empty", () => {
    render(<BulkActionsBar selectedIds={new Set(["a", "b", "c"])} onClear={vi.fn()} onApproved={vi.fn()} />)
    expect(screen.getByRole("button", { name: /Approve 3/i })).toBeInTheDocument()
  })

  it("clicking Approve N calls the API for each id and invokes onApproved", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const onApproved = vi.fn()
    render(
      <BulkActionsBar
        selectedIds={new Set(["a", "b"])}
        onClear={vi.fn()}
        onApproved={onApproved}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Approve 2/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(onApproved).toHaveBeenCalled()
  })

  it("calls onClear when Clear is clicked", () => {
    const onClear = vi.fn()
    render(<BulkActionsBar selectedIds={new Set(["a"])} onClear={onClear} onApproved={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /clear/i }))
    expect(onClear).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/pipeline/BulkActionsBar.tsx`:

```typescript
"use client"

import { useState } from "react"
import { Check, X, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface BulkActionsBarProps {
  selectedIds: Set<string>
  onClear: () => void
  onApproved: () => void
}

export function BulkActionsBar({ selectedIds, onClear, onApproved }: BulkActionsBarProps) {
  const [busy, setBusy] = useState(false)

  if (selectedIds.size === 0) return null

  async function approveAll() {
    setBusy(true)
    try {
      const ids = Array.from(selectedIds)
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/admin/social/posts/${id}/approve`, { method: "POST" }),
        ),
      )
      const failed = results.filter((r) => r.status === "rejected").length
      if (failed > 0) toast.error(`${failed} of ${ids.length} failed`)
      else toast.success(`Approved ${ids.length}`)
      onApproved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40 bg-primary text-primary-foreground shadow-lg rounded-full px-4 py-2 flex items-center gap-3">
      <span className="text-sm font-medium">{selectedIds.size} selected</span>
      <button
        type="button"
        onClick={approveAll}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full bg-success/20 text-white hover:bg-success/30 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        Approve {selectedIds.size}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-60"
      >
        <X className="size-3" /> Clear
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Re-run and verify**

```bash
npm run test:run -- __tests__/components/admin/content-studio/pipeline/BulkActionsBar.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/pipeline/BulkActionsBar.tsx __tests__/components/admin/content-studio/pipeline/BulkActionsBar.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): BulkActionsBar with Approve N across selected posts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: PipelineFilters top-bar component

**Files:**
- Create: `components/admin/content-studio/pipeline/PipelineFilters.tsx`
- Test: `__tests__/components/admin/content-studio/pipeline/PipelineFilters.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/pipeline/PipelineFilters.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PipelineFilters } from "@/components/admin/content-studio/pipeline/PipelineFilters"

const replaceMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content",
  useSearchParams: () => new URLSearchParams("platform=instagram"),
}))

describe("<PipelineFilters>", () => {
  it("renders all platform and status pills", () => {
    render(<PipelineFilters videos={[]} />)
    expect(screen.getByRole("button", { name: /Instagram/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Facebook/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Approved/i })).toBeInTheDocument()
  })

  it("toggles the initial 'instagram' platform chip as active", () => {
    render(<PipelineFilters videos={[]} />)
    expect(screen.getByRole("button", { name: /Instagram/i })).toHaveAttribute("aria-pressed", "true")
  })

  it("clicking a platform pill updates the URL", () => {
    replaceMock.mockClear()
    render(<PipelineFilters videos={[]} />)
    fireEvent.click(screen.getByRole("button", { name: /Facebook/i }))
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringMatching(/platform=(instagram,facebook|facebook,instagram)/),
      { scroll: false },
    )
  })

  it("Clear all resets filters", () => {
    replaceMock.mockClear()
    render(<PipelineFilters videos={[]} />)
    fireEvent.click(screen.getByRole("button", { name: /Clear all/i }))
    expect(replaceMock).toHaveBeenCalledWith("/admin/content", { scroll: false })
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/pipeline/PipelineFilters.tsx`:

```typescript
"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useMemo, useCallback } from "react"
import { Filter, X } from "lucide-react"
import {
  parseFilters,
  filtersToSearchParams,
  type PipelineFilters as Filters,
} from "@/lib/content-studio/pipeline-filters"
import type { SocialPlatform, SocialApprovalStatus, VideoUpload } from "@/types/database"
import { cn } from "@/lib/utils"

const PLATFORMS: { id: SocialPlatform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "facebook", label: "Facebook" },
  { id: "youtube", label: "YouTube" },
  { id: "youtube_shorts", label: "YT Shorts" },
  { id: "linkedin", label: "LinkedIn" },
]

const STATUSES: { id: SocialApprovalStatus; label: string }[] = [
  { id: "needs_review", label: "Needs Review" },
  { id: "approved", label: "Approved" },
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
]

interface PipelineFiltersProps {
  videos: VideoUpload[]
}

export function PipelineFilters({ videos }: PipelineFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])

  const update = useCallback(
    (next: Filters) => {
      const sp = filtersToSearchParams(next)
      // Preserve non-filter params like ?tab=
      const preserve = ["tab"]
      for (const k of preserve) {
        const v = searchParams.get(k)
        if (v) sp.set(k, v)
      }
      const qs = sp.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  function togglePlatform(id: SocialPlatform) {
    const has = filters.platforms.includes(id)
    const next = has ? filters.platforms.filter((p) => p !== id) : [...filters.platforms, id]
    update({ ...filters, platforms: next })
  }
  function toggleStatus(id: SocialApprovalStatus) {
    const has = filters.statuses.includes(id)
    const next = has ? filters.statuses.filter((s) => s !== id) : [...filters.statuses, id]
    update({ ...filters, statuses: next })
  }

  const activeCount =
    filters.platforms.length +
    filters.statuses.length +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0) +
    (filters.sourceVideoId ? 1 : 0)

  return (
    <div className="rounded-lg border border-border bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm text-primary">
          <Filter className="size-4" />
          <span className="font-medium">Filters</span>
          {activeCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {activeCount} active
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => router.replace(pathname, { scroll: false })}
            className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            <X className="size-3" /> Clear all
          </button>
        )}
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Platform</p>
        <div className="flex flex-wrap gap-1">
          {PLATFORMS.map(({ id, label }) => {
            const active = filters.platforms.includes(id)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => togglePlatform(id)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white text-muted-foreground border-border hover:border-primary/50",
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Status</p>
        <div className="flex flex-wrap gap-1">
          {STATUSES.map(({ id, label }) => {
            const active = filters.statuses.includes(id)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleStatus(id)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white text-muted-foreground border-border hover:border-primary/50",
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-xs text-muted-foreground">
          From
          <input
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => update({ ...filters, from: e.target.value || null })}
            className="mt-0.5 block w-full rounded border border-border px-2 py-1 text-xs"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => update({ ...filters, to: e.target.value || null })}
            className="mt-0.5 block w-full rounded border border-border px-2 py-1 text-xs"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Source video
          <select
            value={filters.sourceVideoId ?? ""}
            onChange={(e) => update({ ...filters, sourceVideoId: e.target.value || null })}
            className="mt-0.5 block w-full rounded border border-border px-2 py-1 text-xs"
          >
            <option value="">All videos</option>
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title ?? v.original_filename}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Re-run and verify**

```bash
npm run test:run -- __tests__/components/admin/content-studio/pipeline/PipelineFilters.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/pipeline/PipelineFilters.tsx __tests__/components/admin/content-studio/pipeline/PipelineFilters.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): PipelineFilters top-bar — url-driven platform/status/date/source

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: PipelineBoard composed component

**Files:**
- Create: `components/admin/content-studio/pipeline/PipelineBoard.tsx`
- Test: `__tests__/components/admin/content-studio/pipeline/PipelineBoard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/pipeline/PipelineBoard.test.tsx`:

```typescript
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import type { PipelineData } from "@/lib/content-studio/pipeline-data"

const data: PipelineData = {
  videos: [
    {
      id: "v1",
      storage_path: "",
      original_filename: "a.mp4",
      duration_seconds: 10,
      size_bytes: 1,
      mime_type: null,
      title: "A",
      uploaded_by: null,
      status: "uploaded",
      created_at: "",
      updated_at: "",
    },
  ],
  posts: [],
  postCountsByVideo: {},
}

describe("<PipelineBoard>", () => {
  it("renders both lanes", () => {
    render(<PipelineBoard initialData={data} />)
    expect(screen.getByRole("region", { name: /Videos/ })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: /Posts/ })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/pipeline/PipelineBoard.tsx`:

```typescript
"use client"

import { useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { VideosLane } from "./VideosLane"
import { PostsLane } from "./PostsLane"
import { BulkActionsBar } from "./BulkActionsBar"
import { PipelineFilters } from "./PipelineFilters"
import { applyFilters, parseFilters } from "@/lib/content-studio/pipeline-filters"
import type { PipelineData } from "@/lib/content-studio/pipeline-data"

export function PipelineBoard({ initialData }: { initialData: PipelineData }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const filtered = useMemo(
    () => applyFilters(initialData.videos, initialData.posts, filters),
    [initialData, filters],
  )

  function toggleSelected(id: string, value: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <PipelineFilters videos={initialData.videos} />
      <VideosLane
        data={{
          ...initialData,
          videos: filtered.videos,
          posts: filtered.posts,
        }}
      />
      <PostsLane
        posts={filtered.posts}
        selectedIds={selectedIds}
        onToggleSelected={toggleSelected}
      />
      <BulkActionsBar
        selectedIds={selectedIds}
        onClear={() => setSelectedIds(new Set())}
        onApproved={() => {
          setSelectedIds(new Set())
          router.refresh()
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/pipeline/PipelineBoard.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/pipeline/PipelineBoard.tsx __tests__/components/admin/content-studio/pipeline/PipelineBoard.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): PipelineBoard composes filters + lanes + bulk bar

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Videos and Posts list views (flat tables)

**Files:**
- Create: `components/admin/content-studio/list/VideosList.tsx`
- Create: `components/admin/content-studio/list/PostsList.tsx`
- Test: `__tests__/components/admin/content-studio/list/VideosList.test.tsx`
- Test: `__tests__/components/admin/content-studio/list/PostsList.test.tsx`

- [ ] **Step 1: Write VideosList test**

Create `__tests__/components/admin/content-studio/list/VideosList.test.tsx`:

```typescript
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import type { VideoUpload } from "@/types/database"

const vids: VideoUpload[] = [
  {
    id: "v1",
    storage_path: "",
    original_filename: "a.mp4",
    duration_seconds: 60,
    size_bytes: 1_000_000,
    mime_type: null,
    title: "Alpha",
    uploaded_by: null,
    status: "transcribed",
    created_at: "2026-04-10T10:00:00Z",
    updated_at: "",
  },
  {
    id: "v2",
    storage_path: "",
    original_filename: "b.mp4",
    duration_seconds: 90,
    size_bytes: 2_000_000,
    mime_type: null,
    title: "Beta",
    uploaded_by: null,
    status: "uploaded",
    created_at: "2026-04-12T10:00:00Z",
    updated_at: "",
  },
]

describe("<VideosList>", () => {
  it("renders a table with all videos", () => {
    render(<VideosList videos={vids} />)
    expect(screen.getByText(/Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/Beta/)).toBeInTheDocument()
  })

  it("each row links to the drawer", () => {
    render(<VideosList videos={vids} />)
    expect(screen.getByRole("link", { name: /Alpha/ })).toHaveAttribute("href", "/admin/content/v1")
  })

  it("renders an empty state when no videos", () => {
    render(<VideosList videos={[]} />)
    expect(screen.getByText(/no videos yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Write PostsList test**

Create `__tests__/components/admin/content-studio/list/PostsList.test.tsx`:

```typescript
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import type { PipelinePostRow } from "@/lib/db/social-posts"

const posts: PipelinePostRow[] = [
  {
    id: "p1",
    platform: "instagram",
    content: "caption one",
    media_url: null,
    approval_status: "approved",
    scheduled_at: null,
    published_at: null,
    source_video_id: "v1",
    source_video_filename: "a.mp4",
    rejection_notes: null,
    platform_post_id: null,
    created_by: null,
    created_at: "2026-04-15T00:00:00Z",
    updated_at: "",
  },
]

describe("<PostsList>", () => {
  it("renders a table with all posts", () => {
    render(<PostsList posts={posts} />)
    expect(screen.getByText(/caption one/)).toBeInTheDocument()
    expect(screen.getByText(/a\.mp4/)).toBeInTheDocument()
  })

  it("rows link to the post-only drawer", () => {
    render(<PostsList posts={posts} />)
    expect(screen.getByRole("link", { name: /caption one/ })).toHaveAttribute(
      "href",
      "/admin/content/post/p1",
    )
  })

  it("renders an empty state when no posts", () => {
    render(<PostsList posts={[]} />)
    expect(screen.getByText(/no posts yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run and watch them fail**

- [ ] **Step 4: Write VideosList implementation**

Create `components/admin/content-studio/list/VideosList.tsx`:

```typescript
import Link from "next/link"
import type { VideoUpload } from "@/types/database"
import { Film } from "lucide-react"

interface VideosListProps {
  videos: VideoUpload[]
}

function formatDuration(s: number | null) {
  if (!s) return "—"
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

export function VideosList({ videos }: VideosListProps) {
  if (videos.length === 0) {
    return (
      <div className="py-16 text-center">
        <Film className="size-8 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No videos yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface/40 text-left">
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2">Title</th>
            <th className="px-4 py-2">Filename</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Duration</th>
            <th className="px-4 py-2">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v.id} className="border-t border-border hover:bg-surface/30">
              <td className="px-4 py-2">
                <Link
                  href={`/admin/content/${v.id}`}
                  className="text-primary font-medium hover:underline"
                >
                  {v.title ?? v.original_filename}
                </Link>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{v.original_filename}</td>
              <td className="px-4 py-2">{v.status}</td>
              <td className="px-4 py-2">{formatDuration(v.duration_seconds)}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {new Date(v.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Write PostsList implementation**

Create `components/admin/content-studio/list/PostsList.tsx`:

```typescript
import Link from "next/link"
import { Megaphone } from "lucide-react"
import type { PipelinePostRow } from "@/lib/db/social-posts"

interface PostsListProps {
  posts: PipelinePostRow[]
}

export function PostsList({ posts }: PostsListProps) {
  if (posts.length === 0) {
    return (
      <div className="py-16 text-center">
        <Megaphone className="size-8 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No posts yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface/40 text-left">
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2">Platform</th>
            <th className="px-4 py-2">Caption</th>
            <th className="px-4 py-2">Source video</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Scheduled</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id} className="border-t border-border hover:bg-surface/30">
              <td className="px-4 py-2 text-muted-foreground">{p.platform}</td>
              <td className="px-4 py-2">
                <Link
                  href={`/admin/content/post/${p.id}`}
                  className="text-primary hover:underline line-clamp-2"
                >
                  {p.content}
                </Link>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{p.source_video_filename ?? "—"}</td>
              <td className="px-4 py-2">{p.approval_status}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/list
```

Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add components/admin/content-studio/list __tests__/components/admin/content-studio/list
git commit -m "$(cat <<'EOF'
feat(content-studio): VideosList + PostsList flat-table views

Tabs now offer a traditional sortable list for users who prefer tables over
Kanban. Rows click through to the drawer just like pipeline cards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Mount everything — update the Content Studio pages

**Files:**
- Modify: `app/(admin)/admin/content/page.tsx`
- Modify: `app/(admin)/admin/content/[videoId]/page.tsx`
- Modify: `app/(admin)/admin/content/post/[postId]/page.tsx`

- [ ] **Step 1: Update the index page**

Replace `app/(admin)/admin/content/page.tsx` with:

```typescript
import { getPipelineData } from "@/lib/content-studio/pipeline-data"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import { TabPlaceholder } from "@/components/admin/content-studio/TabPlaceholder"

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function ContentStudioPage({ searchParams }: PageProps) {
  const { tab } = await searchParams
  const data = await getPipelineData()

  switch (tab) {
    case "calendar":
      return <TabPlaceholder tabName="Calendar" phaseLabel="Phase 4" />
    case "videos":
      return <VideosList videos={data.videos} />
    case "posts":
      return <PostsList posts={data.posts} />
    default:
      return <PipelineBoard initialData={data} />
  }
}
```

- [ ] **Step 2: Update the [videoId] page to render matching tab content behind the drawer**

Replace `app/(admin)/admin/content/[videoId]/page.tsx` with the following. The only change from Phase 2 is that the "behind" content is now real (PipelineBoard / VideosList / PostsList) rather than a placeholder.

```typescript
import { notFound } from "next/navigation"
import { getDrawerData } from "@/lib/content-studio/drawer-data"
import { getPipelineData } from "@/lib/content-studio/pipeline-data"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import { TabPlaceholder } from "@/components/admin/content-studio/TabPlaceholder"
import type { DrawerTab } from "@/components/admin/content-studio/drawer/DrawerContent"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ tab?: string; postId?: string }>
}

function resolveDrawerTab(raw: string | undefined, postId: string | undefined): DrawerTab {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return postId ? "posts" : "transcript"
}

export default async function ContentStudioDrawerPage({ params, searchParams }: PageProps) {
  const { videoId } = await params
  const { tab, postId } = await searchParams
  const data = await getDrawerData(videoId)
  if (!data) notFound()

  // Note: we pull pipeline data for the underneath view. In a real deployment
  // this doubles the data fetch per drawer open — acceptable because both are
  // cached by Supabase/Postgres and the Phase 2 drawer fetch is already the
  // heavier query. Phase 5 may move pipeline data into the shell layout if
  // this becomes a bottleneck.
  const pipeline = await getPipelineData()

  const drawerTab = resolveDrawerTab(tab, postId)
  const effectiveData = postId ? { ...data, highlightPostId: postId } : data

  let underneath: React.ReactNode
  switch (tab) {
    case "calendar":
      underneath = <TabPlaceholder tabName="Calendar" phaseLabel="Phase 4" />
      break
    case "videos":
      underneath = <VideosList videos={pipeline.videos} />
      break
    case "posts":
      underneath = <PostsList posts={pipeline.posts} />
      break
    default:
      underneath = <PipelineBoard initialData={pipeline} />
  }

  return (
    <>
      {underneath}
      <DetailDrawer data={effectiveData} defaultTab={drawerTab} closeHref={`/admin/content${tab ? `?tab=${tab}` : ""}`} />
    </>
  )
}
```

- [ ] **Step 3: Update the post-only drawer route similarly**

Replace `app/(admin)/admin/content/post/[postId]/page.tsx` with:

```typescript
import { notFound } from "next/navigation"
import { getDrawerDataForPost } from "@/lib/content-studio/drawer-data"
import { getPipelineData } from "@/lib/content-studio/pipeline-data"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import type { DrawerTab } from "@/components/admin/content-studio/drawer/DrawerContent"

interface PageProps {
  params: Promise<{ postId: string }>
  searchParams: Promise<{ tab?: string }>
}

function resolveDrawerTab(raw: string | undefined): DrawerTab {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return "posts"
}

export default async function ContentStudioPostDrawerPage({ params, searchParams }: PageProps) {
  const { postId } = await params
  const { tab } = await searchParams
  const data = await getDrawerDataForPost(postId)
  if (!data) notFound()
  const pipeline = await getPipelineData()

  return (
    <>
      <PostsList posts={pipeline.posts} />
      <DetailDrawer
        data={data}
        defaultTab={resolveDrawerTab(tab)}
        closeHref="/admin/content?tab=posts"
      />
    </>
  )
}
```

- [ ] **Step 4: Manual smoke test**

```bash
CONTENT_STUDIO_ENABLED=true npm run dev
```

Visit, logged in as admin:

- `/admin/content` — renders PipelineBoard with both lanes populated.
- `?tab=videos` — renders VideosList.
- `?tab=posts` — renders PostsList.
- Click a video card → drawer opens with PipelineBoard visible behind.
- Close drawer (ESC) → returns to PipelineBoard; the selected video is no longer highlighted.
- Select 2 post cards → BulkActionsBar appears with "Approve 2" button. Click it → cards move to Approved column.
- Drag a post card from Needs Review to Approved → card moves; status pill changes to `approved`; server accepts.
- Drag a post card to Scheduled column → toast "Use the Schedule action" — the card snaps back.
- Drag a failed post back to Needs Review → card moves; rejection_notes cleared.
- Filter by platform=instagram → non-Instagram posts disappear; videos with no Instagram child posts disappear.

- [ ] **Step 5: Commit**

```bash
git add app/\(admin\)/admin/content/page.tsx \
        app/\(admin\)/admin/content/\[videoId\]/page.tsx \
        app/\(admin\)/admin/content/post/\[postId\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): mount PipelineBoard + list views + drawer-with-tab-behind

Pipeline now renders on the root tab; Videos/Posts tabs get sortable tables.
The [videoId] and /post/[postId] drawer routes render the tab content
underneath so closing the drawer preserves the user's context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: E2E — pipeline happy path

**Files:**
- Create: `__tests__/e2e/content-studio-pipeline.spec.ts`

- [ ] **Step 1: Write the e2e**

Create `__tests__/e2e/content-studio-pipeline.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com"
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin-password"

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/admin\//)
}

test.describe("Content Studio pipeline", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test("pipeline renders Videos + Posts lanes", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page.getByRole("region", { name: /Videos/ })).toBeVisible()
    await expect(page.getByRole("region", { name: /Posts/ })).toBeVisible()
    // Column headings
    await expect(page.getByText("Needs Review")).toBeVisible()
    await expect(page.getByText("Approved")).toBeVisible()
    await expect(page.getByText("Published")).toBeVisible()
  })

  test("platform filter narrows posts", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    await page.getByRole("button", { name: /Instagram/i }).first().click()
    await expect(page).toHaveURL(/platform=instagram/)
  })

  test("Videos tab shows a table", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=videos")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    await expect(page.getByRole("columnheader", { name: /Filename/i })).toBeVisible()
  })

  test("Posts tab shows a table with source-video column", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=posts")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    await expect(page.getByRole("columnheader", { name: /Source video/i })).toBeVisible()
  })

  test("clicking a post row in Posts tab opens the post-only drawer", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=posts")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    const firstLink = page.locator("tbody a").first()
    const count = await firstLink.count()
    test.skip(count === 0, "No posts to click")
    await firstLink.click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/content\/post\//)
  })
})
```

- [ ] **Step 2: Run e2e**

```bash
CONTENT_STUDIO_ENABLED=true npm run dev
# separate shell:
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e -- content-studio-pipeline
```

Expected: all pass (or skip cleanly if no seed data).

- [ ] **Step 3: Commit**

```bash
git add __tests__/e2e/content-studio-pipeline.spec.ts
git commit -m "$(cat <<'EOF'
test(content-studio): e2e for pipeline lanes, filter, list views, drawer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Final lint / typecheck / full sweep

- [ ] **Step 1: Lint**

```bash
npm run lint
```

- [ ] **Step 2: Format check**

```bash
npm run format:check
```

If failures, `npm run format`, then re-check.

- [ ] **Step 3: Full unit-test run**

```bash
npm run test:run
```

Expected: all tests pass, including Phase 1/2/3.

- [ ] **Step 4: Commit any formatter fixes**

```bash
git add -u
git commit -m "chore(content-studio): prettier fixes from Phase 3" --allow-empty
```

---

## Verification Before Calling Phase 3 Done

Before marking this phase complete, confirm ALL of the following:

1. **Pipeline renders.** `/admin/content` shows both lanes, cards populated from the Supabase data, correct column counts.
2. **Videos lane is read-only.** No drag target highlights appear; attempting a drag does not move a video card.
3. **Post drag-drop works.** A Needs Review card dropped on Approved becomes approved (pill changes, server state updates).
4. **Drop into Scheduled is rejected.** Dropping a card on the Scheduled column toasts "Use the Schedule action" and snaps back.
5. **Failed → Needs Review clears rejection_notes.** After the drop, the card no longer shows the error banner.
6. **Bulk approve works.** Selecting 2+ cards surfaces the floating bar; clicking Approve N moves them all to Approved.
7. **Filters work.** Selecting platform=Instagram narrows both posts and videos. Date range filters against scheduled_at/published_at/created_at. Source-video select narrows to one video.
8. **Videos list view.** `?tab=videos` shows a table; rows link to `/admin/content/<id>`.
9. **Posts list view.** `?tab=posts` shows a table with the source-video column; rows link to `/admin/content/post/<id>`.
10. **Drawer still works from Pipeline.** Clicking a video card opens the drawer; closing returns to pipeline with filters preserved.
11. **API.** Manually `curl` `/api/admin/content-studio/posts/<id>/status` with `{"targetColumn":"approved"}` and verify 200. Verify `{"targetColumn":"scheduled"}` returns 409.
12. **All tests pass.** `npm run test:run` and the three e2e suites (shell, drawer, pipeline).

---

## Phase 3 Scope Boundaries

**In this phase:**
- Two-lane Kanban (Videos read-only, Posts draggable)
- Bulk approve
- URL-driven filters (platform / status / date range / source video)
- Unified `/posts/:id/status` status-transition endpoint for drag-drop
- Videos and Posts list-view tabs

**NOT in this phase** (handled in later phases):
- Month/Week/Day calendar with unscheduled panel → **Phase 4**
- Drag from Approved → Calendar tab to schedule → **Phase 4**
- Global search / user preferences / a11y polish / legacy-page cleanup → **Phase 5**

When Phase 3 ships behind the flag, internal users can triage the entire content pipeline end-to-end from a single board.
