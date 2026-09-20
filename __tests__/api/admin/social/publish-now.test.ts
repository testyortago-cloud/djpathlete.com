import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (id: string) => getSocialPostByIdMock(id),
  updateSocialPost: (id: string, u: unknown) => updateSocialPostMock(id, u),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: () => listPlatformConnectionsMock(),
}))

const guardMock = vi.fn()
const releaseMock = vi.fn()
vi.mock("@/lib/content-studio/edit-gate", () => ({
  assertSourceVideoPostable: (...a: unknown[]) => guardMock(...a),
  releaseSourceVideoForSend: (...a: unknown[]) => releaseMock(...a),
}))

import { POST } from "@/app/api/admin/social/posts/[id]/publish-now/route"

async function call(id: string) {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/publish-now`, { method: "POST" })
  return POST(req, { params: Promise.resolve({ id }) })
}

function withConnected(platforms: string[]) {
  listPlatformConnectionsMock.mockResolvedValue(
    platforms.map((p) => ({ plugin_name: p, status: "connected" })),
  )
}

describe("POST /api/admin/social/posts/:id/publish-now", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
    guardMock.mockResolvedValue({ ok: true })
    withConnected(["instagram", "facebook", "linkedin"])
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await call("p1")
    expect(res.status).toBe(401)
  })

  it("returns 404 when post missing", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await call("nope")
    expect(res.status).toBe(404)
  })

  it("returns 409 when status is published", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "published",
      platform: "instagram",
      post_type: "image",
    })
    const res = await call("p1")
    expect(res.status).toBe(409)
  })

  it("returns 409 when status is rejected", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "rejected",
      platform: "instagram",
      post_type: "image",
    })
    const res = await call("p1")
    expect(res.status).toBe(409)
  })

  it("returns 409 with a connect-platform message when the platform isn't connected", async () => {
    withConnected([])
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "instagram",
      post_type: "image",
    })
    const res = await call("p1")
    expect(res.status).toBe(409)
    expect(await res.text()).toMatch(/connect.+instagram/i)
  })

  it("auto-approves and publishes a draft post when the platform is connected", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "instagram",
      post_type: "image",
    })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "scheduled" })
    const res = await call("p1")
    expect(res.status).toBe(200)
    const args = updateSocialPostMock.mock.calls[0]
    expect(args[1].approval_status).toBe("scheduled")
    const scheduledAt = new Date(args[1].scheduled_at as string)
    expect(scheduledAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it("from approved: sets scheduled with past scheduled_at and clears rejection_notes", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "approved",
      platform: "instagram",
      post_type: "image",
    })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "scheduled" })
    const res = await call("p1")
    expect(res.status).toBe(200)
    const args = updateSocialPostMock.mock.calls[0]
    expect(args[0]).toBe("p1")
    expect(args[1].approval_status).toBe("scheduled")
    expect(args[1].rejection_notes).toBeNull()
    const scheduledAt = new Date(args[1].scheduled_at as string)
    expect(scheduledAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it("from failed: also transitions to scheduled, clearing rejection_notes", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: "p2",
      approval_status: "failed",
      platform: "instagram",
      post_type: "image",
      rejection_notes: "Invalid token",
    })
    updateSocialPostMock.mockResolvedValue({ id: "p2", approval_status: "scheduled" })
    const res = await call("p2")
    expect(res.status).toBe(200)
    const args = updateSocialPostMock.mock.calls[0]
    expect(args[1].approval_status).toBe("scheduled")
    expect(args[1].rejection_notes).toBeNull()
  })

  // Was: a 409 refusing until the video was marked ready. Publishing by hand IS
  // that release, so the route now clears the gate and carries on -- one switch.
  it("releases the edit gate instead of refusing, when the source video still needs editing", async () => {
    withConnected(["instagram"])
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "instagram",
      post_type: "video",
      source_video_id: "v1",
    })
    const res = await call("p1")

    expect(res.status).toBe(200)
    expect(releaseMock).toHaveBeenCalledWith("v1")
    expect(updateSocialPostMock).toHaveBeenCalled()
  })

  // Ordering invariant: the release is a WRITE, so it must sit after every
  // refusal. A publish that bounces on a missing connection must not leave the
  // video marked ready for a post that never went out.
  it("does NOT release the gate when the publish is refused for a missing connection", async () => {
    withConnected([])
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "instagram",
      post_type: "video",
      source_video_id: "v1",
    })
    const res = await call("p1")

    expect(res.status).toBe(409)
    expect(releaseMock).not.toHaveBeenCalled()
  })

  it("does not try to release a gate for a post with no source video", async () => {
    withConnected(["instagram"])
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "instagram",
      post_type: "video",
      source_video_id: null,
    })
    await call("p1")
    expect(releaseMock).toHaveBeenCalledWith(null)
  })

  it("accepts draft Story posts without a connection check (lightweight pipeline)", async () => {
    withConnected([])
    getSocialPostByIdMock.mockResolvedValue({
      id: "post-1",
      approval_status: "draft",
      post_type: "story",
      platform: "instagram",
    })
    updateSocialPostMock.mockResolvedValue({
      id: "post-1",
      approval_status: "scheduled",
      scheduled_at: new Date().toISOString(),
    })

    const res = await call("post-1")
    expect(res.status).toBe(200)
    expect(updateSocialPostMock).toHaveBeenCalledOnce()
    const patch = updateSocialPostMock.mock.calls[0][1]
    expect(patch.approval_status).toBe("scheduled")
  })
})
