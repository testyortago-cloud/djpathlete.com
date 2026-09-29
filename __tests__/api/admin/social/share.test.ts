// POST /api/admin/social/share — "Share to LinkedIn" from a blog post or issue.
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  canAccessAdminPath: vi.fn(),
  createAiJob: vi.fn(),
  getBlogPostById: vi.fn(),
  getNewsletterById: vi.fn(),
  listPlatformConnections: vi.fn(),
  findOpenShareDraft: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: h.canAccessAdminPath }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: h.createAiJob }))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
vi.mock("@/lib/db/blog-posts", () => ({ getBlogPostById: h.getBlogPostById }))
vi.mock("@/lib/db/newsletters", () => ({ getNewsletterById: h.getNewsletterById }))
vi.mock("@/lib/db/platform-connections", () => ({ listPlatformConnections: h.listPlatformConnections }))
vi.mock("@/lib/db/social-posts", () => ({ findOpenShareDraft: h.findOpenShareDraft }))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/admin/social/share/route"

function call(body: unknown) {
  return POST(
    new NextRequest("https://example.test/api/admin/social/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  h.auth.mockReset()
  h.auth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  h.canAccessAdminPath.mockReset()
  h.canAccessAdminPath.mockResolvedValue(true)
  h.createAiJob.mockReset()
  h.createAiJob.mockResolvedValue({ jobId: "job-1", status: "pending" })
  h.getBlogPostById.mockReset()
  h.getBlogPostById.mockResolvedValue({ id: "b1", status: "published" })
  h.getNewsletterById.mockReset()
  h.getNewsletterById.mockResolvedValue({ id: "n1", status: "sent" })
  h.listPlatformConnections.mockReset()
  h.listPlatformConnections.mockResolvedValue([{ plugin_name: "linkedin", status: "connected" }])
  h.findOpenShareDraft.mockReset()
  h.findOpenShareDraft.mockResolvedValue(null)
})

describe("POST /api/admin/social/share", () => {
  it("queues a draft for a published blog post", async () => {
    const res = await call({ blogPostId: "b1" })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ jobId: "job-1" })
    expect(h.createAiJob).toHaveBeenCalledTimes(1)
    expect(h.createAiJob).toHaveBeenCalledWith({
      type: "social_agent_run",
      userId: "admin-1",
      input: {
        platform: "linkedin",
        blogPostId: "b1",
        siteUrl: "https://www.darrenjpaul.com",
        businessId: "platform-biz",
      },
    })
  })

  it("queues a draft for a sent newsletter, with no blogPostId key", async () => {
    const res = await call({ newsletterId: "n1" })
    expect(res.status).toBe(202)
    const input = h.createAiJob.mock.calls[0][0].input
    expect(input.newsletterId).toBe("n1")
    expect("blogPostId" in input).toBe(false)
  })

  it("queues a draft for a scheduled newsletter", async () => {
    h.getNewsletterById.mockResolvedValue({ id: "n1", status: "scheduled" })
    const res = await call({ newsletterId: "n1" })
    expect(res.status).toBe(202)
  })

  it("returns the existing open draft instead of queuing", async () => {
    h.findOpenShareDraft.mockResolvedValue({ id: "sp-9" })
    const res = await call({ blogPostId: "b1" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ existingPostId: "sp-9" })
    expect(h.createAiJob).not.toHaveBeenCalled()
  })

  it("refuses a draft blog post", async () => {
    h.getBlogPostById.mockResolvedValue({ id: "b1", status: "draft" })
    const res = await call({ blogPostId: "b1" })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "Only published posts can be shared" })
    expect(h.createAiJob).not.toHaveBeenCalled()
  })

  it("refuses a draft newsletter", async () => {
    h.getNewsletterById.mockResolvedValue({ id: "n1", status: "draft" })
    const res = await call({ newsletterId: "n1" })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "Only sent or scheduled issues can be shared" })
    expect(h.createAiJob).not.toHaveBeenCalled()
  })

  it.each([
    ["not_connected", [{ plugin_name: "linkedin", status: "not_connected" }]],
    ["absent", [{ plugin_name: "facebook", status: "connected" }]],
  ])("refuses when LinkedIn is %s", async (_label, rows) => {
    h.listPlatformConnections.mockResolvedValue(rows)
    const res = await call({ blogPostId: "b1" })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "Connect LinkedIn first (Platform connections)" })
    expect(h.createAiJob).not.toHaveBeenCalled()
  })

  it("refuses both ids and neither id", async () => {
    let res = await call({ blogPostId: "b1", newsletterId: "n1" })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Send blogPostId or newsletterId, not both" })
    res = await call({})
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Send blogPostId or newsletterId" })
    expect(h.createAiJob).not.toHaveBeenCalled()
  })

  it("404s an unknown blog post and an unknown newsletter", async () => {
    h.getBlogPostById.mockRejectedValue(new Error("not found"))
    let res = await call({ blogPostId: "nope" })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Blog post not found" })
    h.getNewsletterById.mockRejectedValue(new Error("not found"))
    res = await call({ newsletterId: "nope" })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Newsletter not found" })
    expect(h.createAiJob).not.toHaveBeenCalled()
  })

  it("401s without a session", async () => {
    h.auth.mockResolvedValueOnce(null)
    const res = await call({ blogPostId: "b1" })
    expect(res.status).toBe(401)
    expect(h.createAiJob).not.toHaveBeenCalled()
  })
})
