// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { InsightsTab } from "@/components/admin/content-studio/insights/InsightsTab"
import type { StudioInsights, VideoPerformanceSummary } from "@/lib/content-studio/insights"

function data(over: Partial<StudioInsights> = {}): StudioInsights {
  return {
    periodDays: 30,
    production: {
      videosUploaded: 9,
      videosUploadedPrevious: 4,
      postsByStage: { draft: 54, published: 0 },
      videosBlockedByEditGate: 2,
      assetsByKind: { image: 7 },
      assetBytes: 1_500_000,
      teamSubmissionsByStatus: { submitted: 3 },
      oldestInStage: [{ stage: "draft", ageDays: 15, label: "Drafts" }],
    },
    performance: { videos: [], totals: { views: 0, likes: 0, comments: 0, shares: 0 }, measuredPostCount: 0 },
    ...over,
  }
}

function video(perPost: VideoPerformanceSummary["perPost"]): VideoPerformanceSummary {
  return { videoId: "v1", state: perPost[0]?.state ?? { kind: "not_published" }, perPost }
}

describe("InsightsTab", () => {
  it("shows production counts that work today", () => {
    render(<InsightsTab data={data()} />)
    // Scoped to the specific tile, not a bare getByText("9") — several tiles
    // on this page render small numbers, so "identify which tile" matters.
    expect(within(screen.getByTestId("stat-new-videos")).getByText("9")).toBeInTheDocument()
    expect(within(screen.getByTestId("stat-posts-draft")).getByText("54")).toBeInTheDocument()
  })

  it("renders the configured period length instead of a hardcoded 30", () => {
    render(<InsightsTab data={data({ periodDays: 14 })} />)
    expect(screen.getByText(/the last 14 days, compared with the 14 days before that/i)).toBeInTheDocument()
    expect(within(screen.getByTestId("stat-new-videos")).getByText(/14 days before/i)).toBeInTheDocument()
  })

  it("says nothing is published yet instead of showing a zero view count", () => {
    render(<InsightsTab data={data()} />)
    expect(screen.getByText(/nothing has been published yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/^0 views$/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId("performance-tiles")).not.toBeInTheDocument()
  })

  it("shows real numbers once posts are measured", () => {
    const videos = [
      video([
        { postId: "p1", platform: "instagram", state: { kind: "measured", views: 1234, likes: 56, comments: 7, shares: 8 } },
      ]),
    ]
    render(
      <InsightsTab
        data={data({
          performance: { videos, totals: { views: 1234, likes: 56, comments: 7, shares: 8 }, measuredPostCount: 3 },
        })}
      />,
    )
    expect(within(screen.getByTestId("stat-views")).getByText("1,234")).toBeInTheDocument()
    expect(screen.queryByText(/nothing has been published yet/i)).not.toBeInTheDocument()
  })

  it("flags what is stuck", () => {
    render(<InsightsTab data={data()} />)
    expect(within(screen.getByTestId("stuck-item-draft")).getByText(/15 days/i)).toBeInTheDocument()
  })

  // The three states this tab used to collapse into "Nothing has been
  // published yet" — a post can be published-but-not-yet-synced, published
  // on a platform that isn't connected, or a mix of measured and either of
  // those. None of those three should ever read as "nothing published".

  it("says posts are live (not 'nothing published') when published posts exist but none are measured yet", () => {
    const videos = [
      video([
        { postId: "p1", platform: "instagram", state: { kind: "awaiting_sync", publishedAt: "2026-09-19T00:00:00Z" } },
        { postId: "p2", platform: "instagram", state: { kind: "awaiting_sync", publishedAt: "2026-09-19T00:00:00Z" } },
      ]),
    ]
    render(
      <InsightsTab
        data={data({
          performance: { videos, totals: { views: 0, likes: 0, comments: 0, shares: 0 }, measuredPostCount: 0 },
        })}
      />,
    )
    expect(screen.queryByText(/nothing has been published yet/i)).not.toBeInTheDocument()
    expect(screen.getByTestId("performance-pending")).toBeInTheDocument()
    expect(within(screen.getByTestId("performance-pending")).getByText(/2 posts have gone live/i)).toBeInTheDocument()
    expect(
      within(screen.getByTestId("performance-pending")).getByText(/waiting on the next nightly update/i),
    ).toBeInTheDocument()
    expect(screen.queryByTestId("performance-tiles")).not.toBeInTheDocument()
  })

  it("shows figures plus a note about posts still awaiting a sync, when some are measured and some are not", () => {
    const videos = [
      video([
        { postId: "p1", platform: "instagram", state: { kind: "measured", views: 10, likes: 2, comments: 1, shares: 0 } },
        { postId: "p2", platform: "instagram", state: { kind: "awaiting_sync", publishedAt: "2026-09-19T00:00:00Z" } },
      ]),
    ]
    render(
      <InsightsTab
        data={data({
          performance: { videos, totals: { views: 10, likes: 2, comments: 1, shares: 0 }, measuredPostCount: 1 },
        })}
      />,
    )
    expect(screen.queryByText(/nothing has been published yet/i)).not.toBeInTheDocument()
    expect(screen.getByTestId("performance-tiles")).toBeInTheDocument()
    expect(within(screen.getByTestId("stat-views")).getByText("10")).toBeInTheDocument()
    expect(
      within(screen.getByTestId("performance-partial-note")).getByText(/1 post is still waiting on the next nightly update/i),
    ).toBeInTheDocument()
  })

  it("shows figures plus a note naming the disconnected platform, when some are measured and one is not connected", () => {
    const videos = [
      video([
        { postId: "p1", platform: "instagram", state: { kind: "measured", views: 10, likes: 2, comments: 1, shares: 0 } },
        { postId: "p2", platform: "tiktok", state: { kind: "not_connected", platform: "tiktok" } },
      ]),
    ]
    render(
      <InsightsTab
        data={data({
          performance: { videos, totals: { views: 10, likes: 2, comments: 1, shares: 0 }, measuredPostCount: 1 },
        })}
      />,
    )
    expect(screen.queryByText(/nothing has been published yet/i)).not.toBeInTheDocument()
    expect(screen.getByTestId("performance-tiles")).toBeInTheDocument()
    expect(within(screen.getByTestId("stat-views")).getByText("10")).toBeInTheDocument()
    const note = screen.getByTestId("performance-partial-note")
    expect(within(note).getByText(/TikTok/)).toBeInTheDocument()
    expect(within(note).getByText(/isn't connected/i)).toBeInTheDocument()
  })

  it("never says 'nothing has been published' when a video's only posts are on a disconnected platform", () => {
    const videos = [video([{ postId: "p1", platform: "linkedin", state: { kind: "not_connected", platform: "linkedin" } }])]
    render(
      <InsightsTab
        data={data({
          performance: { videos, totals: { views: 0, likes: 0, comments: 0, shares: 0 }, measuredPostCount: 0 },
        })}
      />,
    )
    expect(screen.queryByText(/nothing has been published yet/i)).not.toBeInTheDocument()
    expect(screen.getByTestId("performance-pending")).toBeInTheDocument()
    expect(within(screen.getByTestId("performance-pending")).getByText(/LinkedIn/)).toBeInTheDocument()
  })
})
