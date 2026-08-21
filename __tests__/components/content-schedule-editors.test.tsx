import { describe, it, expect, vi } from "vitest"
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react"
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

  // A post with valid excerpt/content so blogPostFormSchema.safeParse actually
  // passes and handleSave reaches its fetch calls — basePost's "" excerpt/
  // content are too short to validate, which is fine for the render-only
  // tests above but would silently no-op these two.
  const scheduledPost = {
    ...basePost,
    excerpt: "A solid off-season plan for building explosive speed safely.",
    content: "<p>Full post body.</p>",
    status: "scheduled",
    scheduled_at: "2026-09-01T07:00:00Z",
  }

  it('"Save Draft" on a scheduled post keeps it scheduled instead of silently disarming it', async () => {
    // Regression for: the PATCH body used to hard-code status: publish ? "published" : "draft",
    // so editing a typo on a queued post wrote status="draft" while leaving
    // scheduled_at set — it would never fire again, and the banner's promise
    // ("edits you save here will be included") would be a lie.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)
    try {
      render(<BlogPostForm post={scheduledPost as never} authorId="a" />)
      fireEvent.click(screen.getByRole("button", { name: /^save draft$/i }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe("/api/admin/blog/b1")
      expect(options.method).toBe("PATCH")
      const body = JSON.parse(options.body as string)
      expect(body.status).toBe("scheduled")

      // And it must NOT have called the publish endpoint.
      expect(fetchMock).not.toHaveBeenCalledWith("/api/admin/blog/b1/publish", expect.anything())
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('"Publish" on a scheduled post goes through the publish endpoint, not a bare PATCH', async () => {
    // Regression for: isPublishing = publish && (!post || post.status === "draft")
    // fell into the "already published" branch for a scheduled post, so it
    // PATCHed status="published" directly and skipped /publish entirely —
    // published_at stayed null, scheduled_at was never cleared, and none of
    // publishBlogPost's side effects (content_calendar flip, newsletter_from_blog,
    // seo_enhance) ran.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)
    try {
      render(<BlogPostForm post={scheduledPost as never} authorId="a" />)
      fireEvent.click(screen.getByRole("button", { name: /^publish$/i }))

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith("/api/admin/blog/b1/publish", expect.objectContaining({ method: "POST" })),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
