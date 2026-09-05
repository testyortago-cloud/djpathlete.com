// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { VideoCard } from "@/components/admin/content-studio/pipeline/VideoCard"
import type { VideoUpload } from "@/types/database"

const video: VideoUpload = {
  id: "11111111-1111-1111-1111-111111111111",
  storage_path: "videos/x.mp4",
  original_filename: "x.mp4",
  duration_seconds: 30,
  size_bytes: null,
  mime_type: "video/mp4",
  title: "Clip",
  uploaded_by: null,
  status: "uploaded",
  needs_edit: true,
  created_at: "2026-05-31T00:00:00Z",
  updated_at: "2026-05-31T00:00:00Z",
}

describe("VideoCard — needs-edit badge", () => {
  it("shows 'Needs edit' when gated and not cut", () => {
    render(<VideoCard video={video} counts={null} hasCut={false} />)
    expect(screen.getByText(/needs edit/i)).toBeInTheDocument()
  })

  it("hides 'Needs edit' when the video has a cut", () => {
    render(<VideoCard video={video} counts={null} hasCut />)
    expect(screen.queryByText(/needs edit/i)).toBeNull()
  })

  it("hides 'Needs edit' when the video is not gated", () => {
    render(<VideoCard video={{ ...video, needs_edit: false }} counts={null} hasCut={false} />)
    expect(screen.queryByText(/needs edit/i)).toBeNull()
  })
})
