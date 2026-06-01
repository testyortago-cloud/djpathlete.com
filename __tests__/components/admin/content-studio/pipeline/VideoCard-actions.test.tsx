import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { VideoCard } from "@/components/admin/content-studio/pipeline/VideoCard"
import type { VideoUpload } from "@/types/database"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))

const video: VideoUpload = {
  id: "v1",
  storage_path: "u/v1.mp4",
  original_filename: "clip.mp4",
  duration_seconds: 30,
  size_bytes: null,
  mime_type: "video/mp4",
  title: "Clip",
  uploaded_by: null,
  status: "transcribed",
  needs_edit: true,
  created_at: "2026-05-31T00:00:00Z",
  updated_at: "2026-05-31T00:00:00Z",
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ jobId: "j1" }) }),
  )
})

describe("VideoCard — edit-column actions", () => {
  it("shows Render cut + Mark ready in the needs_edit column", () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" />)
    expect(screen.getByRole("button", { name: /render cut/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /mark ready/i })).toBeInTheDocument()
  })

  it("POSTs to the captioned-cut endpoint when Render cut is clicked", () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" />)
    fireEvent.click(screen.getByRole("button", { name: /render cut/i }))
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/content-studio/captioned-cut",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("PATCHes the videos endpoint when Mark ready is clicked", () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" />)
    fireEvent.click(screen.getByRole("button", { name: /mark ready/i }))
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/videos/v1",
      expect.objectContaining({ method: "PATCH" }),
    )
  })

  it("shows a render-failed badge and Retry render when renderFailed is set", () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" renderFailed />)
    expect(screen.getByText(/render failed/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /retry render/i })).toBeInTheDocument()
  })

  it("shows an elapsed timer (no action buttons) in the rendering column", () => {
    render(<VideoCard video={video} counts={null} column="rendering" renderJobId="j1" />)
    expect(screen.queryByRole("button", { name: /render cut/i })).toBeNull()
    expect(screen.getByText(/0:0\d/)).toBeInTheDocument()
  })

  it("renders the legacy card (single link, no action buttons) when column is omitted", () => {
    render(<VideoCard video={video} counts={null} />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/content/v1")
    expect(screen.queryByRole("button", { name: /render cut/i })).toBeNull()
  })
})
