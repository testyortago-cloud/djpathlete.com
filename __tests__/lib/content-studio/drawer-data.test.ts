import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the DAL modules — we are testing shape + parallelism, not Supabase.
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: vi.fn(),
}))
vi.mock("@/lib/db/video-transcripts", () => ({
  getTranscriptForVideo: vi.fn(),
}))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: vi.fn(),
  listSocialPostsBySourceVideo: vi.fn(),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({
    bucket: () => ({
      file: () => ({
        getSignedUrl: async () => ["https://signed.example/preview.mp4"],
      }),
    }),
  }),
}))

import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { getSocialPostById, listSocialPostsBySourceVideo } from "@/lib/db/social-posts"
import { getDrawerData, getDrawerDataForPost } from "@/lib/content-studio/drawer-data"

const fixtureVideo = {
  id: "video-1",
  storage_path: "uploads/video-1.mp4",
  original_filename: "rotational-reboot-teaser.mp4",
  duration_seconds: 48,
  size_bytes: 12_340_000,
  mime_type: "video/mp4",
  title: "Rotational Reboot Teaser",
  uploaded_by: "user-1",
  status: "transcribed" as const,
  created_at: "2026-04-15T12:00:00Z",
  updated_at: "2026-04-15T12:01:00Z",
}

const fixtureTranscript = {
  id: "t-1",
  video_upload_id: "video-1",
  transcript_text: "Hey folks, in this clip we break down the rotational reboot drill...",
  language: "en",
  assemblyai_job_id: "aai-abc",
  analysis: null,
  source: "speech" as const,
  created_at: "2026-04-15T12:05:00Z",
}

const fixturePost = {
  id: "post-1",
  platform: "instagram" as const,
  content: "Stay rotational.",
  media_url: null,
  post_type: "video" as const,
  approval_status: "draft" as const,
  scheduled_at: null,
  published_at: null,
  source_video_id: "video-1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: "user-1",
  created_at: "2026-04-15T12:10:00Z",
  updated_at: "2026-04-15T12:10:00Z",
}

describe("getDrawerData", () => {
  beforeEach(() => {
    vi.mocked(getVideoUploadById).mockReset()
    vi.mocked(getTranscriptForVideo).mockReset()
    vi.mocked(listSocialPostsBySourceVideo).mockReset()
  })

  it("returns null when the video does not exist", async () => {
    vi.mocked(getVideoUploadById).mockResolvedValueOnce(null)
    const result = await getDrawerData("missing")
    expect(result).toBeNull()
  })

  it("returns video + previewUrl + transcript + posts when the video exists", async () => {
    vi.mocked(getVideoUploadById).mockResolvedValueOnce(fixtureVideo)
    vi.mocked(getTranscriptForVideo).mockResolvedValueOnce(fixtureTranscript)
    vi.mocked(listSocialPostsBySourceVideo).mockResolvedValueOnce([fixturePost])
    const result = await getDrawerData("video-1")
    expect(result).not.toBeNull()
    expect(result!.video!.id).toBe("video-1")
    expect(result!.previewUrl).toMatch(/^https:\/\/signed\.example/)
    expect(result!.transcript?.transcript_text).toContain("rotational")
    expect(result!.posts).toHaveLength(1)
    expect(result!.posts[0].id).toBe("post-1")
  })

  it("runs transcript and posts fetches in parallel", async () => {
    const order: string[] = []
    vi.mocked(getVideoUploadById).mockResolvedValueOnce(fixtureVideo)
    vi.mocked(getTranscriptForVideo).mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push("transcript")
      return fixtureTranscript
    })
    vi.mocked(listSocialPostsBySourceVideo).mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push("posts")
      return [fixturePost]
    })
    await getDrawerData("video-1")
    expect(order).toEqual(["posts", "transcript"])
  })
})

describe("getDrawerDataForPost", () => {
  beforeEach(() => {
    vi.mocked(getSocialPostById).mockReset()
    vi.mocked(getVideoUploadById).mockReset()
    vi.mocked(getTranscriptForVideo).mockReset()
    vi.mocked(listSocialPostsBySourceVideo).mockReset()
  })

  it("returns null when the post does not exist", async () => {
    vi.mocked(getSocialPostById).mockResolvedValueOnce(null)
    expect(await getDrawerDataForPost("missing")).toBeNull()
  })

  it("post-only mode when source_video_id is null", async () => {
    vi.mocked(getSocialPostById).mockResolvedValueOnce({
      ...fixturePost,
      source_video_id: null,
    })
    const result = await getDrawerDataForPost("post-1")
    expect(result).not.toBeNull()
    expect(result!.mode).toBe("post-only")
    expect(result!.posts).toHaveLength(1)
    expect(result!.video).toBeNull()
  })

  it("resolves to full video mode when source_video_id is set", async () => {
    vi.mocked(getSocialPostById).mockResolvedValueOnce(fixturePost)
    vi.mocked(getVideoUploadById).mockResolvedValueOnce(fixtureVideo)
    vi.mocked(getTranscriptForVideo).mockResolvedValueOnce(fixtureTranscript)
    vi.mocked(listSocialPostsBySourceVideo).mockResolvedValueOnce([fixturePost])
    const result = await getDrawerDataForPost("post-1")
    expect(result!.mode).toBe("video")
    expect(result!.video?.id).toBe("video-1")
  })

  it("falls back to post-only mode when the referenced source_video_id no longer exists", async () => {
    // Post references a video that has since been deleted.
    vi.mocked(getSocialPostById).mockResolvedValueOnce(fixturePost)
    vi.mocked(getVideoUploadById).mockResolvedValueOnce(null)
    const result = await getDrawerDataForPost("post-1")
    expect(result).not.toBeNull()
    expect(result!.mode).toBe("post-only")
    expect(result!.video).toBeNull()
    expect(result!.posts).toHaveLength(1)
    expect(result!.highlightPostId).toBe("post-1")
  })
})
