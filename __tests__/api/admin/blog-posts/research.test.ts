import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createAiJobMock = vi.fn()
const getBlogPostByIdMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))
vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
}))

import { POST } from "@/app/api/admin/blog-posts/[id]/research/route"

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/blog-posts/bp-1/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function ctx(id = "bp-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/admin/blog-posts/[id]/research", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await POST(makeRequest({ topic: "t" }), ctx())
    expect(res.status).toBe(401)
  })

  it("returns 400 when topic is missing", async () => {
    const res = await POST(makeRequest({}), ctx())
    expect(res.status).toBe(400)
  })

  it("returns 400 when topic is empty string", async () => {
    const res = await POST(makeRequest({ topic: "   " }), ctx())
    expect(res.status).toBe(400)
  })

  it("returns 404 when blog post not found", async () => {
    const notFound = Object.assign(new Error("not found"), { code: "PGRST116" })
    getBlogPostByIdMock.mockRejectedValue(notFound)
    const res = await POST(makeRequest({ topic: "shoulder rehab" }), ctx())
    expect(res.status).toBe(404)
  })

  it("creates a tavily_research ai_job and returns 202 with jobId", async () => {
    getBlogPostByIdMock.mockResolvedValue({ id: "bp-1", title: "x" })
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })

    const res = await POST(makeRequest({ topic: "shoulder rehab" }), ctx())
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")

    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "tavily_research",
      userId: "admin-1",
      input: { topic: "shoulder rehab", blog_post_id: "bp-1" },
    })
  })
})
