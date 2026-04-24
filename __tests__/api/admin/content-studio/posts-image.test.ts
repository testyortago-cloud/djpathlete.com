import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockCreate = vi.fn()
const mockDelete = vi.fn()
const mockAttach = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: (...args: unknown[]) => mockCreate(...args),
  deleteSocialPost: (...args: unknown[]) => mockDelete(...args),
}))
vi.mock("@/lib/db/social-post-media", () => ({
  attachMedia: (...args: unknown[]) => mockAttach(...args),
}))
vi.mock("@/lib/content-studio/feature-flag", () => ({
  isContentStudioMultimediaEnabled: () => true,
}))

describe("POST /api/admin/content-studio/posts — image path", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    mockCreate.mockResolvedValue({ id: "post-1", approval_status: "approved" })
    mockAttach.mockResolvedValue(undefined)
    mockDelete.mockResolvedValue(undefined)
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

  it("creates an image post and attaches the asset", async () => {
    const res = await call({
      platform: "instagram",
      caption: "hello",
      postType: "image",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "instagram",
        post_type: "image",
        content: "hello",
        media_url: null,
        source_video_id: null,
      }),
    )
    expect(mockAttach).toHaveBeenCalledWith("post-1", "asset-1", 0)
  })

  it("rejects image post without mediaAssetId", async () => {
    const res = await call({
      platform: "instagram",
      caption: "hello",
      postType: "image",
    })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects image post on linkedin (deferred to Phase 1c)", async () => {
    const res = await call({
      platform: "linkedin",
      caption: "hello",
      postType: "image",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(400)
  })

  it("rejects image post on tiktok (deferred to Phase 1d)", async () => {
    const res = await call({
      platform: "tiktok",
      caption: "hello",
      postType: "image",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(400)
  })

  it("still accepts video posts without postType (back-compat)", async () => {
    const res = await call({
      platform: "instagram",
      caption: "hello",
      source_video_id: "video-1",
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ source_video_id: "video-1" }),
    )
    expect(mockAttach).not.toHaveBeenCalled()
  })

  it("rolls back the post when attachMedia fails", async () => {
    mockAttach.mockRejectedValueOnce(new Error("attach exploded"))
    const res = await call({
      platform: "instagram",
      caption: "hello",
      postType: "image",
      mediaAssetId: "asset-1",
    })
    expect(res.status).toBe(500)
    expect(mockCreate).toHaveBeenCalledOnce()
    expect(mockDelete).toHaveBeenCalledWith("post-1")
  })
})

describe("POST /api/admin/content-studio/posts — multimedia flag off", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    vi.doMock("@/lib/content-studio/feature-flag", () => ({
      isContentStudioMultimediaEnabled: () => false,
    }))
    vi.resetModules()
  })

  it("rejects postType=image when the flag is off", async () => {
    const { POST } = await import("@/app/api/admin/content-studio/posts/route")
    const req = new NextRequest("http://localhost/api/admin/content-studio/posts", {
      method: "POST",
      body: JSON.stringify({
        platform: "instagram",
        caption: "hi",
        postType: "image",
        mediaAssetId: "a-1",
      }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
