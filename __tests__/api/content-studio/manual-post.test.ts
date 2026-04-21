import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u-1", role: "admin" } })),
}))
const createMock = vi.fn()
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: (...args: unknown[]) => createMock(...args),
}))

import { POST } from "@/app/api/admin/content-studio/posts/route"

function req(body: unknown): Request {
  return new Request("http://localhost/api/admin/content-studio/posts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => createMock.mockReset())

describe("POST /api/admin/content-studio/posts", () => {
  it("rejects when platform missing", async () => {
    const res = await POST(req({ caption: "hi" }) as never)
    expect(res.status).toBe(400)
  })

  it("rejects when scheduled_at is in the past", async () => {
    const res = await POST(
      req({ platform: "instagram", caption: "hi", scheduled_at: "2020-01-01T00:00:00Z" }) as never,
    )
    expect(res.status).toBe(400)
  })

  it("creates a manual post with source_video_id=null", async () => {
    createMock.mockResolvedValueOnce({ id: "new-1", approval_status: "scheduled" })
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    const res = await POST(
      req({ platform: "instagram", caption: "hello world", scheduled_at: future }) as never,
    )
    expect(res.status).toBe(200)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "instagram",
        content: "hello world",
        source_video_id: null,
        approval_status: "scheduled",
      }),
    )
  })

  it("saves as 'approved' (unscheduled) when no scheduled_at provided", async () => {
    createMock.mockResolvedValueOnce({ id: "new-1", approval_status: "approved" })
    const res = await POST(req({ platform: "instagram", caption: "hello" }) as never)
    expect(res.status).toBe(200)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "approved", scheduled_at: null }),
    )
  })
})
