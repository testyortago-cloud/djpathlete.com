import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockCreate = vi.fn()
const mockDelete = vi.fn()
const mockAttach = vi.fn()
const mockGetAsset = vi.fn()
const mockGetVideoUpload = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: (...args: unknown[]) => mockCreate(...args),
  deleteSocialPost: (...args: unknown[]) => mockDelete(...args),
}))
vi.mock("@/lib/db/social-post-media", () => ({
  attachMedia: (...args: unknown[]) => mockAttach(...args),
}))
vi.mock("@/lib/db/media-assets", () => ({
  getMediaAssetById: (...args: unknown[]) => mockGetAsset(...args),
}))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (...args: unknown[]) => mockGetVideoUpload(...args),
}))
vi.mock("@/lib/content-studio/feature-flag", () => ({
  isContentStudioMultimediaEnabled: () => true,
}))

describe("POST /api/admin/content-studio/posts — story path", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    mockCreate.mockResolvedValue({ id: "post-1", approval_status: "approved" })
    mockAttach.mockResolvedValue(undefined)
    mockDelete.mockResolvedValue(undefined)
    mockGetAsset.mockImplementation(async (id: string) => ({
      id,
      kind: "image",
      mime_type: "image/jpeg",
    }))
    mockGetVideoUpload.mockResolvedValue({ id: "video-1" })
  })

  async function call(body: unknown) {
    const { POST } = await import("@/app/api/admin/content-studio/posts/route")
    const req = new NextRequest("http://localhost/api/admin/content-studio/posts", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
    return POST(req)
  }

  it("creates a Story in draft status when no scheduled_at (lightweight pipeline)", async () => {
    const res = await call({
      platform: "instagram",
      caption: "",
      postType: "story",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        post_type: "story",
        approval_status: "draft",
      }),
    )
  })

  it("creates a Story in scheduled status when scheduled_at is provided", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const res = await call({
      platform: "instagram",
      caption: "",
      postType: "story",
      mediaAssetId: "asset-1",
      scheduled_at: future,
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        post_type: "story",
        approval_status: "scheduled",
        scheduled_at: future,
      }),
    )
  })

  it("creates a story post and attaches the asset", async () => {
    const res = await call({
      platform: "instagram",
      caption: "story caption that IG will ignore",
      postType: "story",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "instagram",
        post_type: "story",
        media_url: null,
        source_video_id: null,
      }),
    )
    expect(mockAttach).toHaveBeenCalledWith("post-1", "asset-1", 0)
  })

  it("accepts story on facebook", async () => {
    const res = await call({
      platform: "facebook",
      caption: "",
      postType: "story",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "facebook", post_type: "story" }),
    )
  })

  it("rejects story on linkedin (unsupported)", async () => {
    const res = await call({
      platform: "linkedin",
      caption: "x",
      postType: "story",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(400)
  })

  it("rejects story when asset is not an image", async () => {
    mockGetAsset.mockImplementation(async (id: string) => ({
      id,
      kind: "video",
      mime_type: "video/mp4",
    }))
    const res = await call({
      platform: "instagram",
      caption: "x",
      postType: "story",
      mediaAssetId: "video-asset",
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects IG story when asset is not JPEG", async () => {
    mockGetAsset.mockImplementation(async (id: string) => ({
      id,
      kind: "image",
      mime_type: "image/png",
    }))
    const res = await call({
      platform: "instagram",
      caption: "x",
      postType: "story",
      mediaAssetId: "png-asset",
    })
    expect(res.status).toBe(400)
  })

  it("rolls back the post when attachMedia fails", async () => {
    mockAttach.mockRejectedValueOnce(new Error("attach exploded"))
    const res = await call({
      platform: "instagram",
      caption: "x",
      postType: "story",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(500)
    expect(mockDelete).toHaveBeenCalledWith("post-1")
  })

  it("accepts a video story via source_video_id (no mediaAssetId)", async () => {
    mockGetVideoUpload.mockResolvedValue({ id: "video-1", storage_path: "videos/u/v.mp4" })
    const res = await call({
      platform: "instagram",
      caption: "",
      postType: "story",
      source_video_id: "video-1",
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        post_type: "story",
        source_video_id: "video-1",
      }),
    )
    // Video stories don't attach a media_asset; source_video_id drives resolution
    expect(mockAttach).not.toHaveBeenCalled()
  })

  it("rejects story with BOTH mediaAssetId and source_video_id", async () => {
    mockGetVideoUpload.mockResolvedValue({ id: "video-1" })
    const res = await call({
      platform: "instagram",
      caption: "",
      postType: "story",
      mediaAssetId: "asset-1",
      source_video_id: "video-1",
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects story with NEITHER mediaAssetId nor source_video_id", async () => {
    const res = await call({
      platform: "instagram",
      caption: "",
      postType: "story",
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects video story when source_video_id does not exist", async () => {
    mockGetVideoUpload.mockResolvedValue(null)
    const res = await call({
      platform: "instagram",
      caption: "",
      postType: "story",
      source_video_id: "missing-video",
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
