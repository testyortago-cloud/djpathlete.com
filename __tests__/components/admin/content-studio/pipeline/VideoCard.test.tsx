import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { VideoCard } from "@/components/admin/content-studio/pipeline/VideoCard"
import type { VideoUpload } from "@/types/database"

const video: VideoUpload = {
  id: "v1",
  storage_path: "u/v1.mp4",
  original_filename: "rotational-reboot.mp4",
  duration_seconds: 65,
  size_bytes: 5_000_000,
  mime_type: "video/mp4",
  title: "Rotational Reboot",
  uploaded_by: null,
  status: "transcribed",
  created_at: "2026-04-15T00:00:00Z",
  updated_at: "2026-04-15T00:00:00Z",
}

describe("<VideoCard>", () => {
  it("renders filename and duration", () => {
    render(<VideoCard video={video} counts={null} />)
    expect(screen.getByText(/Rotational Reboot/)).toBeInTheDocument()
    expect(screen.getByText(/1:05/)).toBeInTheDocument()
  })

  it("renders the status badge", () => {
    render(<VideoCard video={video} counts={null} />)
    expect(screen.getByText(/transcribed/i)).toBeInTheDocument()
  })

  it("renders the post summary line when counts are present", () => {
    render(
      <VideoCard
        video={video}
        counts={{
          total: 6,
          approved: 4,
          scheduled: 2,
          published: 0,
          failed: 0,
          needs_review: 0,
        }}
      />,
    )
    expect(screen.getByText(/6 posts/)).toBeInTheDocument()
    // Compact pill rendering: "✓N" with a sr-only " approved" label, same for "⏱N scheduled".
    expect(screen.getByText(/✓4/)).toBeInTheDocument()
    expect(screen.getByText(/⏱2/)).toBeInTheDocument()
  })

  it("links to /admin/content/[videoId] so clicking opens the drawer", () => {
    render(<VideoCard video={video} counts={null} />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/content/v1")
  })

  it("renders a red error badge when video status is 'failed'", () => {
    render(<VideoCard video={{ ...video, status: "failed" }} counts={null} />)
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })
})
