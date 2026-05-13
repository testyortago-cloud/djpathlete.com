import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const getBlogPostByIdMock = vi.fn()
const supabaseFromMock = vi.fn()
const jobSetMock = vi.fn()
const jobDocMock = vi.fn(() => ({ id: "new-job-id", set: jobSetMock }))
const collectionMock = vi.fn(() => ({ doc: jobDocMock }))

vi.mock("@/lib/auth", () => ({ auth: authMock }))
vi.mock("@/lib/db/blog-posts", () => ({ getBlogPostById: getBlogPostByIdMock }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: supabaseFromMock }),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: collectionMock }),
}))
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  authMock.mockReset()
  getBlogPostByIdMock.mockReset()
  supabaseFromMock.mockReset()
  jobSetMock.mockReset()
  jobDocMock.mockClear()
})

async function callRoute(id: string) {
  const { POST } = await import("@/app/api/admin/blog/[id]/sweep-links/route")
  const req = new NextRequest(`https://example.test/api/admin/blog/${id}/sweep-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/blog/[id]/sweep-links", () => {
  it("returns 403 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u", role: "client" } })
    const res = await callRoute("post-1")
    expect(res.status).toBe(403)
    expect(jobSetMock).not.toHaveBeenCalled()
  })

  it("returns 404 when target post is missing", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin", role: "admin" } })
    getBlogPostByIdMock.mockRejectedValueOnce(new Error("not found"))
    const res = await callRoute("missing")
    expect(res.status).toBe(404)
  })

  it("returns 409 when no candidates score >= 1", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValueOnce({
      id: "post-1",
      title: "Target",
      slug: "target",
      tags: ["unique-tag-no-others-share"],
      category: "Performance",
    })
    // Candidates have NO tag overlap and DIFFERENT category → score=0 each.
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          neq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: [
                    { id: "c1", title: "C1", slug: "c1", tags: ["other"], category: "Recovery" },
                    { id: "c2", title: "C2", slug: "c2", tags: ["another"], category: "Recovery" },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      }),
    }))
    const res = await callRoute("post-1")
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/no candidate/i) })
  })

  it("happy path: scores candidates, enqueues job with top 5 ids, returns 202", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-uuid", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValueOnce({
      id: "target-1",
      title: "Target",
      slug: "target",
      tags: ["deadlift", "strength"],
      category: "Performance",
    })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          neq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: [
                    { id: "c1", title: "C1", slug: "c1", tags: ["deadlift", "strength"], category: "Performance" },
                    { id: "c2", title: "C2", slug: "c2", tags: ["deadlift"], category: "Recovery" },
                    { id: "c3", title: "C3", slug: "c3", tags: ["unrelated"], category: "Recovery" },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      }),
    }))
    jobSetMock.mockResolvedValueOnce(undefined)

    const res = await callRoute("target-1")
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toMatchObject({ jobId: "new-job-id", candidateCount: 2 })

    const jobArg = jobSetMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(jobArg).toMatchObject({
      type: "internal_link_sweep",
      status: "pending",
      userId: "admin-uuid",
      triggeredBy: "manual_sweep_button",
    })
    const inp = jobArg.input as { targetBlogPostId: string; candidateAnchorPostIds: string[] }
    expect(inp.targetBlogPostId).toBe("target-1")
    // c1 (score=5) before c2 (score=2); c3 excluded.
    expect(inp.candidateAnchorPostIds).toEqual(["c1", "c2"])
  })
})
