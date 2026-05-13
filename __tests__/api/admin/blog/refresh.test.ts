import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const getBlogPostByIdMock = vi.fn()
const jobSetMock = vi.fn()
const jobDocMock = vi.fn(() => ({ id: "new-job-id", set: jobSetMock }))
const collectionMock = vi.fn(() => ({ doc: jobDocMock }))

vi.mock("@/lib/auth", () => ({ auth: authMock }))
vi.mock("@/lib/db/blog-posts", () => ({ getBlogPostById: getBlogPostByIdMock }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: collectionMock }),
}))
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  authMock.mockReset()
  getBlogPostByIdMock.mockReset()
  jobSetMock.mockReset()
  jobDocMock.mockClear()
  collectionMock.mockClear()
})

async function callRoute(id: string, body: object = {}) {
  const { POST } = await import("@/app/api/admin/blog/[id]/refresh/route")
  const req = new NextRequest(`https://example.test/api/admin/blog/${id}/refresh`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

describe("POST /api/admin/blog/[id]/refresh", () => {
  it("returns 403 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u", role: "client" } })
    const res = await callRoute("post-1")
    expect(res.status).toBe(403)
    expect(jobSetMock).not.toHaveBeenCalled()
  })

  it("returns 404 when the post doesn't exist", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin", role: "admin" } })
    getBlogPostByIdMock.mockRejectedValueOnce(new Error("not found"))
    const res = await callRoute("missing")
    expect(res.status).toBe(404)
    expect(jobSetMock).not.toHaveBeenCalled()
  })

  it("happy path: enqueues a blog_refresh job and returns 202", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-uuid", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValueOnce({
      id: "post-1",
      slug: "deadlift-tips",
      title: "Deadlift tips",
    })
    jobSetMock.mockResolvedValueOnce(undefined)

    const res = await callRoute("post-1", { triggerReason: "manual" })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toEqual({ jobId: "new-job-id", status: "pending" })

    const jobArg = jobSetMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(jobArg).toMatchObject({
      type: "blog_refresh",
      status: "pending",
      userId: "admin-uuid",
      triggeredBy: "manual_refresh_button",
    })
    expect((jobArg.input as Record<string, unknown>)).toMatchObject({
      blogPostId: "post-1",
      userId: "admin-uuid",
    })
  })

  it("accepts optional gscTopQueries in body and forwards them", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-uuid", role: "admin" } })
    getBlogPostByIdMock.mockResolvedValueOnce({ id: "post-1", slug: "x", title: "y" })
    jobSetMock.mockResolvedValueOnce(undefined)

    await callRoute("post-1", {
      triggerReason: "position_drop",
      gscTopQueries: ["squat depth", "ATG squat form"],
    })

    const jobArg = jobSetMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect((jobArg.input as Record<string, unknown>)).toMatchObject({
      references: { gscTopQueries: ["squat depth", "ATG squat form"] },
    })
  })
})
