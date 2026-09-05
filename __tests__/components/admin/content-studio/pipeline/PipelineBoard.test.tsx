// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import type { PipelineData } from "@/lib/content-studio/pipeline-data"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content",
  useSearchParams: () => new URLSearchParams(""),
}))

const data: PipelineData = {
  videos: [
    {
      id: "v1",
      storage_path: "",
      original_filename: "a.mp4",
      duration_seconds: 10,
      size_bytes: 1,
      mime_type: null,
      title: "A",
      uploaded_by: null,
      status: "uploaded",
      needs_edit: false,
      thumbnail_path: null,
      created_at: "",
      updated_at: "",
    },
  ],
  posts: [],
  postCountsByVideo: {},
  thumbnailUrlsByVideo: {},
  cutVideoIds: new Set(),
  captionedCutEnabled: false,
  renderJobIdByVideo: {},
  renderStartedAtByVideo: {},
  failedRenderVideoIds: new Set<string>(),
}

describe("<PipelineBoard>", () => {
  it("renders both lanes", () => {
    render(<PipelineBoard initialData={data} />)
    expect(screen.getByRole("region", { name: /Videos/ })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: /Posts/ })).toBeInTheDocument()
  })

  it("surfaces a stored filter in the filter bar even when the URL has no filter params", () => {
    render(
      <PipelineBoard
        initialData={data}
        initialFilters={{ platforms: ["instagram"], statuses: [], from: null, to: null, sourceVideoId: null }}
      />,
    )
    // The board applies the stored filter, so the UI must show it as active + clearable.
    expect(screen.getByRole("button", { name: /Clear all/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Instagram/i })).toHaveAttribute("aria-pressed", "true")
  })

  it("does not empty the board when a stored sourceVideoId points to a deleted video", () => {
    const withPost: PipelineData = {
      ...data,
      videos: [{ ...data.videos[0], status: "transcribed" }],
      posts: [
        {
          id: "p1",
          platform: "instagram",
          content: "x",
          media_url: null,
          post_type: "video",
          approval_status: "draft",
          scheduled_at: null,
          published_at: null,
          source_video_id: "v1",
          rejection_notes: null,
          platform_post_id: null,
          created_by: "u",
          created_at: "",
          updated_at: "",
          source_video_filename: "a.mp4",
        },
      ],
      postCountsByVideo: {
        v1: { total: 1, approved: 0, scheduled: 0, published: 0, failed: 0, needs_review: 1 },
      },
    }
    render(
      <PipelineBoard
        initialData={withPost}
        initialFilters={{ platforms: [], statuses: [], from: null, to: null, sourceVideoId: "ghost-deleted" }}
      />,
    )
    // v1 (which has posts) must survive the stale ghost filter → Videos lane counts it.
    expect(screen.getByText("1 total · 1 with posts")).toBeInTheDocument()
  })
})
