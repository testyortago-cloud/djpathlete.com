import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import type { VideoUpload } from "@/types/database"

vi.mock("@/components/admin/content-studio/drawer/GenerateQuoteCardsButton", () => ({
  GenerateQuoteCardsButton: () => <button type="button">Make post from transcript</button>,
}))
vi.mock("@/components/admin/content-studio/drawer/CaptionedCutPanel", () => ({
  CaptionedCutPanel: () => <div data-testid="cut-panel" />,
}))

import { VideoDetailSidebar } from "@/components/admin/content-studio/detail/VideoDetailSidebar"

const video: VideoUpload = {
  id: "v1",
  storage_path: "p.mp4",
  original_filename: "clip.mp4",
  duration_seconds: 90,
  size_bytes: 1_000_000,
  mime_type: "video/mp4",
  title: "Clip",
  uploaded_by: null,
  status: "transcribed",
  needs_edit: true,
  created_at: "2026-05-31T00:00:00Z",
  updated_at: "2026-05-31T00:00:00Z",
}

describe("<VideoDetailSidebar>", () => {
  it("renders the player and filename, and hides the cut panel when disabled", () => {
    const { container } = render(
      <VideoDetailSidebar video={video} previewUrl="https://example/p.mp4" captionedCutEnabled={false} />,
    )
    expect(container.querySelector("video")).toBeTruthy()
    expect(screen.getByText("clip.mp4")).toBeInTheDocument()
    expect(screen.queryByTestId("cut-panel")).toBeNull()
  })

  it("renders the captioned-cut panel when enabled", () => {
    render(<VideoDetailSidebar video={video} previewUrl={null} captionedCutEnabled />)
    expect(screen.getByTestId("cut-panel")).toBeInTheDocument()
  })
})
