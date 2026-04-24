import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (id: string) => getSocialPostByIdMock(id),
  updateSocialPost: (id: string, u: unknown) => updateSocialPostMock(id, u),
}))

import { POST } from "@/app/api/admin/social/posts/[id]/publish-now/route"

async function call(id: string) {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/publish-now`, { method: "POST" })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/social/posts/:id/publish-now", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
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

  it("returns 409 when source status is not approved or failed", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "draft" })
    const res = await call("p1")
    expect(res.status).toBe(409)
  })

  it("from approved: sets scheduled with past scheduled_at and clears rejection_notes", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "approved" })
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
      rejection_notes: "Invalid token",
    })
    updateSocialPostMock.mockResolvedValue({ id: "p2", approval_status: "scheduled" })
    const res = await call("p2")
    expect(res.status).toBe(200)
    const args = updateSocialPostMock.mock.calls[0]
    expect(args[1].approval_status).toBe("scheduled")
    expect(args[1].rejection_notes).toBeNull()
  })

  it("accepts draft status for Story posts (lightweight pipeline)", async () => {
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

  it("still rejects draft status for non-Story posts (normal flow unchanged)", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: "post-2",
      approval_status: "draft",
      post_type: "image",
      platform: "instagram",
    })

    const res = await call("post-2")
    expect(res.status).toBe(409)
    expect(updateSocialPostMock).not.toHaveBeenCalled()
  })
})
