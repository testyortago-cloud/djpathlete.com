import { describe, it, expect, vi, beforeEach } from "vitest"

const getSocialPostWithMediaMock = vi.fn()
const findReelCutForVideoMock = vi.fn()
const getVideoUploadByIdMock = vi.fn()
const resolveMediaUrlMock = vi.fn()
const resolveStoryImageUrlMock = vi.fn()

vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostWithMedia: (id: string) => getSocialPostWithMediaMock(id),
}))
vi.mock("@/lib/db/social-post-media", () => ({
  findReelCutForVideo: (id: string) => findReelCutForVideoMock(id),
}))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (id: string) => getVideoUploadByIdMock(id),
}))
vi.mock("@/lib/social/resolve-media-url", () => ({
  resolveMediaUrl: (x: { media_url: string }) => resolveMediaUrlMock(x),
  resolveStoryImageUrl: (p: string) => resolveStoryImageUrlMock(p),
}))

import { resolveStoryMedia, storyVideoFor } from "@/lib/social/story-media"

const STORY = { id: "s1", source_video_id: null as string | null }

function attached(asset: Record<string, unknown> | null) {
  getSocialPostWithMediaMock.mockResolvedValue({ media: asset ? [{ position: 0, asset }] : [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveMediaUrlMock.mockImplementation(async (x: { media_url: string }) => `https://signed/${x.media_url}`)
  resolveStoryImageUrlMock.mockImplementation(async (p: string) => `https://signed/${p}.story.jpg`)
  findReelCutForVideoMock.mockResolvedValue(null)
})

describe("resolveStoryMedia", () => {
  it("posts an attached photo as a JPEG", async () => {
    attached({ kind: "image", storage_path: "images/u/gym.png", public_url: "images/u/gym.png", duration_ms: null })
    expect(await resolveStoryMedia(STORY)).toEqual({ url: "https://signed/images/u/gym.png.story.jpg" })
  })

  it("posts an attached video of 60 seconds or less", async () => {
    attached({ kind: "video", storage_path: "cuts/c.mp4", public_url: "cuts/c.mp4", duration_ms: 58_000 })
    expect(await resolveStoryMedia(STORY)).toEqual({ url: "https://signed/cuts/c.mp4" })
  })

  it("refuses an attached video over 60 seconds, naming its length", async () => {
    attached({ kind: "video", storage_path: "cuts/c.mp4", public_url: "cuts/c.mp4", duration_ms: 134_000 })
    const result = await resolveStoryMedia(STORY)
    expect(result).toEqual({ error: expect.stringContaining("2:14") })
    expect(resolveMediaUrlMock).not.toHaveBeenCalled()
  })

  it("uses the edited cut from the same video's Instagram reel, not the raw upload", async () => {
    attached(null)
    findReelCutForVideoMock.mockResolvedValue({ storage_path: "cuts/reel.mp4", duration_ms: 40_000 })
    expect(await resolveStoryMedia({ id: "s1", source_video_id: "v1" })).toEqual({
      url: "https://signed/cuts/reel.mp4",
    })
    expect(findReelCutForVideoMock).toHaveBeenCalledWith("v1")
    expect(getVideoUploadByIdMock).not.toHaveBeenCalled()
  })

  it("falls back to the original upload when no cut exists, and checks its length", async () => {
    attached(null)
    getVideoUploadByIdMock.mockResolvedValue({ storage_path: "videos/u/raw.mov", duration_seconds: 134 })
    expect(await resolveStoryMedia({ id: "s1", source_video_id: "v1" })).toEqual({
      error: expect.stringContaining("2:14"),
    })

    getVideoUploadByIdMock.mockResolvedValue({ storage_path: "videos/u/raw.mov", duration_seconds: 30 })
    expect(await resolveStoryMedia({ id: "s1", source_video_id: "v1" })).toEqual({
      url: "https://signed/videos/u/raw.mov",
    })
  })

  it("says so when the story has nothing to post", async () => {
    attached(null)
    expect(await resolveStoryMedia(STORY)).toEqual({ error: expect.stringContaining("no photo or video") })
  })
})

describe("storyVideoFor", () => {
  it("answers null for a photo story", async () => {
    attached({ kind: "image", storage_path: "images/u/gym.png", public_url: "images/u/gym.png", duration_ms: null })
    expect(await storyVideoFor(STORY)).toBeNull()
  })
})
