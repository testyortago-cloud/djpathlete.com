import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockGetSignedUrl = vi.fn()
const createMediaAssetMock = vi.fn()
const createAiJobMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({
    bucket: () => ({
      file: () => ({ getSignedUrl: mockGetSignedUrl }),
    }),
  }),
}))
vi.mock("@/lib/db/media-assets", () => ({
  createMediaAsset: (...args: unknown[]) => createMediaAssetMock(...args),
}))
vi.mock("@/lib/ai-jobs", () => ({
  createAiJob: (...args: unknown[]) => createAiJobMock(...args),
}))

async function POSTreq(body: unknown) {
  const { POST } = await import("@/app/api/admin/media-assets/upload-url/route")
  mockAuth.mockResolvedValue({ user: { id: "u-1", role: "admin" } })
  return POST(
    new NextRequest("http://localhost/api/admin/media-assets/upload-url", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  )
}

describe("POST /api/admin/media-assets/upload-url (video)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSignedUrl.mockResolvedValue(["https://signed.example/put"])
    createMediaAssetMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "asset-123",
      ...input,
    }))
    createAiJobMock.mockResolvedValue({ jobId: "job-xyz", status: "pending" })
  })

  it("accepts an MP4 as a video asset, under media-videos/, and skips the photo alt-text job", async () => {
    const res = await POSTreq({ filename: "drill.mp4", contentType: "video/mp4" })
    expect(res.status).toBe(201)
    expect(createMediaAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "video",
        mime_type: "video/mp4",
        storage_path: expect.stringMatching(/^media-videos\/u-1\/\d+-drill\.mp4$/),
      }),
    )
    expect(createAiJobMock).not.toHaveBeenCalled()
  })

  it("accepts a MOV (video/quicktime)", async () => {
    const res = await POSTreq({ filename: "drill.MOV", contentType: "video/quicktime" })
    expect(res.status).toBe(201)
  })

  it("still refuses other video types", async () => {
    const res = await POSTreq({ filename: "drill.webm", contentType: "video/webm" })
    expect(res.status).toBe(400)
    expect(createMediaAssetMock).not.toHaveBeenCalled()
  })

  it("refuses a mismatched name and type", async () => {
    const res = await POSTreq({ filename: "drill.jpg", contentType: "video/mp4" })
    expect(res.status).toBe(400)
  })

  it("photos are unchanged: kind image, images/ path, alt-text job queued", async () => {
    const res = await POSTreq({ filename: "a.png", contentType: "image/png" })
    expect(res.status).toBe(201)
    expect(createMediaAssetMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "image" }))
    expect(createAiJobMock).toHaveBeenCalledOnce()
  })
})
