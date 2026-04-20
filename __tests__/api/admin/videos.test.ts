// __tests__/api/admin/videos.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getAdminStorageMock = vi.fn()
const createVideoUploadMock = vi.fn()

vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => getAdminStorageMock(),
}))
vi.mock("@/lib/db/video-uploads", () => ({
  createVideoUpload: (input: unknown) => createVideoUploadMock(input),
}))

import { POST } from "@/app/api/admin/videos/route"

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/videos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/videos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "client-1", role: "client" } })
    const res = await POST(makeRequest({ filename: "a.mp4" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when filename missing", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("creates a video_uploads row and returns a signed upload URL", async () => {
    const fileMock = {
      getSignedUrl: vi.fn().mockResolvedValue(["https://storage.googleapis.com/signed-upload"]),
    }
    const bucketMock = { file: vi.fn().mockReturnValue(fileMock) }
    getAdminStorageMock.mockReturnValue({ bucket: () => bucketMock })

    createVideoUploadMock.mockResolvedValue({
      id: "upload-1",
      storage_path: "videos/admin-1/123-a.mp4",
      original_filename: "a.mp4",
      status: "uploaded",
    })

    const res = await POST(makeRequest({ filename: "a.mp4", contentType: "video/mp4", title: "Drill" }))
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.videoUploadId).toBe("upload-1")
    expect(body.uploadUrl).toBe("https://storage.googleapis.com/signed-upload")
    expect(body.storagePath).toMatch(/^videos\/admin-1\//)

    expect(createVideoUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        original_filename: "a.mp4",
        mime_type: "video/mp4",
        title: "Drill",
        status: "uploaded",
        uploaded_by: "admin-1",
      }),
    )

    expect(bucketMock.file).toHaveBeenCalledWith(expect.stringMatching(/^videos\/admin-1\//))
    expect(fileMock.getSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "write",
        contentType: "video/mp4",
      }),
    )
  })
})
