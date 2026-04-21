import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { WeeklyContentReport } from "@/components/emails/WeeklyContentReport"
import type { SocialMetrics, ContentMetrics } from "@/types/analytics"

const baseSocial: SocialMetrics = {
  totalPosts: 10,
  previousTotalPosts: 6,
  publishedPosts: 8,
  previousPublishedPosts: 5,
  totalImpressions: 12_300,
  totalEngagement: 420,
  postsByMonth: [],
  postsByPlatform: [
    { label: "Instagram", count: 4 },
    { label: "Facebook", count: 2 },
  ],
  postsByStatus: [],
  topPostsByEngagement: [
    {
      social_post_id: "p1",
      platform: "instagram",
      content_preview: "Hip flexor drill — the one most athletes skip",
      engagement: 250,
      impressions: 5000,
    },
    {
      social_post_id: "p2",
      platform: "facebook",
      content_preview: "Short sprint mechanics tip",
      engagement: 120,
      impressions: 2200,
    },
  ],
}

const baseContent: ContentMetrics = {
  blogsCreated: 3,
  previousBlogsCreated: 1,
  blogsPublished: 2,
  previousBlogsPublished: 1,
  newslettersSent: 1,
  activeSubscribers: 1234,
  blogsByMonth: [],
  blogsByCategory: [],
  blogsByFactCheckStatus: [
    { label: "Passed", count: 2 },
    { label: "Flagged", count: 1 },
  ],
  recentPublishes: [
    {
      id: "b1",
      title: "How to drill hip flexor rotation",
      status: "published",
      category: "Performance",
      published_at: "2026-04-18T10:00:00Z",
      created_at: "2026-04-16T10:00:00Z",
    },
  ],
}

function render(overrides: Partial<Parameters<typeof WeeklyContentReport>[0]> = {}): string {
  return renderToStaticMarkup(
    <WeeklyContentReport
      social={baseSocial}
      content={baseContent}
      rangeStart={new Date("2026-04-14T00:00:00Z")}
      rangeEnd={new Date("2026-04-21T00:00:00Z")}
      dashboardUrl="https://app.local/admin/analytics?tab=social"
      {...overrides}
    />,
  )
}

describe("<WeeklyContentReport />", () => {
  it("renders the hero summary with counts and engagement", () => {
    const html = render()
    expect(html).toContain("8 posts published")
    expect(html).toContain("420")
    expect(html).toContain("2 blogs shipped")
  })

  it("shows the KPI numbers for posts created and published", () => {
    const html = render()
    expect(html).toContain("Posts created")
    expect(html).toContain("Posts published")
  })

  it("renders top posts with platform and content preview", () => {
    const html = render()
    expect(html).toContain("Hip flexor drill")
    expect(html).toContain("instagram")
  })

  it("renders a 'no engagement' placeholder when topPostsByEngagement is empty", () => {
    const html = render({
      social: { ...baseSocial, topPostsByEngagement: [] },
    })
    expect(html).toContain("No engagement data this week yet")
  })

  it("lists platform breakdown counts", () => {
    const html = render()
    expect(html).toContain("Instagram")
    expect(html).toContain("Facebook")
  })

  it("shows fact-check warning block when blogs are flagged", () => {
    const html = render()
    expect(html).toContain("Fact-check needs attention")
    expect(html).toContain("Flagged")
  })

  it("omits the fact-check block entirely when nothing is flagged", () => {
    const html = render({
      content: {
        ...baseContent,
        blogsByFactCheckStatus: [{ label: "Passed", count: 2 }],
      },
    })
    expect(html).not.toContain("Fact-check needs attention")
  })

  it("includes the Open dashboard CTA linking to the analytics page", () => {
    const html = render()
    expect(html).toContain("https://app.local/admin/analytics?tab=social")
    expect(html).toContain("Open dashboard")
  })

  it("shows recent blog titles when present", () => {
    const html = render()
    expect(html).toContain("How to drill hip flexor rotation")
  })

  it("formats the week heading with the rangeStart date", () => {
    const html = render()
    expect(html).toContain("Week of Apr")
  })
})
