// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { VideoPerformance } from "@/components/admin/content-studio/detail/VideoPerformance"

describe("VideoPerformance", () => {
  it("not published yet", () => {
    render(<VideoPerformance performance={{ videoId: "v1", state: { kind: "not_published" }, perPost: [] }} />)
    expect(screen.getByText(/isn't published yet/i)).toBeInTheDocument()
  })

  it("published, waiting for the first numbers", () => {
    render(
      <VideoPerformance
        performance={{
          videoId: "v1",
          state: { kind: "awaiting_sync", publishedAt: "2026-09-19T12:00:00Z" },
          perPost: [],
        }}
      />,
    )
    expect(screen.getByText(/first numbers/i)).toBeInTheDocument()
  })

  it("names the platform that isn't connected", () => {
    render(
      <VideoPerformance
        performance={{
          videoId: "v1",
          state: { kind: "not_connected", platform: "linkedin" },
          perPost: [],
        }}
      />,
    )
    expect(screen.getByText(/linkedin/i)).toBeInTheDocument()
  })

  it("shows a real zero as a zero, not the not-published message", () => {
    render(
      <VideoPerformance
        performance={{
          videoId: "v1",
          state: { kind: "measured", views: 0, likes: 0, comments: 0, shares: 0 },
          perPost: [],
        }}
      />,
    )
    // Scoped to the Views tile specifically: a naive `value || "-"` fallback
    // would swallow a genuine zero, and an unscoped getByText("0") is
    // ambiguous here because all four figures are legitimately zero.
    expect(screen.getByTestId("perf-stat-views")).toHaveTextContent("0")
    expect(screen.getByTestId("perf-stat-likes")).toHaveTextContent("0")
    expect(screen.queryByText(/isn't published yet/i)).not.toBeInTheDocument()
  })

  it("renders nothing when there is no performance record at all", () => {
    const { container } = render(<VideoPerformance performance={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders a real, non-toLocaleString figure using toLocaleString formatting", () => {
    render(
      <VideoPerformance
        performance={{
          videoId: "v1",
          state: { kind: "measured", views: 12345, likes: 200, comments: 7, shares: 3 },
          perPost: [],
        }}
      />,
    )
    expect(screen.getByTestId("perf-stat-views")).toHaveTextContent("12,345")
  })

  it("renders perPost lines even when the roll-up says measured — the roll-up hides a disconnected platform that perPost must surface", () => {
    // Mirrors summarizeVideoPerformance's own documented lossiness: one
    // measured post sums into a "measured" video-level state even though a
    // second post, on a disconnected platform, never got read at all. A
    // reviewer flagged this exact scenario as the failure this feature must
    // not hide.
    render(
      <VideoPerformance
        performance={{
          videoId: "v1",
          state: { kind: "measured", views: 500, likes: 40, comments: 2, shares: 1 },
          perPost: [
            {
              postId: "post-measured",
              platform: "instagram",
              state: { kind: "measured", views: 500, likes: 40, comments: 2, shares: 1 },
            },
            {
              postId: "post-blocked",
              platform: "linkedin",
              state: { kind: "not_connected", platform: "linkedin" },
            },
          ],
        }}
      />,
    )
    // The roll-up alone would look entirely healthy. The per-post list must
    // still say LinkedIn couldn't be read.
    expect(screen.getByText(/linkedin isn't connected/i)).toBeInTheDocument()
    expect(screen.getByText("Instagram")).toBeInTheDocument()
  })

  it("capitalises a raw platform id for display instead of showing it verbatim", () => {
    render(
      <VideoPerformance
        performance={{
          videoId: "v1",
          state: { kind: "not_published" },
          perPost: [
            {
              postId: "post-1",
              platform: "youtube_shorts",
              state: { kind: "not_published" },
            },
          ],
        }}
      />,
    )
    expect(screen.getByText("YouTube Shorts")).toBeInTheDocument()
    expect(screen.queryByText("youtube_shorts")).not.toBeInTheDocument()
  })

  it("gives a not_published post its own short line, not the video-scoped sentence", () => {
    // Production has 0 published posts today, so a video with several drafts
    // would otherwise repeat "This video isn't published yet..." once per
    // post — the roll-up's sentence, wrongly attributed to a post.
    render(
      <VideoPerformance
        performance={{
          videoId: "v1",
          state: { kind: "not_published" },
          perPost: [
            {
              postId: "post-1",
              platform: "instagram",
              state: { kind: "not_published" },
            },
          ],
        }}
      />,
    )
    expect(screen.getByText("Not published yet.")).toBeInTheDocument()
    // Only the roll-up (one copy) may use the video-scoped sentence.
    expect(screen.getAllByText(/this video isn't published yet/i)).toHaveLength(1)
  })

  it("says the numbers couldn't be read when performance is 'error', instead of rendering nothing", () => {
    render(<VideoPerformance performance="error" />)
    expect(screen.getByText(/couldn't read the numbers/i)).toBeInTheDocument()
  })
})
