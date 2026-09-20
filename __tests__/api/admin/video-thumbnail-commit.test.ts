import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getVideoMock = vi.fn()
const updateMock = vi.fn()
const existsMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: async (u: { role?: string }) => u?.role === "admin" }))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (...a: unknown[]) => getVideoMock(...a),
  updateVideoUpload: (...a: unknown[]) => updateMock(...a),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({
    bucket: () => ({ file: () => ({ exists: existsMock, getSignedUrl: vi.fn().mockResolvedValue(["https://signed/put"]) }) }),
  }),
}))

import { PUT } from "@/app/api/admin/videos/[id]/thumbnail/route"

const STORAGE = "videos/u/clip.mp4"

function call(id: string, body: unknown) {
  const req = new Request(`http://localhost/api/admin/videos/${id}/thumbnail`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return PUT(req as never, { params: Promise.resolve({ id }) })
}

describe("PUT /api/admin/videos/[id]/thumbnail", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
    getVideoMock.mockResolvedValue({ id: "v1", storage_path: STORAGE })
    existsMock.mockResolvedValue([true])
    updateMock.mockResolvedValue({ id: "v1" })
  })

  it("401 for a non-admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    expect((await call("v1", { source: "frame", thumbnailPath: `${STORAGE}.thumb-custom-1.jpg` })).status).toBe(401)
  })

  it("commits a frame thumbnail once the blob is confirmed present", async () => {
    const path = `${STORAGE}.thumb-custom-1700000000000.jpg`
    const res = await call("v1", { source: "frame", thumbnailPath: path })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith("v1", { thumbnail_path: path, thumbnail_source: "frame" })
  })

  it("409s and writes NOTHING when the blob is missing", async () => {
    existsMock.mockResolvedValue([false])
    const res = await call("v1", { source: "frame", thumbnailPath: `${STORAGE}.thumb-custom-1.jpg` })
    expect(res.status).toBe(409)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("400s on a path belonging to a different video", async () => {
    const res = await call("v1", { source: "upload", thumbnailPath: "videos/someone-else/other.mp4.thumb-custom-1.jpg" })
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("400s on a traversal attempt that merely starts with the prefix", async () => {
    const res = await call("v1", { source: "upload", thumbnailPath: `${STORAGE}.thumb-custom-1.jpg/../../secrets.jpg` })
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("reverts to the auto path, deriving it server-side", async () => {
    const res = await call("v1", { source: "auto" })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith("v1", {
      thumbnail_path: `${STORAGE}.thumb.jpg`,
      thumbnail_source: "auto",
    })
  })

  it("409s on revert when the auto blob no longer exists, leaving the custom one alone", async () => {
    existsMock.mockResolvedValue([false])
    const res = await call("v1", { source: "auto" })
    expect(res.status).toBe(409)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("400s when source is absent", async () => {
    expect((await call("v1", {})).status).toBe(400)
  })
})
