import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getBlogPostByIdMock = vi.fn()
const updateBlogPostMock = vi.fn()
const createAiJobMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
  updateBlogPost: (id: string, u: unknown) => updateBlogPostMock(id, u),
}))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))

import { POST } from "@/app/api/admin/blog/[id]/publish/route"

function ctx(id = "bp-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/admin/blog/[id]/publish — SEO queue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValue({ id: "bp-1", title: "t", published_at: null })
    updateBlogPostMock.mockResolvedValue({ id: "bp-1", title: "t", slug: "t" })
    createAiJobMock.mockResolvedValue({ jobId: "job-x", status: "pending" })
  })

  it("queues both newsletter_from_blog and seo_enhance ai_jobs", async () => {
    await POST(new Request("http://localhost/api/admin/blog/bp-1/publish", { method: "POST" }), ctx())
    const calls = createAiJobMock.mock.calls.map((c) => c[0])
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "newsletter_from_blog", input: { blog_post_id: "bp-1" } }),
        expect.objectContaining({ type: "seo_enhance", input: { blog_post_id: "bp-1" } }),
      ]),
    )
  })

  it("publish returns 200 even when seo_enhance queue throws", async () => {
    createAiJobMock.mockImplementation((args: { type: string }) => {
      if (args.type === "seo_enhance") return Promise.reject(new Error("firestore down"))
      return Promise.resolve({ jobId: "n", status: "pending" })
    })
    const res = await POST(new Request("http://localhost/api/admin/blog/bp-1/publish", { method: "POST" }), ctx())
    expect(res.status).toBe(200)
  })
})
