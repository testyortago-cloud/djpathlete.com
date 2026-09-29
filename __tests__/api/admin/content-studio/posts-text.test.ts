import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockCreate = vi.fn()
const mockDelete = vi.fn()
const mockAttach = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/db/social-posts", () => ({
  createSocialPost: (...args: unknown[]) => mockCreate(...args),
  deleteSocialPost: (...args: unknown[]) => mockDelete(...args),
}))
vi.mock("@/lib/db/social-post-media", () => ({
  attachMedia: (...args: unknown[]) => mockAttach(...args),
}))
vi.mock("@/lib/content-studio/feature-flag", () => ({
  isContentStudioMultimediaEnabled: () => false,
}))
vi.mock("@/lib/content-studio/edit-gate", () => ({
  assertSourceVideoPostable: async () => ({ ok: true }),
}))

describe("POST /api/admin/content-studio/posts — text posts, multimedia flag off", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    mockCreate.mockResolvedValue({ id: "post-1", approval_status: "approved" })
    mockAttach.mockResolvedValue(undefined)
    mockDelete.mockResolvedValue(undefined)
  })

  async function call(body: unknown) {
    const { POST } = await import("@/app/api/admin/content-studio/posts/route")
    const req = new NextRequest("http://localhost/api/admin/content-studio/posts", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
    return POST(req)
  }

  it("creates a LinkedIn text post even though the flag is off", async () => {
    const res = await call({ platform: "linkedin", postType: "text", caption: "Hello" })
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "linkedin", post_type: "text", content: "Hello" }),
    )
  })

  it("rejects a text post with a blank caption", async () => {
    const res = await call({ platform: "linkedin", postType: "text", caption: "   " })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Write the post text first" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("still refuses text on a platform that does not support it", async () => {
    const res = await call({ platform: "instagram", postType: "text", caption: "Hi" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("instagram does not support text posts")
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("still guards media posts behind the flag", async () => {
    const res = await call({
      platform: "linkedin",
      postType: "image",
      mediaAssetId: "m1",
      caption: "x",
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Multimedia posts are disabled/)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
