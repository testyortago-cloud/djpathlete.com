import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockGetSignedUrl = vi.fn()
const mockCreateMediaAsset = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({
    bucket: () => ({
      file: () => ({ getSignedUrl: mockGetSignedUrl }),
    }),
  }),
}))
vi.mock("@/lib/db/media-assets", () => ({
  createMediaAsset: (...args: unknown[]) => mockCreateMediaAsset(...args),
}))

describe("POST /api/admin/media-assets/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSignedUrl.mockResolvedValue(["https://signed.example/put"])
    mockCreateMediaAsset.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "asset-123",
      ...input,
    }))
  })

  async function call(body: unknown, opts?: { role?: "admin" | "client" | null }) {
    const { POST } = await import("@/app/api/admin/media-assets/upload-url/route")
    mockAuth.mockResolvedValue(
      opts?.role === null
        ? null
        : { user: { id: "user-1", role: opts?.role ?? "admin" } },
    )
    const req = new NextRequest("http://localhost/api/admin/media-assets/upload-url", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
    return POST(req)
  }

  it("returns 401 for non-admin sessions", async () => {
    const res = await call({ filename: "x.jpg", contentType: "image/jpeg" }, { role: "client" })
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid payload (non-image)", async () => {
    const res = await call({ filename: "x.mp4", contentType: "video/mp4" })
    expect(res.status).toBe(400)
  })

  it("issues signed URL + creates media_asset row for a valid request", async () => {
    const res = await call({ filename: "photo.jpg", contentType: "image/jpeg" })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({
      mediaAssetId: "asset-123",
      uploadUrl: "https://signed.example/put",
      storagePath: expect.stringMatching(/^images\/user-1\/\d+-photo\.jpg$/),
    })
    expect(mockCreateMediaAsset).toHaveBeenCalledOnce()
    const call0 = mockCreateMediaAsset.mock.calls[0][0] as Record<string, unknown>
    expect(call0.kind).toBe("image")
    expect(call0.mime_type).toBe("image/jpeg")
    expect(call0.created_by).toBe("user-1")
  })
})
