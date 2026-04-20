// __tests__/api/admin/social/approve.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (x: string) => getSocialPostByIdMock(x),
  updateSocialPost: (id: string, updates: unknown) => updateSocialPostMock(id, updates),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: () => listPlatformConnectionsMock(),
}))

import { POST } from "@/app/api/admin/social/posts/[id]/approve/route"

async function callApprove(id: string) {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/approve`, {
    method: "POST",
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/social/posts/:id/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("sets approval_status=approved when the platform is connected", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", platform: "instagram", approval_status: "draft" })
    listPlatformConnectionsMock.mockResolvedValue([
      { plugin_name: "instagram", status: "connected" },
      { plugin_name: "facebook", status: "not_connected" },
    ])
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "approved" })

    const res = await callApprove("p1")
    expect(res.status).toBe(200)
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", { approval_status: "approved" })
  })

  it("sets approval_status=awaiting_connection when the platform is not connected", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p2", platform: "facebook", approval_status: "draft" })
    listPlatformConnectionsMock.mockResolvedValue([
      { plugin_name: "instagram", status: "connected" },
      { plugin_name: "facebook", status: "not_connected" },
    ])
    updateSocialPostMock.mockResolvedValue({ id: "p2", approval_status: "awaiting_connection" })

    await callApprove("p2")
    expect(updateSocialPostMock).toHaveBeenCalledWith("p2", { approval_status: "awaiting_connection" })
  })

  it("returns 404 when the post doesn't exist", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await callApprove("nope")
    expect(res.status).toBe(404)
  })
})
