import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { VideoCard } from "@/components/admin/content-studio/pipeline/VideoCard"
import type { VideoUpload } from "@/types/database"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))
// Keep Firebase (pulled in by the RTDB progress hook) out of the component test.
vi.mock("@/hooks/use-render-progress", () => ({ useRenderProgress: vi.fn(() => null) }))

const baseVideo: VideoUpload = {
  id: "v1",
  storage_path: "u/v1.mp4",
  original_filename: "clip.mp4",
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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ jobId: "j1" }) }))
})

describe("VideoCard — transcribe action", () => {
  it("shows a Transcribe button in the uploaded column", () => {
    render(<VideoCard video={baseVideo} counts={null} column="uploaded" />)
    expect(screen.getByRole("button", { name: /transcribe/i })).toBeInTheDocument()
  })

  it("POSTs to the transcribe endpoint with the video id when clicked", async () => {
    render(<VideoCard video={baseVideo} counts={null} column="uploaded" />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /transcribe/i }))
    })
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/videos/transcribe",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("v1") }),
    )
  })

  it("shows a Retry button for a failed video (in the transcribing column)", () => {
    render(<VideoCard video={{ ...baseVideo, status: "failed" }} counts={null} column="transcribing" />)
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
  })

  it("shows no transcribe/retry button while a video is genuinely transcribing", () => {
    render(<VideoCard video={{ ...baseVideo, status: "transcribing" }} counts={null} column="transcribing" />)
    expect(screen.queryByRole("button", { name: /transcribe/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull()
  })
})
