import { describe, it, expect } from "vitest"
import { computeContentMetrics } from "@/lib/analytics/content"
import type { BlogPost, Newsletter } from "@/types/database"
import type { DateRange } from "@/types/analytics"

function mkRange(fromIso: string, toIso: string): DateRange {
  return { from: new Date(fromIso), to: new Date(toIso) }
}

function mkBlog(overrides: Partial<BlogPost>): BlogPost {
  return {
    id: overrides.id ?? "b-1",
    title: overrides.title ?? "Sample Post",
    slug: overrides.slug ?? "sample-post",
    excerpt: overrides.excerpt ?? "",
    content: overrides.content ?? "",
    category: overrides.category ?? "Performance",
    cover_image_url: null,
    status: overrides.status ?? "draft",
    tags: [],
    meta_description: null,
    author_id: "author-1",
    published_at: overrides.published_at ?? null,
    created_at: overrides.created_at ?? "2026-04-05T10:00:00Z",
    updated_at: overrides.updated_at ?? "2026-04-05T10:00:00Z",
    source_video_id: null,
    seo_metadata: {},
    tavily_research: null,
    fact_check_status: overrides.fact_check_status ?? null,
    fact_check_details: null,
  }
}

function mkNewsletter(overrides: Partial<Newsletter>): Newsletter {
  return {
    id: overrides.id ?? "n-1",
    subject: overrides.subject ?? "Weekly Update",
    preview_text: "",
    content: "",
    status: overrides.status ?? "draft",
    sent_at: overrides.sent_at ?? null,
    sent_count: overrides.sent_count ?? 0,
    failed_count: overrides.failed_count ?? 0,
    source_blog_post_id: overrides.source_blog_post_id ?? null,
    author_id: "author-1",
    created_at: overrides.created_at ?? "2026-04-05T10:00:00Z",
    updated_at: overrides.updated_at ?? "2026-04-05T10:00:00Z",
  }
}

const APRIL = mkRange("2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z")
const MARCH = mkRange("2026-03-01T00:00:00Z", "2026-03-31T23:59:59Z")

describe("computeContentMetrics", () => {
  it("returns zeros for empty input", () => {
    const m = computeContentMetrics([], [], 0, APRIL, MARCH)
    expect(m.blogsCreated).toBe(0)
    expect(m.blogsPublished).toBe(0)
    expect(m.newslettersSent).toBe(0)
    expect(m.activeSubscribers).toBe(0)
    expect(m.recentPublishes).toHaveLength(0)
  })

  it("counts blogs created and published in range separately", () => {
    const blogs = [
      mkBlog({ id: "b1", created_at: "2026-04-02T10:00:00Z" }),
      mkBlog({
        id: "b2",
        created_at: "2026-03-25T10:00:00Z",
        status: "published",
        published_at: "2026-04-05T10:00:00Z",
      }),
    ]
    const m = computeContentMetrics(blogs, [], 0, APRIL, MARCH)
    expect(m.blogsCreated).toBe(1)
    expect(m.blogsPublished).toBe(1)
  })

  it("tracks previous-period counts for trend cards", () => {
    const blogs = [
      mkBlog({ id: "old", created_at: "2026-03-10T10:00:00Z" }),
      mkBlog({ id: "old2", created_at: "2026-03-20T10:00:00Z" }),
      mkBlog({ id: "new", created_at: "2026-04-05T10:00:00Z" }),
    ]
    const m = computeContentMetrics(blogs, [], 0, APRIL, MARCH)
    expect(m.previousBlogsCreated).toBe(2)
  })

  it("counts newsletters sent (not just created) in range", () => {
    const nls = [
      mkNewsletter({ id: "n1", status: "draft", created_at: "2026-04-02T10:00:00Z" }),
      mkNewsletter({ id: "n2", status: "sent", sent_at: "2026-04-10T10:00:00Z" }),
      mkNewsletter({ id: "n3", status: "sent", sent_at: "2026-03-25T10:00:00Z" }),
    ]
    const m = computeContentMetrics([], nls, 0, APRIL, null)
    expect(m.newslettersSent).toBe(1)
  })

  it("surfaces active subscriber count as-is (no filtering)", () => {
    const m = computeContentMetrics([], [], 1234, APRIL, null)
    expect(m.activeSubscribers).toBe(1234)
  })

  it("buckets blogs by month — drafts vs. published", () => {
    const blogs = [
      mkBlog({ id: "b1", created_at: "2026-04-02T10:00:00Z" }),
      mkBlog({ id: "b2", created_at: "2026-04-05T10:00:00Z" }),
      mkBlog({
        id: "b3",
        created_at: "2026-04-10T10:00:00Z",
        status: "published",
        published_at: "2026-04-12T10:00:00Z",
      }),
    ]
    const m = computeContentMetrics(blogs, [], 0, APRIL, null)
    const april = m.blogsByMonth.find((x) => x.key === "2026-04")
    expect(april?.drafts).toBe(3)
    expect(april?.published).toBe(1)
  })

  it("breaks down published blogs by category, newest-first by count", () => {
    const blogs = [
      mkBlog({
        id: "b1",
        category: "Performance",
        status: "published",
        published_at: "2026-04-05T10:00:00Z",
      }),
      mkBlog({
        id: "b2",
        category: "Performance",
        status: "published",
        published_at: "2026-04-06T10:00:00Z",
      }),
      mkBlog({
        id: "b3",
        category: "Recovery",
        status: "published",
        published_at: "2026-04-07T10:00:00Z",
      }),
    ]
    const m = computeContentMetrics(blogs, [], 0, APRIL, null)
    expect(m.blogsByCategory).toEqual([
      { label: "Performance", count: 2 },
      { label: "Recovery", count: 1 },
    ])
  })

  it("surfaces fact-check status for blogs created in range, excluding null/zero", () => {
    const blogs = [
      mkBlog({ id: "b1", fact_check_status: "passed", created_at: "2026-04-02T10:00:00Z" }),
      mkBlog({ id: "b2", fact_check_status: "passed", created_at: "2026-04-03T10:00:00Z" }),
      mkBlog({ id: "b3", fact_check_status: "flagged", created_at: "2026-04-04T10:00:00Z" }),
      mkBlog({ id: "b4", fact_check_status: null, created_at: "2026-04-05T10:00:00Z" }),
    ]
    const m = computeContentMetrics(blogs, [], 0, APRIL, null)
    expect(m.blogsByFactCheckStatus).toEqual([
      { label: "Passed", count: 2 },
      { label: "Flagged", count: 1 },
    ])
  })

  it("returns up to 10 recent publishes, newest-first by published_at", () => {
    const blogs = Array.from({ length: 12 }, (_, i) =>
      mkBlog({
        id: `b${i}`,
        title: `Post ${i}`,
        status: "published",
        published_at: `2026-04-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      }),
    )
    const m = computeContentMetrics(blogs, [], 0, APRIL, null)
    expect(m.recentPublishes).toHaveLength(10)
    expect(m.recentPublishes[0].title).toBe("Post 11")
    expect(m.recentPublishes[9].title).toBe("Post 2")
  })
})
