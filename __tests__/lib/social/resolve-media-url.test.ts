import { describe, it, expect, vi, beforeEach } from "vitest"

const getVideoUploadByIdMock = vi.fn()
const getAdminStorageMock = vi.fn()
const mockGetSignedUrl = vi.fn()

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
    mockGetSignedUrl.mockResolvedValue(["https://signed.example/read"])
    getAdminStorageMock.mockReturnValue({
      bucket: () => ({
        file: () => ({ getSignedUrl: mockGetSignedUrl }),
      }),
    })
    getVideoUploadByIdMock.mockResolvedValue({ storage_path: "videos/u/1.mp4" })
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

  it("returns null for text-only posts", async () => {
    const url = await resolveMediaUrl({ source_video_id: null, media_url: null })
    expect(url).toBeNull()
  })

  it("returns http media_url unchanged", async () => {
    const url = await resolveMediaUrl({
      source_video_id: null,
      media_url: "https://external.example/img.jpg",
    })
    expect(url).toBe("https://external.example/img.jpg")
  })

  it("signs a Firebase storage path stored in media_url", async () => {
    const url = await resolveMediaUrl({
      source_video_id: null,
      media_url: "images/user-1/1712345678-photo.jpg",
    })
    expect(url).toBe("https://signed.example/read")
    expect(mockGetSignedUrl).toHaveBeenCalledOnce()
  })

  it("prefers source_video_id when both set", async () => {
    const url = await resolveMediaUrl({
      source_video_id: "video-1",
      media_url: "images/whatever.jpg",
    })
    expect(url).toBe("https://signed.example/read")
  })
})
