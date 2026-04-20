import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getBlogPostByIdMock = vi.fn()
const updateBlogPostMock = vi.fn()
const createAiJobMock = vi.fn()
const sendBlogNewsletterToAllMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
  updateBlogPost: (id: string, u: unknown) => updateBlogPostMock(id, u),
}))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))
vi.mock("@/lib/email", () => ({ sendBlogNewsletterToAll: (x: unknown) => sendBlogNewsletterToAllMock(x) }))

import { POST } from "@/app/api/admin/blog/[id]/publish/route"

function ctx(id = "bp-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/admin/blog/[id]/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValue({ id: "bp-1", title: "t", published_at: null })
    updateBlogPostMock.mockResolvedValue({
      id: "bp-1", title: "t", slug: "t", excerpt: "e", category: "Performance", cover_image_url: null,
    })
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })
  })

  it("creates a newsletter_from_blog ai_job with the blog post id", async () => {
    const res = await POST(new Request("http://localhost/api/admin/blog/bp-1/publish", { method: "POST" }), ctx())
    expect(res.status).toBe(200)
    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "newsletter_from_blog",
      userId: "admin-1",
      input: { blog_post_id: "bp-1" },
    })
  })

  it("does NOT call the old sendBlogNewsletterToAll blast", async () => {
    await POST(new Request("http://localhost/api/admin/blog/bp-1/publish", { method: "POST" }), ctx())
    expect(sendBlogNewsletterToAllMock).not.toHaveBeenCalled()
  })

  it("returns 200 even when createAiJob throws (fire-and-forget)", async () => {
    createAiJobMock.mockRejectedValueOnce(new Error("firestore unavailable"))
    const res = await POST(new Request("http://localhost/api/admin/blog/bp-1/publish", { method: "POST" }), ctx())
    expect(res.status).toBe(200)
  })
})
