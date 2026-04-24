import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockExtractQuotes = vi.fn()
const mockRenderCard = vi.fn()
const mockRenderJpeg = vi.fn()
const mockGetVideoUpload = vi.fn()
const mockGetTranscript = vi.fn()
const mockGetSignedUrl = vi.fn()
const mockStorageSave = vi.fn()
const mockCreateMediaAsset = vi.fn()
const mockCreateSocialPost = vi.fn()
const mockDeleteSocialPost = vi.fn()
const mockAttachMedia = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/content-studio/feature-flag", () => ({
  isContentStudioMultimediaEnabled: () => true,
}))
vi.mock("@/lib/ai/quote-extraction", () => ({
  extractQuotesFromTranscript: (...args: unknown[]) => mockExtractQuotes(...args),
}))
vi.mock("@/lib/content-studio/quote-card-renderer", () => ({
  renderQuoteCard: (...args: unknown[]) => mockRenderCard(...args),
  renderQuoteCardJpeg: (...args: unknown[]) => mockRenderJpeg(...args),
}))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (...args: unknown[]) => mockGetVideoUpload(...args),
}))
vi.mock("@/lib/db/video-transcripts", () => ({
  getTranscriptByVideoId: (...args: unknown[]) => mockGetTranscript(...args),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({
    bucket: () => ({
      file: () => ({
        save: mockStorageSave,
        getSignedUrl: mockGetSignedUrl,
      }),
    }),
  }),
}))
vi.mock("@/lib/db/media-assets", () => ({
  createMediaAsset: (...args: unknown[]) => mockCreateMediaAsset(...args),
}))
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: (...args: unknown[]) => mockCreateSocialPost(...args),
  deleteSocialPost: (...args: unknown[]) => mockDeleteSocialPost(...args),
}))
vi.mock("@/lib/db/social-post-media", () => ({
  attachMedia: (...args: unknown[]) => mockAttachMedia(...args),
}))

describe("POST /api/admin/content-studio/quote-cards", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    mockGetVideoUpload.mockResolvedValue({
      id: "video-1",
      storage_path: "videos/u/v1.mp4",
    })
    mockGetTranscript.mockResolvedValue({
      transcript_text:
        "A long transcript about power development and rotation that goes well past the fifty character minimum.",
    })
    mockExtractQuotes.mockImplementation(async (_text: string, count: number) => {
      const pool = [
        "Power is hip hinge plus speed.",
        "Rotation is where control lives.",
        "Train the pattern, not the muscle.",
        "Strength is a habit, not a mood.",
        "Move first. Load second.",
      ]
      return pool.slice(0, Math.min(count ?? pool.length, pool.length))
    })
    mockRenderCard.mockImplementation(async () =>
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
    )
    mockRenderJpeg.mockImplementation(async () =>
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
    )
    mockStorageSave.mockResolvedValue(undefined)
    let assetCounter = 0
    mockCreateMediaAsset.mockImplementation(async () => {
      assetCounter += 1
      return { id: `asset-${assetCounter}` }
    })
    mockCreateSocialPost.mockResolvedValue({
      id: "post-1",
      approval_status: "draft",
    })
    mockAttachMedia.mockResolvedValue(undefined)
  })

  async function call(body: unknown) {
    const { POST } = await import("@/app/api/admin/content-studio/quote-cards/route")
    const req = new NextRequest("http://localhost/api/admin/content-studio/quote-cards", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
    return POST(req)
  }

  it("returns 401 for non-admin", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "u", role: "client" } })
    const res = await call({ videoUploadId: "video-1" })
    expect(res.status).toBe(401)
  })

  it("returns 400 when videoUploadId is missing", async () => {
    const res = await call({})
    expect(res.status).toBe(400)
  })

  it("returns 404 when the video doesn't exist", async () => {
    mockGetVideoUpload.mockResolvedValueOnce(null)
    const res = await call({ videoUploadId: "missing" })
    expect(res.status).toBe(404)
  })

  it("returns 422 when the transcript is missing or empty", async () => {
    mockGetTranscript.mockResolvedValueOnce(null)
    const res = await call({ videoUploadId: "video-1" })
    expect(res.status).toBe(422)
  })

  it("returns 422 when Claude returns 0 quotes", async () => {
    mockExtractQuotes.mockResolvedValueOnce([])
    const res = await call({ videoUploadId: "video-1" })
    expect(res.status).toBe(422)
  })

  it("creates N media_assets + a draft FB carousel post with attached slides", async () => {
    const res = await call({ videoUploadId: "video-1", count: 3 })
    expect(res.status).toBe(200)

    // Rendered each quote once
    expect(mockRenderCard).toHaveBeenCalledTimes(3)

    // Saved each PNG to storage
    expect(mockStorageSave).toHaveBeenCalledTimes(3)

    // Created 3 media_assets rows with correct shape
    expect(mockCreateMediaAsset).toHaveBeenCalledTimes(3)
    const firstAssetCall = mockCreateMediaAsset.mock.calls[0][0]
    expect(firstAssetCall.kind).toBe("image")
    expect(firstAssetCall.mime_type).toBe("image/png")
    expect(firstAssetCall.derived_from_video_id).toBe("video-1")
    expect(firstAssetCall.ai_analysis).toMatchObject({ origin: "quote_card" })
    expect(typeof firstAssetCall.ai_analysis.quote).toBe("string")

    // Created exactly one social_posts row for FB carousel
    expect(mockCreateSocialPost).toHaveBeenCalledOnce()
    const postCall = mockCreateSocialPost.mock.calls[0][0]
    expect(postCall.platform).toBe("facebook")
    expect(postCall.post_type).toBe("carousel")
    expect(postCall.approval_status).toBe("draft")

    // Attached each asset at its position
    expect(mockAttachMedia).toHaveBeenCalledTimes(3)
    expect(mockAttachMedia).toHaveBeenNthCalledWith(1, "post-1", "asset-1", 0)
    expect(mockAttachMedia).toHaveBeenNthCalledWith(2, "post-1", "asset-2", 1)
    expect(mockAttachMedia).toHaveBeenNthCalledWith(3, "post-1", "asset-3", 2)

    // Body returns postId + asset list
    const body = await res.json()
    expect(body.postId).toBe("post-1")
    expect(body.mediaAssetIds).toEqual(["asset-1", "asset-2", "asset-3"])
  })

  it("rolls back the draft post when attachMedia fails", async () => {
    mockAttachMedia.mockImplementation(async (_p: string, assetId: string) => {
      if (assetId === "asset-2") throw new Error("boom")
    })
    const res = await call({ videoUploadId: "video-1", count: 3 })
    expect(res.status).toBe(500)
    expect(mockDeleteSocialPost).toHaveBeenCalledWith("post-1")
  })

  it("accepts platform=instagram, uses JPEG renderer, and creates an IG draft carousel", async () => {
    const res = await call({ videoUploadId: "video-1", count: 3, platform: "instagram" })
    expect(res.status).toBe(200)

    // Renderer: JPEG variant called, PNG variant not called
    expect(mockRenderJpeg).toHaveBeenCalledTimes(3)
    expect(mockRenderCard).not.toHaveBeenCalled()

    // Storage path ends in .jpg
    expect(mockStorageSave).toHaveBeenCalledTimes(3)
    const firstSaveArgs = mockStorageSave.mock.calls[0]
    // sharp-based renderer returns a buffer; first positional arg to save() is the buffer
    // second positional arg is options with contentType
    expect((firstSaveArgs[1] as { contentType: string }).contentType).toBe("image/jpeg")

    // Asset rows have image/jpeg mime_type
    const firstAssetCall = mockCreateMediaAsset.mock.calls[0][0] as { mime_type: string }
    expect(firstAssetCall.mime_type).toBe("image/jpeg")

    // Draft post created with platform=instagram
    const postCall = mockCreateSocialPost.mock.calls[0][0] as { platform: string; post_type: string }
    expect(postCall.platform).toBe("instagram")
    expect(postCall.post_type).toBe("carousel")
  })

  it("defaults to platform=facebook and uses PNG renderer", async () => {
    const res = await call({ videoUploadId: "video-1", count: 2 })
    expect(res.status).toBe(200)
    expect(mockRenderCard).toHaveBeenCalledTimes(2)
    expect(mockRenderJpeg).not.toHaveBeenCalled()
    const firstAssetCall = mockCreateMediaAsset.mock.calls[0][0] as { mime_type: string }
    expect(firstAssetCall.mime_type).toBe("image/png")
    const postCall = mockCreateSocialPost.mock.calls[0][0] as { platform: string }
    expect(postCall.platform).toBe("facebook")
  })

  it("accepts platform=linkedin, uses PNG renderer (LinkedIn accepts PNG carousels)", async () => {
    const res = await call({ videoUploadId: "video-1", count: 2, platform: "linkedin" })
    expect(res.status).toBe(200)
    expect(mockRenderCard).toHaveBeenCalledTimes(2)
    expect(mockRenderJpeg).not.toHaveBeenCalled()
    const postCall = mockCreateSocialPost.mock.calls[0][0] as { platform: string }
    expect(postCall.platform).toBe("linkedin")
  })

  it("rejects platform=youtube (not supported for carousels)", async () => {
    const res = await call({ videoUploadId: "video-1", platform: "youtube" })
    expect(res.status).toBe(400)
    expect(mockCreateSocialPost).not.toHaveBeenCalled()
  })
})
