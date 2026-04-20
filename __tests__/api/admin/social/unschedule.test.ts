import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (id: string) => getSocialPostByIdMock(id),
  updateSocialPost: (id: string, u: unknown) => updateSocialPostMock(id, u),
}))

import { POST } from "@/app/api/admin/social/posts/[id]/unschedule/route"

async function call(id: string) {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/unschedule`, { method: "POST" })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/social/posts/:id/unschedule", () => {
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

  it("returns 409 when post isn't scheduled", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "draft" })
    const res = await call("p1")
    expect(res.status).toBe(409)
  })

  it("flips scheduled → approved and clears scheduled_at", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "scheduled" })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "approved", scheduled_at: null })
    const res = await call("p1")
    expect(res.status).toBe(200)
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", {
      approval_status: "approved",
      scheduled_at: null,
    })
  })
})
