import { describe, it, expect } from "vitest"
import { computePipeline } from "@/lib/analytics/daily-pulse"

const referenceDate = new Date("2026-08-21T12:00:00Z")

describe("computePipeline — scheduled blog posts", () => {
  it("does not count a scheduled post in blogsInDraft, but does in blogsScheduled", () => {
    const blogs = [
      { status: "scheduled", schedule_failed_reason: null },
      { status: "draft", schedule_failed_reason: null },
    ]
    const result = computePipeline([] as never, [] as never, blogs as never, referenceDate)
    expect(result.blogsInDraft).toBe(1)
    expect(result.blogsScheduled).toBe(1)
    expect(result.contentMissedSlot).toBe(0)
  })

  it("counts a draft with schedule_failed_reason in contentMissedSlot, excluded from blogsInDraft", () => {
    const blogs = [
      { status: "draft", schedule_failed_reason: "Missed its slot — pick a new time." },
      { status: "draft", schedule_failed_reason: null },
      { status: "scheduled", schedule_failed_reason: null },
    ]
    const result = computePipeline([] as never, [] as never, blogs as never, referenceDate)
    expect(result.contentMissedSlot).toBe(1)
    expect(result.blogsInDraft).toBe(1)
    expect(result.blogsScheduled).toBe(1)
  })
})
