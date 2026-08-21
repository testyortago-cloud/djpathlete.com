import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { NewsletterForm } from "@/components/admin/newsletter/NewsletterForm"
import { BlogPostForm } from "@/components/admin/blog/BlogPostForm"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

// BlogGenerateDialog / NewsletterGenerateDialog / ResearchPanel all call useAiJob,
// which subscribes to Firebase Realtime Database — unavailable and unconfigured
// in this test environment. Mirrors the mock in
// __tests__/components/newsletter-generate-dialog-from-blog.test.tsx.
vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: () => ({
    status: "pending",
    result: null,
    error: null,
    text: "",
    chunks: [],
    analysis: null,
    programCreated: null,
    messageId: null,
    activeTools: [],
    reset: vi.fn(),
  }),
}))

const baseNewsletter = {
  id: "n1",
  subject: "August round-up",
  preview_text: "",
  content: "x".repeat(50),
  sent_at: null,
  sent_count: 0,
  failed_count: 0,
  source_blog_post_id: null,
  author_id: "a",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  schedule_failed_reason: null,
}

const basePost = {
  id: "b1",
  title: "Off-season speed work",
  slug: "speed",
  excerpt: "",
  content: "",
  category: "Performance",
  cover_image_url: null,
  tags: [],
  meta_description: null,
  author_id: "a",
  published_at: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  source_video_id: null,
  seo_metadata: {},
  tavily_research: null,
  fact_check_status: null,
  fact_check_details: null,
  inline_images: [],
  primary_keyword: null,
  secondary_keywords: [],
  search_intent: null,
  faq: [],
  subcategory: null,
  last_refreshed_at: null,
  refresh_count: 0,
  schedule_failed_reason: null,
}

describe("scheduled items in the admin editors", () => {
  it("newsletter editor for a scheduled item renders a banner naming the queued time, offering Cancel schedule", () => {
    render(
      <NewsletterForm
        newsletter={{ ...baseNewsletter, status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z" } as never}
        authorId="a"
      />,
    )
    expect(screen.getByText(/scheduled to go out on/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /cancel schedule/i })).toBeTruthy()
  })

  it("blog editor for a scheduled item renders a banner naming the queued time, offering Cancel schedule", () => {
    render(
      <BlogPostForm
        post={{ ...basePost, status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z" } as never}
        authorId="a"
      />,
    )
    expect(screen.getByText(/scheduled to go out on/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /cancel schedule/i })).toBeTruthy()
  })

  it("newsletter editor for a draft item renders a Schedule button beside Send", () => {
    render(
      <NewsletterForm newsletter={{ ...baseNewsletter, status: "draft", scheduled_at: null } as never} authorId="a" />,
    )
    expect(screen.getByRole("button", { name: /^schedule$/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^send$/i })).toBeTruthy()
    expect(screen.queryByText(/scheduled to go out on/i)).toBeNull()
  })

  it("blog editor for a draft item renders a Schedule button beside Publish", () => {
    render(<BlogPostForm post={{ ...basePost, status: "draft", scheduled_at: null } as never} authorId="a" />)
    expect(screen.getByRole("button", { name: /^schedule$/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^publish$/i })).toBeTruthy()
    expect(screen.queryByText(/scheduled to go out on/i)).toBeNull()
  })

  it("a sent newsletter is immutable: neither the Schedule button nor the banner render", () => {
    render(
      <NewsletterForm
        newsletter={{ ...baseNewsletter, status: "sent", scheduled_at: null, sent_at: "2026-08-10T09:00:00Z" } as never}
        authorId="a"
      />,
    )
    expect(screen.queryByRole("button", { name: /^schedule$/i })).toBeNull()
    expect(screen.queryByText(/scheduled to go out on/i)).toBeNull()
    expect(screen.queryByRole("button", { name: /cancel schedule/i })).toBeNull()
  })

  it("newsletter status line reads Scheduled, not Draft, for a scheduled item", () => {
    render(
      <NewsletterForm
        newsletter={{ ...baseNewsletter, status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z" } as never}
        authorId="a"
      />,
    )
    const statusLine = screen.getByText("Status:").closest("p")
    expect(statusLine ? within(statusLine).getByText("Scheduled") : null).toBeTruthy()
  })

  it("blog status line reads Scheduled, not Draft, for a scheduled item", () => {
    render(
      <BlogPostForm
        post={{ ...basePost, status: "scheduled", scheduled_at: "2026-09-01T07:00:00Z" } as never}
        authorId="a"
      />,
    )
    const statusLine = screen.getByText("Status:").closest("p")
    expect(statusLine ? within(statusLine).getByText("Scheduled") : null).toBeTruthy()
  })
})
