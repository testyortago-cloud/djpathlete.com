# Content Studio Phase 2 — Detail Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 1 placeholder `<DetailDrawer>` with a real drawer that fetches a video's full context (the video upload row, signed preview URL, transcript, and all fanned-out social posts) and displays it across three tabs: `Transcript`, `Posts (N)`, and `Meta`. Opening the drawer from a post selects the Posts tab and auto-expands that post via `?tab=posts&postId=<id>`. Opening from a video defaults to Transcript. A post-only mode handles manual posts (no `source_video_id`).

This phase solves the original user pain point: transcripts now sit next to the video and the generated posts they produced.

**Architecture:**

- A **server-side fetcher** `getDrawerData(videoId)` runs inside `app/(admin)/admin/content/[videoId]/page.tsx` and returns `{ video, previewUrl, transcript, posts }` in a single parallel fetch. The data is passed to a client `<DrawerContent>` component as a prop, so the client does not re-fetch on mount.
- The drawer frame (backdrop, ESC handler, close button) stays where it was in Phase 1 but now renders `<DrawerContent>` where the placeholder block used to be.
- **Post-only mode**: when a post ID is passed in without a `source_video_id`, the same route (`/admin/content/post/[postId]`) handles it. The drawer renders a "Manual post — no source video" card instead of the video player, but still uses the same `<DrawerContent>` shell with the Posts tab active.
- Tabs are controlled by the `?tab=` search param so the URL is the source of truth. Tab switches update the URL via `router.replace()` without a full navigation so the drawer stays mounted.
- Inline post rows reuse the existing post actions (`/api/admin/social/posts/[id]/approve|schedule|publish-now`) so this phase introduces no new API endpoints.

**Tech Stack:** Next.js 16 App Router (React 19), TypeScript strict, Tailwind v4, Vitest + Testing Library, Playwright, Lucide icons, Sonner toasts.

**Spec:** [docs/superpowers/specs/2026-04-20-content-studio-design.md](../specs/2026-04-20-content-studio-design.md) — see "Detail drawer" section and "Per-entry-point defaults" table.

**Prerequisite:** Phase 1 complete (shell, tab switcher, routed drawer placeholder, feature flag).

---

## File Structure

**Create:**

- `lib/content-studio/drawer-data.ts` — `getDrawerData(videoId)` and `getDrawerDataForPost(postId)` server-side fetchers
- `__tests__/lib/content-studio/drawer-data.test.ts`
- `components/admin/content-studio/drawer/DrawerContent.tsx` — tab switcher + tab bodies, takes the fetched data as a prop
- `components/admin/content-studio/drawer/DrawerVideoHeader.tsx` — player + filename + metadata block
- `components/admin/content-studio/drawer/DrawerPostOnlyHeader.tsx` — placeholder block for video-less posts
- `components/admin/content-studio/drawer/TranscriptTab.tsx` — full transcript text, Vision badge, Copy / Regenerate / Edit actions
- `components/admin/content-studio/drawer/PostsTab.tsx` — inline list of all social posts for this video
- `components/admin/content-studio/drawer/PostsTabRow.tsx` — single collapsible post row
- `components/admin/content-studio/drawer/MetaTab.tsx` — upload info + job ids + errors
- `app/(admin)/admin/content/post/[postId]/page.tsx` — post-only route
- `__tests__/components/admin/content-studio/drawer/DrawerContent.test.tsx`
- `__tests__/components/admin/content-studio/drawer/TranscriptTab.test.tsx`
- `__tests__/components/admin/content-studio/drawer/PostsTab.test.tsx`
- `__tests__/components/admin/content-studio/drawer/PostsTabRow.test.tsx`
- `__tests__/components/admin/content-studio/drawer/MetaTab.test.tsx`
- `__tests__/e2e/content-studio-drawer.spec.ts`

**Modify:**

- `components/admin/content-studio/DetailDrawer.tsx` — accept `data` prop and render `<DrawerContent>` instead of the Phase 1 placeholder. Also accept an optional `defaultTab` and `highlightPostId` that come from the server page.
- `app/(admin)/admin/content/[videoId]/page.tsx` — fetch drawer data server-side and pass it down.

---

## Task 1: Server-side drawer data fetcher

**Files:**
- Create: `lib/content-studio/drawer-data.ts`
- Test: `__tests__/lib/content-studio/drawer-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/drawer-data.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the DAL modules — we are testing shape + parallelism, not Supabase.
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: vi.fn(),
}))
vi.mock("@/lib/db/video-transcripts", () => ({
  getTranscriptForVideo: vi.fn(),
}))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: vi.fn(),
  listSocialPostsBySourceVideo: vi.fn(),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({
    bucket: () => ({
      file: () => ({
        getSignedUrl: async () => ["https://signed.example/preview.mp4"],
      }),
    }),
  }),
}))

import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { getSocialPostById, listSocialPostsBySourceVideo } from "@/lib/db/social-posts"
import { getDrawerData, getDrawerDataForPost } from "@/lib/content-studio/drawer-data"

const fixtureVideo = {
  id: "video-1",
  storage_path: "uploads/video-1.mp4",
  original_filename: "rotational-reboot-teaser.mp4",
  duration_seconds: 48,
  size_bytes: 12_340_000,
  mime_type: "video/mp4",
  title: "Rotational Reboot Teaser",
  uploaded_by: "user-1",
  status: "transcribed" as const,
  created_at: "2026-04-15T12:00:00Z",
  updated_at: "2026-04-15T12:01:00Z",
}

const fixtureTranscript = {
  id: "t-1",
  video_upload_id: "video-1",
  transcript_text: "Hey folks, in this clip...",
  language: "en",
  assemblyai_job_id: "aai-abc",
  analysis: null,
  source: "speech" as const,
  created_at: "2026-04-15T12:05:00Z",
}

const fixturePost = {
  id: "post-1",
  platform: "instagram" as const,
  content: "Stay rotational.",
  media_url: null,
  approval_status: "needs_review" as const,
  scheduled_at: null,
  published_at: null,
  source_video_id: "video-1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: "user-1",
  created_at: "2026-04-15T12:10:00Z",
  updated_at: "2026-04-15T12:10:00Z",
}

describe("getDrawerData", () => {
  beforeEach(() => {
    vi.mocked(getVideoUploadById).mockReset()
    vi.mocked(getTranscriptForVideo).mockReset()
    vi.mocked(listSocialPostsBySourceVideo).mockReset()
  })

  it("returns null when the video does not exist", async () => {
    vi.mocked(getVideoUploadById).mockResolvedValueOnce(null)
    const result = await getDrawerData("missing")
    expect(result).toBeNull()
  })

  it("returns video + previewUrl + transcript + posts when the video exists", async () => {
    vi.mocked(getVideoUploadById).mockResolvedValueOnce(fixtureVideo)
    vi.mocked(getTranscriptForVideo).mockResolvedValueOnce(fixtureTranscript)
    vi.mocked(listSocialPostsBySourceVideo).mockResolvedValueOnce([fixturePost])
    const result = await getDrawerData("video-1")
    expect(result).not.toBeNull()
    expect(result!.video.id).toBe("video-1")
    expect(result!.previewUrl).toMatch(/^https:\/\/signed\.example/)
    expect(result!.transcript?.transcript_text).toContain("rotational")
    expect(result!.posts).toHaveLength(1)
    expect(result!.posts[0].id).toBe("post-1")
  })

  it("runs transcript and posts fetches in parallel", async () => {
    const order: string[] = []
    vi.mocked(getVideoUploadById).mockResolvedValueOnce(fixtureVideo)
    vi.mocked(getTranscriptForVideo).mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push("transcript")
      return fixtureTranscript
    })
    vi.mocked(listSocialPostsBySourceVideo).mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push("posts")
      return [fixturePost]
    })
    await getDrawerData("video-1")
    // If parallel, "posts" resolves first because its sleep is shorter.
    expect(order).toEqual(["posts", "transcript"])
  })
})

describe("getDrawerDataForPost", () => {
  beforeEach(() => {
    vi.mocked(getSocialPostById).mockReset()
    vi.mocked(getVideoUploadById).mockReset()
    vi.mocked(getTranscriptForVideo).mockReset()
    vi.mocked(listSocialPostsBySourceVideo).mockReset()
  })

  it("returns null when the post does not exist", async () => {
    vi.mocked(getSocialPostById).mockResolvedValueOnce(null)
    expect(await getDrawerDataForPost("missing")).toBeNull()
  })

  it("post-only mode when source_video_id is null", async () => {
    vi.mocked(getSocialPostById).mockResolvedValueOnce({
      ...fixturePost,
      source_video_id: null,
    })
    const result = await getDrawerDataForPost("post-1")
    expect(result).not.toBeNull()
    expect(result!.mode).toBe("post-only")
    expect(result!.posts).toHaveLength(1)
    expect(result!.video).toBeNull()
  })

  it("resolves to full video mode when source_video_id is set", async () => {
    vi.mocked(getSocialPostById).mockResolvedValueOnce(fixturePost)
    vi.mocked(getVideoUploadById).mockResolvedValueOnce(fixtureVideo)
    vi.mocked(getTranscriptForVideo).mockResolvedValueOnce(fixtureTranscript)
    vi.mocked(listSocialPostsBySourceVideo).mockResolvedValueOnce([fixturePost])
    const result = await getDrawerDataForPost("post-1")
    expect(result!.mode).toBe("video")
    expect(result!.video?.id).toBe("video-1")
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm run test:run -- __tests__/lib/content-studio/drawer-data.test.ts
```

Expected: FAIL — `lib/content-studio/drawer-data` module not found, and `listSocialPostsBySourceVideo` does not exist yet.

- [ ] **Step 3: Add `listSocialPostsBySourceVideo` to the DAL**

Edit `lib/db/social-posts.ts` — append this function to the bottom of the file:

```typescript
export async function listSocialPostsBySourceVideo(
  sourceVideoId: string,
): Promise<SocialPost[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("social_posts")
    .select("*")
    .eq("source_video_id", sourceVideoId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as SocialPost[]
}
```

- [ ] **Step 4: Write minimal implementation of the fetcher**

Create `lib/content-studio/drawer-data.ts`:

```typescript
import { getAdminStorage } from "@/lib/firebase-admin"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { getSocialPostById, listSocialPostsBySourceVideo } from "@/lib/db/social-posts"
import type { VideoUpload, VideoTranscript, SocialPost } from "@/types/database"

const PREVIEW_URL_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

export interface DrawerData {
  mode: "video" | "post-only"
  video: VideoUpload | null
  previewUrl: string | null
  transcript: VideoTranscript | null
  posts: SocialPost[]
  /** When opened from a post card, echoed back so the client can pre-expand. */
  highlightPostId: string | null
}

async function signPreviewUrl(storagePath: string): Promise<string> {
  const bucket = getAdminStorage().bucket()
  const [url] = await bucket.file(storagePath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + PREVIEW_URL_EXPIRY_MS,
  })
  return url
}

export async function getDrawerData(videoId: string): Promise<DrawerData | null> {
  const video = await getVideoUploadById(videoId)
  if (!video) return null

  // Fan out the three I/O-bound fetches in parallel.
  const [transcript, posts, previewUrl] = await Promise.all([
    getTranscriptForVideo(videoId),
    listSocialPostsBySourceVideo(videoId),
    signPreviewUrl(video.storage_path),
  ])

  return {
    mode: "video",
    video,
    previewUrl,
    transcript,
    posts,
    highlightPostId: null,
  }
}

export async function getDrawerDataForPost(postId: string): Promise<DrawerData | null> {
  const post = await getSocialPostById(postId)
  if (!post) return null

  if (!post.source_video_id) {
    return {
      mode: "post-only",
      video: null,
      previewUrl: null,
      transcript: null,
      posts: [post],
      highlightPostId: post.id,
    }
  }

  const base = await getDrawerData(post.source_video_id)
  if (!base) {
    // Fallback: source video was deleted — still render the post alone.
    return {
      mode: "post-only",
      video: null,
      previewUrl: null,
      transcript: null,
      posts: [post],
      highlightPostId: post.id,
    }
  }

  return { ...base, highlightPostId: post.id }
}
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
npm run test:run -- __tests__/lib/content-studio/drawer-data.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/content-studio/drawer-data.ts lib/db/social-posts.ts __tests__/lib/content-studio/drawer-data.test.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): drawer data fetcher joins video + transcript + posts

Single server-side entry point that fans out three I/O-bound fetches in
parallel and signs a Firebase preview URL. Handles both video-entered and
post-entered drawer opens, including the manual-post (no source_video_id)
case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: DrawerVideoHeader component (player + metadata)

**Files:**
- Create: `components/admin/content-studio/drawer/DrawerVideoHeader.tsx`

- [ ] **Step 1: Write the implementation**

This component is pure presentation; the integration is covered by the Playwright e2e in Task 10. The player reuses the same `<video controls>` pattern as `components/admin/videos/VideoListCard.tsx` (lines 313-321) so no new upload/preview infrastructure is needed.

Create `components/admin/content-studio/drawer/DrawerVideoHeader.tsx`:

```typescript
import { Clock, HardDrive, Calendar } from "lucide-react"
import type { VideoUpload } from "@/types/database"

interface DrawerVideoHeaderProps {
  video: VideoUpload
  previewUrl: string | null
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

export function DrawerVideoHeader({ video, previewUrl }: DrawerVideoHeaderProps) {
  const title = video.title ?? video.original_filename
  return (
    <div className="border-b border-border bg-surface/40">
      {previewUrl ? (
        <video
          src={previewUrl}
          controls
          preload="metadata"
          className="w-full aspect-video bg-black"
        >
          Your browser does not support the video element.
        </video>
      ) : (
        <div className="w-full aspect-video bg-muted flex items-center justify-center text-sm text-muted-foreground">
          Preview unavailable
        </div>
      )}
      <div className="px-6 py-4">
        <h2 className="font-heading text-lg text-primary truncate" title={title}>
          {title}
        </h2>
        <p className="text-xs text-muted-foreground truncate" title={video.original_filename}>
          {video.original_filename}
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
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
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/content-studio/drawer/DrawerVideoHeader.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): DrawerVideoHeader — player + filename + metadata

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: DrawerPostOnlyHeader component

**Files:**
- Create: `components/admin/content-studio/drawer/DrawerPostOnlyHeader.tsx`

- [ ] **Step 1: Write the implementation**

Create `components/admin/content-studio/drawer/DrawerPostOnlyHeader.tsx`:

```typescript
import { FileText } from "lucide-react"

export function DrawerPostOnlyHeader() {
  return (
    <div className="border-b border-border bg-surface/40 px-6 py-10">
      <div className="rounded-lg border-2 border-dashed border-border bg-background/60 py-10 flex flex-col items-center text-center">
        <FileText className="size-8 text-muted-foreground mb-2" strokeWidth={1.5} />
        <h2 className="font-heading text-lg text-primary">Manual post</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">
          No source video — this post was created directly or its source video has been deleted.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/content-studio/drawer/DrawerPostOnlyHeader.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): DrawerPostOnlyHeader placeholder for video-less posts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: TranscriptTab component

**Files:**
- Create: `components/admin/content-studio/drawer/TranscriptTab.tsx`
- Test: `__tests__/components/admin/content-studio/drawer/TranscriptTab.test.tsx`

Scope note: **Regenerate** and **Edit** actions are stubbed in Phase 2 (buttons rendered, `onClick` opens a toast "Coming in Phase 3" — the live retry flows exist via other endpoints but wiring the transcript edit UI is out of scope here). **Copy** is fully functional. This is called out in the spec — Phase 2's single goal is putting the transcript next to the video.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/drawer/TranscriptTab.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TranscriptTab } from "@/components/admin/content-studio/drawer/TranscriptTab"

const writeText = vi.fn()
Object.assign(navigator, { clipboard: { writeText } })

describe("<TranscriptTab>", () => {
  const base = {
    id: "t-1",
    video_upload_id: "video-1",
    transcript_text: "Hello world, this is a transcript.",
    language: "en",
    assemblyai_job_id: "aai-1",
    analysis: null,
    source: "speech" as const,
    created_at: "2026-04-15T12:00:00Z",
  }

  it("renders the full transcript text", () => {
    render(<TranscriptTab transcript={base} />)
    expect(screen.getByText(/Hello world, this is a transcript\./)).toBeInTheDocument()
  })

  it("shows the Vision description badge when source is vision", () => {
    render(<TranscriptTab transcript={{ ...base, source: "vision" }} />)
    expect(screen.getByText(/Vision description/i)).toBeInTheDocument()
  })

  it("does not show the Vision badge for speech transcripts", () => {
    render(<TranscriptTab transcript={base} />)
    expect(screen.queryByText(/Vision description/i)).not.toBeInTheDocument()
  })

  it("copies the transcript text when Copy is clicked", () => {
    writeText.mockClear()
    render(<TranscriptTab transcript={base} />)
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }))
    expect(writeText).toHaveBeenCalledWith("Hello world, this is a transcript.")
  })

  it("renders an empty-state when transcript is null", () => {
    render(<TranscriptTab transcript={null} />)
    expect(screen.getByText(/No transcript yet/i)).toBeInTheDocument()
  })

  it("has a stubbed Regenerate button that shows a toast (no crash)", () => {
    render(<TranscriptTab transcript={base} />)
    const btn = screen.getByRole("button", { name: /regenerate/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn) // should not throw
  })
})
```

- [ ] **Step 2: Run the test**

```bash
npm run test:run -- __tests__/components/admin/content-studio/drawer/TranscriptTab.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `components/admin/content-studio/drawer/TranscriptTab.tsx`:

```typescript
"use client"

import { Copy, RefreshCw, Pencil, Sparkles } from "lucide-react"
import { toast } from "sonner"
import type { VideoTranscript } from "@/types/database"

interface TranscriptTabProps {
  transcript: VideoTranscript | null
}

export function TranscriptTab({ transcript }: TranscriptTabProps) {
  if (!transcript) {
    return (
      <div className="py-12 text-center">
        <Sparkles className="size-8 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No transcript yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Click Transcribe on the video card to generate one.
        </p>
      </div>
    )
  }

  const isVision = transcript.source === "vision"

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(transcript!.transcript_text)
      toast.success("Transcript copied")
    } catch {
      toast.error("Copy failed")
    }
  }

  function handleStub(label: string) {
    toast.info(`${label} is coming in a later phase — Phase 2 ships the transcript-next-to-video fix only.`)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center flex-wrap gap-2 px-6 py-3 border-b border-border bg-background">
        {isVision && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-medium">
            <Sparkles className="size-3" /> Vision description
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {transcript.transcript_text.length.toLocaleString()} characters · {transcript.language}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10"
          >
            <Copy className="size-3.5" /> Copy
          </button>
          <button
            type="button"
            onClick={() => handleStub("Regenerate")}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <RefreshCw className="size-3.5" /> Regenerate
          </button>
          <button
            type="button"
            onClick={() => handleStub("Edit")}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <p className="text-sm text-primary leading-relaxed whitespace-pre-wrap font-body">
          {transcript.transcript_text}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Re-run and verify**

```bash
npm run test:run -- __tests__/components/admin/content-studio/drawer/TranscriptTab.test.tsx
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/drawer/TranscriptTab.tsx __tests__/components/admin/content-studio/drawer/TranscriptTab.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): TranscriptTab with Vision badge + Copy action

Regenerate/Edit are stubs in this phase per the spec — Phase 2's scope is the
transcript-next-to-video fix only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: PostsTabRow component (inline collapsible row)

**Files:**
- Create: `components/admin/content-studio/drawer/PostsTabRow.tsx`
- Test: `__tests__/components/admin/content-studio/drawer/PostsTabRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/drawer/PostsTabRow.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PostsTabRow } from "@/components/admin/content-studio/drawer/PostsTabRow"
import type { SocialPost } from "@/types/database"

function makePost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "post-1",
    platform: "instagram",
    content: "Morning rotation check-in.",
    media_url: null,
    approval_status: "needs_review",
    scheduled_at: null,
    published_at: null,
    source_video_id: "video-1",
    rejection_notes: null,
    platform_post_id: null,
    created_by: "user-1",
    created_at: "2026-04-15T12:10:00Z",
    updated_at: "2026-04-15T12:10:00Z",
    ...overrides,
  }
}

describe("<PostsTabRow>", () => {
  it("shows platform label, status pill, and caption preview when collapsed", () => {
    render(<PostsTabRow post={makePost()} isExpanded={false} onToggle={vi.fn()} onMutate={vi.fn()} />)
    expect(screen.getByText(/Instagram/)).toBeInTheDocument()
    expect(screen.getByText(/needs review/i)).toBeInTheDocument()
    expect(screen.getByText(/Morning rotation check-in/)).toBeInTheDocument()
  })

  it("clicking the row header calls onToggle", () => {
    const onToggle = vi.fn()
    render(<PostsTabRow post={makePost()} isExpanded={false} onToggle={onToggle} onMutate={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /expand/i }))
    expect(onToggle).toHaveBeenCalledWith("post-1")
  })

  it("when expanded, shows the edit textarea and action buttons", () => {
    render(<PostsTabRow post={makePost()} isExpanded={true} onToggle={vi.fn()} onMutate={vi.fn()} />)
    expect(screen.getByRole("textbox", { name: /caption/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /schedule/i })).toBeInTheDocument()
  })

  it("for failed posts, surfaces the rejection note", () => {
    render(
      <PostsTabRow
        post={makePost({ approval_status: "failed", rejection_notes: "Facebook API 403" })}
        isExpanded={true}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
      />,
    )
    expect(screen.getByText(/Facebook API 403/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
  })

  it("published posts lock the edit UI and hide approve/schedule", () => {
    render(
      <PostsTabRow
        post={makePost({ approval_status: "published", published_at: "2026-04-16T08:00:00Z" })}
        isExpanded={true}
        onToggle={vi.fn()}
        onMutate={vi.fn()}
      />,
    )
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /schedule/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Published/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:run -- __tests__/components/admin/content-studio/drawer/PostsTabRow.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `components/admin/content-studio/drawer/PostsTabRow.tsx`:

```typescript
"use client"

import { useState } from "react"
import {
  Facebook,
  Instagram,
  Music2,
  Youtube,
  Linkedin,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Zap,
} from "lucide-react"
import { toast } from "sonner"
import type { SocialPost, SocialPlatform } from "@/types/database"
import { cn } from "@/lib/utils"

const PLATFORM_ICONS: Record<SocialPlatform, typeof Facebook> = {
  facebook: Facebook,
  instagram: Instagram,
  tiktok: Music2,
  youtube: Youtube,
  youtube_shorts: Youtube,
  linkedin: Linkedin,
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  youtube_shorts: "YouTube Shorts",
  linkedin: "LinkedIn",
}

const STATUS_PILL_CLASSES: Record<SocialPost["approval_status"], string> = {
  draft: "bg-muted text-muted-foreground",
  edited: "bg-muted text-muted-foreground",
  needs_review: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  scheduled: "bg-accent/10 text-accent",
  published: "bg-primary/10 text-primary",
  rejected: "bg-error/10 text-error",
  awaiting_connection: "bg-warning/10 text-warning",
  failed: "bg-error/10 text-error",
}

function formatStatus(status: SocialPost["approval_status"]): string {
  return status.replace(/_/g, " ")
}

interface PostsTabRowProps {
  post: SocialPost
  isExpanded: boolean
  onToggle: (postId: string) => void
  onMutate: (updated: SocialPost) => void
}

export function PostsTabRow({ post, isExpanded, onToggle, onMutate }: PostsTabRowProps) {
  const [draft, setDraft] = useState(post.content)
  const [busy, setBusy] = useState<"approve" | "schedule" | "retry" | "save" | null>(null)
  const Icon = PLATFORM_ICONS[post.platform]
  const isPublished = post.approval_status === "published"
  const isFailed = post.approval_status === "failed"

  async function approve() {
    setBusy("approve")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/approve`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const { approval_status } = (await res.json()) as { approval_status: SocialPost["approval_status"] }
      onMutate({ ...post, approval_status })
      toast.success("Approved")
    } catch (err) {
      toast.error((err as Error).message || "Approve failed")
    } finally {
      setBusy(null)
    }
  }

  async function retry() {
    setBusy("retry")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/publish-now`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as Pick<SocialPost, "approval_status" | "scheduled_at">
      onMutate({ ...post, ...data, rejection_notes: null })
      toast.success("Requeued for publishing")
    } catch (err) {
      toast.error((err as Error).message || "Retry failed")
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (draft.trim() === post.content.trim()) return
    setBusy("save")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption_text: draft, hashtags: [] }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { content: string; approval_status: SocialPost["approval_status"] }
      onMutate({ ...post, content: data.content, approval_status: data.approval_status })
      toast.success("Caption updated")
    } catch (err) {
      toast.error((err as Error).message || "Save failed")
    } finally {
      setBusy(null)
    }
  }

  function handleScheduleStub() {
    // The schedule picker dialog from Phase 3 pipeline / Phase 4 calendar wires
    // this up end-to-end. For Phase 2 we surface the button but redirect the user
    // to the Calendar tab for date/time selection.
    toast.info("Open the Calendar tab to drop this on a day — schedule picker lands in Phase 4.")
  }

  return (
    <div
      data-post-id={post.id}
      className={cn(
        "border border-border rounded-lg bg-white overflow-hidden",
        isFailed && "border-error/40",
        isPublished && "opacity-75",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(post.id)}
        aria-label={isExpanded ? `Collapse post ${post.id}` : `Expand post ${post.id}`}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface/40"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="size-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-primary">{PLATFORM_LABELS[post.platform]}</span>
            <span
              className={cn(
                "text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full",
                STATUS_PILL_CLASSES[post.approval_status],
              )}
            >
              {formatStatus(post.approval_status)}
            </span>
            {post.scheduled_at && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(post.scheduled_at).toLocaleString()}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{post.content}</p>
        </div>
        {isExpanded ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 border-t border-border space-y-3">
          {isFailed && post.rejection_notes && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-error/5 border border-error/20 text-xs text-error">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{post.rejection_notes}</span>
            </div>
          )}
          <label className="block text-xs text-muted-foreground">
            Caption
            <textarea
              aria-label="Caption"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              disabled={isPublished}
              className="mt-1 w-full rounded-md border border-border p-2 text-sm font-body bg-surface/40 disabled:opacity-60"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {!isPublished && (
              <button
                type="button"
                onClick={save}
                disabled={busy !== null || draft.trim() === post.content.trim()}
                className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-60"
              >
                {busy === "save" ? "Saving..." : "Save caption"}
              </button>
            )}
            {!isPublished && post.approval_status !== "approved" && (
              <button
                type="button"
                onClick={approve}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 disabled:opacity-60"
              >
                {busy === "approve" ? "Approving..." : "Approve"}
              </button>
            )}
            {!isPublished && (
              <button
                type="button"
                onClick={handleScheduleStub}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-accent/10 text-accent hover:bg-accent/20"
              >
                Schedule
              </button>
            )}
            {isFailed && (
              <button
                type="button"
                onClick={retry}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-1"
              >
                <Zap className="size-3" /> {busy === "retry" ? "Retrying..." : "Retry"}
              </button>
            )}
            {isPublished && (
              <span className="text-xs text-muted-foreground">
                Published {post.published_at ? new Date(post.published_at).toLocaleString() : ""}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run and verify**

```bash
npm run test:run -- __tests__/components/admin/content-studio/drawer/PostsTabRow.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/drawer/PostsTabRow.tsx __tests__/components/admin/content-studio/drawer/PostsTabRow.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): PostsTabRow — collapsible row with inline edit/approve/retry

Schedule action defers to the Phase 4 calendar drag-drop flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: PostsTab component (list of rows)

**Files:**
- Create: `components/admin/content-studio/drawer/PostsTab.tsx`
- Test: `__tests__/components/admin/content-studio/drawer/PostsTab.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/drawer/PostsTab.test.tsx`:

```typescript
import { describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PostsTab } from "@/components/admin/content-studio/drawer/PostsTab"
import type { SocialPost } from "@/types/database"

const basePost = (id: string, overrides: Partial<SocialPost> = {}): SocialPost => ({
  id,
  platform: "instagram",
  content: `Caption for ${id}.`,
  media_url: null,
  approval_status: "needs_review",
  scheduled_at: null,
  published_at: null,
  source_video_id: "video-1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: "u",
  created_at: "2026-04-15T00:00:00Z",
  updated_at: "2026-04-15T00:00:00Z",
  ...overrides,
})

describe("<PostsTab>", () => {
  it("renders all posts", () => {
    render(<PostsTab posts={[basePost("p1"), basePost("p2")]} initialExpandedPostId={null} />)
    expect(screen.getByText(/Caption for p1/)).toBeInTheDocument()
    expect(screen.getByText(/Caption for p2/)).toBeInTheDocument()
  })

  it("pre-expands the initialExpandedPostId row", () => {
    render(<PostsTab posts={[basePost("p1"), basePost("p2")]} initialExpandedPostId="p2" />)
    // Expanded row has a caption textarea
    expect(screen.getByRole("textbox", { name: /caption/i })).toBeInTheDocument()
    // Only one expanded row at a time — so only one textarea
    expect(screen.getAllByRole("textbox", { name: /caption/i })).toHaveLength(1)
  })

  it("clicking a collapsed row header expands it", () => {
    render(<PostsTab posts={[basePost("p1")]} initialExpandedPostId={null} />)
    expect(screen.queryByRole("textbox", { name: /caption/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /expand/i }))
    expect(screen.getByRole("textbox", { name: /caption/i })).toBeInTheDocument()
  })

  it("renders an empty state when there are no posts", () => {
    render(<PostsTab posts={[]} initialExpandedPostId={null} />)
    expect(screen.getByText(/No posts generated yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:run -- __tests__/components/admin/content-studio/drawer/PostsTab.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `components/admin/content-studio/drawer/PostsTab.tsx`:

```typescript
"use client"

import { useState, useEffect } from "react"
import { Megaphone } from "lucide-react"
import { PostsTabRow } from "./PostsTabRow"
import type { SocialPost } from "@/types/database"

interface PostsTabProps {
  posts: SocialPost[]
  /** Post id that should start expanded (from ?postId= query). */
  initialExpandedPostId: string | null
}

export function PostsTab({ posts: initialPosts, initialExpandedPostId }: PostsTabProps) {
  const [posts, setPosts] = useState(initialPosts)
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedPostId)

  useEffect(() => {
    setPosts(initialPosts)
  }, [initialPosts])

  useEffect(() => {
    setExpandedId(initialExpandedPostId)
  }, [initialExpandedPostId])

  function toggle(postId: string) {
    setExpandedId((prev) => (prev === postId ? null : postId))
  }

  function mutate(updated: SocialPost) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  if (posts.length === 0) {
    return (
      <div className="py-12 text-center">
        <Megaphone className="size-8 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No posts generated yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Run the social fanout from the video card to generate 6 captions.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 px-6 py-4">
      {posts.map((post) => (
        <PostsTabRow
          key={post.id}
          post={post}
          isExpanded={expandedId === post.id}
          onToggle={toggle}
          onMutate={mutate}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Scroll the expanded row into view**

Add an effect in `PostsTab.tsx` — just below the two existing effects — so that when an `initialExpandedPostId` is set on mount, the drawer scrolls to it. Insert:

```typescript
useEffect(() => {
  if (!initialExpandedPostId) return
  const el = document.querySelector(`[data-post-id="${initialExpandedPostId}"]`)
  el?.scrollIntoView({ behavior: "smooth", block: "center" })
}, [initialExpandedPostId])
```

- [ ] **Step 5: Run and verify**

```bash
npm run test:run -- __tests__/components/admin/content-studio/drawer/PostsTab.test.tsx
```

Expected: PASS (4 tests). If `scrollIntoView` throws in jsdom (not implemented), wrap the call in a `typeof el?.scrollIntoView === "function"` guard.

- [ ] **Step 6: Commit**

```bash
git add components/admin/content-studio/drawer/PostsTab.tsx __tests__/components/admin/content-studio/drawer/PostsTab.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): PostsTab — inline list with deep-link pre-expansion

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: MetaTab component

**Files:**
- Create: `components/admin/content-studio/drawer/MetaTab.tsx`
- Test: `__tests__/components/admin/content-studio/drawer/MetaTab.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/drawer/MetaTab.test.tsx`:

```typescript
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MetaTab } from "@/components/admin/content-studio/drawer/MetaTab"
import type { SocialPost, VideoTranscript, VideoUpload } from "@/types/database"

const video: VideoUpload = {
  id: "video-1",
  storage_path: "uploads/video-1.mp4",
  original_filename: "clip.mp4",
  duration_seconds: 42,
  size_bytes: 1_000_000,
  mime_type: "video/mp4",
  title: "Clip",
  uploaded_by: "user-1",
  status: "transcribed",
  created_at: "2026-04-15T10:00:00Z",
  updated_at: "2026-04-15T10:01:00Z",
}
const transcript: VideoTranscript = {
  id: "t-1",
  video_upload_id: "video-1",
  transcript_text: "hi",
  language: "en",
  assemblyai_job_id: "aai-xyz",
  analysis: null,
  source: "speech",
  created_at: "2026-04-15T10:05:00Z",
}
const failedPost: SocialPost = {
  id: "p-1",
  platform: "facebook",
  content: "oops",
  media_url: null,
  approval_status: "failed",
  scheduled_at: null,
  published_at: null,
  source_video_id: "video-1",
  rejection_notes: "FB API 403 — token expired",
  platform_post_id: null,
  created_by: "u",
  created_at: "2026-04-15T11:00:00Z",
  updated_at: "2026-04-15T11:01:00Z",
}

describe("<MetaTab>", () => {
  it("renders upload info", () => {
    render(<MetaTab video={video} transcript={transcript} posts={[]} />)
    expect(screen.getByText(/clip\.mp4/)).toBeInTheDocument()
    expect(screen.getByText(/uploads\/video-1\.mp4/)).toBeInTheDocument()
  })

  it("renders the AssemblyAI job id when available", () => {
    render(<MetaTab video={video} transcript={transcript} posts={[]} />)
    expect(screen.getByText(/aai-xyz/)).toBeInTheDocument()
  })

  it("surfaces publishing errors from failed posts", () => {
    render(<MetaTab video={video} transcript={transcript} posts={[failedPost]} />)
    expect(screen.getByText(/FB API 403 — token expired/)).toBeInTheDocument()
  })

  it("renders a 'no errors' line when no posts are failed", () => {
    render(<MetaTab video={video} transcript={transcript} posts={[]} />)
    expect(screen.getByText(/no publishing errors/i)).toBeInTheDocument()
  })

  it("works in post-only mode (no video)", () => {
    render(<MetaTab video={null} transcript={null} posts={[failedPost]} />)
    expect(screen.getByText(/no source video/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:run -- __tests__/components/admin/content-studio/drawer/MetaTab.test.tsx
```

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/drawer/MetaTab.tsx`:

```typescript
import { AlertCircle } from "lucide-react"
import type { SocialPost, VideoTranscript, VideoUpload } from "@/types/database"

interface MetaTabProps {
  video: VideoUpload | null
  transcript: VideoTranscript | null
  posts: SocialPost[]
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 border-b border-border last:border-0">
      <dt className="text-xs text-muted-foreground w-36 shrink-0 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-primary break-all">{value}</dd>
    </div>
  )
}

export function MetaTab({ video, transcript, posts }: MetaTabProps) {
  const failed = posts.filter((p) => p.approval_status === "failed" && p.rejection_notes)
  const statusHistory = posts.map((p) => ({
    id: p.id,
    platform: p.platform,
    status: p.approval_status,
    updated_at: p.updated_at,
  }))

  return (
    <div className="px-6 py-4 space-y-6">
      <section>
        <h3 className="font-heading text-sm text-primary uppercase tracking-wide mb-2">
          Upload
        </h3>
        {video ? (
          <dl className="rounded-lg border border-border bg-white px-4 py-2">
            <MetaRow label="ID" value={video.id} />
            <MetaRow label="Filename" value={video.original_filename} />
            <MetaRow label="Storage path" value={video.storage_path} />
            <MetaRow label="Status" value={video.status} />
            <MetaRow
              label="Uploaded at"
              value={new Date(video.created_at).toLocaleString()}
            />
            <MetaRow
              label="Size"
              value={video.size_bytes ? `${video.size_bytes.toLocaleString()} bytes` : "—"}
            />
            <MetaRow
              label="Duration"
              value={video.duration_seconds ? `${video.duration_seconds}s` : "—"}
            />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground italic">No source video for this post.</p>
        )}
      </section>

      {transcript && (
        <section>
          <h3 className="font-heading text-sm text-primary uppercase tracking-wide mb-2">
            Transcript
          </h3>
          <dl className="rounded-lg border border-border bg-white px-4 py-2">
            <MetaRow label="Source" value={transcript.source} />
            <MetaRow label="Language" value={transcript.language} />
            <MetaRow
              label="AssemblyAI job id"
              value={transcript.assemblyai_job_id ?? "—"}
            />
            <MetaRow
              label="Created at"
              value={new Date(transcript.created_at).toLocaleString()}
            />
          </dl>
        </section>
      )}

      <section>
        <h3 className="font-heading text-sm text-primary uppercase tracking-wide mb-2">
          Fanout history
        </h3>
        {statusHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No posts generated yet.</p>
        ) : (
          <ul className="text-sm text-primary space-y-1">
            {statusHistory.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-1 border-b border-border last:border-0">
                <span className="w-24 text-xs uppercase tracking-wide text-muted-foreground">
                  {h.platform}
                </span>
                <span className="flex-1">{h.status}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(h.updated_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="font-heading text-sm text-primary uppercase tracking-wide mb-2">
          Publishing errors
        </h3>
        {failed.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No publishing errors.</p>
        ) : (
          <ul className="space-y-2">
            {failed.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-2 rounded-md border border-error/30 bg-error/5 p-2 text-sm text-error"
              >
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">
                    {p.platform} · {p.id}
                  </p>
                  <p className="mt-0.5">{p.rejection_notes}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Re-run and verify**

```bash
npm run test:run -- __tests__/components/admin/content-studio/drawer/MetaTab.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/drawer/MetaTab.tsx __tests__/components/admin/content-studio/drawer/MetaTab.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): MetaTab — upload + transcript + fanout history + errors

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: DrawerContent — compose the tab bar and bodies

**Files:**
- Create: `components/admin/content-studio/drawer/DrawerContent.tsx`
- Test: `__tests__/components/admin/content-studio/drawer/DrawerContent.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/drawer/DrawerContent.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DrawerContent } from "@/components/admin/content-studio/drawer/DrawerContent"
import type { DrawerData } from "@/lib/content-studio/drawer-data"

const replaceMock = vi.fn()
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation")
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), replace: replaceMock, back: vi.fn() }),
    useSearchParams: () => new URLSearchParams("tab=posts"),
    usePathname: () => "/admin/content/video-1",
  }
})

const videoData: DrawerData = {
  mode: "video",
  video: {
    id: "video-1",
    storage_path: "p.mp4",
    original_filename: "p.mp4",
    duration_seconds: 10,
    size_bytes: 1000,
    mime_type: "video/mp4",
    title: "Test",
    uploaded_by: "u",
    status: "transcribed",
    created_at: "2026-04-15T00:00:00Z",
    updated_at: "2026-04-15T00:00:00Z",
  },
  previewUrl: "https://signed.example/video.mp4",
  transcript: null,
  posts: [],
  highlightPostId: null,
}

const postOnlyData: DrawerData = {
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
      approval_status: "needs_review",
      scheduled_at: null,
      published_at: null,
      source_video_id: null,
      rejection_notes: null,
      platform_post_id: null,
      created_by: "u",
      created_at: "2026-04-15T00:00:00Z",
      updated_at: "2026-04-15T00:00:00Z",
    },
  ],
  highlightPostId: "p1",
}

describe("<DrawerContent>", () => {
  it("renders the video header when mode=video", () => {
    render(<DrawerContent data={videoData} defaultTab="transcript" />)
    expect(screen.getByRole("heading", { name: /Test/ })).toBeInTheDocument()
  })

  it("renders the post-only header when mode=post-only", () => {
    render(<DrawerContent data={postOnlyData} defaultTab="posts" />)
    expect(screen.getByText(/Manual post/i)).toBeInTheDocument()
  })

  it("shows the posts count in the tab label", () => {
    render(
      <DrawerContent
        data={{ ...videoData, posts: [postOnlyData.posts[0]] }}
        defaultTab="transcript"
      />,
    )
    expect(screen.getByRole("tab", { name: /Posts \(1\)/ })).toBeInTheDocument()
  })

  it("clicking a tab updates the URL via router.replace", () => {
    replaceMock.mockClear()
    render(<DrawerContent data={videoData} defaultTab="transcript" />)
    fireEvent.click(screen.getByRole("tab", { name: /Meta/ }))
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/tab=meta/), { scroll: false })
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:run -- __tests__/components/admin/content-studio/drawer/DrawerContent.test.tsx
```

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/drawer/DrawerContent.tsx`:

```typescript
"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useCallback } from "react"
import { DrawerVideoHeader } from "./DrawerVideoHeader"
import { DrawerPostOnlyHeader } from "./DrawerPostOnlyHeader"
import { TranscriptTab } from "./TranscriptTab"
import { PostsTab } from "./PostsTab"
import { MetaTab } from "./MetaTab"
import type { DrawerData } from "@/lib/content-studio/drawer-data"
import { cn } from "@/lib/utils"

export type DrawerTab = "transcript" | "posts" | "meta"

interface DrawerContentProps {
  data: DrawerData
  defaultTab: DrawerTab
}

function resolveTab(raw: string | null): DrawerTab {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return "transcript"
}

export function DrawerContent({ data, defaultTab }: DrawerContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const active: DrawerTab = resolveTab(searchParams.get("tab") ?? defaultTab)

  const setTab = useCallback(
    (nextTab: DrawerTab) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("tab", nextTab)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const postsCount = data.posts.length

  return (
    <div className="flex flex-col h-full">
      {data.mode === "video" && data.video ? (
        <DrawerVideoHeader video={data.video} previewUrl={data.previewUrl} />
      ) : (
        <DrawerPostOnlyHeader />
      )}

      <div
        role="tablist"
        aria-label="Video detail tabs"
        className="flex items-center border-b border-border px-2 bg-background"
      >
        <TabButton label="Transcript" isActive={active === "transcript"} onClick={() => setTab("transcript")} />
        <TabButton
          label={`Posts (${postsCount})`}
          isActive={active === "posts"}
          onClick={() => setTab("posts")}
        />
        <TabButton label="Meta" isActive={active === "meta"} onClick={() => setTab("meta")} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {active === "transcript" && <TranscriptTab transcript={data.transcript} />}
        {active === "posts" && (
          <PostsTab posts={data.posts} initialExpandedPostId={data.highlightPostId} />
        )}
        {active === "meta" && (
          <MetaTab video={data.video} transcript={data.transcript} posts={data.posts} />
        )}
      </div>
    </div>
  )
}

function TabButton({
  label,
  isActive,
  onClick,
}: {
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      role="tab"
      type="button"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
        isActive
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  )
}
```

- [ ] **Step 4: Re-run and verify**

```bash
npm run test:run -- __tests__/components/admin/content-studio/drawer/DrawerContent.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/drawer/DrawerContent.tsx __tests__/components/admin/content-studio/drawer/DrawerContent.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): DrawerContent composes header + tab bar + tab bodies

Tab state is URL-driven (?tab=) so refreshing or deep-linking preserves it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire up the DetailDrawer + videoId route to the real data

**Files:**
- Modify: `components/admin/content-studio/DetailDrawer.tsx`
- Modify: `app/(admin)/admin/content/[videoId]/page.tsx`
- Create: `app/(admin)/admin/content/post/[postId]/page.tsx`

- [ ] **Step 1: Change `DetailDrawer` to accept data + defaultTab props**

Edit `components/admin/content-studio/DetailDrawer.tsx` to take `data` instead of just `videoId`. Replace the entire file contents with:

```typescript
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { X } from "lucide-react"
import { DrawerContent, type DrawerTab } from "./drawer/DrawerContent"
import type { DrawerData } from "@/lib/content-studio/drawer-data"

interface DetailDrawerProps {
  data: DrawerData
  defaultTab: DrawerTab
  /** Where to navigate when the drawer closes (e.g. back to the tab the user came from). */
  closeHref: string
}

export function DetailDrawer({ data, defaultTab, closeHref }: DetailDrawerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const title =
    data.mode === "video" && data.video
      ? `Video · ${data.video.title ?? data.video.original_filename}`
      : "Manual post"

  function handleClose() {
    router.push(closeHref)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, closeHref])

  return (
    <>
      <button
        type="button"
        aria-label="Close drawer backdrop"
        onClick={handleClose}
        className="fixed inset-0 bg-black/40 z-40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-0 right-0 h-screen w-full max-w-[700px] bg-background border-l border-border z-50 flex flex-col"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-heading text-base truncate">{title}</h2>
          <button
            type="button"
            aria-label="Close drawer"
            onClick={handleClose}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 min-h-0">
          <DrawerContent data={data} defaultTab={defaultTab} />
        </div>
      </aside>
    </>
  )
}
```

- [ ] **Step 2: Update the Phase 1 test to use the new prop shape**

Replace `__tests__/components/admin/content-studio/DetailDrawer.test.tsx` with (Phase 1 API was `videoId`; this phase changes the prop to `data`):

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import type { DrawerData } from "@/lib/content-studio/drawer-data"

const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content/abc-123",
  useSearchParams: () => new URLSearchParams(""),
}))

const data: DrawerData = {
  mode: "video",
  video: {
    id: "abc-123",
    storage_path: "p.mp4",
    original_filename: "p.mp4",
    duration_seconds: 10,
    size_bytes: 1000,
    mime_type: "video/mp4",
    title: "Abc",
    uploaded_by: null,
    status: "transcribed",
    created_at: "2026-04-15T00:00:00Z",
    updated_at: "2026-04-15T00:00:00Z",
  },
  previewUrl: "https://example/p.mp4",
  transcript: null,
  posts: [],
  highlightPostId: null,
}

describe("<DetailDrawer>", () => {
  it("renders the video title in the header", () => {
    render(<DetailDrawer data={data} defaultTab="transcript" closeHref="/admin/content" />)
    expect(screen.getByText(/Video · Abc/)).toBeInTheDocument()
  })

  it("renders the drawer dialog role", () => {
    render(<DetailDrawer data={data} defaultTab="transcript" closeHref="/admin/content" />)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("navigates to closeHref when close is clicked", () => {
    pushMock.mockClear()
    render(
      <DetailDrawer data={data} defaultTab="transcript" closeHref="/admin/content?tab=videos" />,
    )
    fireEvent.click(screen.getByRole("button", { name: /close drawer$/i }))
    expect(pushMock).toHaveBeenCalledWith("/admin/content?tab=videos")
  })
})
```

- [ ] **Step 3: Update the [videoId] server page to fetch data**

Replace `app/(admin)/admin/content/[videoId]/page.tsx` with:

```typescript
import { notFound } from "next/navigation"
import { getDrawerData } from "@/lib/content-studio/drawer-data"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { TabPlaceholder } from "@/components/admin/content-studio/TabPlaceholder"
import type { DrawerTab } from "@/components/admin/content-studio/drawer/DrawerContent"

interface PageProps {
  params: Promise<{ videoId: string }>
  searchParams: Promise<{ tab?: string; postId?: string }>
}

function resolveTab(raw: string | undefined): DrawerTab {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return "transcript"
}

export default async function ContentStudioDrawerPage({ params, searchParams }: PageProps) {
  const { videoId } = await params
  const { tab, postId } = await searchParams

  const data = await getDrawerData(videoId)
  if (!data) notFound()

  // If ?postId= is present in the URL, override the server-computed highlightPostId
  // (server set it to null because the caller opened from the video itself).
  const effectiveData = postId ? { ...data, highlightPostId: postId } : data

  // Default tab selection follows the spec:
  //   video card → transcript
  //   post card → posts
  // The explicit ?tab= always wins.
  const defaultTab: DrawerTab = tab ? resolveTab(tab) : postId ? "posts" : "transcript"

  // closeHref preserves whichever tab the user was on in the shell.
  const closeHref = "/admin/content"

  // Render a placeholder behind the drawer — Phase 3 replaces this with the real Pipeline.
  return (
    <>
      <TabPlaceholder tabName="Pipeline" phaseLabel="Phase 3" />
      <DetailDrawer data={effectiveData} defaultTab={defaultTab} closeHref={closeHref} />
    </>
  )
}
```

- [ ] **Step 4: Create the post-only route**

Create `app/(admin)/admin/content/post/[postId]/page.tsx`:

```typescript
import { notFound } from "next/navigation"
import { getDrawerDataForPost } from "@/lib/content-studio/drawer-data"
import { DetailDrawer } from "@/components/admin/content-studio/DetailDrawer"
import { TabPlaceholder } from "@/components/admin/content-studio/TabPlaceholder"
import type { DrawerTab } from "@/components/admin/content-studio/drawer/DrawerContent"

interface PageProps {
  params: Promise<{ postId: string }>
  searchParams: Promise<{ tab?: string }>
}

function resolveTab(raw: string | undefined): DrawerTab {
  if (raw === "posts" || raw === "meta" || raw === "transcript") return raw
  return "posts"
}

export default async function ContentStudioPostDrawerPage({ params, searchParams }: PageProps) {
  const { postId } = await params
  const { tab } = await searchParams

  const data = await getDrawerDataForPost(postId)
  if (!data) notFound()

  // Post-only opens default to "posts" tab per the per-entry-point defaults table.
  const defaultTab = resolveTab(tab)
  const closeHref = "/admin/content?tab=posts"

  return (
    <>
      <TabPlaceholder tabName="Posts" phaseLabel="Phase 3" />
      <DetailDrawer data={data} defaultTab={defaultTab} closeHref={closeHref} />
    </>
  )
}
```

- [ ] **Step 5: Run the full updated drawer suite**

```bash
npm run test:run -- __tests__/components/admin/content-studio
npm run test:run -- __tests__/lib/content-studio
```

Expected: all Phase 1 + Phase 2 drawer tests pass.

- [ ] **Step 6: Manual smoke test**

Start the dev server:

```bash
CONTENT_STUDIO_ENABLED=true npm run dev
```

Visit, while logged in as admin and using a real video ID from `video_uploads`:

- `http://localhost:3050/admin/content/<real-video-id>` — should render with the video player, filename, metadata, and the Transcript tab active. If a transcript exists, the text appears; if not, the empty state appears.
- Append `?tab=posts` — Posts tab active, all social posts for this video listed.
- Append `?tab=posts&postId=<real-post-id>` — Posts tab active with that row pre-expanded and scrolled to.
- Visit `/admin/content/post/<real-post-id>` — drawer opens in Posts tab. If the post has a source video, the video header shows; if not, the Manual post placeholder shows.
- Click Meta tab — upload info, assemblyai id, fanout history, errors section visible.
- Press ESC — URL returns to `/admin/content` (or `/admin/content?tab=posts` for the post route).

- [ ] **Step 7: Commit**

```bash
git add components/admin/content-studio/DetailDrawer.tsx \
        __tests__/components/admin/content-studio/DetailDrawer.test.tsx \
        app/\(admin\)/admin/content/\[videoId\]/page.tsx \
        app/\(admin\)/admin/content/post/\[postId\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): wire DetailDrawer to real data + add post-only route

Drawer now renders DrawerContent with the real video, transcript, and posts
fetched server-side. /admin/content/post/[postId] handles manual posts and
posts whose source video was deleted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: E2E — drawer happy path

**Files:**
- Create: `__tests__/e2e/content-studio-drawer.spec.ts`

- [ ] **Step 1: Write the e2e suite**

Create `__tests__/e2e/content-studio-drawer.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

// Requires CONTENT_STUDIO_ENABLED=true plus a seeded admin and at least one
// video_uploads row with a transcript and social_posts. The test skips if
// no data is present so it can run in CI without pre-seeding.

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com"
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin-password"

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/admin\//)
}

async function firstVideoIdWithPosts(page: import("@playwright/test").Page): Promise<string | null> {
  // Uses an admin API response that the Videos tab already queries; if
  // no seed data, returns null and tests skip.
  const res = await page.request.get("/api/admin/videos")
  if (!res.ok()) return null
  const body = (await res.json()) as { videos?: Array<{ id: string }> } | Array<{ id: string }>
  const arr = Array.isArray(body) ? body : body.videos ?? []
  return arr[0]?.id ?? null
}

test.describe("Content Studio drawer", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test("opens with video player + transcript tab by default", async ({ page }) => {
    const videoId = await firstVideoIdWithPosts(page)
    test.skip(!videoId, "No seeded video with posts")

    const response = await page.goto(`/admin/content/${videoId}`)
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.locator("video")).toHaveCount(1)
    await expect(dialog.getByRole("tab", { name: /Transcript/ })).toHaveAttribute("aria-selected", "true")
  })

  test("switches to Posts tab via URL", async ({ page }) => {
    const videoId = await firstVideoIdWithPosts(page)
    test.skip(!videoId, "No seeded video with posts")

    const response = await page.goto(`/admin/content/${videoId}?tab=posts`)
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("tab", { name: /Posts/ })).toHaveAttribute("aria-selected", "true")
  })

  test("clicking Meta tab updates the URL", async ({ page }) => {
    const videoId = await firstVideoIdWithPosts(page)
    test.skip(!videoId, "No seeded video with posts")

    const response = await page.goto(`/admin/content/${videoId}`)
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await page.getByRole("tab", { name: /Meta/ }).click()
    await expect(page).toHaveURL(/tab=meta/)
    await expect(page.getByText(/Upload$/).or(page.getByText(/Storage path/))).toBeVisible()
  })

  test("ESC closes and restores /admin/content", async ({ page }) => {
    const videoId = await firstVideoIdWithPosts(page)
    test.skip(!videoId, "No seeded video with posts")

    const response = await page.goto(`/admin/content/${videoId}`)
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page.getByRole("dialog")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page).toHaveURL(/\/admin\/content$/)
    await expect(page.getByRole("dialog")).toBeHidden()
  })

  test("non-existent video id returns 404", async ({ page }) => {
    const response = await page.goto(
      "/admin/content/00000000-0000-0000-0000-000000000000",
    )
    expect(response?.status()).toBe(404)
  })
})
```

- [ ] **Step 2: Run the e2e**

In one terminal:
```bash
CONTENT_STUDIO_ENABLED=true npm run dev
```

In another:
```bash
E2E_ADMIN_EMAIL=<admin> E2E_ADMIN_PASSWORD=<pw> npm run test:e2e -- content-studio-drawer
```

Expected: either all tests pass, or they skip cleanly if no seed data is available.

- [ ] **Step 3: Commit**

```bash
git add __tests__/e2e/content-studio-drawer.spec.ts
git commit -m "$(cat <<'EOF'
test(content-studio): e2e for drawer — player, tabs, routing, 404

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final lint, typecheck, full test sweep

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: zero errors. Fix any that appear in files you touched.

- [ ] **Step 2: Format check**

```bash
npm run format:check
```

If files need formatting: `npm run format` then re-run.

- [ ] **Step 3: Full unit test run**

```bash
npm run test:run
```

Expected: all tests pass, including Phase 1 and the new Phase 2 suites.

- [ ] **Step 4: Commit any formatter fixes**

```bash
git add -u
git commit -m "chore(content-studio): prettier fixes from Phase 2" --allow-empty
```

(Skip if there were no changes.)

---

## Verification Before Calling Phase 2 Done

Before marking this phase complete, confirm ALL of the following:

1. **Drawer from video card (Transcript default).** Visit `/admin/content/<videoId>`. The drawer shows the video player, filename, upload date, duration, size. The Transcript tab is active. If a transcript exists, its text renders. If the transcript source is `vision`, the "Vision description" badge appears.
2. **Drawer from post card (Posts default + auto-expand).** Visit `/admin/content/<videoId>?tab=posts&postId=<postId>`. The Posts tab is active, all posts for the video are listed, and the specified post row is expanded and scrolled into view.
3. **Post-only mode.** For a manual post with no `source_video_id`, `/admin/content/post/<postId>` shows the "Manual post" placeholder instead of the player. The Posts tab still lists that single post and the row is pre-expanded.
4. **Meta tab.** All three section blocks render (Upload, Transcript, Fanout history, Publishing errors). Failed posts surface their `rejection_notes`. Missing data renders a muted "—" placeholder rather than an error.
5. **Posts tab inline actions.**
   - Expanding a row shows the caption textarea.
   - Edit → Save caption PATCHes `/api/admin/social/posts/[id]` and toasts success.
   - Approve moves the post to `approved` and the status pill changes.
   - Retry on a `failed` post POSTs `/api/admin/social/posts/[id]/publish-now`.
   - Published posts lock the textarea and hide approve/schedule.
6. **URL-driven tabs.** Clicking tabs updates `?tab=` without a full page navigation. Refreshing preserves the selected tab.
7. **ESC / backdrop / X close the drawer** and preserve the `?tab=` the user was on.
8. **Admin-only enforcement.** Non-admin users still hit the middleware redirect.
9. **All tests pass.**
   ```bash
   npm run test:run
   CONTENT_STUDIO_ENABLED=true npm run test:e2e -- content-studio
   ```

---

## Phase 2 Scope Boundaries

**In this phase:**
- Real drawer content — player, transcript, posts, meta
- URL-driven tab state (?tab=, ?postId=)
- Post-only mode
- Inline Copy on transcripts; inline Approve / Save / Retry on posts

**NOT in this phase** (handled in later phases):
- The two-lane Kanban pipeline board → **Phase 3**
- Flat list views for Videos/Posts tabs → **Phase 3**
- The full Month/Week/Day calendar with unscheduled panel → **Phase 4**
- Regenerate transcript / full transcript edit flow → **Phase 5 polish**
- Global search → **Phase 5**

When Phase 2 ships behind the flag, every entry point into the drawer places the transcript next to the video player and next to the posts — the original user pain point is fixed.
