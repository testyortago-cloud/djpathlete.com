import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u", role: "admin" } })),
}))

const mockGetPost = vi.fn()
const mockUpdatePost = vi.fn()

vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (...args: unknown[]) => mockGetPost(...args),
  updateSocialPost: (...args: unknown[]) => mockUpdatePost(...args),
}))

import { POST } from "@/app/api/admin/content-studio/posts/[id]/status/route"

function req(body: unknown): Request {
  return new Request("http://localhost/api/admin/content-studio/posts/p1/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const basePost = {
  id: "p1",
  platform: "instagram",
  content: "x",
  media_url: null,
  approval_status: "draft" as const,
  scheduled_at: null,
  published_at: null,
  source_video_id: "v1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: null,
  created_at: "",
  updated_at: "",
}

describe("POST /api/admin/content-studio/posts/[id]/status", () => {
  beforeEach(() => {
    mockGetPost.mockReset()
    mockUpdatePost.mockReset()
  })

  it("rejects an unknown target column", async () => {
    const res = await POST(
      req({ targetColumn: "bogus" }) as never,
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(400)
  })

  it("needs_review → approved: updates approval_status=approved", async () => {
    mockGetPost.mockResolvedValueOnce(basePost)
    mockUpdatePost.mockResolvedValueOnce({ ...basePost, approval_status: "approved" })
    const res = await POST(
      req({ targetColumn: "approved" }) as never,
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(200)
    expect(mockUpdatePost).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ approval_status: "approved" }),
    )
  })

  it("approved → needs_review: moves back to draft", async () => {
    mockGetPost.mockResolvedValueOnce({ ...basePost, approval_status: "approved" })
    mockUpdatePost.mockResolvedValueOnce({ ...basePost, approval_status: "draft" })
    const res = await POST(
      req({ targetColumn: "needs_review" }) as never,
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(200)
    expect(mockUpdatePost).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ approval_status: "draft" }),
    )
  })

  it("rejects a drop directly into 'scheduled' (requires date picker)", async () => {
    mockGetPost.mockResolvedValueOnce({ ...basePost, approval_status: "approved" })
    const res = await POST(
      req({ targetColumn: "scheduled" }) as never,
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(409)
    expect(mockUpdatePost).not.toHaveBeenCalled()
  })

  it("rejects a drop into 'published' (server-side side effect only)", async () => {
    mockGetPost.mockResolvedValueOnce({ ...basePost, approval_status: "approved" })
    const res = await POST(
      req({ targetColumn: "published" }) as never,
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(409)
  })

  it("failed → needs_review: clears rejection_notes and scheduled_at", async () => {
    mockGetPost.mockResolvedValueOnce({
      ...basePost,
      approval_status: "failed",
      rejection_notes: "boom",
    })
    mockUpdatePost.mockResolvedValueOnce({
      ...basePost,
      approval_status: "draft",
      rejection_notes: null,
    })
    const res = await POST(
      req({ targetColumn: "needs_review" }) as never,
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(200)
    expect(mockUpdatePost).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        approval_status: "draft",
        rejection_notes: null,
      }),
    )
  })

  it("404 when the post does not exist", async () => {
    mockGetPost.mockResolvedValueOnce(null)
    const res = await POST(
      req({ targetColumn: "approved" }) as never,
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(404)
  })
})
