import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { TranscriptTab } from "@/components/admin/content-studio/drawer/TranscriptTab"
import type { VideoUpload } from "@/types/database"

const writeText = vi.fn()
Object.assign(navigator, { clipboard: { writeText } })

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: () => ({
    status: "pending",
    text: "",
    chunks: [],
    analysis: null,
    programCreated: null,
    messageId: null,
    error: null,
    result: null,
    activeTools: [],
    reset: vi.fn(),
  }),
}))

describe("<TranscriptTab>", () => {
  const base = {
    id: "t-1",
    video_upload_id: "video-1",
    transcript_text: "Hello world, this is a transcript.",
    language: "en",
    assemblyai_job_id: "aai-1",
    analysis: null,
    source: "speech" as const,
    created_at: "2026-04-15T12:00:00Z",
  }

  const uploadedVideo: VideoUpload = {
    id: "video-1",
    storage_path: "videos/video-1.mp4",
    original_filename: "clip.mp4",
    title: "Clip",
    duration_seconds: 27,
    status: "uploaded",
    created_at: "2026-04-15T12:00:00Z",
    updated_at: "2026-04-15T12:00:00Z",
  } as unknown as VideoUpload

  it("renders the full transcript text", () => {
    render(<TranscriptTab transcript={base} video={null} />)
    expect(screen.getByText(/Hello world, this is a transcript\./)).toBeInTheDocument()
  })

  it("shows the Vision description badge when source is vision", () => {
    render(<TranscriptTab transcript={{ ...base, source: "vision" }} video={null} />)
    expect(screen.getByText(/Vision description/i)).toBeInTheDocument()
  })

  it("does not show the Vision badge for speech transcripts", () => {
    render(<TranscriptTab transcript={base} video={null} />)
    expect(screen.queryByText(/Vision description/i)).not.toBeInTheDocument()
  })

  it("copies the transcript text when Copy is clicked", () => {
    writeText.mockClear()
    render(<TranscriptTab transcript={base} video={null} />)
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }))
    expect(writeText).toHaveBeenCalledWith("Hello world, this is a transcript.")
  })

  it("renders an empty-state when transcript is null", () => {
    render(<TranscriptTab transcript={null} video={null} />)
    expect(screen.getByText(/No transcript yet/i)).toBeInTheDocument()
  })

  it("has a stubbed Regenerate button that shows a toast (no crash)", () => {
    render(<TranscriptTab transcript={base} video={null} />)
    const btn = screen.getByRole("button", { name: /regenerate/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
  })

  it("shows a Transcribe button in the empty state for an uploaded video", () => {
    render(<TranscriptTab transcript={null} video={uploadedVideo} />)
    expect(screen.getByRole("button", { name: /transcribe/i })).toBeInTheDocument()
  })

  it("POSTs to the transcribe API when Transcribe is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: "job-1" }),
      text: async () => "",
    })
    vi.stubGlobal("fetch", fetchMock)
    try {
      render(<TranscriptTab transcript={null} video={uploadedVideo} />)
      fireEvent.click(screen.getByRole("button", { name: /transcribe/i }))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe("/api/admin/videos/transcribe")
      expect(init.method).toBe("POST")
      expect(JSON.parse(init.body as string)).toEqual({ videoUploadId: "video-1" })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("shows a Transcribing spinner when video status is transcribing", () => {
    render(
      <TranscriptTab transcript={null} video={{ ...uploadedVideo, status: "transcribing" } as VideoUpload} />,
    )
    expect(screen.getByText(/Transcribing/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^transcribe$/i })).not.toBeInTheDocument()
  })

  it("shows a Retry button when the last transcription failed", () => {
    render(<TranscriptTab transcript={null} video={{ ...uploadedVideo, status: "failed" } as VideoUpload} />)
    expect(screen.getByText(/Last transcription failed/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /retry transcription/i })).toBeInTheDocument()
  })
})
