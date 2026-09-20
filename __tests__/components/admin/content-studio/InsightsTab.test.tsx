// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { InsightsTab } from "@/components/admin/content-studio/insights/InsightsTab"
import type { StudioInsights } from "@/lib/content-studio/insights"

function data(over: Partial<StudioInsights> = {}): StudioInsights {
  return {
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

describe("InsightsTab", () => {
  it("shows production counts that work today", () => {
    render(<InsightsTab data={data()} />)
    // Scoped to the specific tile, not a bare getByText("9") — several tiles
    // on this page render small numbers, so "identify which tile" matters.
    expect(within(screen.getByTestId("stat-new-videos")).getByText("9")).toBeInTheDocument()
    expect(within(screen.getByTestId("stat-posts-draft")).getByText("54")).toBeInTheDocument()
  })

  it("says nothing is published yet instead of showing a zero view count", () => {
    render(<InsightsTab data={data()} />)
    expect(screen.getByText(/nothing has been published yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/^0 views$/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId("performance-tiles")).not.toBeInTheDocument()
  })

  it("shows real numbers once posts are measured", () => {
    render(
      <InsightsTab
        data={data({
          performance: { videos: [], totals: { views: 1234, likes: 56, comments: 7, shares: 8 }, measuredPostCount: 3 },
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
})
