import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessAdminPathMock = vi.fn()
const getSettingMock = vi.fn()
const getBlogPostByIdMock = vi.fn()
const updateBlogPostMock = vi.fn()
const getNewsletterByIdMock = vi.fn()
const updateNewsletterMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: (u: unknown) => canAccessAdminPathMock(u) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (k: string, d: unknown) => getSettingMock(k, d) }))
vi.mock("@/lib/db/blog-posts", () => ({
  getBlogPostById: (id: string) => getBlogPostByIdMock(id),
  updateBlogPost: (id: string, u: unknown) => updateBlogPostMock(id, u),
}))
vi.mock("@/lib/db/newsletters", () => ({
  getNewsletterById: (id: string) => getNewsletterByIdMock(id),
  updateNewsletter: (id: string, u: unknown) => updateNewsletterMock(id, u),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (a: unknown) => recordAuditMock(a) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/indexnow", () => ({ submitUrlToIndexNow: vi.fn().mockResolvedValue(undefined) }))

import { POST as scheduleBlog } from "@/app/api/admin/blog/[id]/schedule/route"
import { POST as unscheduleBlog } from "@/app/api/admin/blog/[id]/unschedule/route"
import { POST as scheduleNewsletter } from "@/app/api/admin/newsletter/[id]/schedule/route"
import { PATCH as patchBlog } from "@/app/api/admin/blog/[id]/route"
import { PATCH as patchNewsletter } from "@/app/api/admin/newsletter/[id]/route"

const FUTURE = new Date(Date.now() + 3_600_000).toISOString()
const PAST = new Date(Date.now() - 3_600_000).toISOString()
const params = { params: Promise.resolve({ id: "x1" }) }

function req(body: unknown) {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }) as never
}

describe("content schedule routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    canAccessAdminPathMock.mockResolvedValue(true)
    getSettingMock.mockResolvedValue(true)
    getBlogPostByIdMock.mockResolvedValue({ id: "x1", status: "draft" })
    updateBlogPostMock.mockImplementation((id, u) => Promise.resolve({ id, ...u }))
    getNewsletterByIdMock.mockResolvedValue({ id: "x1", status: "draft", content: "x".repeat(50) })
    updateNewsletterMock.mockImplementation((id, u) => Promise.resolve({ id, ...u }))
  })

  it("rejects a signed-out caller", async () => {
    authMock.mockResolvedValue(null)
    const res = await scheduleBlog(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(401)
  })

  it("rejects a non-admin caller", async () => {
    canAccessAdminPathMock.mockResolvedValue(false)
    const res = await scheduleBlog(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(401)
  })

  it("rejects a time in the past", async () => {
    const res = await scheduleBlog(req({ scheduled_at: PAST }), params)
    expect(res.status).toBe(400)
  })

  it("rejects an unreadable time", async () => {
    const res = await scheduleBlog(req({ scheduled_at: "next tuesday-ish" }), params)
    expect(res.status).toBe(400)
  })

  it("rejects with a readable message while the checker is switched off", async () => {
    getSettingMock.mockResolvedValue(false)
    const res = await scheduleBlog(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/switched off/i)
  })

  it("refuses to schedule a post that is already published", async () => {
    getBlogPostByIdMock.mockResolvedValue({ id: "x1", status: "published" })
    const res = await scheduleBlog(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(409)
  })

  it("arms a draft post and records an audit row", async () => {
    const res = await scheduleBlog(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(200)
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.status).toBe("scheduled")
    expect(updates.scheduled_at).toBe(new Date(FUTURE).toISOString())
    expect(updates.schedule_failed_reason).toBeNull()
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "blog.scheduled" }))
  })

  it("unschedules back to draft and clears the time", async () => {
    getBlogPostByIdMock.mockResolvedValue({ id: "x1", status: "scheduled" })
    const res = await unscheduleBlog(req({}), params)
    expect(res.status).toBe(200)
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.status).toBe("draft")
    expect(updates.scheduled_at).toBeNull()
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "blog.schedule_cancelled" }),
    )
  })

  it("refuses to schedule a newsletter whose body is too short — at schedule time, not at 7am", async () => {
    getNewsletterByIdMock.mockResolvedValue({ id: "x1", status: "draft", content: "hi" })
    const res = await scheduleNewsletter(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/too short|more text/i)
  })

  it("refuses to schedule a newsletter that was already sent", async () => {
    getNewsletterByIdMock.mockResolvedValue({ id: "x1", status: "sent", content: "x".repeat(50) })
    const res = await scheduleNewsletter(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(409)
  })

  it("arms a draft newsletter", async () => {
    const res = await scheduleNewsletter(req({ scheduled_at: FUTURE }), params)
    expect(res.status).toBe(200)
    expect(updateNewsletterMock.mock.calls[0][1].status).toBe("scheduled")
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "newsletter.scheduled" }))
  })

  describe("editing an item clears a stale 'Missed' reason instead of leaving it stuck", () => {
    it("blog PATCH clears schedule_failed_reason on save", async () => {
      getBlogPostByIdMock.mockResolvedValue({ id: "x1", status: "draft", slug: "old-slug" })
      updateBlogPostMock.mockImplementation((id, u) => Promise.resolve({ id, slug: "old-slug", status: "draft", ...u }))
      const res = await patchBlog(req({ title: "Fixed the typo" }), params)
      expect(res.status).toBe(200)
      const [, updates] = updateBlogPostMock.mock.calls[0]
      expect(updates.schedule_failed_reason).toBeNull()
    })

    it("newsletter PATCH clears schedule_failed_reason on save", async () => {
      getNewsletterByIdMock.mockResolvedValue({ id: "x1", status: "draft", content: "x".repeat(50) })
      updateNewsletterMock.mockImplementation((id, u) => Promise.resolve({ id, ...u }))
      const res = await patchNewsletter(
        req({ subject: "Fixed subject", preview_text: "", content: "x".repeat(50) }),
        params,
      )
      expect(res.status).toBe(200)
      const [, updates] = updateNewsletterMock.mock.calls[0]
      expect(updates.schedule_failed_reason).toBeNull()
    })
  })
})
