import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getVideoMock = vi.fn()
const deleteVideoMock = vi.fn()
const listPostsMock = vi.fn()
const deletePostMock = vi.fn()
const blobDeleteMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (id: string) => getVideoMock(id),
  deleteVideoUpload: (id: string) => deleteVideoMock(id),
  updateVideoUpload: vi.fn(),
}))
vi.mock("@/lib/db/social-posts", () => ({
  listSocialPostsBySourceVideo: (id: string) => listPostsMock(id),
  deleteSocialPost: (id: string) => deletePostMock(id),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({ bucket: () => ({ file: () => ({ delete: blobDeleteMock }) }) }),
}))
vi.mock("@/lib/db/video-transcripts", () => ({ getTranscriptForVideo: vi.fn() }))

import { DELETE } from "@/app/api/admin/videos/[id]/route"

function call(id = "v1") {
  const req = new Request(`http://localhost/api/admin/videos/${id}`, { method: "DELETE" })
  return DELETE(req as never, { params: Promise.resolve({ id }) })
}

const post = (id: string, approval_status: string, platform_post_id: string | null = null, platform = "instagram") => ({
  id,
  approval_status,
  platform_post_id,
  platform,
})

describe("DELETE /api/admin/videos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
    getVideoMock.mockResolvedValue({ id: "v1", storage_path: "videos/u/v1.mp4" })
    blobDeleteMock.mockResolvedValue(undefined)
  })

  it("deletes the posts that have not gone out, keeps published ones, then the video", async () => {
    listPostsMock.mockResolvedValue([
      post("draft", "draft"),
      post("sched", "scheduled"),
      post("failed", "failed"),
      post("live", "published", "IG_1"),
    ])
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deletedPosts: 3, keptPublished: 1 })
    expect(deletePostMock.mock.calls.map((c) => c[0])).toEqual(["draft", "sched", "failed"])
    expect(deleteVideoMock).toHaveBeenCalledWith("v1")
  })

  // Deleting our row would not stop Facebook: it holds the post in its own queue.
  it("refuses while a post sits in Facebook's own schedule, and deletes nothing", async () => {
    listPostsMock.mockResolvedValue([
      { ...post("fb", "scheduled", "FB_1", "facebook"), scheduled_at: "2099-01-01T10:00:00Z" },
      post("draft", "draft"),
    ])
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain("Unschedule")
    expect(deletePostMock).not.toHaveBeenCalled()
    expect(deleteVideoMock).not.toHaveBeenCalled()
    expect(blobDeleteMock).not.toHaveBeenCalled()
  })

  // Nothing marks a Facebook-queued post "published" after it goes out. Once its time
  // has passed it is live: keep it, and never send the coach to "Unschedule" (which
  // deletes the post on Facebook).
  it("keeps a Facebook-queued post whose time has passed, and deletes the video", async () => {
    listPostsMock.mockResolvedValue([
      { ...post("fb-live", "scheduled", "FB_1", "facebook"), scheduled_at: "2026-01-01T10:00:00Z" },
      post("draft", "draft"),
    ])
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deletedPosts: 1, keptPublished: 1 })
    expect(deletePostMock.mock.calls.map((c) => c[0])).toEqual(["draft"])
    expect(deleteVideoMock).toHaveBeenCalledWith("v1")
  })

  it("stops before touching the video when a post delete fails", async () => {
    listPostsMock.mockResolvedValue([post("draft", "draft")])
    deletePostMock.mockRejectedValue(new Error("db down"))
    const res = await call()
    expect(res.status).toBe(500)
    expect(deleteVideoMock).not.toHaveBeenCalled()
    expect(blobDeleteMock).not.toHaveBeenCalled()
  })

  it("401 for a non-admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    expect((await call()).status).toBe(401)
  })
})
