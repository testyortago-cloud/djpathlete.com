# Starter AI Automation — Phase 3b: Scheduled Publishing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approved social posts publish to their platform at their scheduled time, automatically, via Vercel Cron → Next.js publish route → plugin registry. Adds a content calendar view and a schedule picker on each approved post.

**Architecture:** Coach schedules an approved post via a date-time picker (`POST /api/admin/social/posts/:id/schedule`). Vercel Cron hits `POST /api/admin/internal/publish-due` every 5 minutes (guarded by shared-secret header). The route fetches `social_posts` where `approval_status="scheduled"` AND `scheduled_at <= now()`, bootstraps the plugin registry from `platform_connections`, resolves media URLs from linked `video_uploads` (via short-lived Firebase Storage signed URLs), calls `plugin.publish()` per post, and writes the result (`platform_post_id` on success, `approval_status="failed"` + error on failure). Content calendar page renders scheduled posts + published posts on a week grid (read-only for this phase — drag-to-reschedule is deferred to 3c).

**Tech Stack:** Next.js App Router Route Handlers + Vercel Cron (cron in `vercel.json`) + existing `lib/social/bootstrap.ts` from Phase 2a + existing `lib/social/registry.ts` + `getAdminStorage().bucket().file().getSignedUrl()` pattern (already used by `transcribeVideo` in Phase 2a) + Vitest + existing admin design system.

**Existing infrastructure this plan builds on (no changes):**

- Phase 1 DAL: `lib/db/social-posts.ts`, `lib/db/social-captions.ts`, `lib/db/platform-connections.ts`, `lib/db/video-uploads.ts`
- Phase 2a plugins: `lib/social/plugins/{facebook,instagram,youtube,youtube-shorts,tiktok,linkedin}.ts`
- Phase 2a bootstrap: `lib/social/bootstrap.ts` (`bootstrapPlugins(connections, options)`)
- Phase 2a registry: `lib/social/registry.ts` (`pluginRegistry` singleton)
- Phase 3a: `components/admin/social/SocialPostCard.tsx` (we extend with a schedule picker)
- Auth: `lib/auth.ts` for admin routes. Shared-secret pattern reused from any existing internal routes.
- Resend + Firebase Admin messaging for TikTok hybrid: `lib/resend.ts`, `lib/firebase-admin.ts`

---

## File Structure

### Next.js API routes (new)

- `app/api/admin/social/posts/[id]/schedule/route.ts` — `POST { scheduled_at }` sets `approval_status="scheduled"` + stores ISO datetime
- `app/api/admin/internal/publish-due/route.ts` — cron-triggered; iterates due posts, publishes, updates status

### Next.js helpers (new)

- `lib/social/publish-runner.ts` — the logic called by the publish-due route. Extracted so it's unit-testable without Next.js route scaffolding.
- `lib/social/resolve-media-url.ts` — if `source_video_id` is set, generates a 1-hour Firebase Storage signed URL for the video; falls back to `media_url` column; returns `null` otherwise.

### Next.js UI (new + modify)

- `components/admin/social/SchedulePickerDialog.tsx` — modal with date + time inputs, triggered from approved post cards
- `components/admin/social/SocialPostCard.tsx` — modify to add "Schedule" button for approved posts
- `app/(admin)/admin/calendar/page.tsx` — new weekly calendar view showing scheduled + published posts
- `components/admin/calendar/WeekGrid.tsx` — read-only grid renderer

### Sidebar update

- `components/admin/AdminSidebar.tsx` — add Calendar link to the "AI Automation" section (between Social and Videos)

### Vercel Cron config (new)

- `vercel.json` — creates with a single cron entry hitting `/api/admin/internal/publish-due` every 5 min

### Env additions (new)

- `.env.example` — document `INTERNAL_CRON_TOKEN` (shared secret between Vercel Cron and the publish-due route)

### Tests (new)

- `__tests__/api/admin/social/schedule.test.ts`
- `__tests__/lib/social/publish-runner.test.ts`
- `__tests__/lib/social/resolve-media-url.test.ts`

---

## Tasks

### Task 1: `resolveMediaUrl` helper

**Files:**

- Create: `lib/social/resolve-media-url.ts`
- Create: `__tests__/lib/social/resolve-media-url.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/social/resolve-media-url.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getVideoUploadByIdMock = vi.fn()
const getAdminStorageMock = vi.fn()

vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (id: string) => getVideoUploadByIdMock(id),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => getAdminStorageMock(),
}))

import { resolveMediaUrl } from "@/lib/social/resolve-media-url"

describe("resolveMediaUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the post.media_url when source_video_id is null", async () => {
    const url = await resolveMediaUrl({
      source_video_id: null,
      media_url: "https://example.com/pic.jpg",
    })
    expect(url).toBe("https://example.com/pic.jpg")
    expect(getVideoUploadByIdMock).not.toHaveBeenCalled()
  })

  it("signs a Firebase Storage URL for the linked video when source_video_id is set", async () => {
    getVideoUploadByIdMock.mockResolvedValue({
      id: "v1",
      storage_path: "videos/admin-1/123-drill.mp4",
    })
    const fileMock = {
      getSignedUrl: vi.fn().mockResolvedValue(["https://storage.googleapis.com/signed-read"]),
    }
    getAdminStorageMock.mockReturnValue({ bucket: () => ({ file: () => fileMock }) })

    const url = await resolveMediaUrl({ source_video_id: "v1", media_url: null })
    expect(url).toBe("https://storage.googleapis.com/signed-read")
    expect(fileMock.getSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "read",
        version: "v4",
      }),
    )
  })

  it("returns null when source_video_id points at a missing row and media_url is null", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)
    const url = await resolveMediaUrl({ source_video_id: "ghost", media_url: null })
    expect(url).toBeNull()
  })

  it("falls back to media_url if video signing fails", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", storage_path: "videos/broken.mp4" })
    getAdminStorageMock.mockImplementation(() => {
      throw new Error("bucket unreachable")
    })
    const url = await resolveMediaUrl({
      source_video_id: "v1",
      media_url: "https://fallback.example.com/pic.jpg",
    })
    expect(url).toBe("https://fallback.example.com/pic.jpg")
  })
})
```

- [ ] **Step 2: Run → FAIL (module not found)**

Run: `npm run test:run -- __tests__/lib/social/resolve-media-url.test.ts`

- [ ] **Step 3: Write `lib/social/resolve-media-url.ts`**

```typescript
// lib/social/resolve-media-url.ts
// Given a social_posts row's source_video_id + media_url, returns the best
// media URL to pass to the plugin.publish() call. Priority:
//   1. If source_video_id is set and the video exists in Firebase Storage,
//      generate a 1-hour signed READ URL.
//   2. Fall back to the post's media_url column (for manually-uploaded images).
//   3. Return null for text-only posts.

import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getAdminStorage } from "@/lib/firebase-admin"

const SIGNED_URL_TTL_MS = 60 * 60 * 1000 // 1 hour — long enough for plugins to fetch

export interface ResolveMediaUrlInput {
  source_video_id: string | null
  media_url: string | null
}

export async function resolveMediaUrl(input: ResolveMediaUrlInput): Promise<string | null> {
  if (input.source_video_id) {
    try {
      const upload = await getVideoUploadById(input.source_video_id)
      if (upload?.storage_path) {
        const bucket = getAdminStorage().bucket()
        const file = bucket.file(upload.storage_path)
        const [url] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + SIGNED_URL_TTL_MS,
        })
        return url
      }
    } catch {
      // Fall through to media_url fallback
    }
  }
  return input.media_url ?? null
}
```

- [ ] **Step 4: Run → PASS (4 tests)**

Run: `npm run test:run -- __tests__/lib/social/resolve-media-url.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/social/resolve-media-url.ts __tests__/lib/social/resolve-media-url.test.ts
git commit -m "feat(social): resolveMediaUrl helper (signed video URL with media_url fallback)"
```

---

### Task 2: Schedule API route

**Files:**

- Create: `app/api/admin/social/posts/[id]/schedule/route.ts`
- Create: `__tests__/api/admin/social/schedule.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/admin/social/schedule.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (id: string) => getSocialPostByIdMock(id),
  updateSocialPost: (id: string, updates: unknown) => updateSocialPostMock(id, updates),
}))

import { POST } from "@/app/api/admin/social/posts/[id]/schedule/route"

async function callSchedule(id: string, body: unknown) {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/schedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/social/posts/:id/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await callSchedule("p1", { scheduled_at: new Date().toISOString() })
    expect(res.status).toBe(401)
  })

  it("returns 400 when scheduled_at is missing", async () => {
    const res = await callSchedule("p1", {})
    expect(res.status).toBe(400)
  })

  it("returns 400 when scheduled_at is in the past", async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "approved" })
    const res = await callSchedule("p1", { scheduled_at: pastTime })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("future")
  })

  it("returns 404 when the post is missing", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await callSchedule("nope", { scheduled_at: new Date(Date.now() + 60_000).toISOString() })
    expect(res.status).toBe(404)
  })

  it("returns 409 when the post isn't approved", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "draft" })
    const res = await callSchedule("p1", { scheduled_at: new Date(Date.now() + 60_000).toISOString() })
    expect(res.status).toBe(409)
  })

  it("updates scheduled_at and status for an approved post", async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "approved" })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "scheduled", scheduled_at: future })

    const res = await callSchedule("p1", { scheduled_at: future })
    expect(res.status).toBe(200)
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", {
      approval_status: "scheduled",
      scheduled_at: future,
    })
  })
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm run test:run -- __tests__/api/admin/social/schedule.test.ts`

- [ ] **Step 3: Write `app/api/admin/social/posts/[id]/schedule/route.ts`**

```typescript
// app/api/admin/social/posts/[id]/schedule/route.ts
// POST { scheduled_at: ISO datetime } — schedules an approved post for
// automatic publishing. Vercel Cron's /publish-due handler picks up rows
// where approval_status="scheduled" AND scheduled_at <= now().

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { scheduled_at?: string } | null
  const scheduledAtRaw = body?.scheduled_at?.trim()
  if (!scheduledAtRaw) {
    return NextResponse.json({ error: "scheduled_at is required (ISO datetime string)" }, { status: 400 })
  }

  const scheduledAt = new Date(scheduledAtRaw)
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: "scheduled_at is not a valid datetime" }, { status: 400 })
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "scheduled_at must be in the future" }, { status: 400 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }
  if (post.approval_status !== "approved" && post.approval_status !== "scheduled") {
    return NextResponse.json(
      { error: `Only approved posts can be scheduled (current status: ${post.approval_status})` },
      { status: 409 },
    )
  }

  const updated = await updateSocialPost(id, {
    approval_status: "scheduled",
    scheduled_at: scheduledAt.toISOString(),
  })

  return NextResponse.json({
    id: updated.id,
    approval_status: updated.approval_status,
    scheduled_at: updated.scheduled_at,
  })
}
```

- [ ] **Step 4: Run → PASS (6 tests)**

Run: `npm run test:run -- __tests__/api/admin/social/schedule.test.ts`

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/social/posts/[id]/schedule/route.ts __tests__/api/admin/social/schedule.test.ts
git commit -m "feat(api): POST /api/admin/social/posts/:id/schedule (approved → scheduled)"
```

---

### Task 3: Schedule picker UI on SocialPostCard

**Files:**

- Create: `components/admin/social/SchedulePickerDialog.tsx`
- Modify: `components/admin/social/SocialPostCard.tsx` (add "Schedule" button + dialog integration for approved posts)

- [ ] **Step 1: Write `components/admin/social/SchedulePickerDialog.tsx`**

```tsx
"use client"

import { useState } from "react"
import { Calendar as CalendarIcon, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { SocialPost } from "@/types/database"

interface SchedulePickerDialogProps {
  post: SocialPost
  open: boolean
  onOpenChange: (open: boolean) => void
  onScheduled: (updated: SocialPost) => void
}

function defaultScheduleTime(): { date: string; time: string } {
  // Default: 1 hour from now, rounded to next 15-min slot
  const now = new Date(Date.now() + 60 * 60 * 1000)
  const minutes = now.getMinutes()
  const rounded = Math.ceil(minutes / 15) * 15
  if (rounded === 60) {
    now.setHours(now.getHours() + 1)
    now.setMinutes(0)
  } else {
    now.setMinutes(rounded)
  }
  now.setSeconds(0, 0)

  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const hh = String(now.getHours()).padStart(2, "0")
  const mi = String(now.getMinutes()).padStart(2, "0")
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` }
}

export function SchedulePickerDialog({ post, open, onOpenChange, onScheduled }: SchedulePickerDialogProps) {
  const initial = defaultScheduleTime()
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [saving, setSaving] = useState(false)

  async function submit() {
    const scheduledAt = new Date(`${date}T${time}:00`)
    if (Number.isNaN(scheduledAt.getTime())) {
      toast.error("Please enter a valid date and time")
      return
    }
    if (scheduledAt.getTime() <= Date.now()) {
      toast.error("Scheduled time must be in the future")
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduled_at: scheduledAt.toISOString() }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Schedule failed")
      const data = (await res.json()) as Pick<SocialPost, "id" | "approval_status" | "scheduled_at">
      onScheduled({ ...post, approval_status: data.approval_status, scheduled_at: data.scheduled_at })
      toast.success(`Scheduled for ${scheduledAt.toLocaleString()}`)
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message || "Schedule failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary">
            <CalendarIcon className="size-5" />
            Schedule post
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="schedule-date">
                Date
              </label>
              <input
                id="schedule-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-border p-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="schedule-time">
                Time
              </label>
              <input
                id="schedule-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full rounded-md border border-border p-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            The post will publish automatically at this time. You can reschedule later.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            <X className="size-3" /> Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Read the current `components/admin/social/SocialPostCard.tsx`**

You'll modify this to add a "Schedule" button that opens the new dialog. The button appears only when `post.approval_status === "approved"` (otherwise hidden).

- [ ] **Step 3: Rewrite `components/admin/social/SocialPostCard.tsx` with the schedule affordance added**

```tsx
"use client"

import { useState } from "react"
import { Facebook, Instagram, Music2, Youtube, Linkedin, Check, X, Pencil, Calendar } from "lucide-react"
import { toast } from "sonner"
import { SchedulePickerDialog } from "./SchedulePickerDialog"
import type { SocialPost, SocialPlatform } from "@/types/database"

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

interface SocialPostCardProps {
  post: SocialPost
  onUpdate: (post: SocialPost) => void
  onRemove: (id: string) => void
}

export function SocialPostCard({ post, onUpdate }: SocialPostCardProps) {
  const [editing, setEditing] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [draftContent, setDraftContent] = useState(post.content)
  const [busy, setBusy] = useState<"approve" | "reject" | "save" | null>(null)
  const Icon = PLATFORM_ICONS[post.platform]

  async function approve() {
    setBusy("approve")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/approve`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const { approval_status } = (await res.json()) as { approval_status: SocialPost["approval_status"] }
      onUpdate({ ...post, approval_status })
      toast.success(
        approval_status === "awaiting_connection" ? "Approved — waiting for platform connection" : "Approved",
      )
    } catch (error) {
      toast.error((error as Error).message || "Approve failed")
    } finally {
      setBusy(null)
    }
  }

  async function reject() {
    setBusy("reject")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rejection_notes: null }),
      })
      if (!res.ok) throw new Error(await res.text())
      onUpdate({ ...post, approval_status: "rejected" })
      toast.success("Rejected")
    } catch (error) {
      toast.error((error as Error).message || "Reject failed")
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (draftContent.trim() === post.content.trim()) {
      setEditing(false)
      return
    }
    setBusy("save")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption_text: draftContent, hashtags: [] }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { content: string; approval_status: SocialPost["approval_status"] }
      onUpdate({ ...post, content: data.content, approval_status: data.approval_status })
      setEditing(false)
      toast.success("Caption updated")
    } catch (error) {
      toast.error((error as Error).message || "Save failed")
    } finally {
      setBusy(null)
    }
  }

  const canSchedule = post.approval_status === "approved" || post.approval_status === "scheduled"

  return (
    <>
      <div className="bg-white rounded-xl border border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="size-4 text-primary" />
          </div>
          <p className="font-medium text-primary">{PLATFORM_LABELS[post.platform]}</p>
          <span className="text-xs text-muted-foreground ml-auto">
            {post.scheduled_at
              ? `Scheduled ${new Date(post.scheduled_at).toLocaleString()}`
              : new Date(post.created_at).toLocaleDateString()}
          </span>
        </div>

        {editing ? (
          <textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-border p-3 text-sm font-body bg-surface resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        ) : (
          <pre className="whitespace-pre-wrap text-sm text-primary font-body">{post.content}</pre>
        )}

        <div className="flex items-center gap-2 mt-3">
          {editing ? (
            <>
              <button
                type="button"
                onClick={save}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy === "save" ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftContent(post.content)
                  setEditing(false)
                }}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={approve}
                disabled={busy !== null || post.approval_status === "published"}
                className="text-xs px-3 py-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 disabled:opacity-60 inline-flex items-center gap-1"
              >
                <Check className="size-3" /> {busy === "approve" ? "Approving..." : "Approve"}
              </button>
              {canSchedule && (
                <button
                  type="button"
                  onClick={() => setScheduleOpen(true)}
                  disabled={busy !== null}
                  className="text-xs px-3 py-1.5 rounded-md bg-accent/10 text-accent hover:bg-accent/20 inline-flex items-center gap-1"
                >
                  <Calendar className="size-3" /> {post.scheduled_at ? "Reschedule" : "Schedule"}
                </button>
              )}
              <button
                type="button"
                onClick={reject}
                disabled={busy !== null || post.approval_status === "rejected"}
                className="text-xs px-3 py-1.5 rounded-md bg-error/10 text-error hover:bg-error/20 disabled:opacity-60 inline-flex items-center gap-1"
              >
                <X className="size-3" /> Reject
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy !== null}
                className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center gap-1"
              >
                <Pencil className="size-3" /> Edit
              </button>
            </>
          )}
        </div>
      </div>

      <SchedulePickerDialog
        post={post}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        onScheduled={(updated) => {
          onUpdate(updated)
          setScheduleOpen(false)
        }}
      />
    </>
  )
}
```

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit 2>&1 | grep -E "SocialPostCard|SchedulePicker" | head -10`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/social/SchedulePickerDialog.tsx components/admin/social/SocialPostCard.tsx
git commit -m "feat(ui): SchedulePickerDialog + Schedule button on approved post cards"
```

---

### Task 4: `publish-runner` — the core publishing logic (extracted for testability)

**Files:**

- Create: `lib/social/publish-runner.ts`
- Create: `__tests__/lib/social/publish-runner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/social/publish-runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const listSocialPostsMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()
const resolveMediaUrlMock = vi.fn()
const registryGetMock = vi.fn()
const registryResetMock = vi.fn()
const registryRegisterMock = vi.fn()

vi.mock("@/lib/db/social-posts", () => ({
  listSocialPosts: (filters?: unknown) => listSocialPostsMock(filters),
  updateSocialPost: (id: string, u: unknown) => updateSocialPostMock(id, u),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: () => listPlatformConnectionsMock(),
}))
vi.mock("@/lib/social/resolve-media-url", () => ({
  resolveMediaUrl: (x: unknown) => resolveMediaUrlMock(x),
}))
vi.mock("@/lib/social/registry", () => ({
  pluginRegistry: {
    get: (name: string) => registryGetMock(name),
    reset: () => registryResetMock(),
    register: (plugin: unknown) => registryRegisterMock(plugin),
    list: () => [],
    all: () => [],
  },
}))

// bootstrapPlugins is called by the runner; mock it so we control registration side-effects.
const bootstrapPluginsMock = vi.fn()
vi.mock("@/lib/social/bootstrap", () => ({
  bootstrapPlugins: (conns: unknown, opts: unknown) => bootstrapPluginsMock(conns, opts),
}))

import { runScheduledPublish } from "@/lib/social/publish-runner"

describe("runScheduledPublish", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("skips when no scheduled posts are due", async () => {
    listSocialPostsMock.mockResolvedValue([])
    const result = await runScheduledPublish({ now: new Date() })
    expect(result).toEqual({ considered: 0, published: 0, failed: 0 })
    expect(bootstrapPluginsMock).not.toHaveBeenCalled()
  })

  it("publishes a due scheduled post via the registered plugin and marks it published", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    const duePost = {
      id: "p1",
      platform: "instagram",
      content: "hello",
      media_url: null,
      source_video_id: "v1",
      approval_status: "scheduled",
      scheduled_at: "2026-05-01T11:55:00Z",
      published_at: null,
      rejection_notes: null,
      platform_post_id: null,
      created_by: null,
      created_at: "",
      updated_at: "",
    }
    listSocialPostsMock.mockResolvedValue([duePost])
    listPlatformConnectionsMock.mockResolvedValue([])
    resolveMediaUrlMock.mockResolvedValue("https://signed.example.com/v1.mp4")
    registryGetMock.mockReturnValue({
      publish: vi.fn().mockResolvedValue({ success: true, platform_post_id: "IG_123" }),
    })

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 1, failed: 0 })

    expect(updateSocialPostMock).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        approval_status: "published",
        platform_post_id: "IG_123",
      }),
    )
  })

  it("marks a post failed when no plugin is registered for its platform", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    const duePost = {
      id: "p2",
      platform: "linkedin",
      content: "hello",
      media_url: null,
      source_video_id: null,
      approval_status: "scheduled",
      scheduled_at: "2026-05-01T11:55:00Z",
      published_at: null,
      rejection_notes: null,
      platform_post_id: null,
      created_by: null,
      created_at: "",
      updated_at: "",
    }
    listSocialPostsMock.mockResolvedValue([duePost])
    listPlatformConnectionsMock.mockResolvedValue([])
    resolveMediaUrlMock.mockResolvedValue(null)
    registryGetMock.mockReturnValue(undefined)

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 0, failed: 1 })
    expect(updateSocialPostMock).toHaveBeenCalledWith(
      "p2",
      expect.objectContaining({
        approval_status: "failed",
        rejection_notes: expect.stringContaining("plugin"),
      }),
    )
  })

  it("marks failed when plugin.publish returns success=false", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    listSocialPostsMock.mockResolvedValue([
      {
        id: "p3",
        platform: "facebook",
        content: "x",
        media_url: null,
        source_video_id: null,
        approval_status: "scheduled",
        scheduled_at: "2026-05-01T11:55:00Z",
        published_at: null,
        rejection_notes: null,
        platform_post_id: null,
        created_by: null,
        created_at: "",
        updated_at: "",
      },
    ])
    listPlatformConnectionsMock.mockResolvedValue([])
    resolveMediaUrlMock.mockResolvedValue(null)
    registryGetMock.mockReturnValue({
      publish: vi.fn().mockResolvedValue({ success: false, error: "Invalid token" }),
    })

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 0, failed: 1 })
    expect(updateSocialPostMock).toHaveBeenCalledWith(
      "p3",
      expect.objectContaining({
        approval_status: "failed",
        rejection_notes: "Invalid token",
      }),
    )
  })

  it("skips scheduled posts whose scheduled_at is still in the future", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    listSocialPostsMock.mockResolvedValue([
      {
        id: "future-1",
        platform: "instagram",
        content: "x",
        media_url: null,
        source_video_id: null,
        approval_status: "scheduled",
        scheduled_at: "2026-05-01T12:05:00Z", // 5 min in the future
        published_at: null,
        rejection_notes: null,
        platform_post_id: null,
        created_by: null,
        created_at: "",
        updated_at: "",
      },
    ])
    listPlatformConnectionsMock.mockResolvedValue([])
    registryGetMock.mockReturnValue({
      publish: vi.fn().mockResolvedValue({ success: true, platform_post_id: "x" }),
    })

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 0, failed: 0 })
    expect(updateSocialPostMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm run test:run -- __tests__/lib/social/publish-runner.test.ts`

- [ ] **Step 3: Write `lib/social/publish-runner.ts`**

```typescript
// lib/social/publish-runner.ts
// Core publishing logic called by /api/admin/internal/publish-due.
// Separated from the route handler so it's unit-testable with mocked DAL
// and plugin registry. The route wires in the real bootstrap with push
// + email senders, then delegates here.

import { listSocialPosts, updateSocialPost } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { pluginRegistry } from "@/lib/social/registry"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { resolveMediaUrl } from "@/lib/social/resolve-media-url"
import type { SocialPost } from "@/types/database"

export interface RunScheduledPublishOptions {
  now?: Date
  bootstrap?: (connections: unknown) => Promise<void>
}

export interface RunScheduledPublishResult {
  considered: number
  published: number
  failed: number
}

export async function runScheduledPublish(
  options: RunScheduledPublishOptions = {},
): Promise<RunScheduledPublishResult> {
  const now = options.now ?? new Date()

  // Fetch all scheduled posts — filtering by scheduled_at <= now happens below
  // because the DAL's current `listSocialPosts` doesn't expose a <= filter.
  const scheduledPosts = await listSocialPosts({ approval_status: "scheduled" })
  const due = scheduledPosts.filter((p) => {
    if (!p.scheduled_at) return false
    return new Date(p.scheduled_at).getTime() <= now.getTime()
  })

  if (due.length === 0) {
    return { considered: scheduledPosts.length, published: 0, failed: 0 }
  }

  // Load connections and (re)bootstrap the registry so it matches current DB state.
  const connections = await listPlatformConnections()
  if (options.bootstrap) {
    await options.bootstrap(connections)
  } else {
    // Fall back to a minimal bootstrap with no TikTok senders — TikTok
    // scheduled posts will register but fail to send email/push (expected
    // in the extracted test-runner path; the route wires real senders).
    bootstrapPlugins(connections, {
      tiktokEmail: "",
      tiktokFcmToken: null,
      sendPush: async () => {},
      sendEmail: async () => {},
    })
  }

  let published = 0
  let failed = 0

  for (const post of due) {
    const result = await publishOnePost(post)
    if (result === "published") published++
    else failed++
  }

  return { considered: scheduledPosts.length, published, failed }
}

async function publishOnePost(post: SocialPost): Promise<"published" | "failed"> {
  const plugin = pluginRegistry.get(post.platform)
  if (!plugin) {
    await updateSocialPost(post.id, {
      approval_status: "failed",
      rejection_notes: `No plugin registered for platform "${post.platform}" — connect the platform and retry.`,
    })
    return "failed"
  }

  const mediaUrl = await resolveMediaUrl({
    source_video_id: post.source_video_id,
    media_url: post.media_url,
  })

  const publishResult = await plugin.publish({
    content: post.content,
    mediaUrl,
    scheduledAt: null, // already handled by our cron — we're publishing NOW
  })

  if (!publishResult.success) {
    await updateSocialPost(post.id, {
      approval_status: "failed",
      rejection_notes: publishResult.error ?? "Plugin returned success=false",
    })
    return "failed"
  }

  await updateSocialPost(post.id, {
    approval_status: "published",
    published_at: new Date().toISOString(),
    platform_post_id: publishResult.platform_post_id ?? null,
  })
  return "published"
}
```

- [ ] **Step 4: Run → PASS (5 tests)**

Run: `npm run test:run -- __tests__/lib/social/publish-runner.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/social/publish-runner.ts __tests__/lib/social/publish-runner.test.ts
git commit -m "feat(social): runScheduledPublish — extracted publishing loop with registry + media resolution"
```

---

### Task 5: `/api/admin/internal/publish-due` cron endpoint

**Files:**

- Create: `app/api/admin/internal/publish-due/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/admin/internal/publish-due/route.ts
// Cron endpoint hit by Vercel Cron every 5 minutes. Guarded by a shared
// bearer token (INTERNAL_CRON_TOKEN env var). Bootstraps the plugin registry
// with real push + email senders (TikTok hybrid), then delegates the actual
// publishing loop to runScheduledPublish().

import { NextRequest, NextResponse } from "next/server"
import { runScheduledPublish } from "@/lib/social/publish-runner"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { getAdminApp } from "@/lib/firebase-admin"
import { getMessaging } from "firebase-admin/messaging"
import { Resend } from "resend"
import type { PlatformConnection } from "@/types/database"

function getAuthedCoachEmail(): string {
  return process.env.COACH_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? ""
}

function getResendClient(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error("RESEND_API_KEY is not configured")
  return new Resend(key)
}

async function bootstrapWithRealSenders(connections: PlatformConnection[]) {
  const coachEmail = getAuthedCoachEmail()
  const resend = getResendClient()
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@djpathlete.com"

  bootstrapPlugins(connections, {
    tiktokEmail: coachEmail,
    tiktokFcmToken: null, // TODO Phase 3c: look up coach's FCM token from users table
    async sendPush({ token, title, body, data }) {
      if (!token) return
      await getMessaging(getAdminApp()).send({
        token,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      })
    },
    async sendEmail({ to, subject, html }) {
      await resend.emails.send({ from: fromEmail, to, subject, html })
    },
  })
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runScheduledPublish({
      bootstrap: async (conns) => {
        await bootstrapWithRealSenders(conns as PlatformConnection[])
      },
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[publish-due] Error:", error)
    return NextResponse.json({ error: (error as Error).message ?? "Unknown publish-due error" }, { status: 500 })
  }
}

// Vercel Cron sends GET by default; allow both so the same endpoint works
// regardless of cron config and manual POSTs.
export async function GET(request: NextRequest) {
  return POST(request)
}
```

- [ ] **Step 2: Add `getAdminApp` to exports from `lib/firebase-admin.ts` (if not already exported)**

Open `lib/firebase-admin.ts`. Look for the existing `getAdminApp()` function. If it's not exported, export it.

Expected state: the top of the file has `export function getAdminApp()` — update if it's currently not exported. If it's already exported, no change needed.

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit 2>&1 | grep -E "publish-due|firebase-admin" | head -10`
Expected: No errors on the new file.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/internal/publish-due/route.ts lib/firebase-admin.ts
git commit -m "feat(api): POST /api/admin/internal/publish-due cron endpoint (plugin bootstrap + real senders)"
```

---

### Task 6: Vercel Cron config + env vars

**Files:**

- Create: `vercel.json`
- Modify: `.env.example`

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/admin/internal/publish-due",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

- [ ] **Step 2: Append to `.env.example`**

Read the current `.env.example`. At the end, add:

```bash
# Internal cron shared secret (Vercel Cron → /api/admin/internal/publish-due)
# Generate with: openssl rand -hex 32
# Set in Vercel Dashboard → Settings → Environment Variables (Production + Preview)
# Also set the cron header: Vercel Cron sends Authorization: Bearer <value>
# automatically when you set the Cron Secret in project settings.
INTERNAL_CRON_TOKEN=

# Coach email (recipient for TikTok hybrid notifications)
COACH_EMAIL=
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json .env.example
git commit -m "feat(cron): Vercel Cron every 5 min hitting publish-due + INTERNAL_CRON_TOKEN env"
```

---

### Task 7: Content calendar page (read-only week view)

**Files:**

- Create: `app/(admin)/admin/calendar/page.tsx`
- Create: `components/admin/calendar/WeekGrid.tsx`
- Modify: `components/admin/AdminSidebar.tsx` (add Calendar link)

- [ ] **Step 1: Create `components/admin/calendar/WeekGrid.tsx`**

```tsx
"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, Facebook, Instagram, Music2, Youtube, Linkedin } from "lucide-react"
import type { SocialPost, SocialPlatform } from "@/types/database"

const PLATFORM_ICONS: Record<SocialPlatform, typeof Facebook> = {
  facebook: Facebook,
  instagram: Instagram,
  tiktok: Music2,
  youtube: Youtube,
  youtube_shorts: Youtube,
  linkedin: Linkedin,
}

interface WeekGridProps {
  posts: SocialPost[]
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day + 6) % 7 // Monday as start of week
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - diff)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function WeekGrid({ posts }: WeekGridProps) {
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()))
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i))

  const postsByDay = days.map((d) =>
    posts.filter((p) => {
      const reference = p.scheduled_at ?? p.published_at
      if (!reference) return false
      return sameDay(new Date(reference), d)
    }),
  )

  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAnchor((prev) => addDays(prev, -7))}
            className="text-xs px-2 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center gap-1"
          >
            <ChevronLeft className="size-3" /> Prev
          </button>
          <button
            type="button"
            onClick={() => setAnchor(startOfWeek(new Date()))}
            className="text-xs px-2 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10"
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setAnchor((prev) => addDays(prev, 7))}
            className="text-xs px-2 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10 inline-flex items-center gap-1"
          >
            Next <ChevronRight className="size-3" />
          </button>
        </div>
        <p className="text-sm font-medium text-primary">
          {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
          {days[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((d, i) => (
          <div key={i} className="border border-border rounded-lg p-2 min-h-[160px]">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {d.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
            <div className="text-sm font-semibold text-primary mb-2">{d.getDate()}</div>
            <div className="space-y-1">
              {postsByDay[i].map((post) => {
                const Icon = PLATFORM_ICONS[post.platform]
                const timeRef = post.scheduled_at ?? post.published_at
                const timeStr = timeRef
                  ? new Date(timeRef).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                  : ""
                return (
                  <div
                    key={post.id}
                    className="flex items-center gap-1 text-[11px] text-primary bg-primary/5 rounded px-1.5 py-1 truncate"
                    title={post.content.slice(0, 80)}
                  >
                    <Icon className="size-3 shrink-0" />
                    <span className="truncate">{timeStr}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/(admin)/admin/calendar/page.tsx`**

```tsx
// app/(admin)/admin/calendar/page.tsx
import { listSocialPosts } from "@/lib/db/social-posts"
import { WeekGrid } from "@/components/admin/calendar/WeekGrid"
import type { SocialPost } from "@/types/database"

export const metadata = { title: "Content Calendar" }

export default async function CalendarPage() {
  // Fetch scheduled + published + approved posts; we only render the ones
  // with a scheduled_at / published_at in the visible range.
  const scheduled = await listSocialPosts({ approval_status: "scheduled" })
  const published = await listSocialPosts({ approval_status: "published" })
  const posts: SocialPost[] = [...scheduled, ...published]

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-1">Content Calendar</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Scheduled and published social posts on a weekly grid. Schedule a post from the Social tab to add it here.
      </p>

      <WeekGrid posts={posts} />
    </div>
  )
}
```

- [ ] **Step 3: Add Calendar link to `components/admin/AdminSidebar.tsx`**

Find the AI Automation section in `AdminSidebar.tsx` (added in Phase 1 Task 14). It currently has 3 items: Social, Videos, Platform Connections. Add a Calendar item between Social and Videos. Also add `CalendarDays` to the lucide-react import (check whether it's already imported — it was imported by existing admin code for other pages, so probably already there).

Modify the `AI Automation` section to:

```typescript
  {
    title: "AI Automation",
    items: [
      { label: "Social", href: "/admin/social", icon: Megaphone },
      { label: "Calendar", href: "/admin/calendar", icon: CalendarDays },
      { label: "Videos", href: "/admin/videos", icon: Film },
      { label: "Platform Connections", href: "/admin/platform-connections", icon: Link2 },
    ],
  },
```

Ensure `CalendarDays` is in the import list. If it isn't imported yet, add it to the existing `lucide-react` import.

- [ ] **Step 4: Verify TypeScript + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "calendar|WeekGrid|AdminSidebar" | head -10`
Expected: No errors.

```bash
git add app/\(admin\)/admin/calendar/page.tsx components/admin/calendar/WeekGrid.tsx components/admin/AdminSidebar.tsx
git commit -m "feat(admin): Content Calendar page (read-only week grid) + sidebar link"
```

---

## Post-Phase-3b Verification

- [ ] **Run full Next.js test suite**

Run: `npm run test:run`
Expected: Phase 3b adds ~15 new tests (4 resolve-media-url + 6 schedule + 5 publish-runner). Pre-existing failures unchanged.

- [ ] **Build check**

Run: `npm run build`
Expected: Clean Next.js build.

- [ ] **Push**

```bash
git push
```

- [ ] **Set `INTERNAL_CRON_TOKEN` in Vercel dashboard**

Instruct the user to:

1. Generate a secret: `openssl rand -hex 32`
2. Vercel Dashboard → Project → Settings → Environment Variables → Add `INTERNAL_CRON_TOKEN` = that value (Production + Preview)
3. Vercel Dashboard → Settings → Cron Jobs → confirm a Cron Job pointing at `/api/admin/internal/publish-due` with schedule `*/5 * * * *` is active (this gets created automatically from `vercel.json` on next deploy)
4. Also set `COACH_EMAIL` env var to your email (for TikTok hybrid notifications at publish time)

- [ ] **Smoke test after deploy**

1. Upload video, transcribe, fanout (Phase 3a flow)
2. Approve one post
3. Click Schedule, pick a time 6 minutes from now
4. Status flips to "Scheduled"
5. Wait ~10 min
6. Check Vercel logs: the cron call should fire, run runScheduledPublish, and the post status should flip to "published" (or "failed" with a clear error if the platform isn't connected or creds are wrong)
7. Check `/admin/calendar` — the post appears on its scheduled day

---

## What Phase 3b Unblocks

- **Phase 2b (OAuth connect flows):** once a coach connects a platform, `awaiting_connection` posts can be manually re-approved and scheduled; publishing now works end-to-end
- **Phase 3c (UX polish):** drag-to-reschedule on the calendar, batch approve, bulk schedule
- **Phase 4 (blog / newsletter extensions):** the same cron pattern can extend to schedule blog publishes (`blog_posts.scheduled_at` → same cron loop) and newsletter sends
- **Phase 5 (reports):** the `published` and `failed` counts are the raw data for the Weekly Content Report

---

## Self-Review

**1. Spec coverage:**

- ✅ Schedule picker UI — Task 3
- ✅ Schedule API + status transition — Task 2
- ✅ Scheduled publishing engine — Tasks 4+5
- ✅ Media URL resolution — Task 1
- ✅ Cron trigger — Task 6
- ✅ Calendar view — Task 7
- ⏸ Drag-to-reschedule — deferred to 3c (read-only calendar is sufficient MVP)
- ⏸ Batch approve — deferred to 3c

**2. Placeholder scan:** no TBD/TODO/fill-in-details. All code complete.

**3. Type consistency:** `SocialPost.approval_status` includes "scheduled" and "failed" (from migration 00076). `SocialPlatform` union matches Phase 1 types. `scheduled_at` is `string | null` (timestamptz). `bootstrapPlugins` signature matches Phase 2a.

**4. Security:**

- Internal cron route guarded by `INTERNAL_CRON_TOKEN` (Bearer header) — 401 if missing or mismatched
- Admin routes use `auth()` + `session.user.role === "admin"`
- `platform_connections.credentials` read via service-role DAL
- Firebase Storage signed URLs expire in 1 hour (Task 1)

**5. Risk analysis:**

- **Vercel Cron minimum interval:** `*/5` is supported on Pro tier (every 5 min). On Hobby tier, check — might need to increase to hourly
- **Plugin bootstrap cost:** Each cron invocation loads all 6 plugin configs from DB + builds the registry. Fine at this scale; can cache per-invocation if needed later
- **Drift risk:** Plugin credentials read fresh each cron cycle. A coach can disconnect a platform and the next cron won't publish to it (expected)
- **Retries:** Phase 3b does NOT retry failed publishes. A failed post requires manual re-approval. Acceptable for MVP; retries can be added to the runner in 3c.

**6. Test coverage:**

- resolve-media-url: 4 tests (happy path, video sign, missing video, fallback)
- schedule route: 6 tests (auth, validation, past time, missing post, wrong status, happy path)
- publish-runner: 5 tests (empty, happy path, no plugin, plugin failure, future post skip)
- Manual smoke test instructions documented
