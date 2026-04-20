import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createAiJobMock = vi.fn()
const getBlogPostByIdMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))
vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
}))

import { POST } from "@/app/api/admin/newsletter/generate-from-blog/route"

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/newsletter/generate-from-blog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/newsletter/generate-from-blog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await POST(makeRequest({ blog_post_id: "bp-1" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when blog_post_id missing", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("returns 404 when blog post not found", async () => {
    const notFound = Object.assign(new Error("not found"), { code: "PGRST116" })
    getBlogPostByIdMock.mockRejectedValue(notFound)
    const res = await POST(makeRequest({ blog_post_id: "bp-1" }))
    expect(res.status).toBe(404)
  })

  it("returns 202 and creates ai_job", async () => {
    getBlogPostByIdMock.mockResolvedValue({ id: "bp-1", title: "t" })
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })

    const res = await POST(makeRequest({ blog_post_id: "bp-1", tone: "conversational", length: "short" }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")

    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "newsletter_from_blog",
      userId: "admin-1",
      input: { blog_post_id: "bp-1", tone: "conversational", length: "short" },
    })
  })
})
