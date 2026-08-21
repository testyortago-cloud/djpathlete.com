import { describe, it, expect, vi, beforeEach } from "vitest"

const getBlogPostByIdMock = vi.fn()
const updateBlogPostMock = vi.fn()
const createAiJobMock = vi.fn()
const submitUrlToIndexNowMock = vi.fn()
const revalidatePathMock = vi.fn()
const calendarUpdateMock = vi.fn()

vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
  updateBlogPost: (id: string, u: unknown) => updateBlogPostMock(id, u),
}))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (j: unknown) => createAiJobMock(j) }))
vi.mock("@/lib/indexnow", () => ({ submitUrlToIndexNow: (u: string) => submitUrlToIndexNowMock(u) }))
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePathMock(p) }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({ update: (v: unknown) => ({ eq: (c: string, id: string) => calendarUpdateMock(v, c, id) }) }),
  }),
}))

import { publishBlogPost } from "@/lib/blog/publish-post"

describe("publishBlogPost", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBlogPostByIdMock.mockResolvedValue({ id: "p1", slug: "speed-work", published_at: null, author_id: "author-1" })
    updateBlogPostMock.mockImplementation((id, u) => Promise.resolve({ id, slug: "speed-work", ...u }))
    createAiJobMock.mockResolvedValue({ id: "job" })
    submitUrlToIndexNowMock.mockResolvedValue(undefined)
  })

  it("marks the post published and stamps published_at", async () => {
    await publishBlogPost({ id: "p1", actorId: "admin-1" })
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.status).toBe("published")
    expect(updates.published_at).toBeTruthy()
  })

  it("preserves an existing published_at rather than re-stamping it", async () => {
    getBlogPostByIdMock.mockResolvedValue({
      id: "p1", slug: "speed-work", published_at: "2026-01-01T00:00:00.000Z", author_id: "author-1",
    })
    await publishBlogPost({ id: "p1", actorId: "admin-1" })
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.published_at).toBe("2026-01-01T00:00:00.000Z")
  })

  it("clears any schedule bookkeeping as it publishes", async () => {
    await publishBlogPost({ id: "p1", actorId: "admin-1" })
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.scheduled_at).toBeNull()
    expect(updates.schedule_failed_reason).toBeNull()
  })

  it("queues both AI jobs under the supplied actor, not a session", async () => {
    await publishBlogPost({ id: "p1", actorId: "cron-actor" })
    const types = createAiJobMock.mock.calls.map((c) => c[0].type)
    expect(types).toContain("newsletter_from_blog")
    expect(types).toContain("seo_enhance")
    for (const call of createAiJobMock.mock.calls) expect(call[0].userId).toBe("cron-actor")
  })

  it("pings IndexNow and revalidates both blog paths", async () => {
    await publishBlogPost({ id: "p1", actorId: "admin-1" })
    expect(submitUrlToIndexNowMock).toHaveBeenCalledWith("/blog/speed-work")
    expect(revalidatePathMock).toHaveBeenCalledWith("/blog")
    expect(revalidatePathMock).toHaveBeenCalledWith("/blog/speed-work")
  })

  it("still resolves when a fire-and-forget side effect rejects", async () => {
    // These are best-effort. A dead IndexNow endpoint must not strand a post
    // as scheduled-but-unpublished at 7am with nobody watching.
    createAiJobMock.mockRejectedValue(new Error("queue down"))
    submitUrlToIndexNowMock.mockRejectedValue(new Error("indexnow down"))
    await expect(publishBlogPost({ id: "p1", actorId: "admin-1" })).resolves.toMatchObject({ id: "p1" })
    expect(updateBlogPostMock).toHaveBeenCalled()
  })
})
