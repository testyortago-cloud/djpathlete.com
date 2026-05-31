# Content Studio Detail Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped 700px detail drawer with full-page video and post detail views, showing the transcript/captions inline.

**Architecture:** Reuse the two existing routes (`/admin/content/[videoId]` and `/admin/content/post/[postId]`) but render full pages instead of `{board} + <DetailDrawer>`. A two-column `VideoDetailPage` (sticky left = player + actions + Captioned Cut; scrolling right = Transcript → Posts → Meta) and a single-column `PostDetailPage`. The existing content components (`TranscriptTab`, `PostsTab`, `MetaTab`, `CaptionedCutPanel`, `MarkReadyButton`, `GenerateQuoteCardsButton`) are rearranged, not rewritten; `DrawerVideoHeader` is copied into a `VideoDetailSidebar` (minus the Mark-ready button, which moves to the page top bar). The drawer files are deleted last.

**Tech Stack:** Next.js 16 App Router (async server components), React 19, Tailwind v4, Vitest + Testing Library, Lucide icons.

**Spec:** [docs/superpowers/specs/2026-05-31-content-studio-detail-pages-design.md](../specs/2026-05-31-content-studio-detail-pages-design.md)

---

## Conventions

- Run one test file: `npm run test:run -- <path>`
- Commit directly to `main` (solo-dev convention). Each task ends in a commit; end every commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Ordering note: new files (Tasks 1-4) are added, then the routes are rewired (Tasks 5-6), then the now-unused drawer files are deleted (Task 7). The old drawer keeps working until Task 7, so nothing breaks mid-flight.

---

### Task 1: Back-nav helper

**Files:**
- Create: `lib/content-studio/detail-nav.ts`
- Test: `__tests__/lib/content-studio/detail-nav.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/detail-nav.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { detailBackInfo } from "@/lib/content-studio/detail-nav"

describe("detailBackInfo", () => {
  it("maps known shell tabs to a labeled href", () => {
    expect(detailBackInfo("videos")).toEqual({ href: "/admin/content?tab=videos", label: "Videos" })
    expect(detailBackInfo("posts")).toEqual({ href: "/admin/content?tab=posts", label: "Posts" })
    expect(detailBackInfo("calendar")).toEqual({ href: "/admin/content?tab=calendar", label: "Calendar" })
  })
  it("defaults to the Pipeline tab for undefined or unknown tabs", () => {
    expect(detailBackInfo(undefined)).toEqual({ href: "/admin/content", label: "Pipeline" })
    expect(detailBackInfo("bogus")).toEqual({ href: "/admin/content", label: "Pipeline" })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:run -- __tests__/lib/content-studio/detail-nav.test.ts`
Expected: FAIL — cannot resolve `@/lib/content-studio/detail-nav`.

- [ ] **Step 3: Implement the helper**

Create `lib/content-studio/detail-nav.ts`:

```ts
// lib/content-studio/detail-nav.ts
// Where a detail page's "← Back" link points, derived from the shell tab the
// user came from (?tab=). Mirrors the old drawer's closeHref behaviour.
export function detailBackInfo(tab: string | undefined): { href: string; label: string } {
  switch (tab) {
    case "videos":
      return { href: "/admin/content?tab=videos", label: "Videos" }
    case "posts":
      return { href: "/admin/content?tab=posts", label: "Posts" }
    case "calendar":
      return { href: "/admin/content?tab=calendar", label: "Calendar" }
    default:
      return { href: "/admin/content", label: "Pipeline" }
  }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:run -- __tests__/lib/content-studio/detail-nav.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/content-studio/detail-nav.ts __tests__/lib/content-studio/detail-nav.test.ts
git commit -m "feat(content-studio): add detail-page back-nav helper"
```

---

### Task 2: VideoDetailSidebar

**Files:**
- Create: `components/admin/content-studio/detail/VideoDetailSidebar.tsx`
- Test: `__tests__/components/admin/content-studio/detail/VideoDetailSidebar.test.tsx`

This is the old `DrawerVideoHeader` content (player + meta + "Make post" + Captioned Cut), **minus** the title `<h2>` (moves to the page top bar) and **minus** the `MarkReadyButton` (also moves to the top bar).

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/detail/VideoDetailSidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import type { VideoUpload } from "@/types/database"

vi.mock("@/components/admin/content-studio/drawer/GenerateQuoteCardsButton", () => ({
  GenerateQuoteCardsButton: () => <button type="button">Make post from transcript</button>,
}))
vi.mock("@/components/admin/content-studio/drawer/CaptionedCutPanel", () => ({
  CaptionedCutPanel: () => <div data-testid="cut-panel" />,
}))

import { VideoDetailSidebar } from "@/components/admin/content-studio/detail/VideoDetailSidebar"

const video: VideoUpload = {
  id: "v1",
  storage_path: "p.mp4",
  original_filename: "clip.mp4",
  duration_seconds: 90,
  size_bytes: 1_000_000,
  mime_type: "video/mp4",
  title: "Clip",
  uploaded_by: null,
  status: "transcribed",
  needs_edit: true,
  created_at: "2026-05-31T00:00:00Z",
  updated_at: "2026-05-31T00:00:00Z",
}

describe("<VideoDetailSidebar>", () => {
  it("renders the player and filename, and hides the cut panel when disabled", () => {
    const { container } = render(
      <VideoDetailSidebar video={video} previewUrl="https://example/p.mp4" captionedCutEnabled={false} />,
    )
    expect(container.querySelector("video")).toBeTruthy()
    expect(screen.getByText("clip.mp4")).toBeInTheDocument()
    expect(screen.queryByTestId("cut-panel")).toBeNull()
  })

  it("renders the captioned-cut panel when enabled", () => {
    render(<VideoDetailSidebar video={video} previewUrl={null} captionedCutEnabled />)
    expect(screen.getByTestId("cut-panel")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:run -- __tests__/components/admin/content-studio/detail/VideoDetailSidebar.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement the component**

Create `components/admin/content-studio/detail/VideoDetailSidebar.tsx`:

```tsx
import { Clock, HardDrive, Calendar } from "lucide-react"
import type { VideoUpload } from "@/types/database"
import { GenerateQuoteCardsButton } from "@/components/admin/content-studio/drawer/GenerateQuoteCardsButton"
import { CaptionedCutPanel } from "@/components/admin/content-studio/drawer/CaptionedCutPanel"

interface VideoDetailSidebarProps {
  video: VideoUpload
  previewUrl: string | null
  hasTranscript?: boolean
  captionedCutEnabled?: boolean
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—"
  const mb = bytes / 1_000_000
  if (mb < 1) return `${(bytes / 1_000).toFixed(0)} KB`
  if (mb < 1_000) return `${mb.toFixed(1)} MB`
  return `${(mb / 1_000).toFixed(2)} GB`
}

export function VideoDetailSidebar({
  video,
  previewUrl,
  hasTranscript = false,
  captionedCutEnabled = false,
}: VideoDetailSidebarProps) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-black">
        {previewUrl ? (
          <video src={previewUrl} controls preload="metadata" className="w-full aspect-video bg-black">
            Your browser does not support the video element.
          </video>
        ) : (
          <div className="w-full aspect-video bg-muted flex items-center justify-center text-sm text-muted-foreground">
            Preview unavailable
          </div>
        )}
      </div>

      <div>
        <p className="text-xs text-muted-foreground truncate" title={video.original_filename}>
          {video.original_filename}
        </p>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <div className="inline-flex items-center gap-1">
            <Calendar className="size-3.5" />
            <dt className="sr-only">Uploaded</dt>
            <dd>{new Date(video.created_at).toLocaleDateString()}</dd>
          </div>
          <div className="inline-flex items-center gap-1">
            <Clock className="size-3.5" />
            <dt className="sr-only">Duration</dt>
            <dd>{formatDuration(video.duration_seconds)}</dd>
          </div>
          <div className="inline-flex items-center gap-1">
            <HardDrive className="size-3.5" />
            <dt className="sr-only">Size</dt>
            <dd>{formatSize(video.size_bytes)}</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        <GenerateQuoteCardsButton videoUploadId={video.id} hasTranscript={hasTranscript} />
      </div>

      {captionedCutEnabled && <CaptionedCutPanel videoUploadId={video.id} hasTranscript={hasTranscript} />}
    </div>
  )
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:run -- __tests__/components/admin/content-studio/detail/VideoDetailSidebar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/detail/VideoDetailSidebar.tsx __tests__/components/admin/content-studio/detail/VideoDetailSidebar.test.tsx
git commit -m "feat(content-studio): add VideoDetailSidebar (player + actions + cut panel)"
```

---

### Task 3: VideoDetailPage

**Files:**
- Create: `components/admin/content-studio/detail/VideoDetailPage.tsx`
- Test: `__tests__/components/admin/content-studio/detail/VideoDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/detail/VideoDetailPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import type { DrawerData } from "@/lib/content-studio/drawer-data"

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("@/components/admin/content-studio/detail/VideoDetailSidebar", () => ({
  VideoDetailSidebar: () => <div data-testid="sidebar" />,
}))
vi.mock("@/components/admin/content-studio/drawer/TranscriptTab", () => ({
  TranscriptTab: () => <div data-testid="transcript" />,
}))
vi.mock("@/components/admin/content-studio/drawer/PostsTab", () => ({
  PostsTab: () => <div data-testid="posts" />,
}))
vi.mock("@/components/admin/content-studio/drawer/MetaTab", () => ({
  MetaTab: () => <div data-testid="meta" />,
}))
vi.mock("@/components/admin/content-studio/drawer/MarkReadyButton", () => ({
  MarkReadyButton: ({ needsEdit }: { needsEdit: boolean }) =>
    needsEdit ? <button type="button">Mark as ready</button> : null,
}))

import { VideoDetailPage } from "@/components/admin/content-studio/detail/VideoDetailPage"

const data: DrawerData = {
  mode: "video",
  video: {
    id: "v1",
    storage_path: "p.mp4",
    original_filename: "p.mp4",
    duration_seconds: 10,
    size_bytes: 1000,
    mime_type: "video/mp4",
    title: "My Clip",
    uploaded_by: null,
    status: "transcribed",
    needs_edit: true,
    created_at: "2026-05-31T00:00:00Z",
    updated_at: "2026-05-31T00:00:00Z",
  },
  previewUrl: "https://example/p.mp4",
  transcript: null,
  posts: [],
  mediaByPost: {},
  highlightPostId: null,
  captionedCutEnabled: true,
}

describe("<VideoDetailPage>", () => {
  it("renders the title, a back link, and all four sections", () => {
    render(<VideoDetailPage data={data} backHref="/admin/content?tab=videos" backLabel="Videos" highlightPostId={null} />)
    expect(screen.getByRole("heading", { name: "My Clip" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Videos/ })).toHaveAttribute("href", "/admin/content?tab=videos")
    expect(screen.getByTestId("sidebar")).toBeInTheDocument()
    expect(screen.getByTestId("transcript")).toBeInTheDocument()
    expect(screen.getByTestId("posts")).toBeInTheDocument()
    expect(screen.getByTestId("meta")).toBeInTheDocument()
  })

  it("shows the posts count from data.posts", () => {
    const three = [data, data, data].map((_, i) => ({ id: `p${i}` })) as never[]
    render(
      <VideoDetailPage
        data={{ ...data, posts: three }}
        backHref="/admin/content"
        backLabel="Pipeline"
        highlightPostId={null}
      />,
    )
    expect(screen.getByText(/Posts \(3\)/)).toBeInTheDocument()
  })

  it("shows Mark as ready only while the video needs editing", () => {
    const { rerender } = render(
      <VideoDetailPage data={data} backHref="/admin/content" backLabel="Pipeline" highlightPostId={null} />,
    )
    expect(screen.getByRole("button", { name: /mark as ready/i })).toBeInTheDocument()
    rerender(
      <VideoDetailPage
        data={{ ...data, video: { ...data.video!, needs_edit: false } }}
        backHref="/admin/content"
        backLabel="Pipeline"
        highlightPostId={null}
      />,
    )
    expect(screen.queryByRole("button", { name: /mark as ready/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:run -- __tests__/components/admin/content-studio/detail/VideoDetailPage.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement the component**

Create `components/admin/content-studio/detail/VideoDetailPage.tsx`:

```tsx
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import type { DrawerData } from "@/lib/content-studio/drawer-data"
import { VideoDetailSidebar } from "./VideoDetailSidebar"
import { TranscriptTab } from "@/components/admin/content-studio/drawer/TranscriptTab"
import { PostsTab } from "@/components/admin/content-studio/drawer/PostsTab"
import { MetaTab } from "@/components/admin/content-studio/drawer/MetaTab"
import { MarkReadyButton } from "@/components/admin/content-studio/drawer/MarkReadyButton"

interface VideoDetailPageProps {
  data: DrawerData
  backHref: string
  backLabel: string
  highlightPostId: string | null
}

const SECTION_HEADING = "font-heading text-sm uppercase tracking-wide text-muted-foreground mb-2"

export function VideoDetailPage({ data, backHref, backLabel, highlightPostId }: VideoDetailPageProps) {
  const video = data.video!
  const title = video.title ?? video.original_filename

  return (
    <div className="px-4 py-4 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="size-4" /> {backLabel}
          </Link>
          <h1 className="truncate font-heading text-lg text-primary" title={title}>
            {title}
          </h1>
        </div>
        <MarkReadyButton videoUploadId={video.id} needsEdit={video.needs_edit} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="self-start lg:sticky lg:top-6">
          <VideoDetailSidebar
            video={video}
            previewUrl={data.previewUrl}
            hasTranscript={Boolean(data.transcript?.transcript_text)}
            captionedCutEnabled={data.captionedCutEnabled}
          />
        </div>

        <div className="min-w-0 space-y-8">
          <section aria-labelledby="transcript-heading">
            <h2 id="transcript-heading" className={SECTION_HEADING}>
              Transcript
            </h2>
            <TranscriptTab transcript={data.transcript} video={data.video} />
          </section>

          <section aria-labelledby="posts-heading">
            <h2 id="posts-heading" className={SECTION_HEADING}>
              Posts ({data.posts.length})
            </h2>
            <PostsTab posts={data.posts} mediaByPost={data.mediaByPost} initialExpandedPostId={highlightPostId} />
          </section>

          <section aria-labelledby="meta-heading">
            <h2 id="meta-heading" className={SECTION_HEADING}>
              Details
            </h2>
            <MetaTab video={data.video} transcript={data.transcript} posts={data.posts} />
          </section>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:run -- __tests__/components/admin/content-studio/detail/VideoDetailPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/detail/VideoDetailPage.tsx __tests__/components/admin/content-studio/detail/VideoDetailPage.test.tsx
git commit -m "feat(content-studio): add two-column VideoDetailPage"
```

---

### Task 4: PostDetailPage

**Files:**
- Create: `components/admin/content-studio/detail/PostDetailPage.tsx`
- Test: `__tests__/components/admin/content-studio/detail/PostDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/detail/PostDetailPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import type { DrawerData } from "@/lib/content-studio/drawer-data"

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("@/components/admin/content-studio/drawer/PostsTab", () => ({
  PostsTab: () => <div data-testid="posts" />,
}))
vi.mock("@/components/admin/content-studio/drawer/MetaTab", () => ({
  MetaTab: () => <div data-testid="meta" />,
}))

import { PostDetailPage } from "@/components/admin/content-studio/detail/PostDetailPage"

const data: DrawerData = {
  mode: "post-only",
  video: null,
  previewUrl: null,
  transcript: null,
  posts: [
    {
      id: "p1",
      platform: "instagram",
      content: "manual",
      media_url: null,
      post_type: "text",
      approval_status: "draft",
      scheduled_at: null,
      published_at: null,
      source_video_id: null,
      rejection_notes: null,
      platform_post_id: null,
      created_by: "u",
      created_at: "2026-05-31T00:00:00Z",
      updated_at: "2026-05-31T00:00:00Z",
    },
  ],
  mediaByPost: {},
  highlightPostId: "p1",
  captionedCutEnabled: false,
}

describe("<PostDetailPage>", () => {
  it("renders the Manual post title, back link, posts, and meta — no transcript", () => {
    render(<PostDetailPage data={data} backHref="/admin/content?tab=posts" backLabel="Posts" />)
    expect(screen.getByRole("heading", { name: /Manual post/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Posts/ })).toHaveAttribute("href", "/admin/content?tab=posts")
    expect(screen.getByTestId("posts")).toBeInTheDocument()
    expect(screen.getByTestId("meta")).toBeInTheDocument()
    expect(screen.queryByTestId("transcript")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:run -- __tests__/components/admin/content-studio/detail/PostDetailPage.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement the component**

Create `components/admin/content-studio/detail/PostDetailPage.tsx`:

```tsx
import Link from "next/link"
import { ArrowLeft, FileText } from "lucide-react"
import type { DrawerData } from "@/lib/content-studio/drawer-data"
import { PostsTab } from "@/components/admin/content-studio/drawer/PostsTab"
import { MetaTab } from "@/components/admin/content-studio/drawer/MetaTab"

interface PostDetailPageProps {
  data: DrawerData
  backHref: string
  backLabel: string
}

export function PostDetailPage({ data, backHref, backLabel }: PostDetailPageProps) {
  return (
    <div className="max-w-3xl px-4 py-4 sm:px-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={backHref}
          className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-4" /> {backLabel}
        </Link>
        <h1 className="inline-flex items-center gap-2 font-heading text-lg text-primary">
          <FileText className="size-4 text-muted-foreground" /> Manual post
        </h1>
      </div>

      <div className="space-y-8">
        <section>
          <PostsTab posts={data.posts} mediaByPost={data.mediaByPost} initialExpandedPostId={data.highlightPostId} />
        </section>
        <section aria-labelledby="post-meta-heading">
          <h2
            id="post-meta-heading"
            className="font-heading text-sm uppercase tracking-wide text-muted-foreground mb-2"
          >
            Details
          </h2>
          <MetaTab video={null} transcript={null} posts={data.posts} />
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:run -- __tests__/components/admin/content-studio/detail/PostDetailPage.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/detail/PostDetailPage.tsx __tests__/components/admin/content-studio/detail/PostDetailPage.test.tsx
git commit -m "feat(content-studio): add single-column PostDetailPage"
```

---

### Task 5: Rewire the video route to the full page

**Files:**
- Modify (replace): `app/(admin)/admin/content/[videoId]/page.tsx`
- Test: `__tests__/app/content-studio/video-page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/content-studio/video-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

const getDrawerDataMock = vi.fn()
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND")
})

vi.mock("@/lib/content-studio/drawer-data", () => ({
  getDrawerData: (...a: unknown[]) => getDrawerDataMock(...a),
}))
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }))
vi.mock("@/components/admin/content-studio/detail/VideoDetailPage", () => ({
  VideoDetailPage: ({ backLabel }: { backLabel: string }) => <div data-testid="video-page">{backLabel}</div>,
}))

import Page from "@/app/(admin)/admin/content/[videoId]/page"

beforeEach(() => vi.clearAllMocks())

describe("video detail route", () => {
  it("calls notFound when the video is missing", async () => {
    getDrawerDataMock.mockResolvedValue(null)
    await expect(
      Page({ params: Promise.resolve({ videoId: "x" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders VideoDetailPage with the back label from ?tab=", async () => {
    getDrawerDataMock.mockResolvedValue({ mode: "video", video: { id: "v1" }, posts: [] })
    const ui = await Page({
      params: Promise.resolve({ videoId: "v1" }),
      searchParams: Promise.resolve({ tab: "videos" }),
    })
    render(ui)
    expect(screen.getByTestId("video-page")).toHaveTextContent("Videos")
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:run -- __tests__/app/content-studio/video-page.test.tsx`
Expected: FAIL — the current page imports the board/drawer and won't match (renders `DetailDrawer`, not the mocked `VideoDetailPage`).

- [ ] **Step 3: Replace the route**

Replace the entire contents of `app/(admin)/admin/content/[videoId]/page.tsx` with:

```tsx
import { notFound } from "next/navigation"
import { getDrawerData } from "@/lib/content-studio/drawer-data"
import { detailBackInfo } from "@/lib/content-studio/detail-nav"
import { VideoDetailPage } from "@/components/admin/content-studio/detail/VideoDetailPage"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ tab?: string; postId?: string }>
}

export default async function ContentStudioVideoPage({ params, searchParams }: PageProps) {
  const { videoId } = await params
  const { tab, postId } = await searchParams

  const data = await getDrawerData(videoId)
  if (!data) notFound()

  const back = detailBackInfo(tab)
  return (
    <VideoDetailPage
      data={data}
      backHref={back.href}
      backLabel={back.label}
      highlightPostId={postId ?? null}
    />
  )
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:run -- __tests__/app/content-studio/video-page.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/content/[videoId]/page.tsx" __tests__/app/content-studio/video-page.test.tsx
git commit -m "feat(content-studio): render full video page instead of the drawer"
```

---

### Task 6: Rewire the post route to the full page

**Files:**
- Modify (replace): `app/(admin)/admin/content/post/[postId]/page.tsx`
- Test: `__tests__/app/content-studio/post-page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/content-studio/post-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

const getDrawerDataForPostMock = vi.fn()
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND")
})

vi.mock("@/lib/content-studio/drawer-data", () => ({
  getDrawerDataForPost: (...a: unknown[]) => getDrawerDataForPostMock(...a),
}))
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }))
vi.mock("@/components/admin/content-studio/detail/VideoDetailPage", () => ({
  VideoDetailPage: () => <div data-testid="video-page" />,
}))
vi.mock("@/components/admin/content-studio/detail/PostDetailPage", () => ({
  PostDetailPage: () => <div data-testid="post-page" />,
}))

import Page from "@/app/(admin)/admin/content/post/[postId]/page"

beforeEach(() => vi.clearAllMocks())

describe("post detail route", () => {
  it("calls notFound when the post is missing", async () => {
    getDrawerDataForPostMock.mockResolvedValue(null)
    await expect(
      Page({ params: Promise.resolve({ postId: "x" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders VideoDetailPage when the post has a source video (mode=video)", async () => {
    getDrawerDataForPostMock.mockResolvedValue({ mode: "video", video: { id: "v1" }, posts: [], highlightPostId: "p1" })
    const ui = await Page({ params: Promise.resolve({ postId: "p1" }), searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByTestId("video-page")).toBeInTheDocument()
  })

  it("renders PostDetailPage for a source-less manual post (mode=post-only)", async () => {
    getDrawerDataForPostMock.mockResolvedValue({ mode: "post-only", video: null, posts: [], highlightPostId: "p1" })
    const ui = await Page({ params: Promise.resolve({ postId: "p1" }), searchParams: Promise.resolve({}) })
    render(ui)
    expect(screen.getByTestId("post-page")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:run -- __tests__/app/content-studio/post-page.test.tsx`
Expected: FAIL — current page renders `DetailDrawer`, not the mocked pages.

- [ ] **Step 3: Replace the route**

Replace the entire contents of `app/(admin)/admin/content/post/[postId]/page.tsx` with:

```tsx
import { notFound } from "next/navigation"
import { getDrawerDataForPost } from "@/lib/content-studio/drawer-data"
import { detailBackInfo } from "@/lib/content-studio/detail-nav"
import { VideoDetailPage } from "@/components/admin/content-studio/detail/VideoDetailPage"
import { PostDetailPage } from "@/components/admin/content-studio/detail/PostDetailPage"

interface PageProps {
  params: Promise<{ postId: string }>
  searchParams: Promise<{ tab?: string }>
}

export default async function ContentStudioPostPage({ params, searchParams }: PageProps) {
  const { postId } = await params
  const { tab } = await searchParams

  const data = await getDrawerDataForPost(postId)
  if (!data) notFound()

  const back = detailBackInfo(tab ?? "posts")

  if (data.mode === "video") {
    return (
      <VideoDetailPage
        data={data}
        backHref={back.href}
        backLabel={back.label}
        highlightPostId={data.highlightPostId}
      />
    )
  }

  return <PostDetailPage data={data} backHref={back.href} backLabel={back.label} />
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:run -- __tests__/app/content-studio/post-page.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/content/post/[postId]/page.tsx" __tests__/app/content-studio/post-page.test.tsx
git commit -m "feat(content-studio): render full post page instead of the drawer"
```

---

### Task 7: Delete the dead drawer files

**Files:**
- Delete: `components/admin/content-studio/DetailDrawer.tsx`
- Delete: `components/admin/content-studio/drawer/DrawerContent.tsx`
- Delete: `components/admin/content-studio/drawer/DrawerVideoHeader.tsx`
- Delete: `components/admin/content-studio/drawer/DrawerPostOnlyHeader.tsx`
- Delete: `__tests__/components/admin/content-studio/DetailDrawer.test.tsx`
- Delete: `__tests__/components/admin/content-studio/drawer/DrawerContent.test.tsx`

- [ ] **Step 1: Confirm nothing still imports them**

Run (Grep tool, or rg): search the repo for `DetailDrawer`, `DrawerContent`, `DrawerVideoHeader`, `DrawerPostOnlyHeader`.
Expected: the only remaining hits are the files being deleted themselves (and this plan/spec doc). If any **other** source file imports them, stop and fix that importer first.

- [ ] **Step 2: Delete the files**

```bash
git rm components/admin/content-studio/DetailDrawer.tsx \
  components/admin/content-studio/drawer/DrawerContent.tsx \
  components/admin/content-studio/drawer/DrawerVideoHeader.tsx \
  components/admin/content-studio/drawer/DrawerPostOnlyHeader.tsx \
  __tests__/components/admin/content-studio/DetailDrawer.test.tsx \
  __tests__/components/admin/content-studio/drawer/DrawerContent.test.tsx
```

- [ ] **Step 3: Run the Content Studio suites to confirm no regressions**

Run: `npm run test:run -- __tests__/components/admin/content-studio __tests__/app/content-studio __tests__/lib/content-studio`
Expected: PASS — including the new detail tests; the deleted drawer tests are gone; reused component tests (`TranscriptTab`, `PostsTab`, `MetaTab`, `MarkReadyButton`, `GenerateQuoteCardsButton`, pipeline, etc.) still green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(content-studio): remove the detail drawer (replaced by full pages)"
```

---

### Task 8: Verification

**Files:** none.

- [ ] **Step 1: Targeted suites**

Run: `npm run test:run -- __tests__/components/admin/content-studio __tests__/app/content-studio __tests__/lib/content-studio`
Expected: PASS.

- [ ] **Step 2: Typecheck the changed surface**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing the new `detail/` components, `detail-nav`, or the two rewired pages. (The repo has ~155 pre-existing unrelated errors — confirm your changes added none referencing the touched files.)

- [ ] **Step 3: Manual smoke (optional, dev server on :3050)**

`npm run dev` → open a video from the pipeline: it loads as a full page with the player + actions + Captioned Cut on the left and the transcript/captions, posts, and details stacked on the right; "← {tab}" returns to the board. Open a manual (source-less) post: single-column post page. Open a post that has a source video: the video page with that post pre-expanded.

---

## Self-review notes

- **Spec coverage:** routing rewire both pages + drop board fetch (Tasks 5-6); two-column VideoDetailPage with inline transcript → posts → meta (Task 3); VideoDetailSidebar = player + meta + Make-post + Captioned Cut, Mark-ready moved to top bar (Tasks 2-3); PostDetailPage single column (Task 4); back-nav helper (Task 1); delete DetailDrawer/DrawerContent/DrawerVideoHeader/DrawerPostOnlyHeader + their tests (Task 7); reuse TranscriptTab/PostsTab/MetaTab/CaptionedCutPanel/MarkReadyButton/GenerateQuoteCardsButton verbatim. All spec sections map to a task.
- **Type consistency:** `VideoDetailPage` props `{ data, backHref, backLabel, highlightPostId }` and `PostDetailPage` props `{ data, backHref, backLabel }` are used identically in the route rewires and the component tests. `detailBackInfo(tab)` returns `{ href, label }` consumed as `back.href` / `back.label` everywhere. `DrawerData` is reused verbatim (no shape change).
- **No placeholders:** every component/test/route step contains full code. Child components are mocked in page/route tests so the new tests don't pull in `fetch`/Firebase.
- **Mid-flight safety:** new files added first (1-4), routes repointed (5-6), dead files deleted last (7) — old drawer remains valid until it's unreferenced.
