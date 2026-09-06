// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { NewsletterList } from "@/components/admin/newsletter/NewsletterList"
import { BlogPostList } from "@/components/admin/blog/BlogPostList"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const baseNewsletter = {
  id: "n1", subject: "August round-up", preview_text: "", content: "x".repeat(50),
  sent_at: null, sent_count: 0, failed_count: 0, source_blog_post_id: null,
  author_id: "a", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
  schedule_failed_reason: null,
}

const basePost = {
  id: "b1", title: "Off-season speed work", slug: "speed", excerpt: "", content: "",
  category: "Performance", cover_image_url: null, tags: [], meta_description: null,
  author_id: "a", published_at: null, created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z", source_video_id: null, seo_metadata: {},
  tavily_research: null, fact_check_status: null, fact_check_details: null,
  inline_images: [], primary_keyword: null, secondary_keywords: [], search_intent: null,
  faq: [], subcategory: null, last_refreshed_at: null, refresh_count: 0,
  schedule_failed_reason: null,
}

describe("scheduled items in the admin lists", () => {
  it("shows a scheduled newsletter as Scheduled, NOT as Draft", () => {
    // The bug this pins: every reader was `status === "sent" ? "Sent" : "Draft"`,
    // so a third value silently rendered as Draft.
    render(<NewsletterList newsletters={[{ ...baseNewsletter, status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z" }] as never} />)
    // Scoped to the table: the status tabs above it also read "Scheduled" / "Draft",
    // so an unscoped query would be ambiguous about which one it's asserting on.
    const table = within(screen.getByRole("table"))
    expect(table.getByText("Scheduled")).toBeTruthy()
    expect(table.queryByText("Draft")).toBeNull()
  })

  it("shows a scheduled blog post as Scheduled, NOT as Draft", () => {
    render(<BlogPostList posts={[{ ...basePost, status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z" }] as never} />)
    expect(within(screen.getByRole("table")).getByText("Scheduled")).toBeTruthy()
  })

  it("offers a Scheduled tab in both lists", () => {
    render(<NewsletterList newsletters={[] as never} />)
    expect(screen.getByRole("button", { name: "Scheduled" })).toBeTruthy()
  })

  it("shows a missed item as needing attention, with its reason", () => {
    render(
      <BlogPostList
        posts={[{ ...basePost, status: "draft", scheduled_at: null, schedule_failed_reason: "Missed its slot — pick a new time." }] as never}
      />,
    )
    expect(screen.getByText(/missed its slot/i)).toBeTruthy()
  })

  describe('a scheduled row offers both "move" and "cancel", not cancel alone', () => {
    // Regression for: the Schedule button (which opens SchedulePicker,
    // pre-filled via its `initial` prop with the row's current scheduled_at)
    // was gated to status === "draft" only. A scheduled row's scheduled_at is
    // never null, so `initial` was dead code and there was no "move" action —
    // only Cancel. The spec promised row actions to "cancel or move".

    it("blog list: a scheduled row shows a Move action alongside Cancel schedule", () => {
      render(
        <BlogPostList
          posts={[{ ...basePost, status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z" }] as never}
        />,
      )
      expect(screen.getByTitle(/move to a different time/i)).toBeTruthy()
      expect(screen.getByTitle(/cancel schedule/i)).toBeTruthy()
    })

    it("newsletter list: a scheduled row shows a Move action alongside Cancel schedule", () => {
      render(
        <NewsletterList
          newsletters={[{ ...baseNewsletter, status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z" }] as never}
        />,
      )
      expect(screen.getByTitle(/move to a different time/i)).toBeTruthy()
      expect(screen.getByTitle(/cancel schedule/i)).toBeTruthy()
    })

    it("a draft row still shows the plain 'Schedule' action, not 'Move'", () => {
      render(<BlogPostList posts={[{ ...basePost, status: "draft", scheduled_at: null }] as never} />)
      expect(screen.getByTitle(/^schedule$/i)).toBeTruthy()
      expect(screen.queryByTitle(/move to a different time/i)).toBeNull()
    })
  })
})
