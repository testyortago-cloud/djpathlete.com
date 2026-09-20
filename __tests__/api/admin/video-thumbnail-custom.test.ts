import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getVideoMock = vi.fn()
const updateMock = vi.fn()
const getSignedUrlMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: async (u: { role?: string }) => u?.role === "admin" }))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (...a: unknown[]) => getVideoMock(...a),
  updateVideoUpload: (...a: unknown[]) => updateMock(...a),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({ bucket: () => ({ file: () => ({ getSignedUrl: getSignedUrlMock }) }) }),
}))

import { POST } from "@/app/api/admin/videos/[id]/thumbnail/custom/route"

function call(id: string, body: unknown) {
  const req = new Request(`http://localhost/api/admin/videos/${id}/thumbnail/custom`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return POST(req as never, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/videos/[id]/thumbnail/custom", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
    getVideoMock.mockResolvedValue({ id: "v1", storage_path: "videos/u/clip.mp4" })
    getSignedUrlMock.mockResolvedValue(["https://signed/put"])
  })

  it("401 for a non-admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    expect((await call("v1", { contentType: "image/jpeg" })).status).toBe(401)
  })

  it("404 when the video does not exist", async () => {
    getVideoMock.mockResolvedValueOnce(null)
    expect((await call("v1", { contentType: "image/jpeg" })).status).toBe(404)
  })

  it("400 for a disallowed content type", async () => {
    expect((await call("v1", { contentType: "application/pdf" })).status).toBe(400)
  })

  it("returns a unique path derived from the video's storage_path", async () => {
    const res = await call("v1", { contentType: "image/jpeg" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.uploadUrl).toBe("https://signed/put")
    expect(body.thumbnailPath).toMatch(/^videos\/u\/clip\.mp4\.thumb-custom-\d+\.jpg$/)
  })

  it("writes NOTHING to the row — the bytes have not landed yet", async () => {
    await call("v1", { contentType: "image/jpeg" })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("never hands out the auto thumbnail's path", async () => {
    const body = await (await call("v1", { contentType: "image/jpeg" })).json()
    expect(body.thumbnailPath).not.toBe("videos/u/clip.mp4.thumb.jpg")
  })
})
