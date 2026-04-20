import { describe, it, expect, vi, beforeEach } from "vitest"

const getVideoUploadByIdMock = vi.fn()
const getAdminStorageMock = vi.fn()

vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (id: string) => getVideoUploadByIdMock(id),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => getAdminStorageMock(),
}))

import { resolveMediaUrl } from "@/lib/social/resolve-media-url"

describe("resolveMediaUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the post.media_url when source_video_id is null", async () => {
    const url = await resolveMediaUrl({
      source_video_id: null,
      media_url: "https://example.com/pic.jpg",
    })
    expect(url).toBe("https://example.com/pic.jpg")
    expect(getVideoUploadByIdMock).not.toHaveBeenCalled()
  })

  it("signs a Firebase Storage URL for the linked video when source_video_id is set", async () => {
    getVideoUploadByIdMock.mockResolvedValue({
      id: "v1",
      storage_path: "videos/admin-1/123-drill.mp4",
    })
    const fileMock = {
      getSignedUrl: vi.fn().mockResolvedValue(["https://storage.googleapis.com/signed-read"]),
    }
    getAdminStorageMock.mockReturnValue({ bucket: () => ({ file: () => fileMock }) })

    const url = await resolveMediaUrl({ source_video_id: "v1", media_url: null })
    expect(url).toBe("https://storage.googleapis.com/signed-read")
    expect(fileMock.getSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "read",
        version: "v4",
      }),
    )
  })

  it("returns null when source_video_id points at a missing row and media_url is null", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)
    const url = await resolveMediaUrl({ source_video_id: "ghost", media_url: null })
    expect(url).toBeNull()
  })

  it("falls back to media_url if video signing fails", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", storage_path: "videos/broken.mp4" })
    getAdminStorageMock.mockImplementation(() => {
      throw new Error("bucket unreachable")
    })
    const url = await resolveMediaUrl({
      source_video_id: "v1",
      media_url: "https://fallback.example.com/pic.jpg",
    })
    expect(url).toBe("https://fallback.example.com/pic.jpg")
  })
})
