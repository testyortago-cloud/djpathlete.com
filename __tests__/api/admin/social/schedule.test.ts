import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (id: string) => getSocialPostByIdMock(id),
  updateSocialPost: (id: string, updates: unknown) => updateSocialPostMock(id, updates),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: () => listPlatformConnectionsMock(),
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

function withConnected(platforms: string[]) {
  listPlatformConnectionsMock.mockResolvedValue(
    platforms.map((p) => ({ plugin_name: p, status: "connected" })),
  )
}

describe("POST /api/admin/social/posts/:id/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    withConnected(["instagram", "facebook", "linkedin"])
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
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "approved", platform: "instagram" })
    const res = await callSchedule("p1", { scheduled_at: pastTime })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("future")
  })

  it("returns 404 when the post is missing", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await callSchedule("nope", { scheduled_at: new Date(Date.now() + 60_000).toISOString() })
    expect(res.status).toBe(404)
  })

  it("returns 409 when the post is already published", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "published", platform: "instagram" })
    const res = await callSchedule("p1", { scheduled_at: new Date(Date.now() + 60_000).toISOString() })
    expect(res.status).toBe(409)
  })

  it("returns 409 when the post has been rejected", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "rejected", platform: "instagram" })
    const res = await callSchedule("p1", { scheduled_at: new Date(Date.now() + 60_000).toISOString() })
    expect(res.status).toBe(409)
  })

  it("returns 409 with a connect-platform message when the platform isn't connected", async () => {
    withConnected([])
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "draft", platform: "instagram" })
    const res = await callSchedule("p1", { scheduled_at: new Date(Date.now() + 60_000).toISOString() })
    expect(res.status).toBe(409)
    expect(await res.text()).toMatch(/connect.+instagram/i)
  })

  it("auto-approves and schedules a draft post when the platform is connected", async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "draft", platform: "instagram" })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "scheduled", scheduled_at: future })

    const res = await callSchedule("p1", { scheduled_at: future })
    expect(res.status).toBe(200)
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", {
      approval_status: "scheduled",
      scheduled_at: future,
    })
  })

  it("updates scheduled_at and status for an approved post", async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "approved", platform: "instagram" })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "scheduled", scheduled_at: future })

    const res = await callSchedule("p1", { scheduled_at: future })
    expect(res.status).toBe(200)
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", {
      approval_status: "scheduled",
      scheduled_at: future,
    })
  })

  it("allows rescheduling an already-scheduled post", async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "scheduled", platform: "instagram" })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "scheduled", scheduled_at: future })

    const res = await callSchedule("p1", { scheduled_at: future })
    expect(res.status).toBe(200)
  })
})
