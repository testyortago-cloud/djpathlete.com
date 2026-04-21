import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MetaTab } from "@/components/admin/content-studio/drawer/MetaTab"
import type { SocialPost, VideoTranscript, VideoUpload } from "@/types/database"

const video: VideoUpload = {
  id: "video-1",
  storage_path: "uploads/video-1.mp4",
  original_filename: "clip.mp4",
  duration_seconds: 42,
  size_bytes: 1_000_000,
  mime_type: "video/mp4",
  title: "Clip",
  uploaded_by: "user-1",
  status: "transcribed",
  created_at: "2026-04-15T10:00:00Z",
  updated_at: "2026-04-15T10:01:00Z",
}
const transcript: VideoTranscript = {
  id: "t-1",
  video_upload_id: "video-1",
  transcript_text: "hi",
  language: "en",
  assemblyai_job_id: "aai-xyz",
  analysis: null,
  source: "speech",
  created_at: "2026-04-15T10:05:00Z",
}
const failedPost: SocialPost = {
  id: "p-1",
  platform: "facebook",
  content: "oops",
  media_url: null,
  approval_status: "failed",
  scheduled_at: null,
  published_at: null,
  source_video_id: "video-1",
  rejection_notes: "FB API 403 — token expired",
  platform_post_id: null,
  created_by: "u",
  created_at: "2026-04-15T11:00:00Z",
  updated_at: "2026-04-15T11:01:00Z",
}

describe("<MetaTab>", () => {
  it("renders upload info", () => {
    render(<MetaTab video={video} transcript={transcript} posts={[]} />)
    expect(screen.getByText(/clip\.mp4/)).toBeInTheDocument()
    expect(screen.getByText(/uploads\/video-1\.mp4/)).toBeInTheDocument()
  })

  it("renders the AssemblyAI job id when available", () => {
    render(<MetaTab video={video} transcript={transcript} posts={[]} />)
    expect(screen.getByText(/aai-xyz/)).toBeInTheDocument()
  })

  it("surfaces publishing errors from failed posts", () => {
    render(<MetaTab video={video} transcript={transcript} posts={[failedPost]} />)
    expect(screen.getByText(/FB API 403 — token expired/)).toBeInTheDocument()
  })

  it("renders a 'no errors' line when no posts are failed", () => {
    render(<MetaTab video={video} transcript={transcript} posts={[]} />)
    expect(screen.getByText(/no publishing errors/i)).toBeInTheDocument()
  })

  it("works in post-only mode (no video)", () => {
    render(<MetaTab video={null} transcript={null} posts={[failedPost]} />)
    expect(screen.getByText(/no source video/i)).toBeInTheDocument()
  })
})
