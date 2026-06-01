import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { VideoCard } from "@/components/admin/content-studio/pipeline/VideoCard"
import type { VideoUpload } from "@/types/database"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))
// Isolate the RTDB progress hook (keeps Firebase out of the component tests).
vi.mock("@/hooks/use-render-progress", () => ({ useRenderProgress: vi.fn(() => null) }))
import { useRenderProgress } from "@/hooks/use-render-progress"

// Capture router.push so we can assert the "Render cut" navigation.
const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content",
  useSearchParams: () => new URLSearchParams(""),
}))

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
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ jobId: "j1" }) }))
  ;(useRenderProgress as ReturnType<typeof vi.fn>).mockReturnValue(null)
  pushMock.mockClear()
})

describe("VideoCard — edit-column actions", () => {
  it("shows Render cut + Mark ready in the needs_edit column", () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" />)
    expect(screen.getByRole("button", { name: /render cut/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /mark ready/i })).toBeInTheDocument()
  })

  it("opens the detail panel (navigates) when Render cut is clicked — no hook-less render", async () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /render cut/i }))
    })
    // Routes to the panel (suggest-before-render) instead of firing a render here.
    expect(pushMock).toHaveBeenCalledWith("/admin/content/v1")
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/admin/content-studio/captioned-cut",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("PATCHes the videos endpoint when Mark ready is clicked", async () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /mark ready/i }))
    })
    expect(fetch).toHaveBeenCalledWith("/api/admin/videos/v1", expect.objectContaining({ method: "PATCH" }))
  })

  it("shows a render-failed badge and Retry render when renderFailed is set", () => {
    render(<VideoCard video={video} counts={null} column="needs_edit" renderFailed />)
    expect(screen.getByText(/render failed/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /retry render/i })).toBeInTheDocument()
  })

  it("shows an elapsed timer (no action buttons) in the rendering column", () => {
    render(<VideoCard video={video} counts={null} column="rendering" />)
    expect(screen.queryByRole("button", { name: /render cut/i })).toBeNull()
    expect(screen.getByText(/0:0\d/)).toBeInTheDocument()
  })

  it("anchors the rendering timer to renderStartedAt (survives remount, not 0:00)", () => {
    // 150s before now → ~2:30 elapsed regardless of when the component mounted.
    const startedAt = new Date(Date.now() - 150_000).toISOString()
    render(<VideoCard video={video} counts={null} column="rendering" renderStartedAt={startedAt} />)
    expect(screen.getByText(/2:\d\d/)).toBeInTheDocument()
    expect(screen.queryByText(/0:0\d/)).toBeNull()
  })

  it("shows a live RTDB progress bar when the worker is publishing progress", () => {
    ;(useRenderProgress as ReturnType<typeof vi.fn>).mockReturnValue({
      progress: 0.42,
      pct: 42,
      stage: "rendering",
      updatedAt: 1,
    })
    render(<VideoCard video={video} counts={null} column="rendering" renderJobId="job-1" />)
    expect(screen.getByText(/42%/)).toBeInTheDocument()
    const bar = screen.getByRole("progressbar")
    expect(bar).toHaveAttribute("aria-valuenow", "42")
  })

  it("renders the legacy card (single link, no action buttons) when column is omitted", () => {
    render(<VideoCard video={video} counts={null} />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/content/v1")
    expect(screen.queryByRole("button", { name: /render cut/i })).toBeNull()
  })
})
