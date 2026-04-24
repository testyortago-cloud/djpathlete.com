import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockCreate = vi.fn()
const mockDelete = vi.fn()
const mockAttach = vi.fn()
const mockGetAsset = vi.fn()

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
vi.mock("@/lib/content-studio/feature-flag", () => ({
  isContentStudioMultimediaEnabled: () => true,
}))

describe("POST /api/admin/content-studio/posts — carousel path", () => {
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

  it("creates a carousel post and attaches assets in order", async () => {
    const res = await call({
      platform: "instagram",
      caption: "3 slide carousel",
      postType: "carousel",
      mediaAssetIds: ["a-1", "a-2", "a-3"],
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "instagram",
        post_type: "carousel",
        content: "3 slide carousel",
        media_url: null,
        source_video_id: null,
      }),
    )
    expect(mockAttach).toHaveBeenCalledTimes(3)
    expect(mockAttach).toHaveBeenNthCalledWith(1, "post-1", "a-1", 0)
    expect(mockAttach).toHaveBeenNthCalledWith(2, "post-1", "a-2", 1)
    expect(mockAttach).toHaveBeenNthCalledWith(3, "post-1", "a-3", 2)
  })

  it("rejects carousel on non-supported platforms", async () => {
    const res = await call({
      platform: "linkedin",
      caption: "x",
      postType: "carousel",
      mediaAssetIds: ["a-1", "a-2"],
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects carousel with fewer than 2 assets", async () => {
    const res = await call({
      platform: "instagram",
      caption: "x",
      postType: "carousel",
      mediaAssetIds: ["only-one"],
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects carousel with more than 10 assets", async () => {
    const mediaAssetIds = Array.from({ length: 11 }, (_, i) => `a-${i}`)
    const res = await call({
      platform: "instagram",
      caption: "x",
      postType: "carousel",
      mediaAssetIds,
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects carousel when mediaAssetIds missing entirely", async () => {
    const res = await call({
      platform: "instagram",
      caption: "x",
      postType: "carousel",
    })
    expect(res.status).toBe(400)
  })

  it("rejects carousel when an asset does not exist", async () => {
    mockGetAsset.mockImplementation(async (id: string) =>
      id === "a-missing" ? null : { id, kind: "image", mime_type: "image/jpeg" },
    )
    const res = await call({
      platform: "instagram",
      caption: "x",
      postType: "carousel",
      mediaAssetIds: ["a-1", "a-missing", "a-3"],
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects carousel when an asset is not an image", async () => {
    mockGetAsset.mockImplementation(async (id: string) =>
      id === "a-2" ? { id, kind: "video", mime_type: "video/mp4" } : { id, kind: "image", mime_type: "image/jpeg" },
    )
    const res = await call({
      platform: "instagram",
      caption: "x",
      postType: "carousel",
      mediaAssetIds: ["a-1", "a-2", "a-3"],
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects IG carousel when an asset is not JPEG", async () => {
    mockGetAsset.mockImplementation(async (id: string) =>
      id === "a-2" ? { id, kind: "image", mime_type: "image/png" } : { id, kind: "image", mime_type: "image/jpeg" },
    )
    const res = await call({
      platform: "instagram",
      caption: "x",
      postType: "carousel",
      mediaAssetIds: ["a-1", "a-2", "a-3"],
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rolls back the post when a midway attachMedia fails", async () => {
    mockAttach.mockImplementation(async (_postId: string, assetId: string, _pos: number) => {
      if (assetId === "a-2") throw new Error("boom")
    })
    const res = await call({
      platform: "instagram",
      caption: "x",
      postType: "carousel",
      mediaAssetIds: ["a-1", "a-2", "a-3"],
    })
    expect(res.status).toBe(500)
    expect(mockDelete).toHaveBeenCalledWith("post-1")
  })
})
