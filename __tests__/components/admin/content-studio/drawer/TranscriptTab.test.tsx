import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TranscriptTab } from "@/components/admin/content-studio/drawer/TranscriptTab"

const writeText = vi.fn()
Object.assign(navigator, { clipboard: { writeText } })

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

  it("renders the full transcript text", () => {
    render(<TranscriptTab transcript={base} />)
    expect(screen.getByText(/Hello world, this is a transcript\./)).toBeInTheDocument()
  })

  it("shows the Vision description badge when source is vision", () => {
    render(<TranscriptTab transcript={{ ...base, source: "vision" }} />)
    expect(screen.getByText(/Vision description/i)).toBeInTheDocument()
  })

  it("does not show the Vision badge for speech transcripts", () => {
    render(<TranscriptTab transcript={base} />)
    expect(screen.queryByText(/Vision description/i)).not.toBeInTheDocument()
  })

  it("copies the transcript text when Copy is clicked", () => {
    writeText.mockClear()
    render(<TranscriptTab transcript={base} />)
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }))
    expect(writeText).toHaveBeenCalledWith("Hello world, this is a transcript.")
  })

  it("renders an empty-state when transcript is null", () => {
    render(<TranscriptTab transcript={null} />)
    expect(screen.getByText(/No transcript yet/i)).toBeInTheDocument()
  })

  it("has a stubbed Regenerate button that shows a toast (no crash)", () => {
    render(<TranscriptTab transcript={base} />)
    const btn = screen.getByRole("button", { name: /regenerate/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
  })
})
