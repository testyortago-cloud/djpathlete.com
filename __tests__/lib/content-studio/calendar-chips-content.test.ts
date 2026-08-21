import { describe, it, expect } from "vitest"
import { blogToChip, newsletterToChip, isLocked } from "@/lib/content-studio/calendar-chips"

describe("blog and newsletter calendar chips", () => {
  it("uses scheduled_at as the chip time for a scheduled post", () => {
    const chip = blogToChip({
      id: "b1",
      title: "Speed work",
      status: "scheduled",
      scheduled_at: "2026-09-01T07:00:00Z",
      published_at: null,
    } as never)
    expect(chip.kind).toBe("blog")
    expect(chip.scheduledAt?.toISOString()).toBe("2026-09-01T07:00:00.000Z")
    expect(chip.label).toBe("Speed work")
  })

  it("uses published_at once the post is live", () => {
    const chip = blogToChip({
      id: "b1",
      title: "Speed work",
      status: "published",
      scheduled_at: null,
      published_at: "2026-08-30T07:00:00Z",
    } as never)
    expect(chip.scheduledAt?.toISOString()).toBe("2026-08-30T07:00:00.000Z")
  })

  it("labels a newsletter by its subject", () => {
    const chip = newsletterToChip({
      id: "n1",
      subject: "August round-up",
      status: "scheduled",
      scheduled_at: "2026-09-02T09:00:00Z",
      sent_at: null,
    } as never)
    expect(chip.kind).toBe("newsletter")
    expect(chip.label).toBe("August round-up")
  })

  it("locks a published post and a sent newsletter against dragging", () => {
    expect(
      isLocked(
        blogToChip({
          id: "b",
          title: "t",
          status: "published",
          scheduled_at: null,
          published_at: "2026-08-30T07:00:00Z",
        } as never),
      ),
    ).toBe(true)
    expect(
      isLocked(
        newsletterToChip({
          id: "n",
          subject: "s",
          status: "sent",
          scheduled_at: null,
          sent_at: "2026-08-30T07:00:00Z",
        } as never),
      ),
    ).toBe(true)
    expect(
      isLocked(
        blogToChip({
          id: "b",
          title: "t",
          status: "scheduled",
          scheduled_at: "2026-09-01T07:00:00Z",
          published_at: null,
        } as never),
      ),
    ).toBe(false)
  })
})
