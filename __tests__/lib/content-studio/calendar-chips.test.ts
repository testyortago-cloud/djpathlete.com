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
    const c = postToChip(
      post({
        approval_status: "published",
        scheduled_at: null,
        published_at: "2026-04-19T10:00:00Z",
      }),
    )
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
    expect(isLocked(postToChip(post({ approval_status: "published" })))).toBe(true)
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
