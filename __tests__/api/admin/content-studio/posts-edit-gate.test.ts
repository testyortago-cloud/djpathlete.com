import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockCreate = vi.fn()
const mockDelete = vi.fn()
const mockAttach = vi.fn()
const mockGuard = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: (...a: unknown[]) => mockCreate(...a),
  deleteSocialPost: (...a: unknown[]) => mockDelete(...a),
}))
vi.mock("@/lib/db/social-post-media", () => ({
  attachMedia: (...a: unknown[]) => mockAttach(...a),
}))
vi.mock("@/lib/content-studio/feature-flag", () => ({
  isContentStudioMultimediaEnabled: () => true,
}))
vi.mock("@/lib/content-studio/edit-gate", () => ({
  assertSourceVideoPostable: (...a: unknown[]) => mockGuard(...a),
}))

import { POST } from "@/app/api/admin/content-studio/posts/route"

function call(body: unknown) {
  const req = new NextRequest("http://localhost/api/admin/content-studio/posts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
  return POST(req)
}

describe("POST /api/admin/content-studio/posts — edit gate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    mockGuard.mockResolvedValue({ ok: true })
  })

  it("downgrades a video post to draft when the source video is gated", async () => {
    mockGuard.mockResolvedValue({ ok: false, reason: "needs editing" })
    mockCreate.mockResolvedValue({ id: "post-1", approval_status: "draft" })

    const res = await call({ platform: "instagram", caption: "hi", source_video_id: "v1" })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ gated: true, approval_status: "draft" })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        approval_status: "draft",
        scheduled_at: null,
        source_video_id: "v1",
      }),
    )
  })

  it("keeps a video post approved when the source video is postable", async () => {
    mockCreate.mockResolvedValue({ id: "post-1", approval_status: "approved" })

    const res = await call({ platform: "instagram", caption: "hi", source_video_id: "v1" })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ gated: false })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "approved" }),
    )
  })

  it("clears scheduled_at when a scheduled video post is gated", async () => {
    mockGuard.mockResolvedValue({ ok: false, reason: "needs editing" })
    mockCreate.mockResolvedValue({ id: "post-1", approval_status: "draft" })
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const res = await call({
      platform: "instagram",
      caption: "hi",
      source_video_id: "v1",
      scheduled_at: future,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ gated: true, approval_status: "draft" })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "draft", scheduled_at: null }),
    )
  })
})
