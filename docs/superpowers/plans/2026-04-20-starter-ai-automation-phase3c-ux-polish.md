# Starter AI Automation — Phase 3c: Scheduling UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the scheduling workflow loop with three UX wins — (a) drag a scheduled post between days on the calendar to reschedule, (b) bulk-select posts and approve them with one click, (c) unschedule / retry failed / publish-now actions to recover from mistakes or errors.

**Architecture:** Three small new Next.js API routes (`unschedule`, `publish-now`) for status transitions Phase 3b's fixed-button UI didn't cover. Calendar page gains `@dnd-kit` drag-and-drop — each day is a droppable zone, each post chip is draggable; drop calls the existing `/schedule` route with a new datetime that keeps time-of-day intact. SocialPostsList gains a selection set with a floating action bar. No DB schema changes.

**Tech Stack:** `@dnd-kit/core` (already in package.json — used by ProgramBuilder elsewhere), existing social-posts DAL, existing admin design system (Green Azure + semantic tokens + Lexend), Vitest for API tests, `sonner` toasts for feedback.

**Existing infrastructure this plan builds on (no changes):**

- Phase 3a: `SocialPostCard`, `SocialPostsList` at `components/admin/social/`
- Phase 3a: `POST /api/admin/social/posts/:id/approve`, `/reject`, PATCH route
- Phase 3b: `POST /api/admin/social/posts/:id/schedule`, `SchedulePickerDialog`, `WeekGrid` calendar at `components/admin/calendar/WeekGrid.tsx`
- Phase 3b: `runScheduledPublish` + cron endpoint — picks up any post where `approval_status="scheduled" AND scheduled_at <= now()`, so `publish-now` reuses the same path
- DAL: `lib/db/social-posts.ts` (`getSocialPostById`, `updateSocialPost`)

---

## File Structure

### Next.js API routes (new)

- `app/api/admin/social/posts/[id]/unschedule/route.ts` — `POST` sets `approval_status="approved"`, clears `scheduled_at`
- `app/api/admin/social/posts/[id]/publish-now/route.ts` — `POST` sets `approval_status="scheduled"`, `scheduled_at=now()-1s`. Works from `approved` OR `failed` source state. Clears `rejection_notes` so the failed error banner goes away.

### UI components (new + modify)

- `components/admin/social/SocialPostCard.tsx` — modify to:
  - Show a **red error banner** above the caption when `approval_status="failed"` (renders `rejection_notes`)
  - Show **Unschedule** button when `approval_status="scheduled"`
  - Show **Publish now** button when `approval_status="approved"` or `"failed"`
  - (Retain existing Approve/Reject/Edit/Schedule buttons)
- `components/admin/social/SocialPostsList.tsx` — modify to:
  - Add per-card checkbox (for posts in "To review" and "Awaiting connection" sections only)
  - Add "Select all" in section header when at least one post exists in that section
  - Render floating action bar at the bottom when selection is non-empty, with Approve selected / Clear selection buttons
- `components/admin/calendar/WeekGrid.tsx` — modify to wrap in `DndContext` and register each day as a droppable, each post chip as a draggable. On drop, call `/schedule` with the new date (preserving time).

### Tests (new)

- `__tests__/api/admin/social/unschedule.test.ts`
- `__tests__/api/admin/social/publish-now.test.ts`

---

## Tasks

### Task 1: Unschedule + Publish Now API routes

**Files:**

- Create: `app/api/admin/social/posts/[id]/unschedule/route.ts`
- Create: `app/api/admin/social/posts/[id]/publish-now/route.ts`
- Create: `__tests__/api/admin/social/unschedule.test.ts`
- Create: `__tests__/api/admin/social/publish-now.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/api/admin/social/unschedule.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (id: string) => getSocialPostByIdMock(id),
  updateSocialPost: (id: string, u: unknown) => updateSocialPostMock(id, u),
}))

import { POST } from "@/app/api/admin/social/posts/[id]/unschedule/route"

async function call(id: string) {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/unschedule`, { method: "POST" })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/social/posts/:id/unschedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await call("p1")
    expect(res.status).toBe(401)
  })

  it("returns 404 when post missing", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await call("nope")
    expect(res.status).toBe(404)
  })

  it("returns 409 when post isn't scheduled", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "draft" })
    const res = await call("p1")
    expect(res.status).toBe(409)
  })

  it("flips scheduled → approved and clears scheduled_at", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "scheduled" })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "approved", scheduled_at: null })
    const res = await call("p1")
    expect(res.status).toBe(200)
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", {
      approval_status: "approved",
      scheduled_at: null,
    })
  })
})
```

```typescript
// __tests__/api/admin/social/publish-now.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (id: string) => getSocialPostByIdMock(id),
  updateSocialPost: (id: string, u: unknown) => updateSocialPostMock(id, u),
}))

import { POST } from "@/app/api/admin/social/posts/[id]/publish-now/route"

async function call(id: string) {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/publish-now`, { method: "POST" })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/social/posts/:id/publish-now", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await call("p1")
    expect(res.status).toBe(401)
  })

  it("returns 404 when post missing", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await call("nope")
    expect(res.status).toBe(404)
  })

  it("returns 409 when source status is not approved or failed", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "draft" })
    const res = await call("p1")
    expect(res.status).toBe(409)
  })

  it("from approved: sets scheduled with past scheduled_at and clears rejection_notes", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "approved" })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "scheduled" })
    const res = await call("p1")
    expect(res.status).toBe(200)
    const args = updateSocialPostMock.mock.calls[0]
    expect(args[0]).toBe("p1")
    expect(args[1].approval_status).toBe("scheduled")
    expect(args[1].rejection_notes).toBeNull()
    const scheduledAt = new Date(args[1].scheduled_at as string)
    expect(scheduledAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it("from failed: also transitions to scheduled, clearing rejection_notes", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: "p2",
      approval_status: "failed",
      rejection_notes: "Invalid token",
    })
    updateSocialPostMock.mockResolvedValue({ id: "p2", approval_status: "scheduled" })
    const res = await call("p2")
    expect(res.status).toBe(200)
    const args = updateSocialPostMock.mock.calls[0]
    expect(args[1].approval_status).toBe("scheduled")
    expect(args[1].rejection_notes).toBeNull()
  })
})
```

- [ ] **Step 2: Run → FAIL (both suites, module not found)**

Run: `npm run test:run -- __tests__/api/admin/social/unschedule.test.ts __tests__/api/admin/social/publish-now.test.ts`

- [ ] **Step 3: Write `app/api/admin/social/posts/[id]/unschedule/route.ts`**

```typescript
// app/api/admin/social/posts/[id]/unschedule/route.ts
// POST — takes a scheduled post back to "approved" and clears scheduled_at.
// Intended for "oops, I don't want this to go out at that time anymore" —
// the post stays approved so the coach can pick a new time later via the
// schedule picker, without losing the approval work.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }
  if (post.approval_status !== "scheduled") {
    return NextResponse.json(
      { error: `Only scheduled posts can be unscheduled (current status: ${post.approval_status})` },
      { status: 409 },
    )
  }

  const updated = await updateSocialPost(id, {
    approval_status: "approved",
    scheduled_at: null,
  })

  return NextResponse.json({
    id: updated.id,
    approval_status: updated.approval_status,
    scheduled_at: updated.scheduled_at,
  })
}
```

- [ ] **Step 4: Write `app/api/admin/social/posts/[id]/publish-now/route.ts`**

```typescript
// app/api/admin/social/posts/[id]/publish-now/route.ts
// POST — transitions approved OR failed posts into "scheduled" with
// scheduled_at set to a past timestamp, so the publish-due cron picks it
// up on the next cycle (≤5 min). Also clears rejection_notes so any stale
// failure reason disappears from the UI.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }

  const allowed = post.approval_status === "approved" || post.approval_status === "failed"
  if (!allowed) {
    return NextResponse.json(
      {
        error: `Publish Now only works for approved or failed posts (current status: ${post.approval_status})`,
      },
      { status: 409 },
    )
  }

  // Set to 1s in the past so the next cron cycle picks it up immediately.
  const scheduledAt = new Date(Date.now() - 1000).toISOString()

  const updated = await updateSocialPost(id, {
    approval_status: "scheduled",
    scheduled_at: scheduledAt,
    rejection_notes: null,
  })

  return NextResponse.json({
    id: updated.id,
    approval_status: updated.approval_status,
    scheduled_at: updated.scheduled_at,
  })
}
```

- [ ] **Step 5: Run → PASS (4 + 5 = 9 tests)**

Run: `npm run test:run -- __tests__/api/admin/social/unschedule.test.ts __tests__/api/admin/social/publish-now.test.ts`

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/social/posts/[id]/unschedule/route.ts app/api/admin/social/posts/[id]/publish-now/route.ts __tests__/api/admin/social/unschedule.test.ts __tests__/api/admin/social/publish-now.test.ts
git commit -m "feat(api): unschedule + publish-now routes for scheduling recovery"
```

---

### Task 2: SocialPostCard — failed banner + recovery buttons

**Files:**

- Modify: `components/admin/social/SocialPostCard.tsx`

- [ ] **Step 1: Replace the file entirely**

```tsx
"use client"

import { useState } from "react"
import {
  Facebook,
  Instagram,
  Music2,
  Youtube,
  Linkedin,
  Check,
  X,
  Pencil,
  Calendar,
  CalendarX,
  Zap,
  AlertCircle,
} from "lucide-react"
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
  selectable?: boolean
  selected?: boolean
  onToggleSelected?: (id: string, selected: boolean) => void
}

type BusyAction = "approve" | "reject" | "save" | "unschedule" | "publishNow" | null

export function SocialPostCard({
  post,
  onUpdate,
  selectable = false,
  selected = false,
  onToggleSelected,
}: SocialPostCardProps) {
  const [editing, setEditing] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [draftContent, setDraftContent] = useState(post.content)
  const [busy, setBusy] = useState<BusyAction>(null)
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

  async function unschedule() {
    setBusy("unschedule")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/unschedule`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { approval_status: SocialPost["approval_status"]; scheduled_at: string | null }
      onUpdate({ ...post, approval_status: data.approval_status, scheduled_at: data.scheduled_at })
      toast.success("Unscheduled")
    } catch (error) {
      toast.error((error as Error).message || "Unschedule failed")
    } finally {
      setBusy(null)
    }
  }

  async function publishNow() {
    setBusy("publishNow")
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/publish-now`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { approval_status: SocialPost["approval_status"]; scheduled_at: string | null }
      onUpdate({
        ...post,
        approval_status: data.approval_status,
        scheduled_at: data.scheduled_at,
        rejection_notes: null,
      })
      toast.success("Queued for next publish cycle (≤5 min)")
    } catch (error) {
      toast.error((error as Error).message || "Publish now failed")
    } finally {
      setBusy(null)
    }
  }

  const canSchedule = post.approval_status === "approved" || post.approval_status === "scheduled"
  const canUnschedule = post.approval_status === "scheduled"
  const canPublishNow = post.approval_status === "approved" || post.approval_status === "failed"
  const showFailedBanner = post.approval_status === "failed" && post.rejection_notes

  return (
    <>
      <div className="bg-white rounded-xl border border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          {selectable && onToggleSelected && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onToggleSelected(post.id, e.target.checked)}
              aria-label={`Select ${PLATFORM_LABELS[post.platform]} post`}
              className="size-4 rounded border-border text-primary focus:ring-primary/30"
            />
          )}
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

        {showFailedBanner && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-error/30 bg-error/5 p-3 flex items-start gap-2 text-xs text-error"
          >
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Publish failed</p>
              <p className="mt-0.5">{post.rejection_notes}</p>
            </div>
          </div>
        )}

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

        <div className="flex flex-wrap items-center gap-2 mt-3">
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
              {canUnschedule && (
                <button
                  type="button"
                  onClick={unschedule}
                  disabled={busy !== null}
                  className="text-xs px-3 py-1.5 rounded-md bg-warning/10 text-warning hover:bg-warning/20 inline-flex items-center gap-1"
                >
                  <CalendarX className="size-3" /> {busy === "unschedule" ? "Unscheduling..." : "Unschedule"}
                </button>
              )}
              {canPublishNow && (
                <button
                  type="button"
                  onClick={publishNow}
                  disabled={busy !== null}
                  className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-1"
                >
                  <Zap className="size-3" />{" "}
                  {busy === "publishNow"
                    ? "Queueing..."
                    : post.approval_status === "failed"
                      ? "Retry now"
                      : "Publish now"}
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

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit 2>&1 | grep SocialPostCard | head -5`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/social/SocialPostCard.tsx
git commit -m "feat(ui): SocialPostCard — failed banner, unschedule + publish-now buttons, selectable prop"
```

---

### Task 3: Bulk selection + batch approve in SocialPostsList

**Files:**

- Modify: `components/admin/social/SocialPostsList.tsx`

- [ ] **Step 1: Replace the file entirely**

```tsx
"use client"

import { useState, useMemo } from "react"
import { Megaphone, Check, XCircle } from "lucide-react"
import { toast } from "sonner"
import { SocialPostCard } from "./SocialPostCard"
import type { SocialPost } from "@/types/database"

interface SocialPostsListProps {
  initialPosts: SocialPost[]
}

// Only these two sections are selectable for batch approve.
const SELECTABLE_SECTION_KEYS = new Set(["to_review", "awaiting_connection"])

const SECTIONS: Array<{ key: SocialPost["approval_status"] | "to_review"; label: string }> = [
  { key: "to_review", label: "To review" },
  { key: "awaiting_connection", label: "Awaiting platform connection" },
  { key: "approved", label: "Approved" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
  { key: "failed", label: "Failed" },
  { key: "rejected", label: "Rejected" },
]

export function SocialPostsList({ initialPosts }: SocialPostsListProps) {
  const [posts, setPosts] = useState(initialPosts)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)

  const sectionedPosts = useMemo(() => {
    return SECTIONS.map((section) => ({
      ...section,
      posts: posts.filter((p) => {
        if (section.key === "to_review") return p.approval_status === "draft" || p.approval_status === "edited"
        return p.approval_status === section.key
      }),
    }))
  }, [posts])

  function onUpdate(updated: SocialPost) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  function onRemove(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id))
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function toggleSelected(id: string, selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function toggleSelectAll(sectionPosts: SocialPost[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = sectionPosts.every((p) => next.has(p.id))
      for (const p of sectionPosts) {
        if (allSelected) next.delete(p.id)
        else next.add(p.id)
      }
      return next
    })
  }

  async function batchApprove() {
    if (selectedIds.size === 0) return
    setBatchBusy(true)
    const ids = Array.from(selectedIds)
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/admin/social/posts/${id}/approve`, { method: "POST" }).then(async (res) => {
          if (!res.ok) throw new Error(await res.text())
          return (await res.json()) as { id: string; approval_status: SocialPost["approval_status"] }
        }),
      ),
    )

    const updates = new Map<string, SocialPost["approval_status"]>()
    let ok = 0
    let fail = 0
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        ok++
        updates.set(ids[i], r.value.approval_status)
      } else {
        fail++
      }
    })

    setPosts((prev) => prev.map((p) => (updates.has(p.id) ? { ...p, approval_status: updates.get(p.id)! } : p)))
    setSelectedIds(new Set())
    setBatchBusy(false)

    if (fail === 0) toast.success(`Approved ${ok} post${ok === 1 ? "" : "s"}`)
    else toast.error(`Approved ${ok}, failed ${fail}`)
  }

  if (posts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-2">
          <Megaphone className="size-5 text-primary" />
          <h2 className="font-semibold text-primary">No social posts yet</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a coaching video in the Videos tab, click Transcribe, then click Generate Social — captions will appear
          here.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6 pb-24">
        {sectionedPosts.map((section) => {
          if (section.posts.length === 0) return null

          const isSelectable = SELECTABLE_SECTION_KEYS.has(section.key)
          const sectionSelectedCount = section.posts.filter((p) => selectedIds.has(p.id)).length
          const allSelected = sectionSelectedCount === section.posts.length && section.posts.length > 0

          return (
            <section key={section.key}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {section.label} ({section.posts.length})
                </h2>
                {isSelectable && (
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(section.posts)}
                    className="text-xs text-primary hover:underline"
                  >
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {section.posts.map((post) => (
                  <SocialPostCard
                    key={post.id}
                    post={post}
                    onUpdate={onUpdate}
                    onRemove={onRemove}
                    selectable={isSelectable}
                    selected={selectedIds.has(post.id)}
                    onToggleSelected={toggleSelected}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {selectedIds.size > 0 && (
        <div
          role="toolbar"
          aria-label="Batch actions"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white rounded-full border border-border shadow-lg px-4 py-2 flex items-center gap-3"
        >
          <span className="text-sm text-primary font-medium">{selectedIds.size} selected</span>
          <button
            type="button"
            onClick={batchApprove}
            disabled={batchBusy}
            className="text-xs px-3 py-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 disabled:opacity-60 inline-flex items-center gap-1"
          >
            <Check className="size-3" /> {batchBusy ? "Approving..." : "Approve selected"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={batchBusy}
            className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            <XCircle className="size-3" /> Clear
          </button>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit 2>&1 | grep SocialPostsList | head -5`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/social/SocialPostsList.tsx
git commit -m "feat(ui): SocialPostsList — bulk select + batch approve with floating action bar"
```

---

### Task 4: Calendar drag-to-reschedule via @dnd-kit

**Files:**

- Modify: `components/admin/calendar/WeekGrid.tsx`

- [ ] **Step 1: Replace the file entirely**

```tsx
"use client"

import { useState } from "react"
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { ChevronLeft, ChevronRight, Facebook, Instagram, Music2, Youtube, Linkedin } from "lucide-react"
import { toast } from "sonner"
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
  const diff = (day + 6) % 7
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

function isoDateKey(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

interface DraggablePostChipProps {
  post: SocialPost
}

function DraggablePostChip({ post }: DraggablePostChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: post.id })
  const Icon = PLATFORM_ICONS[post.platform]
  const timeRef = post.scheduled_at ?? post.published_at
  const timeStr = timeRef ? new Date(timeRef).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : ""
  const isDraggableNow = post.approval_status === "scheduled"

  // Only scheduled posts are draggable — published ones are locked in place.
  const dragProps = isDraggableNow ? { ref: setNodeRef, ...listeners, ...attributes } : {}

  return (
    <div
      {...dragProps}
      title={post.content.slice(0, 80)}
      className={`flex items-center gap-1 text-[11px] rounded px-1.5 py-1 truncate ${
        isDraggableNow
          ? "text-primary bg-primary/5 cursor-grab active:cursor-grabbing"
          : "text-muted-foreground bg-muted/30"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{timeStr}</span>
    </div>
  )
}

interface DroppableDayProps {
  date: Date
  posts: SocialPost[]
}

function DroppableDay({ date, posts }: DroppableDayProps) {
  const { setNodeRef, isOver } = useDroppable({ id: isoDateKey(date) })
  return (
    <div
      ref={setNodeRef}
      className={`border border-border rounded-lg p-2 min-h-[160px] transition ${
        isOver ? "bg-primary/5 border-primary" : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {date.toLocaleDateString(undefined, { weekday: "short" })}
      </div>
      <div className="text-sm font-semibold text-primary mb-2">{date.getDate()}</div>
      <div className="space-y-1">
        {posts.map((post) => (
          <DraggablePostChip key={post.id} post={post} />
        ))}
      </div>
    </div>
  )
}

export function WeekGrid({ posts: initialPosts }: WeekGridProps) {
  const [posts, setPosts] = useState(initialPosts)
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i))

  const postsByDay = days.map((d) =>
    posts.filter((p) => {
      const reference = p.scheduled_at ?? p.published_at
      if (!reference) return false
      return sameDay(new Date(reference), d)
    }),
  )

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const targetDateKey = over.id as string
    const post = posts.find((p) => p.id === active.id)
    if (!post || !post.scheduled_at) return

    const current = new Date(post.scheduled_at)
    const targetParts = targetDateKey.split("-").map(Number)
    const [ty, tm, td] = targetParts
    const next = new Date(current)
    next.setFullYear(ty, (tm ?? 1) - 1, td ?? 1)
    // Keep time-of-day from the original schedule.

    if (sameDay(current, next)) return

    if (next.getTime() <= Date.now()) {
      toast.error("Can't reschedule to a date in the past")
      return
    }

    // Optimistically update local state first
    const prevScheduledAt = post.scheduled_at
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, scheduled_at: next.toISOString() } : p)))

    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduled_at: next.toISOString() }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Reschedule failed")
      toast.success(`Moved to ${next.toLocaleString()}`)
    } catch (error) {
      // Revert
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, scheduled_at: prevScheduledAt } : p)))
      toast.error((error as Error).message || "Reschedule failed")
    }
  }

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

      <p className="text-xs text-muted-foreground mb-3">
        Drag a scheduled post to a different day to reschedule. The time of day stays the same.
      </p>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-7 gap-2">
          {days.map((d, i) => (
            <DroppableDay key={i} date={d} posts={postsByDay[i]} />
          ))}
        </div>
      </DndContext>
    </div>
  )
}
```

- [ ] **Step 2: Verify `@dnd-kit/core` is actually installed**

Run: `npm ls @dnd-kit/core 2>&1 | head -5`
Expected: version listed (already in package.json per CLAUDE.md). If not installed, run `npm install` to sync.

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit 2>&1 | grep WeekGrid | head -5`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add components/admin/calendar/WeekGrid.tsx
git commit -m "feat(calendar): drag-to-reschedule scheduled posts between days"
```

---

## Post-Phase-3c Verification

- [ ] **Run full test suite**

Run: `npm run test:run`
Expected: Phase 3c adds 9 new tests (4 unschedule + 5 publish-now). Pre-existing failures unchanged.

- [ ] **Build check**

Run: `npm run build`
Expected: Clean Next.js build.

- [ ] **Push**

```bash
git push
```

- [ ] **Smoke test after deploy**

1. Go to `/admin/social` — select 3 posts in "To review" via checkboxes → floating bar shows "3 selected" → click "Approve selected" → all 3 flip to Approved or Awaiting
2. On an approved post, click "Schedule" → pick a time → status flips to Scheduled
3. On a scheduled post, click "Unschedule" → back to Approved
4. On an approved post, click "Publish now" → status flips to Scheduled (past timestamp) → within 5 min the cron picks it up and either publishes or marks failed
5. For any failed post, the red banner shows the error and a "Retry now" button appears
6. Go to `/admin/calendar` — drag a scheduled post chip from one day to another → toast confirms → the post now shows under the new date with the same time of day

---

## What Phase 3c Unblocks / Concludes

- **Publishing workflow is UX-complete.** The Starter AI build now has every state transition covered: draft → approved → scheduled → published (or failed → retry).
- **Phase 2b (OAuth):** nothing else in the scheduling UX blocks on OAuth. When OAuth lands, connected-platform posts will actually publish at their scheduled time; the cron + plugins just start succeeding instead of failing.
- **Phase 4 (blog/newsletter extensions):** can borrow the same batch-selection pattern for blog drafts if useful.
- **Phase 5 (reports):** the `failed` count with `rejection_notes` becomes a real signal for the Weekly Report.

---

## Self-Review

**1. Spec coverage:**

- ✅ Drag-to-reschedule — Task 4 (dnd-kit, keeps time-of-day, optimistic update with revert on failure)
- ✅ Bulk approve — Task 3 (selection set, floating toolbar, `Promise.allSettled` for resilience)
- ✅ Retry failed + unschedule + publish-now — Tasks 1 (APIs) + Task 2 (UI)
- ✅ Failed-post error display — Task 2 (red banner with `rejection_notes`)

**2. Placeholder scan:** no TBD/TODO. Every code block is complete.

**3. Type consistency:**

- `SocialPost` fields referenced match `types/database.ts`: `approval_status`, `scheduled_at`, `rejection_notes`, `published_at`.
- Status enum values used match the `00076` CHECK constraint: `draft`, `edited`, `approved`, `scheduled`, `published`, `rejected`, `awaiting_connection`, `failed`.
- `SocialPostCard` new props `selectable`, `selected`, `onToggleSelected` are all optional — existing callers (none besides `SocialPostsList`) compile without change.

**4. Security:**

- Every API route checks `session.user.role === "admin"` via existing `auth()` helper
- Publish-now uses a past timestamp so cron picks it up — no direct plugin invocation, so no new credential exposure surface
- Drag-to-reschedule calls the existing `/schedule` route, so it inherits all server-side validation (future time check, approved/scheduled source state check)

**5. Risk analysis:**

- **dnd-kit SSR:** `useDraggable`/`useDroppable` are client-only. `WeekGrid.tsx` already has `"use client"` so safe.
- **Batch approve race:** `Promise.allSettled` handles partial failures; UI shows ok/fail counts
- **Drag to past date:** guarded with the same "future only" check the manual schedule API uses (409 response handled by revert)
- **Calendar showing failed posts:** not yet — they don't have a `scheduled_at` that's future-dated (cron cleared it). Acceptable — failed posts surface in the Social tab with the error banner, which is the right place for remediation

**6. Test coverage:**

- Unschedule: 4 tests (auth, 404, wrong state, happy path)
- Publish-now: 5 tests (auth, 404, wrong state, from approved, from failed)
- UI: relies on tsc for correctness + manual smoke test checklist above
- Drag-to-reschedule: relies on tsc + manual smoke test; the underlying `/schedule` API is already covered in Phase 3b (6 tests)
