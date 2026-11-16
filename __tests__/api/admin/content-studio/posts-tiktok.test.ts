import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockCreate = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: (...args: unknown[]) => mockCreate(...args),
  deleteSocialPost: vi.fn(),
}))
vi.mock("@/lib/db/social-post-media", () => ({ attachMedia: vi.fn() }))
vi.mock("@/lib/content-studio/feature-flag", () => ({
  isContentStudioMultimediaEnabled: () => false,
}))
vi.mock("@/lib/content-studio/edit-gate", () => ({
  assertSourceVideoPostable: async () => ({ ok: true }),
}))

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()

describe("POST /api/admin/content-studio/posts — TikTok is never queued at creation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    mockCreate.mockImplementation(async (input: { approval_status: string }) => ({
      id: "post-1",
      approval_status: input.approval_status,
    }))
  })

  async function call(body: unknown) {
    const { POST } = await import("@/app/api/admin/content-studio/posts/route")
    return POST(
      new NextRequest("http://localhost/api/admin/content-studio/posts", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    )
  }

  it("a TikTok post sent with scheduled_at is stored approved with no schedule", async () => {
    const res = await call({
      platform: "tiktok",
      postType: "video",
      caption: "Hi",
      source_video_id: "v1",
      scheduled_at: FUTURE,
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "tiktok", approval_status: "approved", scheduled_at: null }),
    )
    expect((await res.json()).approval_status).toBe("approved")
  })

  it("an Instagram post sent with scheduled_at is still scheduled", async () => {
    const res = await call({
      platform: "instagram",
      postType: "video",
      caption: "Hi",
      source_video_id: "v1",
      scheduled_at: FUTURE,
    })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "instagram", approval_status: "scheduled", scheduled_at: FUTURE }),
    )
  })
})
