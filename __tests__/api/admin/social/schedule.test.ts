import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (id: string) => getSocialPostByIdMock(id),
  updateSocialPost: (id: string, updates: unknown) => updateSocialPostMock(id, updates),
}))

import { POST } from "@/app/api/admin/social/posts/[id]/schedule/route"

async function callSchedule(id: string, body: unknown) {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/schedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/social/posts/:id/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await callSchedule("p1", { scheduled_at: new Date().toISOString() })
    expect(res.status).toBe(401)
  })

  it("returns 400 when scheduled_at is missing", async () => {
    const res = await callSchedule("p1", {})
    expect(res.status).toBe(400)
  })

  it("returns 400 when scheduled_at is in the past", async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "approved" })
    const res = await callSchedule("p1", { scheduled_at: pastTime })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("future")
  })

  it("returns 404 when the post is missing", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await callSchedule("nope", { scheduled_at: new Date(Date.now() + 60_000).toISOString() })
    expect(res.status).toBe(404)
  })

  it("returns 409 when the post isn't approved", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "draft" })
    const res = await callSchedule("p1", { scheduled_at: new Date(Date.now() + 60_000).toISOString() })
    expect(res.status).toBe(409)
  })

  it("updates scheduled_at and status for an approved post", async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "approved" })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "scheduled", scheduled_at: future })

    const res = await callSchedule("p1", { scheduled_at: future })
    expect(res.status).toBe(200)
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", {
      approval_status: "scheduled",
      scheduled_at: future,
    })
  })
})
