import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { VideoCard } from "@/components/admin/content-studio/pipeline/VideoCard"
import type { VideoUpload } from "@/types/database"

const video: VideoUpload = {
  id: "vid-1",
  storage_path: "videos/x.mp4",
  original_filename: "x.mp4",
  duration_seconds: 42,
  size_bytes: 1000,
  mime_type: "video/mp4",
  title: "Clip",
  uploaded_by: null,
  status: "transcribed",
  thumbnail_path: null,
  created_at: "2026-05-31T00:00:00.000Z",
  updated_at: "2026-05-31T00:00:00.000Z",
}

describe("VideoCard — captioned-cut badge", () => {
  it("shows the 'Cut' chip when hasCut is true", () => {
    render(<VideoCard video={video} counts={null} hasCut />)
    expect(screen.getByText("Cut")).toBeTruthy()
  })

  it("hides the 'Cut' chip when hasCut is false", () => {
    render(<VideoCard video={video} counts={null} hasCut={false} />)
    expect(screen.queryByText("Cut")).toBeNull()
  })

  it("hides the 'Cut' chip by default (prop omitted)", () => {
    render(<VideoCard video={video} counts={null} />)
    expect(screen.queryByText("Cut")).toBeNull()
  })
})
