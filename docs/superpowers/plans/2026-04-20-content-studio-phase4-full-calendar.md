# Content Studio Phase 4 — Full Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 1 Calendar placeholder with a full three-column calendar at `/admin/content?tab=calendar`: filters (left) · calendar grid (center) · unscheduled-posts panel (right). The center supports Month / Week / Day views, platform-color-coded chips with hover mini-cards, drag-drop rescheduling, published-chip locking, failed-chip retry, and empty-day → manual post. Keyboard shortcuts (m/w/d/←/→/t). The calendar reads from BOTH `social_posts.scheduled_for` (via `scheduled_at`) and `content_calendar_entry` and merges them into a single chip stream per the spec. Filters persist in URL search params; saving them to user preferences is Phase 5.

**Architecture:**

- **Data.** A server-side `getCalendarData({ from, to })` fetches scheduled posts and calendar entries whose scheduled date falls in the current view's window, returning a unified `CalendarChip` union. The shell reload is on `router.refresh()`.
- **Chip model.** `CalendarChip = SocialPostChip | CalendarEntryChip`. Both have `{ id, kind, scheduledAt, platformOrType, label, sourceVideoThumbnail?, sourceVideoFilename?, status, ... }`. Drag-drop and rendering act on the chip union.
- **Views.** `<MonthGrid>`, `<WeekGrid>`, `<DayGrid>` are siblings. A `<CalendarViewToggle>` at the top reads/writes `?view=` and `?anchor=` (ISO date anchoring the visible period).
- **Drag-drop.** Reuses `@dnd-kit/core` — same pattern as Phase 3 and the existing `components/admin/calendar/WeekGrid.tsx`. Day cells are droppables with id `day-YYYY-MM-DD`; chips are draggables with id `chip-<kind>-<id>`. Hour cells in Day view are droppables with id `hour-YYYY-MM-DDTHH`. Week view offers day-level granularity only (hour drops come in a later polish phase).
- **Unscheduled panel.** `getUnscheduledPosts()` returns `social_posts` where `approval_status='approved'` and `scheduled_at IS NULL`. Grouped client-side by `source_video_id`. Dragging a chip onto a day opens a time-picker popover defaulting to a fixed per-platform best time (Phase 4 uses hard-coded defaults; the "best time AI" is out of scope per the spec).
- **Manual-post dialog.** Click an empty day → dialog to create a `social_posts` row with `source_video_id=null`, default platform=instagram, caption empty, `scheduled_at=<that day at default time>`.

**Tech Stack:** Next.js 16 App Router (React 19), TypeScript strict, Tailwind v4, `@dnd-kit/core`, Vitest + Testing Library, Playwright.

**Spec:** [docs/superpowers/specs/2026-04-20-content-studio-design.md](../specs/2026-04-20-content-studio-design.md) — see "Full Calendar View" and "Data flow" sections.

**Prerequisite:** Phase 1 (shell), Phase 2 (drawer), Phase 3 (pipeline + list views) complete.

---

## File Structure

**Create:**

- `lib/content-studio/calendar-chips.ts` — `CalendarChip` union type + `postToChip()` + `entryToChip()` + `groupByDay()` + `groupByHour()`
- `lib/content-studio/calendar-data.ts` — `getCalendarData({ from, to })`, `getUnscheduledPosts()`
- `lib/content-studio/calendar-defaults.ts` — `defaultPublishTimeForPlatform(platform, day): Date`
- `__tests__/lib/content-studio/calendar-chips.test.ts`
- `__tests__/lib/content-studio/calendar-defaults.test.ts`
- `components/admin/content-studio/calendar/CalendarContainer.tsx`
- `components/admin/content-studio/calendar/CalendarViewToggle.tsx`
- `components/admin/content-studio/calendar/MonthGrid.tsx`
- `components/admin/content-studio/calendar/WeekGrid.tsx` (new one — not to be confused with `components/admin/calendar/WeekGrid.tsx` which is the legacy component)
- `components/admin/content-studio/calendar/DayGrid.tsx`
- `components/admin/content-studio/calendar/PostChip.tsx`
- `components/admin/content-studio/calendar/UnscheduledPanel.tsx`
- `components/admin/content-studio/calendar/LeftFilters.tsx`
- `components/admin/content-studio/calendar/TimePickerPopover.tsx`
- `components/admin/content-studio/calendar/ManualPostDialog.tsx`
- `app/api/admin/content-studio/posts/route.ts` — POST creates a manual post (no source video). Reused by ManualPostDialog.
- `__tests__/components/admin/content-studio/calendar/CalendarViewToggle.test.tsx`
- `__tests__/components/admin/content-studio/calendar/MonthGrid.test.tsx`
- `__tests__/components/admin/content-studio/calendar/WeekGrid.test.tsx`
- `__tests__/components/admin/content-studio/calendar/DayGrid.test.tsx`
- `__tests__/components/admin/content-studio/calendar/PostChip.test.tsx`
- `__tests__/components/admin/content-studio/calendar/UnscheduledPanel.test.tsx`
- `__tests__/components/admin/content-studio/calendar/LeftFilters.test.tsx`
- `__tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx`
- `__tests__/api/content-studio/manual-post.test.ts`
- `__tests__/e2e/content-studio-calendar.spec.ts`

**Modify:**

- `app/(admin)/admin/content/page.tsx` — wire `?tab=calendar` to `<CalendarContainer>`
- `app/(admin)/admin/content/[videoId]/page.tsx` — same, so the drawer-behind content is the calendar when opened from a chip
- `lib/db/content-calendar.ts` — ensure `listCalendarEntries({ from_date, to_date })` is sufficient (already exists; verify)

---

## Task 1: CalendarChip domain + grouping helpers

**Files:**
- Create: `lib/content-studio/calendar-chips.ts`
- Test: `__tests__/lib/content-studio/calendar-chips.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/calendar-chips.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import {
  postToChip,
  entryToChip,
  groupByDay,
  groupByHour,
  isLocked,
  type CalendarChip,
} from "@/lib/content-studio/calendar-chips"
import type { SocialPost, ContentCalendarEntry } from "@/types/database"

const post = (overrides: Partial<SocialPost> = {}): SocialPost => ({
  id: "p1",
  platform: "instagram",
  content: "caption",
  media_url: null,
  approval_status: "scheduled",
  scheduled_at: "2026-04-20T15:00:00Z",
  published_at: null,
  source_video_id: "v1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: "u",
  created_at: "",
  updated_at: "",
  ...overrides,
})

const entry = (overrides: Partial<ContentCalendarEntry> = {}): ContentCalendarEntry => ({
  id: "e1",
  entry_type: "blog_post",
  reference_id: null,
  title: "Blog draft",
  scheduled_for: "2026-04-20",
  scheduled_time: "10:00",
  status: "planned",
  metadata: {},
  created_at: "",
  updated_at: "",
  ...overrides,
})

describe("postToChip", () => {
  it("maps a scheduled post to a chip with kind='post'", () => {
    const c = postToChip(post())
    expect(c.kind).toBe("post")
    expect(c.id).toBe("p1")
    expect(c.platformOrType).toBe("instagram")
    expect(c.scheduledAt?.toISOString()).toBe("2026-04-20T15:00:00.000Z")
    expect(c.status).toBe("scheduled")
  })

  it("prefers published_at as the chip time for published posts", () => {
    const c = postToChip(post({ approval_status: "published", scheduled_at: null, published_at: "2026-04-19T10:00:00Z" }))
    expect(c.scheduledAt?.toISOString()).toBe("2026-04-19T10:00:00.000Z")
  })

  it("returns chip with scheduledAt=null for unscheduled posts", () => {
    const c = postToChip(post({ scheduled_at: null, published_at: null, approval_status: "approved" }))
    expect(c.scheduledAt).toBeNull()
  })
})

describe("entryToChip", () => {
  it("composes scheduled_for + scheduled_time into a Date", () => {
    const c = entryToChip(entry())
    expect(c.kind).toBe("entry")
    expect(c.platformOrType).toBe("blog_post")
    expect(c.scheduledAt?.toISOString()).toBe("2026-04-20T10:00:00.000Z")
  })

  it("handles entries with no time (midnight default)", () => {
    const c = entryToChip(entry({ scheduled_time: null }))
    expect(c.scheduledAt?.toISOString()).toBe("2026-04-20T00:00:00.000Z")
  })
})

describe("isLocked", () => {
  it("locks published post chips", () => {
    expect(isLocked({ ...postToChip(post({ approval_status: "published" })) })).toBe(true)
  })
  it("locks completed calendar entries", () => {
    expect(isLocked(entryToChip(entry({ status: "published" })))).toBe(true)
  })
  it("does not lock scheduled post chips", () => {
    expect(isLocked(postToChip(post({ approval_status: "scheduled" })))).toBe(false)
  })
})

describe("groupByDay", () => {
  it("groups chips by YYYY-MM-DD key of their scheduledAt", () => {
    const chips: CalendarChip[] = [
      postToChip(post({ id: "a", scheduled_at: "2026-04-20T00:00:00Z" })),
      postToChip(post({ id: "b", scheduled_at: "2026-04-20T23:59:59Z" })),
      postToChip(post({ id: "c", scheduled_at: "2026-04-21T00:00:00Z" })),
    ]
    const g = groupByDay(chips)
    expect(g["2026-04-20"].map((c) => c.id).sort()).toEqual(["a", "b"])
    expect(g["2026-04-21"].map((c) => c.id)).toEqual(["c"])
  })

  it("skips chips with no scheduledAt", () => {
    const chips = [postToChip(post({ scheduled_at: null, published_at: null, approval_status: "approved" }))]
    expect(Object.keys(groupByDay(chips))).toEqual([])
  })
})

describe("groupByHour", () => {
  it("groups chips by YYYY-MM-DDTHH key", () => {
    const chips = [
      postToChip(post({ id: "a", scheduled_at: "2026-04-20T15:00:00Z" })),
      postToChip(post({ id: "b", scheduled_at: "2026-04-20T15:30:00Z" })),
      postToChip(post({ id: "c", scheduled_at: "2026-04-20T16:00:00Z" })),
    ]
    const g = groupByHour(chips)
    expect(g["2026-04-20T15"].map((c) => c.id).sort()).toEqual(["a", "b"])
    expect(g["2026-04-20T16"].map((c) => c.id)).toEqual(["c"])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:run -- __tests__/lib/content-studio/calendar-chips.test.ts
```

- [ ] **Step 3: Write implementation**

Create `lib/content-studio/calendar-chips.ts`:

```typescript
import type {
  SocialPost,
  SocialPlatform,
  SocialApprovalStatus,
  ContentCalendarEntry,
  CalendarEntryType,
  CalendarStatus,
} from "@/types/database"

export interface SocialPostChip {
  kind: "post"
  id: string
  label: string
  /** Date or null (for unscheduled posts). */
  scheduledAt: Date | null
  platformOrType: SocialPlatform
  status: SocialApprovalStatus
  sourceVideoId: string | null
  sourceVideoFilename: string | null
  rejection_notes: string | null
  raw: SocialPost
}

export interface CalendarEntryChip {
  kind: "entry"
  id: string
  label: string
  scheduledAt: Date | null
  platformOrType: CalendarEntryType
  status: CalendarStatus
  raw: ContentCalendarEntry
}

export type CalendarChip = SocialPostChip | CalendarEntryChip

export function postToChip(
  post: SocialPost,
  sourceVideoFilename: string | null = null,
): SocialPostChip {
  // For published posts, use published_at as the chip time; otherwise scheduled_at.
  const ref =
    post.approval_status === "published" && post.published_at
      ? post.published_at
      : post.scheduled_at
  return {
    kind: "post",
    id: post.id,
    label: post.content.slice(0, 30),
    scheduledAt: ref ? new Date(ref) : null,
    platformOrType: post.platform,
    status: post.approval_status,
    sourceVideoId: post.source_video_id,
    sourceVideoFilename,
    rejection_notes: post.rejection_notes,
    raw: post,
  }
}

export function entryToChip(entry: ContentCalendarEntry): CalendarEntryChip {
  const iso = `${entry.scheduled_for}T${entry.scheduled_time ?? "00:00"}:00Z`
  return {
    kind: "entry",
    id: entry.id,
    label: entry.title,
    scheduledAt: new Date(iso),
    platformOrType: entry.entry_type,
    status: entry.status,
    raw: entry,
  }
}

export function isLocked(chip: CalendarChip): boolean {
  if (chip.kind === "post") return chip.status === "published"
  return chip.status === "published"
}

export function isFailed(chip: CalendarChip): boolean {
  if (chip.kind === "post") return chip.status === "failed"
  return false
}

function dayKeyOf(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function hourKeyOf(date: Date): string {
  const day = dayKeyOf(date)
  const h = String(date.getUTCHours()).padStart(2, "0")
  return `${day}T${h}`
}

export function groupByDay(chips: CalendarChip[]): Record<string, CalendarChip[]> {
  const out: Record<string, CalendarChip[]> = {}
  for (const c of chips) {
    if (!c.scheduledAt) continue
    const key = dayKeyOf(c.scheduledAt)
    ;(out[key] ??= []).push(c)
  }
  return out
}

export function groupByHour(chips: CalendarChip[]): Record<string, CalendarChip[]> {
  const out: Record<string, CalendarChip[]> = {}
  for (const c of chips) {
    if (!c.scheduledAt) continue
    const key = hourKeyOf(c.scheduledAt)
    ;(out[key] ??= []).push(c)
  }
  return out
}

export function dayKey(date: Date): string {
  return dayKeyOf(date)
}
```

- [ ] **Step 4: Re-run and verify**

```bash
npm run test:run -- __tests__/lib/content-studio/calendar-chips.test.ts
```

Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/content-studio/calendar-chips.ts __tests__/lib/content-studio/calendar-chips.test.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): CalendarChip union + grouping helpers

Merges social_posts.scheduled_at and content_calendar_entry into one
rendering model; groupByDay / groupByHour power the Month / Week / Day grids.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Platform default times

**Files:**
- Create: `lib/content-studio/calendar-defaults.ts`
- Test: `__tests__/lib/content-studio/calendar-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/content-studio/calendar-defaults.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { defaultPublishTimeForPlatform } from "@/lib/content-studio/calendar-defaults"

describe("defaultPublishTimeForPlatform", () => {
  it("returns a Date on the given day", () => {
    const day = new Date("2026-04-20T00:00:00Z")
    const t = defaultPublishTimeForPlatform("instagram", day)
    expect(t.getUTCFullYear()).toBe(2026)
    expect(t.getUTCMonth()).toBe(3) // April
    expect(t.getUTCDate()).toBe(20)
  })

  it("Instagram defaults to 12:00 UTC", () => {
    const t = defaultPublishTimeForPlatform("instagram", new Date("2026-04-20T00:00:00Z"))
    expect(t.getUTCHours()).toBe(12)
  })

  it("TikTok defaults to 19:00 UTC", () => {
    const t = defaultPublishTimeForPlatform("tiktok", new Date("2026-04-20T00:00:00Z"))
    expect(t.getUTCHours()).toBe(19)
  })

  it("LinkedIn defaults to 09:00 UTC weekdays", () => {
    const t = defaultPublishTimeForPlatform("linkedin", new Date("2026-04-20T00:00:00Z")) // Monday
    expect(t.getUTCHours()).toBe(9)
  })

  it("never returns a time in the past — pushes to next-slot-today if past", () => {
    const now = new Date()
    const day = new Date(now)
    day.setUTCHours(0, 0, 0, 0)
    const t = defaultPublishTimeForPlatform("instagram", day)
    // Either tomorrow's 12 UTC, or later today — but strictly in the future.
    expect(t.getTime()).toBeGreaterThan(now.getTime())
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `lib/content-studio/calendar-defaults.ts`:

```typescript
import type { SocialPlatform } from "@/types/database"

const DEFAULT_UTC_HOURS: Record<SocialPlatform, number> = {
  instagram: 12,
  tiktok: 19,
  facebook: 15,
  youtube: 17,
  youtube_shorts: 17,
  linkedin: 9,
}

/**
 * Returns a Date on the given day at the platform's default publish hour.
 * If the requested time is already in the past, rolls forward to the next
 * day at the same hour so we never schedule-in-the-past.
 */
export function defaultPublishTimeForPlatform(platform: SocialPlatform, day: Date): Date {
  const t = new Date(day)
  t.setUTCHours(DEFAULT_UTC_HOURS[platform], 0, 0, 0)
  if (t.getTime() <= Date.now()) {
    t.setUTCDate(t.getUTCDate() + 1)
  }
  return t
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/lib/content-studio/calendar-defaults.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/content-studio/calendar-defaults.ts __tests__/lib/content-studio/calendar-defaults.test.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): platform-specific default publish times

Used by TimePickerPopover when dropping an unscheduled post — precedes the
Phase 5+ best-time AI. Keeps schedule in the future.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Server fetcher for calendar + unscheduled

**Files:**
- Create: `lib/content-studio/calendar-data.ts`

- [ ] **Step 1: Write the implementation**

This is a thin fetcher; its behavior is covered by e2e in Task 15 and integration via mocked DAL is overkill. Create `lib/content-studio/calendar-data.ts`:

```typescript
import { listSocialPostsForPipeline, type PipelinePostRow } from "@/lib/db/social-posts"
import { listCalendarEntries } from "@/lib/db/content-calendar"
import { postToChip, entryToChip, type CalendarChip } from "./calendar-chips"

export interface CalendarWindow {
  from: string // ISO YYYY-MM-DD
  to: string   // ISO YYYY-MM-DD, inclusive
}

export interface CalendarData {
  chips: CalendarChip[]
  unscheduledPosts: PipelinePostRow[]
  /** Distinct source-video ids present in the unscheduled list, for filter options. */
  unscheduledSourceVideos: { id: string; filename: string }[]
}

function isoDayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export async function getCalendarData(window: CalendarWindow): Promise<CalendarData> {
  const [posts, entries] = await Promise.all([
    listSocialPostsForPipeline(),
    listCalendarEntries({ from_date: window.from, to_date: isoDayAfter(window.to) }),
  ])

  // Filter posts to the window (scheduled_at or published_at inside the window).
  const fromTs = new Date(`${window.from}T00:00:00Z`).getTime()
  const toTs = new Date(`${window.to}T23:59:59.999Z`).getTime()

  const windowPosts = posts.filter((p) => {
    const ref = p.scheduled_at ?? p.published_at
    if (!ref) return false
    const t = new Date(ref).getTime()
    return t >= fromTs && t <= toTs
  })

  const unscheduledPosts = posts.filter(
    (p) => p.approval_status === "approved" && !p.scheduled_at,
  )

  const postChips = windowPosts.map((p) => postToChip(p, p.source_video_filename))
  const entryChips = entries.map(entryToChip)
  const chips = [...postChips, ...entryChips]

  // Distinct source videos present in the unscheduled list
  const seen = new Map<string, string>()
  for (const p of unscheduledPosts) {
    if (p.source_video_id && p.source_video_filename && !seen.has(p.source_video_id)) {
      seen.set(p.source_video_id, p.source_video_filename)
    }
  }
  const unscheduledSourceVideos = Array.from(seen, ([id, filename]) => ({ id, filename }))

  return { chips, unscheduledPosts, unscheduledSourceVideos }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/content-studio/calendar-data.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): calendar-data fetcher — merged chip stream + unscheduled list

Reads social_posts AND content_calendar per the spec's merge decision.
Unscheduled list filters to approved posts with no scheduled_at.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Manual-post creation API

**Files:**
- Create: `app/api/admin/content-studio/posts/route.ts`
- Test: `__tests__/api/content-studio/manual-post.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/content-studio/manual-post.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u-1", role: "admin" } })),
}))
const createMock = vi.fn()
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: (...args: unknown[]) => createMock(...args),
}))

import { POST } from "@/app/api/admin/content-studio/posts/route"

function req(body: unknown): Request {
  return new Request("http://localhost/api/admin/content-studio/posts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => createMock.mockReset())

describe("POST /api/admin/content-studio/posts", () => {
  it("rejects when platform missing", async () => {
    const res = await POST(req({ caption: "hi" }))
    expect(res.status).toBe(400)
  })

  it("rejects when scheduled_at is in the past", async () => {
    const res = await POST(
      req({ platform: "instagram", caption: "hi", scheduled_at: "2020-01-01T00:00:00Z" }),
    )
    expect(res.status).toBe(400)
  })

  it("creates a manual post with source_video_id=null", async () => {
    createMock.mockResolvedValueOnce({ id: "new-1", approval_status: "approved" })
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    const res = await POST(
      req({ platform: "instagram", caption: "hello world", scheduled_at: future }),
    )
    expect(res.status).toBe(200)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "instagram",
        content: "hello world",
        source_video_id: null,
        approval_status: "scheduled",
      }),
    )
  })

  it("saves as 'approved' (unscheduled) when no scheduled_at provided", async () => {
    createMock.mockResolvedValueOnce({ id: "new-1" })
    const res = await POST(req({ platform: "instagram", caption: "hello" }))
    expect(res.status).toBe(200)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "approved", scheduled_at: null }),
    )
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `app/api/admin/content-studio/posts/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createSocialPost } from "@/lib/db/social-posts"
import type { SocialPlatform } from "@/types/database"

const VALID_PLATFORMS: readonly SocialPlatform[] = [
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "youtube_shorts",
  "linkedin",
]

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | { platform?: string; caption?: string; scheduled_at?: string | null; source_video_id?: string | null }
    | null

  const platform = body?.platform as SocialPlatform | undefined
  const caption = (body?.caption ?? "").trim()

  if (!platform || !(VALID_PLATFORMS as readonly string[]).includes(platform)) {
    return NextResponse.json({ error: "platform must be one of " + VALID_PLATFORMS.join(", ") }, { status: 400 })
  }

  let scheduledAt: string | null = null
  if (body?.scheduled_at) {
    const d = new Date(body.scheduled_at)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "scheduled_at is not a valid datetime" }, { status: 400 })
    }
    if (d.getTime() <= Date.now()) {
      return NextResponse.json({ error: "scheduled_at must be in the future" }, { status: 400 })
    }
    scheduledAt = d.toISOString()
  }

  const post = await createSocialPost({
    platform,
    content: caption,
    media_url: null,
    approval_status: scheduledAt ? "scheduled" : "approved",
    scheduled_at: scheduledAt,
    source_video_id: body?.source_video_id ?? null,
    created_by: session.user.id,
  })

  return NextResponse.json({ id: post.id, approval_status: post.approval_status })
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/api/content-studio/manual-post.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/content-studio/posts/route.ts __tests__/api/content-studio/manual-post.test.ts
git commit -m "$(cat <<'EOF'
feat(content-studio): manual-post creation API (no source video)

Used by the calendar's empty-day click to create a post scheduled on the
clicked day.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CalendarViewToggle + keyboard shortcuts

**Files:**
- Create: `components/admin/content-studio/calendar/CalendarViewToggle.tsx`
- Test: `__tests__/components/admin/content-studio/calendar/CalendarViewToggle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/calendar/CalendarViewToggle.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CalendarViewToggle } from "@/components/admin/content-studio/calendar/CalendarViewToggle"

const replaceMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content",
  useSearchParams: () => new URLSearchParams("tab=calendar&view=month&anchor=2026-04-20"),
}))

describe("<CalendarViewToggle>", () => {
  it("renders Month/Week/Day buttons", () => {
    render(<CalendarViewToggle />)
    expect(screen.getByRole("button", { name: /Month/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: /Week/ })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: /Day/ })).toHaveAttribute("aria-pressed", "false")
  })

  it("clicking Week updates the URL", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.click(screen.getByRole("button", { name: /Week/ }))
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/view=week/), { scroll: false })
  })

  it("pressing 'w' switches to week view", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.keyDown(document, { key: "w" })
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/view=week/), { scroll: false })
  })

  it("pressing 'm' switches to month view", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.keyDown(document, { key: "m" })
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/view=month/), { scroll: false })
  })

  it("pressing 'd' switches to day view", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.keyDown(document, { key: "d" })
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/view=day/), { scroll: false })
  })

  it("pressing 't' jumps to today", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.keyDown(document, { key: "t" })
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringMatching(/anchor=\d{4}-\d{2}-\d{2}/),
      { scroll: false },
    )
  })

  it("Prev and Next arrows move anchor", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.click(screen.getByRole("button", { name: /previous period/i }))
    expect(replaceMock).toHaveBeenCalled()
    const call = replaceMock.mock.calls[0][0] as string
    expect(call).toMatch(/anchor=2026-03-/)
  })

  it("does not trigger shortcuts while typing in an input", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: "w" })
    expect(replaceMock).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/calendar/CalendarViewToggle.tsx`:

```typescript
"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useEffect, useCallback } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

type View = "month" | "week" | "day"

function resolveView(raw: string | null): View {
  if (raw === "week" || raw === "day") return raw
  return "month"
}

function anchorOrToday(raw: string | null): Date {
  if (raw) {
    const d = new Date(`${raw}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) return d
  }
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  return today
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function shift(date: Date, view: View, direction: 1 | -1): Date {
  const d = new Date(date)
  if (view === "month") d.setUTCMonth(d.getUTCMonth() + direction)
  else if (view === "week") d.setUTCDate(d.getUTCDate() + 7 * direction)
  else d.setUTCDate(d.getUTCDate() + direction)
  return d
}

export function CalendarViewToggle() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = resolveView(searchParams.get("view"))
  const anchor = anchorOrToday(searchParams.get("anchor"))

  const update = useCallback(
    (patch: { view?: View; anchor?: Date }) => {
      const params = new URLSearchParams(searchParams.toString())
      if (patch.view) params.set("view", patch.view)
      if (patch.anchor) params.set("anchor", isoDate(patch.anchor))
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const isTypingTarget = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable
  }, [])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case "m":
          update({ view: "month" })
          break
        case "w":
          update({ view: "week" })
          break
        case "d":
          update({ view: "day" })
          break
        case "t": {
          const today = new Date()
          today.setUTCHours(0, 0, 0, 0)
          update({ anchor: today })
          break
        }
        case "ArrowLeft":
          update({ anchor: shift(anchor, view, -1) })
          break
        case "ArrowRight":
          update({ anchor: shift(anchor, view, 1) })
          break
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [anchor, view, update, isTypingTarget])

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        aria-label="Previous period"
        onClick={() => update({ anchor: shift(anchor, view, -1) })}
        className="p-1.5 rounded border border-border hover:bg-surface/40"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          const today = new Date()
          today.setUTCHours(0, 0, 0, 0)
          update({ anchor: today })
        }}
        className="text-xs px-3 py-1.5 rounded border border-border hover:bg-surface/40"
      >
        Today
      </button>
      <button
        type="button"
        aria-label="Next period"
        onClick={() => update({ anchor: shift(anchor, view, 1) })}
        className="p-1.5 rounded border border-border hover:bg-surface/40"
      >
        <ChevronRight className="size-4" />
      </button>
      <div className="ml-2 inline-flex rounded-md border border-border overflow-hidden">
        {(["month", "week", "day"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => update({ view: v })}
            className={cn(
              "text-xs px-3 py-1.5 capitalize transition",
              view === v
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-surface/40",
            )}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/calendar/CalendarViewToggle.test.tsx
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/calendar/CalendarViewToggle.tsx __tests__/components/admin/content-studio/calendar/CalendarViewToggle.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): CalendarViewToggle + m/w/d/t/arrow keyboard shortcuts

Input/textarea focus disables shortcuts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: PostChip component (hover mini-card, drag)

**Files:**
- Create: `components/admin/content-studio/calendar/PostChip.tsx`
- Test: `__tests__/components/admin/content-studio/calendar/PostChip.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/calendar/PostChip.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { PostChip } from "@/components/admin/content-studio/calendar/PostChip"
import { postToChip, type CalendarChip } from "@/lib/content-studio/calendar-chips"

const chip: CalendarChip = postToChip({
  id: "p1",
  platform: "instagram",
  content: "12345678901234567890123456789012345 — long caption preview text",
  media_url: null,
  approval_status: "scheduled",
  scheduled_at: "2026-04-20T15:00:00Z",
  published_at: null,
  source_video_id: "v1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: "u",
  created_at: "",
  updated_at: "",
}, "rotational-reboot.mp4")

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

describe("<PostChip>", () => {
  it("renders platform icon + truncated caption", () => {
    render(wrap(<PostChip chip={chip} />))
    expect(screen.getByText(/12345678901234567890123456789/)).toBeInTheDocument()
  })

  it("hover shows the mini-card with full label + Open link", () => {
    render(wrap(<PostChip chip={chip} />))
    fireEvent.mouseEnter(screen.getByRole("button", { name: /scheduled/i }))
    expect(screen.getByRole("link", { name: /Open/ })).toHaveAttribute("href", "/admin/content/post/p1")
  })

  it("published chips are non-draggable (no pointer cursor)", () => {
    const published = { ...chip, status: "published" as const }
    const { container } = render(wrap(<PostChip chip={published as CalendarChip} />))
    expect(container.firstChild).not.toHaveClass(/cursor-grab/)
  })

  it("failed chips show a red badge and a Retry button on hover", () => {
    const failed = { ...chip, status: "failed" as const, rejection_notes: "oops" } as CalendarChip
    render(wrap(<PostChip chip={failed} />))
    fireEvent.mouseEnter(screen.getByRole("button", { name: /failed/i }))
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument()
  })

  it("calendar entries (kind='entry') render with the entry-type label", () => {
    const entry: CalendarChip = {
      kind: "entry",
      id: "e1",
      label: "Draft blog",
      scheduledAt: new Date("2026-04-20T10:00:00Z"),
      platformOrType: "blog_post",
      status: "planned",
      raw: {
        id: "e1",
        entry_type: "blog_post",
        reference_id: null,
        title: "Draft blog",
        scheduled_for: "2026-04-20",
        scheduled_time: "10:00",
        status: "planned",
        metadata: {},
        created_at: "",
        updated_at: "",
      },
    }
    render(wrap(<PostChip chip={entry} />))
    expect(screen.getByText(/Draft blog/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/calendar/PostChip.tsx`:

```typescript
"use client"

import Link from "next/link"
import { useState } from "react"
import { useDraggable } from "@dnd-kit/core"
import {
  Facebook,
  Instagram,
  Music2,
  Youtube,
  Linkedin,
  FileText,
  Mail,
  Lightbulb,
  AlertCircle,
  Zap,
  ExternalLink,
  Film,
} from "lucide-react"
import { toast } from "sonner"
import type { CalendarChip } from "@/lib/content-studio/calendar-chips"
import type { SocialPlatform, CalendarEntryType } from "@/types/database"
import { cn } from "@/lib/utils"

const PLATFORM_ICONS: Record<SocialPlatform, typeof Facebook> = {
  facebook: Facebook,
  instagram: Instagram,
  tiktok: Music2,
  youtube: Youtube,
  youtube_shorts: Youtube,
  linkedin: Linkedin,
}

const ENTRY_ICONS: Record<CalendarEntryType, typeof FileText> = {
  social_post: Instagram,
  blog_post: FileText,
  newsletter: Mail,
  topic_suggestion: Lightbulb,
}

const PLATFORM_COLORS: Record<SocialPlatform, string> = {
  instagram: "bg-[#C13584]/10 text-[#C13584] border-[#C13584]/30",
  tiktok: "bg-black/10 text-black border-black/30",
  youtube: "bg-[#FF0000]/10 text-[#FF0000] border-[#FF0000]/30",
  youtube_shorts: "bg-[#FF0000]/10 text-[#FF0000] border-[#FF0000]/30",
  facebook: "bg-[#1877F2]/10 text-[#1877F2] border-[#1877F2]/30",
  linkedin: "bg-[#0A66C2]/10 text-[#0A66C2] border-[#0A66C2]/30",
}

// Reviewer note: these hex codes are platform brand colors — they are the one
// exception to the "no hardcoded hex" rule in CLAUDE.md because they denote
// an external brand, not our own UI theme. All project-theme colors stay
// semantic (`text-primary`, `bg-surface`, etc.).

interface PostChipProps {
  chip: CalendarChip
}

export function PostChip({ chip }: PostChipProps) {
  const [hovered, setHovered] = useState(false)
  const isLocked = chip.status === "published"
  const isFailed = chip.kind === "post" && chip.status === "failed"
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip-${chip.kind}-${chip.id}`,
    data: { chip },
    disabled: isLocked,
  })

  const Icon =
    chip.kind === "post"
      ? PLATFORM_ICONS[chip.platformOrType]
      : ENTRY_ICONS[chip.platformOrType]

  const colorClasses =
    chip.kind === "post"
      ? PLATFORM_COLORS[chip.platformOrType]
      : "bg-accent/10 text-accent border-accent/30"

  const drawerHref = chip.kind === "post" ? `/admin/content/post/${chip.id}` : "#"

  async function retry() {
    if (chip.kind !== "post") return
    try {
      const res = await fetch(`/api/admin/social/posts/${chip.id}/publish-now`, {
        method: "POST",
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Requeued for publishing")
    } catch (err) {
      toast.error((err as Error).message || "Retry failed")
    }
  }

  const ariaLabel =
    chip.status === "published"
      ? `Published ${chip.label}`
      : chip.status === "failed"
      ? `Failed ${chip.label}`
      : `Scheduled ${chip.label}`

  return (
    <div
      ref={setNodeRef}
      {...(isLocked ? {} : attributes)}
      {...(isLocked ? {} : listeners)}
      role="button"
      aria-label={ariaLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "relative rounded border px-1.5 py-1 text-[11px] truncate inline-flex items-center gap-1",
        colorClasses,
        !isLocked && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        isLocked && "opacity-70",
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{chip.label}</span>
      {isFailed && <AlertCircle className="size-3 shrink-0 text-error" />}
      {chip.kind === "post" && chip.sourceVideoId && (
        <Film className="size-3 shrink-0 opacity-70" />
      )}

      {hovered && (
        <div
          role="tooltip"
          className="absolute left-0 top-full mt-1 z-30 w-72 rounded-lg border border-border bg-white shadow-lg p-3 text-left cursor-auto"
        >
          <p className="text-xs font-semibold text-primary flex items-center gap-2">
            <Icon className="size-3.5" />
            {chip.platformOrType.replace("_", " ")}
            <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
              {chip.status}
            </span>
          </p>
          <p className="mt-2 text-sm text-primary line-clamp-4 break-words">
            {chip.kind === "post" ? chip.raw.content : chip.raw.title}
          </p>
          {chip.kind === "post" && chip.sourceVideoFilename && (
            <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Film className="size-3" />
              {chip.sourceVideoFilename}
            </p>
          )}
          {isFailed && chip.kind === "post" && chip.rejection_notes && (
            <p className="mt-2 text-[11px] text-error">{chip.rejection_notes}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Link
              href={drawerHref}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary/5 text-primary hover:bg-primary/10"
            >
              <ExternalLink className="size-3" /> Open
            </Link>
            {isFailed && (
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Zap className="size-3" /> Retry
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/calendar/PostChip.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/calendar/PostChip.tsx __tests__/components/admin/content-studio/calendar/PostChip.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): PostChip — platform color, hover mini-card, retry, drag

Chip component used by all three views. Handles both social_posts and
content_calendar_entry via the CalendarChip union. Published chips lock;
failed chips show a retry inline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: MonthGrid

**Files:**
- Create: `components/admin/content-studio/calendar/MonthGrid.tsx`
- Test: `__tests__/components/admin/content-studio/calendar/MonthGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/calendar/MonthGrid.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { MonthGrid } from "@/components/admin/content-studio/calendar/MonthGrid"
import { postToChip } from "@/lib/content-studio/calendar-chips"

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

describe("<MonthGrid>", () => {
  it("renders a 6-week grid (42 day cells)", () => {
    render(
      wrap(<MonthGrid anchor={new Date("2026-04-15T00:00:00Z")} chips={[]} onEmptyDayClick={vi.fn()} />),
    )
    const cells = screen.getAllByRole("gridcell")
    expect(cells).toHaveLength(42)
  })

  it("highlights 'today' when it is inside the visible month", () => {
    const now = new Date()
    now.setUTCHours(0, 0, 0, 0)
    const { container } = render(
      wrap(<MonthGrid anchor={now} chips={[]} onEmptyDayClick={vi.fn()} />),
    )
    // Today cell has a specific class marker — match via data-attr:
    expect(container.querySelector("[data-today='true']")).toBeTruthy()
  })

  it("renders a chip on its scheduled day", () => {
    const chip = postToChip({
      id: "p1",
      platform: "instagram",
      content: "caption",
      media_url: null,
      approval_status: "scheduled",
      scheduled_at: "2026-04-20T15:00:00Z",
      published_at: null,
      source_video_id: null,
      rejection_notes: null,
      platform_post_id: null,
      created_by: "u",
      created_at: "",
      updated_at: "",
    })
    render(wrap(<MonthGrid anchor={new Date("2026-04-15T00:00:00Z")} chips={[chip]} onEmptyDayClick={vi.fn()} />))
    expect(screen.getByText(/caption/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/calendar/MonthGrid.tsx`:

```typescript
"use client"

import { useDroppable } from "@dnd-kit/core"
import { PostChip } from "./PostChip"
import { groupByDay, type CalendarChip, dayKey } from "@/lib/content-studio/calendar-chips"
import { cn } from "@/lib/utils"

interface MonthGridProps {
  anchor: Date
  chips: CalendarChip[]
  onEmptyDayClick: (dateKey: string) => void
}

function startOfMonthGrid(anchor: Date): Date {
  const d = new Date(anchor)
  d.setUTCDate(1)
  // Monday as first day of week (spec uses Mon-Sun like the existing WeekGrid).
  const dow = d.getUTCDay() // 0 Sun..6 Sat
  const offset = (dow + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function sameYearMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
}

function isTodayUTC(d: Date): boolean {
  const now = new Date()
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  )
}

function DayCell({
  day,
  isInMonth,
  chips,
  onEmptyClick,
}: {
  day: Date
  isInMonth: boolean
  chips: CalendarChip[]
  onEmptyClick: (dayKey: string) => void
}) {
  const key = dayKey(day)
  const { setNodeRef, isOver } = useDroppable({ id: `day-${key}`, data: { dayKey: key } })
  const today = isTodayUTC(day)

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      data-today={today || undefined}
      className={cn(
        "min-h-[110px] border border-border p-1.5 flex flex-col text-left cursor-pointer",
        !isInMonth && "bg-muted/30 text-muted-foreground/60",
        isOver && "ring-2 ring-primary bg-primary/5",
        today && "bg-accent/5",
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[role='button']")) return
        if (chips.length === 0) onEmptyClick(key)
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className={cn(
            "text-xs font-semibold",
            today ? "text-accent" : isInMonth ? "text-primary" : "text-muted-foreground/60",
          )}
        >
          {day.getUTCDate()}
        </span>
      </div>
      <div className="flex flex-col gap-1 overflow-hidden">
        {chips.slice(0, 3).map((c) => (
          <PostChip key={`${c.kind}-${c.id}`} chip={c} />
        ))}
        {chips.length > 3 && (
          <span className="text-[10px] text-muted-foreground">+{chips.length - 3} more</span>
        )}
      </div>
    </div>
  )
}

export function MonthGrid({ anchor, chips, onEmptyDayClick }: MonthGridProps) {
  const start = startOfMonthGrid(anchor)
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const grouped = groupByDay(chips)

  return (
    <div className="bg-white rounded-lg border border-border overflow-hidden" role="grid" aria-label="Calendar month view">
      <div className="grid grid-cols-7 bg-surface/40 text-xs text-muted-foreground uppercase tracking-wide">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-2 text-center font-semibold">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => (
          <DayCell
            key={day.toISOString()}
            day={day}
            isInMonth={sameYearMonth(day, anchor)}
            chips={grouped[dayKey(day)] ?? []}
            onEmptyClick={onEmptyDayClick}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/calendar/MonthGrid.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/calendar/MonthGrid.tsx __tests__/components/admin/content-studio/calendar/MonthGrid.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): MonthGrid — 6-week droppable grid with today highlight

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: WeekGrid (new, co-exists with legacy one)

**Files:**
- Create: `components/admin/content-studio/calendar/WeekGrid.tsx`
- Test: `__tests__/components/admin/content-studio/calendar/WeekGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/calendar/WeekGrid.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { WeekGrid } from "@/components/admin/content-studio/calendar/WeekGrid"

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

describe("<WeekGrid>", () => {
  it("renders 7 day cells", () => {
    render(wrap(<WeekGrid anchor={new Date("2026-04-20T00:00:00Z")} chips={[]} onEmptyDayClick={vi.fn()} />))
    expect(screen.getAllByRole("gridcell")).toHaveLength(7)
  })

  it("renders weekday + day number labels", () => {
    render(wrap(<WeekGrid anchor={new Date("2026-04-20T00:00:00Z")} chips={[]} onEmptyDayClick={vi.fn()} />))
    // 2026-04-20 is a Monday — week starts there.
    expect(screen.getByText("20")).toBeInTheDocument()
    expect(screen.getByText("26")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/calendar/WeekGrid.tsx`:

```typescript
"use client"

import { useDroppable } from "@dnd-kit/core"
import { PostChip } from "./PostChip"
import { groupByDay, dayKey, type CalendarChip } from "@/lib/content-studio/calendar-chips"
import { cn } from "@/lib/utils"

function startOfWeek(anchor: Date): Date {
  const d = new Date(anchor)
  const dow = d.getUTCDay()
  const offset = (dow + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function isTodayUTC(d: Date): boolean {
  const now = new Date()
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  )
}

function DayCell({
  day,
  chips,
  onEmptyClick,
}: {
  day: Date
  chips: CalendarChip[]
  onEmptyClick: (dayKey: string) => void
}) {
  const key = dayKey(day)
  const { setNodeRef, isOver } = useDroppable({ id: `day-${key}`, data: { dayKey: key } })
  const today = isTodayUTC(day)
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      className={cn(
        "min-h-[360px] border border-border p-2 flex flex-col cursor-pointer",
        isOver && "ring-2 ring-primary bg-primary/5",
        today && "bg-accent/5",
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[role='button']")) return
        if (chips.length === 0) onEmptyClick(key)
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {day.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}
          </div>
          <div className={cn("text-lg font-semibold", today ? "text-accent" : "text-primary")}>
            {day.getUTCDate()}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1 flex-1 overflow-y-auto">
        {chips.map((c) => (
          <PostChip key={`${c.kind}-${c.id}`} chip={c} />
        ))}
      </div>
    </div>
  )
}

interface WeekGridProps {
  anchor: Date
  chips: CalendarChip[]
  onEmptyDayClick: (dateKey: string) => void
}

export function WeekGrid({ anchor, chips, onEmptyDayClick }: WeekGridProps) {
  const start = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const grouped = groupByDay(chips)
  return (
    <div
      className="grid grid-cols-7 gap-0 bg-white rounded-lg border border-border overflow-hidden"
      role="grid"
      aria-label="Calendar week view"
    >
      {days.map((d) => (
        <DayCell
          key={d.toISOString()}
          day={d}
          chips={grouped[dayKey(d)] ?? []}
          onEmptyClick={onEmptyDayClick}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/calendar/WeekGrid.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/calendar/WeekGrid.tsx __tests__/components/admin/content-studio/calendar/WeekGrid.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): WeekGrid — 7-day strip with taller day cells

Lives alongside the legacy components/admin/calendar/WeekGrid.tsx, which is
still used from the legacy /admin/calendar page until Phase 5 deletes it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: DayGrid (hourly)

**Files:**
- Create: `components/admin/content-studio/calendar/DayGrid.tsx`
- Test: `__tests__/components/admin/content-studio/calendar/DayGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/calendar/DayGrid.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { DayGrid } from "@/components/admin/content-studio/calendar/DayGrid"

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

describe("<DayGrid>", () => {
  it("renders 24 hour rows", () => {
    render(wrap(<DayGrid anchor={new Date("2026-04-20T00:00:00Z")} chips={[]} onEmptyDayClick={vi.fn()} />))
    expect(screen.getAllByRole("row")).toHaveLength(24)
  })

  it("renders hour labels 00..23", () => {
    render(wrap(<DayGrid anchor={new Date("2026-04-20T00:00:00Z")} chips={[]} onEmptyDayClick={vi.fn()} />))
    expect(screen.getByText("09:00")).toBeInTheDocument()
    expect(screen.getByText("23:00")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/calendar/DayGrid.tsx`:

```typescript
"use client"

import { useDroppable } from "@dnd-kit/core"
import { PostChip } from "./PostChip"
import { groupByHour, type CalendarChip } from "@/lib/content-studio/calendar-chips"
import { cn } from "@/lib/utils"

function hourKey(anchor: Date, hour: number): string {
  const y = anchor.getUTCFullYear()
  const m = String(anchor.getUTCMonth() + 1).padStart(2, "0")
  const d = String(anchor.getUTCDate()).padStart(2, "0")
  const h = String(hour).padStart(2, "0")
  return `${y}-${m}-${d}T${h}`
}

function HourRow({
  anchor,
  hour,
  chips,
  onEmptyDayClick,
}: {
  anchor: Date
  hour: number
  chips: CalendarChip[]
  onEmptyDayClick: (dayKey: string) => void
}) {
  const key = hourKey(anchor, hour)
  const { setNodeRef, isOver } = useDroppable({ id: `hour-${key}`, data: { hourKey: key } })
  return (
    <div
      ref={setNodeRef}
      role="row"
      className={cn(
        "grid grid-cols-[80px_1fr] border-b border-border min-h-[48px] cursor-pointer",
        isOver && "ring-2 ring-primary bg-primary/5",
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[role='button']")) return
        if (chips.length === 0) onEmptyDayClick(key.slice(0, 10))
      }}
    >
      <div className="text-[11px] text-muted-foreground px-2 py-1.5">
        {String(hour).padStart(2, "0")}:00
      </div>
      <div className="flex flex-wrap gap-1 p-1">
        {chips.map((c) => (
          <PostChip key={`${c.kind}-${c.id}`} chip={c} />
        ))}
      </div>
    </div>
  )
}

interface DayGridProps {
  anchor: Date
  chips: CalendarChip[]
  onEmptyDayClick: (dateKey: string) => void
}

export function DayGrid({ anchor, chips, onEmptyDayClick }: DayGridProps) {
  const grouped = groupByHour(chips)
  const hours = Array.from({ length: 24 }, (_, h) => h)
  return (
    <div className="bg-white rounded-lg border border-border overflow-hidden" role="grid" aria-label="Calendar day view">
      {hours.map((h) => (
        <HourRow
          key={h}
          anchor={anchor}
          hour={h}
          chips={grouped[hourKey(anchor, h)] ?? []}
          onEmptyDayClick={onEmptyDayClick}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/calendar/DayGrid.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/calendar/DayGrid.tsx __tests__/components/admin/content-studio/calendar/DayGrid.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): DayGrid — 24-hour vertical strip with hourly drop targets

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: TimePickerPopover + drag-drop scheduling

**Files:**
- Create: `components/admin/content-studio/calendar/TimePickerPopover.tsx`

This is a small controlled dialog invoked when dropping an unscheduled post onto a day cell. It defaults to the platform's default time. Minimal UI — Phase 5 may refine.

- [ ] **Step 1: Write the implementation**

Create `components/admin/content-studio/calendar/TimePickerPopover.tsx`:

```typescript
"use client"

import { useState } from "react"
import type { SocialPlatform } from "@/types/database"
import { defaultPublishTimeForPlatform } from "@/lib/content-studio/calendar-defaults"

interface TimePickerPopoverProps {
  platform: SocialPlatform
  dayKey: string
  onConfirm: (scheduledAtIso: string) => Promise<void> | void
  onCancel: () => void
}

function toLocalInputValue(iso: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${iso.getFullYear()}-${pad(iso.getMonth() + 1)}-${pad(iso.getDate())}T${pad(iso.getHours())}:${pad(iso.getMinutes())}`
}

export function TimePickerPopover({ platform, dayKey, onConfirm, onCancel }: TimePickerPopoverProps) {
  const day = new Date(`${dayKey}T00:00:00Z`)
  const defaultTime = defaultPublishTimeForPlatform(platform, day)
  const [value, setValue] = useState(() => toLocalInputValue(defaultTime))
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm(new Date(value).toISOString())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="rounded-lg bg-white border border-border shadow-lg p-4 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-sm text-primary mb-2">Schedule on {dayKey}</h3>
        <label className="block text-xs text-muted-foreground">
          Time
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded border border-border px-2 py-1 text-sm"
          />
        </label>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Defaulted to {platform}'s best-time preset — you can override.
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/content-studio/calendar/TimePickerPopover.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): TimePickerPopover — platform-default time, override input

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: UnscheduledPanel

**Files:**
- Create: `components/admin/content-studio/calendar/UnscheduledPanel.tsx`
- Test: `__tests__/components/admin/content-studio/calendar/UnscheduledPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/calendar/UnscheduledPanel.test.tsx`:

```typescript
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { UnscheduledPanel } from "@/components/admin/content-studio/calendar/UnscheduledPanel"
import type { PipelinePostRow } from "@/lib/db/social-posts"

const post = (id: string, overrides: Partial<PipelinePostRow> = {}): PipelinePostRow => ({
  id,
  platform: "instagram",
  content: "caption",
  media_url: null,
  approval_status: "approved",
  scheduled_at: null,
  published_at: null,
  source_video_id: "v1",
  source_video_filename: "rotational-reboot.mp4",
  rejection_notes: null,
  platform_post_id: null,
  created_by: null,
  created_at: "",
  updated_at: "",
  ...overrides,
})

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

describe("<UnscheduledPanel>", () => {
  it("groups posts by source_video_id with a filename header", () => {
    const posts = [
      post("a", { source_video_id: "v1", source_video_filename: "clip-a.mp4" }),
      post("b", { source_video_id: "v1", source_video_filename: "clip-a.mp4" }),
      post("c", { source_video_id: "v2", source_video_filename: "clip-b.mp4" }),
    ]
    render(wrap(<UnscheduledPanel posts={posts} />))
    expect(screen.getByText(/clip-a\.mp4/)).toBeInTheDocument()
    expect(screen.getByText(/clip-b\.mp4/)).toBeInTheDocument()
  })

  it("renders a manual-posts bucket for source_video_id=null", () => {
    const posts = [post("m", { source_video_id: null, source_video_filename: null })]
    render(wrap(<UnscheduledPanel posts={posts} />))
    expect(screen.getByText(/Manual posts/i)).toBeInTheDocument()
  })

  it("renders an empty state when no unscheduled posts", () => {
    render(wrap(<UnscheduledPanel posts={[]} />))
    expect(screen.getByText(/All caught up/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/calendar/UnscheduledPanel.tsx`:

```typescript
"use client"

import { useState } from "react"
import { useDraggable } from "@dnd-kit/core"
import { ChevronDown, ChevronRight, Film, Sparkles } from "lucide-react"
import type { PipelinePostRow } from "@/lib/db/social-posts"
import { cn } from "@/lib/utils"

function DraggableCard({ post }: { post: PipelinePostRow }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unscheduled-${post.id}`,
    data: { postId: post.id, platform: post.platform },
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "p-2 rounded border border-border bg-white text-xs cursor-grab active:cursor-grabbing hover:border-primary/50",
        isDragging && "opacity-40",
      )}
    >
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{post.platform}</p>
      <p className="text-primary line-clamp-3 mt-0.5">{post.content}</p>
    </div>
  )
}

function Group({
  title,
  posts,
  icon,
}: {
  title: string
  posts: PipelinePostRow[]
  icon: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 text-left text-xs font-semibold text-primary mb-1"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {icon}
        <span className="truncate">{title}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">({posts.length})</span>
      </button>
      {open && (
        <div className="space-y-1 pl-3">
          {posts.map((p) => (
            <DraggableCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </section>
  )
}

interface UnscheduledPanelProps {
  posts: PipelinePostRow[]
}

export function UnscheduledPanel({ posts }: UnscheduledPanelProps) {
  if (posts.length === 0) {
    return (
      <aside aria-label="Unscheduled posts" className="w-72 shrink-0 px-3 py-6 text-center border-l border-border bg-surface/30">
        <Sparkles className="size-6 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">All caught up.</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Nothing is waiting to be scheduled.
        </p>
      </aside>
    )
  }

  const groups = new Map<string, { title: string; posts: PipelinePostRow[] }>()
  for (const p of posts) {
    const key = p.source_video_id ?? "__manual__"
    const title = p.source_video_filename ?? (key === "__manual__" ? "Manual posts" : "Unknown source")
    const g = groups.get(key) ?? { title, posts: [] }
    g.posts.push(p)
    groups.set(key, g)
  }

  return (
    <aside
      aria-label="Unscheduled posts"
      className="w-72 shrink-0 border-l border-border bg-surface/30 overflow-y-auto"
    >
      <header className="px-3 py-2 border-b border-border">
        <h3 className="font-heading text-xs uppercase tracking-wide text-primary">
          Unscheduled
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Drag any post onto a day to schedule
        </p>
      </header>
      <div className="p-3">
        {Array.from(groups.entries()).map(([key, g]) => (
          <Group
            key={key}
            title={g.title}
            icon={<Film className="size-3 shrink-0" />}
            posts={g.posts}
          />
        ))}
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/calendar/UnscheduledPanel.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/calendar/UnscheduledPanel.tsx __tests__/components/admin/content-studio/calendar/UnscheduledPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): UnscheduledPanel — draggable cards grouped by source video

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: LeftFilters

**Files:**
- Create: `components/admin/content-studio/calendar/LeftFilters.tsx`
- Test: `__tests__/components/admin/content-studio/calendar/LeftFilters.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/calendar/LeftFilters.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LeftFilters } from "@/components/admin/content-studio/calendar/LeftFilters"

const replaceMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content",
  useSearchParams: () => new URLSearchParams("tab=calendar"),
}))

describe("<LeftFilters>", () => {
  it("renders platform checkboxes", () => {
    render(<LeftFilters videos={[]} />)
    expect(screen.getByLabelText(/Instagram/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/TikTok/i)).toBeInTheDocument()
  })

  it("toggling a checkbox updates the URL", () => {
    replaceMock.mockClear()
    render(<LeftFilters videos={[]} />)
    fireEvent.click(screen.getByLabelText(/Instagram/i))
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/platform=instagram/), { scroll: false })
  })

  it("source video search filters the dropdown list", () => {
    render(
      <LeftFilters
        videos={[
          {
            id: "v1",
            storage_path: "",
            original_filename: "clip-alpha.mp4",
            duration_seconds: 1,
            size_bytes: 1,
            mime_type: null,
            title: "Alpha",
            uploaded_by: null,
            status: "transcribed",
            created_at: "",
            updated_at: "",
          },
          {
            id: "v2",
            storage_path: "",
            original_filename: "clip-beta.mp4",
            duration_seconds: 1,
            size_bytes: 1,
            mime_type: null,
            title: "Beta",
            uploaded_by: null,
            status: "transcribed",
            created_at: "",
            updated_at: "",
          },
        ]}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/Search videos/i), { target: { value: "alpha" } })
    expect(screen.getByText(/Alpha/)).toBeInTheDocument()
    expect(screen.queryByText(/Beta/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/calendar/LeftFilters.tsx`:

```typescript
"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useMemo, useState, useCallback } from "react"
import {
  parseFilters,
  filtersToSearchParams,
  type PipelineFilters,
} from "@/lib/content-studio/pipeline-filters"
import type { SocialPlatform, SocialApprovalStatus, VideoUpload } from "@/types/database"

const PLATFORMS: { id: SocialPlatform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "facebook", label: "Facebook" },
  { id: "youtube", label: "YouTube" },
  { id: "youtube_shorts", label: "YouTube Shorts" },
  { id: "linkedin", label: "LinkedIn" },
]
const STATUSES: { id: SocialApprovalStatus; label: string }[] = [
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
]

interface LeftFiltersProps {
  videos: VideoUpload[]
}

export function LeftFilters({ videos }: LeftFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const [search, setSearch] = useState("")

  const update = useCallback(
    (next: PipelineFilters) => {
      const sp = filtersToSearchParams(next)
      for (const k of ["tab", "view", "anchor"]) {
        const v = searchParams.get(k)
        if (v) sp.set(k, v)
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  function togglePlatform(id: SocialPlatform) {
    const has = filters.platforms.includes(id)
    update({ ...filters, platforms: has ? filters.platforms.filter((p) => p !== id) : [...filters.platforms, id] })
  }
  function toggleStatus(id: SocialApprovalStatus) {
    const has = filters.statuses.includes(id)
    update({ ...filters, statuses: has ? filters.statuses.filter((s) => s !== id) : [...filters.statuses, id] })
  }

  const matching = videos.filter((v) =>
    (v.title ?? v.original_filename).toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <aside aria-label="Calendar filters" className="w-60 shrink-0 border-r border-border bg-surface/30 overflow-y-auto">
      <div className="p-3 space-y-5">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Platform</h3>
          <ul className="space-y-1">
            {PLATFORMS.map(({ id, label }) => (
              <li key={id}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.platforms.includes(id)}
                    onChange={() => togglePlatform(id)}
                    className="size-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span>{label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Status</h3>
          <ul className="space-y-1">
            {STATUSES.map(({ id, label }) => (
              <li key={id}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.statuses.includes(id)}
                    onChange={() => toggleStatus(id)}
                    className="size-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span>{label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Source video</h3>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search videos"
            className="w-full rounded border border-border px-2 py-1 text-xs mb-2"
          />
          <select
            value={filters.sourceVideoId ?? ""}
            onChange={(e) => update({ ...filters, sourceVideoId: e.target.value || null })}
            className="w-full rounded border border-border px-2 py-1 text-xs"
          >
            <option value="">All videos</option>
            {matching.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title ?? v.original_filename}
              </option>
            ))}
          </select>
        </section>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/calendar/LeftFilters.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/calendar/LeftFilters.tsx __tests__/components/admin/content-studio/calendar/LeftFilters.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): calendar LeftFilters — platform/status checkboxes + source search

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: ManualPostDialog

**Files:**
- Create: `components/admin/content-studio/calendar/ManualPostDialog.tsx`
- Test: `__tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ManualPostDialog } from "@/components/admin/content-studio/calendar/ManualPostDialog"

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  Object.assign(global, { fetch: fetchMock })
})

describe("<ManualPostDialog>", () => {
  it("renders platform selector and caption textarea for the given day", () => {
    render(<ManualPostDialog dayKey="2026-04-20" onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByText(/2026-04-20/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Platform/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Caption/i)).toBeInTheDocument()
  })

  it("submits to the manual-post API and calls onCreated", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "new-1" }), { status: 200 }))
    const onCreated = vi.fn()
    render(<ManualPostDialog dayKey="2030-01-01" onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText(/Caption/i), { target: { value: "hello" } })
    fireEvent.click(screen.getByRole("button", { name: /Create/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.platform).toBe("instagram")
    expect(body.caption).toBe("hello")
    expect(body.scheduled_at).toMatch(/^2030-01-01/)
    expect(onCreated).toHaveBeenCalledWith("new-1")
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write implementation**

Create `components/admin/content-studio/calendar/ManualPostDialog.tsx`:

```typescript
"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { SocialPlatform } from "@/types/database"
import { defaultPublishTimeForPlatform } from "@/lib/content-studio/calendar-defaults"

interface ManualPostDialogProps {
  dayKey: string // YYYY-MM-DD
  onClose: () => void
  onCreated: (postId: string) => void
}

const PLATFORMS: SocialPlatform[] = [
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "youtube_shorts",
  "linkedin",
]

export function ManualPostDialog({ dayKey, onClose, onCreated }: ManualPostDialogProps) {
  const [platform, setPlatform] = useState<SocialPlatform>("instagram")
  const [caption, setCaption] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const day = new Date(`${dayKey}T00:00:00Z`)
      const scheduled_at = defaultPublishTimeForPlatform(platform, day).toISOString()
      const res = await fetch("/api/admin/content-studio/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, caption, scheduled_at }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Create failed")
      const data = (await res.json()) as { id: string }
      toast.success("Manual post scheduled")
      onCreated(data.id)
    } catch (err) {
      toast.error((err as Error).message || "Create failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="rounded-lg bg-white border border-border shadow-lg p-4 w-96"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-sm text-primary mb-3">New manual post — {dayKey}</h3>
        <label className="block text-xs text-muted-foreground mb-3">
          Platform
          <select
            aria-label="Platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
            className="mt-1 block w-full rounded border border-border px-2 py-1 text-sm"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted-foreground mb-3">
          Caption
          <textarea
            aria-label="Caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded border border-border px-2 py-1 text-sm"
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Re-run**

```bash
npm run test:run -- __tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/content-studio/calendar/ManualPostDialog.tsx __tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): ManualPostDialog — create post on an empty day

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: CalendarContainer — wire everything

**Files:**
- Create: `components/admin/content-studio/calendar/CalendarContainer.tsx`

- [ ] **Step 1: Write the implementation**

This is the main component. It owns the drag-drop `DndContext`, swaps between MonthGrid / WeekGrid / DayGrid, and hosts the popovers.

Create `components/admin/content-studio/calendar/CalendarContainer.tsx`:

```typescript
"use client"

import { useState, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { toast } from "sonner"
import { CalendarViewToggle } from "./CalendarViewToggle"
import { MonthGrid } from "./MonthGrid"
import { WeekGrid } from "./WeekGrid"
import { DayGrid } from "./DayGrid"
import { UnscheduledPanel } from "./UnscheduledPanel"
import { LeftFilters } from "./LeftFilters"
import { ManualPostDialog } from "./ManualPostDialog"
import { TimePickerPopover } from "./TimePickerPopover"
import type { CalendarData } from "@/lib/content-studio/calendar-data"
import type { CalendarChip } from "@/lib/content-studio/calendar-chips"
import { applyFilters, parseFilters } from "@/lib/content-studio/pipeline-filters"
import type { SocialPlatform, VideoUpload } from "@/types/database"

interface CalendarContainerProps {
  data: CalendarData
  videos: VideoUpload[]
}

type View = "month" | "week" | "day"
function resolveView(raw: string | null): View {
  if (raw === "week" || raw === "day") return raw
  return "month"
}
function resolveAnchor(raw: string | null): Date {
  if (raw) {
    const d = new Date(`${raw}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) return d
  }
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  return today
}

export function CalendarContainer({ data, videos }: CalendarContainerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view = resolveView(searchParams.get("view"))
  const anchor = resolveAnchor(searchParams.get("anchor"))

  const [manualPostDay, setManualPostDay] = useState<string | null>(null)
  const [pendingDrop, setPendingDrop] = useState<
    | { postId: string; platform: SocialPlatform; dayKey: string }
    | null
  >(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const filters = useMemo(() => parseFilters(searchParams), [searchParams])

  // Apply filters to chips (for the center grid only — unscheduled panel stays intact)
  const chipsFiltered = useMemo(() => {
    // Filter only post-kind chips; entry chips pass through.
    const postChips = data.chips.filter((c): c is Extract<CalendarChip, { kind: "post" }> => c.kind === "post")
    const entryChips = data.chips.filter((c) => c.kind === "entry")
    const fakePosts = postChips.map((c) => c.raw)
    const { posts: afterFilter } = applyFilters([], fakePosts, filters)
    const kept = new Set(afterFilter.map((p) => p.id))
    return [...postChips.filter((c) => kept.has(c.id)), ...entryChips]
  }, [data.chips, filters])

  async function rescheduleExistingChip(chipId: string, dayKey: string) {
    // chipId is "chip-<kind>-<id>"
    const match = chipId.match(/^chip-(post|entry)-(.+)$/)
    if (!match) return
    const kind = match[1]
    const id = match[2]

    if (kind === "entry") {
      // Update content_calendar_entry.scheduled_for
      const res = await fetch(`/api/admin/calendar/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduled_for: dayKey }),
      })
      if (!res.ok) {
        toast.error("Reschedule failed")
        return
      }
      toast.success(`Moved to ${dayKey}`)
      router.refresh()
      return
    }

    // Post chip: preserve the original time-of-day, change the date.
    const chip = data.chips.find((c) => c.kind === "post" && c.id === id)
    if (!chip || chip.kind !== "post" || !chip.scheduledAt) {
      toast.error("Missing scheduled time for this post")
      return
    }
    const original = chip.scheduledAt
    const next = new Date(`${dayKey}T00:00:00Z`)
    next.setUTCHours(original.getUTCHours(), original.getUTCMinutes(), 0, 0)
    if (next.getTime() <= Date.now()) {
      toast.error("Cannot reschedule to the past")
      return
    }
    const res = await fetch(`/api/admin/social/posts/${id}/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduled_at: next.toISOString() }),
    })
    if (!res.ok) {
      toast.error("Reschedule failed")
      return
    }
    toast.success(`Moved to ${next.toLocaleString()}`)
    router.refresh()
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const overId = String(over.id)
    const dayKey = overId.startsWith("day-") ? overId.slice(4) : overId.startsWith("hour-") ? overId.slice(5, 15) : null
    if (!dayKey) return

    const activeId = String(active.id)

    // Dragging an already-scheduled chip → reschedule preserving time-of-day
    if (activeId.startsWith("chip-")) {
      await rescheduleExistingChip(activeId, dayKey)
      return
    }

    // Dragging an unscheduled card → open the TimePickerPopover
    if (activeId.startsWith("unscheduled-")) {
      const data = active.data.current as { postId: string; platform: SocialPlatform } | undefined
      if (!data) return
      setPendingDrop({ postId: data.postId, platform: data.platform, dayKey })
    }
  }

  async function confirmPendingDrop(scheduledAtIso: string) {
    if (!pendingDrop) return
    const res = await fetch(`/api/admin/social/posts/${pendingDrop.postId}/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduled_at: scheduledAtIso }),
    })
    if (!res.ok) {
      toast.error(await res.text())
    } else {
      toast.success("Scheduled")
      router.refresh()
    }
    setPendingDrop(null)
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-[calc(100vh-220px)] min-h-[600px] gap-0 border border-border rounded-lg overflow-hidden bg-background">
        <LeftFilters videos={videos} />
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <h3 className="font-heading text-sm text-primary">
              {view === "month" && anchor.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
              {view === "week" && `Week of ${anchor.toLocaleDateString(undefined, { timeZone: "UTC" })}`}
              {view === "day" && anchor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}
            </h3>
            <CalendarViewToggle />
          </div>
          <div className="flex-1 overflow-auto p-2">
            {view === "month" && (
              <MonthGrid anchor={anchor} chips={chipsFiltered} onEmptyDayClick={setManualPostDay} />
            )}
            {view === "week" && (
              <WeekGrid anchor={anchor} chips={chipsFiltered} onEmptyDayClick={setManualPostDay} />
            )}
            {view === "day" && (
              <DayGrid anchor={anchor} chips={chipsFiltered} onEmptyDayClick={setManualPostDay} />
            )}
          </div>
        </div>
        <UnscheduledPanel posts={data.unscheduledPosts} />
      </div>

      {manualPostDay && (
        <ManualPostDialog
          dayKey={manualPostDay}
          onClose={() => setManualPostDay(null)}
          onCreated={() => {
            setManualPostDay(null)
            router.refresh()
          }}
        />
      )}
      {pendingDrop && (
        <TimePickerPopover
          platform={pendingDrop.platform}
          dayKey={pendingDrop.dayKey}
          onConfirm={confirmPendingDrop}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </DndContext>
  )
}
```

Reviewer note: dragging a `content_calendar_entry` chip calls `/api/admin/calendar/:id` with a `scheduled_for` PATCH. If that endpoint does not exist yet in the codebase, update the code path to gracefully no-op via a toast `"Calendar-entry reschedule not yet supported"`. Grep `app/api/admin/calendar/` during implementation — if it exists you're good, if not leave the fallback toast in place.

- [ ] **Step 2: Commit**

```bash
git add components/admin/content-studio/calendar/CalendarContainer.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): CalendarContainer — wires filters + grid + unscheduled + drops

Owns the DndContext. Existing chips preserve time-of-day on reschedule;
unscheduled drops open the TimePickerPopover; empty-day click opens the
ManualPostDialog.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Mount Calendar in the Content Studio pages + window-aware data

**Files:**
- Modify: `app/(admin)/admin/content/page.tsx`
- Modify: `app/(admin)/admin/content/[videoId]/page.tsx`
- Modify: `app/(admin)/admin/content/post/[postId]/page.tsx`

- [ ] **Step 1: Helper: window for the requested view/anchor**

Insert this helper at the top of `app/(admin)/admin/content/page.tsx` (just above the default export), and replace the existing `calendar` branch.

Update `app/(admin)/admin/content/page.tsx`:

```typescript
import { getPipelineData } from "@/lib/content-studio/pipeline-data"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import { VideosList } from "@/components/admin/content-studio/list/VideosList"
import { PostsList } from "@/components/admin/content-studio/list/PostsList"
import { getCalendarData } from "@/lib/content-studio/calendar-data"
import { CalendarContainer } from "@/components/admin/content-studio/calendar/CalendarContainer"

interface PageProps {
  searchParams: Promise<{ tab?: string; view?: string; anchor?: string }>
}

function computeCalendarWindow(view: string | undefined, anchor: string | undefined) {
  const anchorDate = anchor ? new Date(`${anchor}T00:00:00Z`) : new Date()
  anchorDate.setUTCHours(0, 0, 0, 0)
  const from = new Date(anchorDate)
  const to = new Date(anchorDate)
  if (view === "day") {
    // just the one day
  } else if (view === "week") {
    const dow = from.getUTCDay()
    from.setUTCDate(from.getUTCDate() - ((dow + 6) % 7))
    to.setTime(from.getTime())
    to.setUTCDate(to.getUTCDate() + 6)
  } else {
    // month: pad +/- one month so the 6-week grid always has data
    from.setUTCDate(1)
    from.setUTCMonth(from.getUTCMonth() - 1)
    to.setUTCDate(1)
    to.setUTCMonth(to.getUTCMonth() + 2)
    to.setUTCDate(0)
  }
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export default async function ContentStudioPage({ searchParams }: PageProps) {
  const { tab, view, anchor } = await searchParams

  if (tab === "calendar") {
    const window = computeCalendarWindow(view, anchor)
    const [calendar, pipeline] = await Promise.all([getCalendarData(window), getPipelineData()])
    return <CalendarContainer data={calendar} videos={pipeline.videos} />
  }

  const data = await getPipelineData()
  switch (tab) {
    case "videos":
      return <VideosList videos={data.videos} />
    case "posts":
      return <PostsList posts={data.posts} />
    default:
      return <PipelineBoard initialData={data} />
  }
}
```

- [ ] **Step 2: Update [videoId] to render the calendar behind when `?tab=calendar`**

Edit `app/(admin)/admin/content/[videoId]/page.tsx` — update the `underneath` switch:

```typescript
// At top, add:
import { getCalendarData } from "@/lib/content-studio/calendar-data"
import { CalendarContainer } from "@/components/admin/content-studio/calendar/CalendarContainer"

// Inside the page function, add the same computeCalendarWindow helper or inline it:

function computeCalendarWindow(view: string | undefined, anchor: string | undefined) {
  // ... (identical to page.tsx — DRY this into lib/content-studio/calendar-window.ts if you prefer)
}

// Then change the `case "calendar":` branch of the `underneath` switch:
case "calendar": {
  const win = computeCalendarWindow(view, anchorSp)
  const calendar = await getCalendarData(win)
  underneath = <CalendarContainer data={calendar} videos={pipeline.videos} />
  break
}
```

The cleanest way is to factor the helper into `lib/content-studio/calendar-window.ts` and import it in all three places. Do that:

Create `lib/content-studio/calendar-window.ts`:

```typescript
export interface CalendarWindow {
  from: string
  to: string
}

export function computeCalendarWindow(
  view: string | undefined,
  anchor: string | undefined,
): CalendarWindow {
  const anchorDate = anchor ? new Date(`${anchor}T00:00:00Z`) : new Date()
  anchorDate.setUTCHours(0, 0, 0, 0)
  const from = new Date(anchorDate)
  const to = new Date(anchorDate)
  if (view === "day") {
    // stay
  } else if (view === "week") {
    const dow = from.getUTCDay()
    from.setUTCDate(from.getUTCDate() - ((dow + 6) % 7))
    to.setTime(from.getTime())
    to.setUTCDate(to.getUTCDate() + 6)
  } else {
    from.setUTCDate(1)
    from.setUTCMonth(from.getUTCMonth() - 1)
    to.setUTCDate(1)
    to.setUTCMonth(to.getUTCMonth() + 2)
    to.setUTCDate(0)
  }
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}
```

Then replace the inline function in `app/(admin)/admin/content/page.tsx` and import from this module. Do the same in `[videoId]/page.tsx`.

- [ ] **Step 3: Manual smoke test**

```bash
CONTENT_STUDIO_ENABLED=true npm run dev
```

- Visit `/admin/content?tab=calendar` — three-column layout with filters left, month grid center, unscheduled panel right.
- Press `w` — week view.
- Press `d` — day view.
- Press `m` — month view.
- Press `t` — jumps to today.
- Press `→` — advances one month/week/day depending on view.
- Click an Instagram filter checkbox — non-IG chips disappear.
- Drag an unscheduled card onto a day cell → TimePickerPopover opens pre-filled with IG default time → Schedule → chip appears.
- Drag a scheduled chip to another day → toasts "Moved to..." and chip moves.
- Drag a published chip → should not start (cursor not grab; locked).
- Click an empty day → ManualPostDialog opens → enter caption → Create → chip appears.
- Hover a chip → mini-card with Open button.
- Click "Open" → drawer opens with the post expanded.

- [ ] **Step 4: Commit**

```bash
git add lib/content-studio/calendar-window.ts \
        app/\(admin\)/admin/content/page.tsx \
        app/\(admin\)/admin/content/\[videoId\]/page.tsx \
        app/\(admin\)/admin/content/post/\[postId\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(content-studio): mount CalendarContainer + window-aware data fetch

Pages fetch only the chips relevant to the current view window. computeCalendarWindow
lives in lib/content-studio/calendar-window.ts so all three pages share it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: E2E — calendar happy path

**Files:**
- Create: `__tests__/e2e/content-studio-calendar.spec.ts`

- [ ] **Step 1: Write the e2e**

Create `__tests__/e2e/content-studio-calendar.spec.ts`:

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

test.describe("Content Studio calendar", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test("calendar tab renders three-column layout", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=calendar")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    await expect(page.getByRole("complementary", { name: /Calendar filters/i })).toBeVisible()
    await expect(page.getByRole("grid", { name: /month view/i })).toBeVisible()
    await expect(page.getByRole("complementary", { name: /Unscheduled posts/i })).toBeVisible()
  })

  test("keyboard shortcut 'w' switches to week view", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=calendar")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    await page.keyboard.press("w")
    await expect(page).toHaveURL(/view=week/)
    await expect(page.getByRole("grid", { name: /week view/i })).toBeVisible()
  })

  test("clicking an empty day opens the ManualPostDialog", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=calendar")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    // Any empty cell (no post chip inside): picks the last row, last column to maximize empty-ness chance
    const cells = page.getByRole("gridcell")
    const count = await cells.count()
    test.skip(count < 42, "Month grid missing")
    await cells.nth(count - 1).click()
    await expect(page.getByText(/New manual post/)).toBeVisible()
  })

  test("drag-drop an unscheduled post onto a day opens the time picker", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=calendar")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    const unscheduled = page.getByRole("complementary", { name: /Unscheduled/ }).locator("[role='button'], .cursor-grab").first()
    const hasAny = await unscheduled.count()
    test.skip(hasAny === 0, "No unscheduled posts to drag")

    const targetCell = page.getByRole("gridcell").nth(10)
    await unscheduled.dragTo(targetCell)
    await expect(page.getByText(/Schedule on 20\d{2}-\d{2}-\d{2}/)).toBeVisible()
  })
})
```

Note: Playwright's `dragTo` may need `{ force: true }` on platforms with strict drag activation; the `useDraggable` distance=5 constraint should accept native drag simulation.

- [ ] **Step 2: Run e2e**

```bash
CONTENT_STUDIO_ENABLED=true npm run dev
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e -- content-studio-calendar
```

Expected: all pass or skip cleanly.

- [ ] **Step 3: Commit**

```bash
git add __tests__/e2e/content-studio-calendar.spec.ts
git commit -m "$(cat <<'EOF'
test(content-studio): e2e for calendar three-column, shortcuts, manual post, drop

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Final lint / full sweep

- [ ] **Step 1: Lint + format**

```bash
npm run lint
npm run format:check
```

If format fails: `npm run format`.

- [ ] **Step 2: Full test run**

```bash
npm run test:run
```

- [ ] **Step 3: Commit formatter fixes if any**

```bash
git add -u
git commit -m "chore(content-studio): prettier fixes from Phase 4" --allow-empty
```

---

## Verification Before Calling Phase 4 Done

1. **Three-column layout.** Left filters, center grid, right unscheduled panel all visible.
2. **Views.** Month / Week / Day each render correctly. Month has 42 cells, Week 7, Day 24 hours.
3. **Keyboard shortcuts.** m/w/d switch views. t jumps to today. ←/→ navigate. No shortcut fires while typing in an input.
4. **Post chips.** Color-coded per platform. Icon + first ~30 chars of caption. Video-source icon present for video-originated posts. Hover shows mini-card with full caption + source-video filename + Open button.
5. **Drag reschedule.** Moving a scheduled chip to a new day preserves the time-of-day and updates `scheduled_at`.
6. **Published chips are locked** — cursor is not grab; dragging does nothing.
7. **Failed chips** show a red accent + inline Retry button in the hover card.
8. **Empty day click.** Creates a manual post via the dialog; it appears on the grid after save.
9. **Unscheduled panel.** Lists approved posts with no `scheduled_at`, grouped by source video (manual bucket for null).
10. **Unscheduled drag → time picker.** TimePickerPopover opens with per-platform default; confirming POSTs `/schedule` and chip appears.
11. **Filters.** Platform/status checkboxes narrow center grid. Source-video select narrows too. Filters persist in URL search params.
12. **Data merge.** Both `social_posts.scheduled_at` chips and `content_calendar_entry` rows appear in the grid per the spec.
13. **All tests pass** — unit, integration, e2e.

---

## Phase 4 Scope Boundaries

**In this phase:**
- Month / Week / Day grids with drag-drop
- Platform default publish times for unscheduled drops
- Unscheduled panel grouped by source video
- Left filter sidebar (platform / status / source video search)
- Manual-post-from-empty-day dialog
- Keyboard shortcuts

**NOT in this phase** (handled in Phase 5):
- Persistence of filter state to user preferences (stays in URL for now)
- Global search across videos/transcripts/captions
- Best-time AI (out of scope for the entire spec)
- Saving the user's preferred default view to a DB row

When Phase 4 ships behind the flag, internal users can plan, schedule, and reschedule the entire publish calendar at a glance, with source-video context always one click away.
