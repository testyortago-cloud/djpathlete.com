import { describe, it, expect, vi, beforeEach } from "vitest"

const listScheduledBlogPostsMock = vi.fn()
const listScheduledNewslettersMock = vi.fn()
const updateBlogPostMock = vi.fn()
const updateNewsletterMock = vi.fn()
const publishBlogPostMock = vi.fn()
const sendNewsletterNowMock = vi.fn()
const isCronSkippedMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/db/blog-posts", () => ({
  listScheduledBlogPosts: () => listScheduledBlogPostsMock(),
  updateBlogPost: (id: string, u: unknown) => updateBlogPostMock(id, u),
}))
vi.mock("@/lib/db/newsletters", () => ({
  listScheduledNewsletters: () => listScheduledNewslettersMock(),
  updateNewsletter: (id: string, u: unknown) => updateNewsletterMock(id, u),
}))
vi.mock("@/lib/blog/publish-post", () => ({ publishBlogPost: (a: unknown) => publishBlogPostMock(a) }))
vi.mock("@/lib/newsletter/send-newsletter", () => ({
  sendNewsletterNow: (a: unknown) => sendNewsletterNowMock(a),
  NewsletterNotSendableError: class extends Error {},
}))
vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: (a: unknown) => isCronSkippedMock(a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (a: unknown) => recordAuditMock(a) }))

import { runContentSchedule } from "@/lib/content-schedule/run-due"

const NOW = new Date("2026-08-21T12:00:00.000Z")
const DUE = "2026-08-21T11:55:00.000Z"
const LONG_AGO = "2026-08-18T12:00:00.000Z"

describe("runContentSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isCronSkippedMock.mockResolvedValue({ skipped: false })
    listScheduledBlogPostsMock.mockResolvedValue([])
    listScheduledNewslettersMock.mockResolvedValue([])
    publishBlogPostMock.mockResolvedValue({ id: "b1", slug: "s", published_at: NOW.toISOString() })
    sendNewsletterNowMock.mockResolvedValue({ id: "n1", queued: true })
  })

  it("does nothing at all when the flag is off — and does not mark anything missed", async () => {
    // Critical: a switched-off checker must not consume the backlog by
    // declaring it missed. The rows have to survive the flag being flipped on.
    isCronSkippedMock.mockResolvedValue({ skipped: true, reason: "disabled" })
    const out = await runContentSchedule({ now: NOW })
    expect(out.skipped).toBe("disabled")
    expect(listScheduledBlogPostsMock).not.toHaveBeenCalled()
    expect(listScheduledNewslettersMock).not.toHaveBeenCalled()
    expect(updateBlogPostMock).not.toHaveBeenCalled()
  })

  it("publishes a due blog post through the shared publish path", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([{ id: "b1", scheduled_at: DUE, author_id: "author-1" }])
    const out = await runContentSchedule({ now: NOW })
    expect(publishBlogPostMock).toHaveBeenCalledWith({ id: "b1", actorId: "author-1" })
    expect(out.published).toBe(1)
    expect(out.considered).toBe(1)
  })

  it("sends a due newsletter through the shared send path", async () => {
    listScheduledNewslettersMock.mockResolvedValue([{ id: "n1", scheduled_at: DUE, author_id: "author-2" }])
    const out = await runContentSchedule({ now: NOW })
    expect(sendNewsletterNowMock).toHaveBeenCalledWith({ id: "n1", actorId: "author-2" })
    expect(out.sent).toBe(1)
  })

  it("leaves a not-yet-due item alone", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([
      { id: "b1", scheduled_at: "2026-08-21T18:00:00.000Z", author_id: "a" },
    ])
    const out = await runContentSchedule({ now: NOW })
    expect(publishBlogPostMock).not.toHaveBeenCalled()
    expect(out.published).toBe(0)
    expect(out.missed).toBe(0)
  })

  it("returns a long-overdue post to draft with a reason instead of publishing it", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([{ id: "b1", scheduled_at: LONG_AGO, author_id: "a" }])
    const out = await runContentSchedule({ now: NOW })
    expect(publishBlogPostMock).not.toHaveBeenCalled()
    expect(out.missed).toBe(1)
    const [id, updates] = updateBlogPostMock.mock.calls[0]
    expect(id).toBe("b1")
    expect(updates.status).toBe("draft")
    expect(updates.scheduled_at).toBeNull()
    expect(updates.schedule_failed_reason).toMatch(/missed/i)
  })

  it("returns a long-overdue newsletter to draft rather than surprising subscribers", async () => {
    listScheduledNewslettersMock.mockResolvedValue([{ id: "n1", scheduled_at: LONG_AGO, author_id: "a" }])
    const out = await runContentSchedule({ now: NOW })
    expect(sendNewsletterNowMock).not.toHaveBeenCalled()
    expect(out.missed).toBe(1)
    expect(updateNewsletterMock.mock.calls[0][1].status).toBe("draft")
  })

  it("isolates a failure — one bad item does not stop the rest of the batch", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([
      { id: "b1", scheduled_at: DUE, author_id: "a" },
      { id: "b2", scheduled_at: DUE, author_id: "a" },
    ])
    publishBlogPostMock.mockRejectedValueOnce(new Error("boom"))
    const out = await runContentSchedule({ now: NOW })
    expect(out.failed).toBe(1)
    expect(out.published).toBe(1)
  })

  it("returns a failed post to draft with the error as its reason", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([{ id: "b1", scheduled_at: DUE, author_id: "a" }])
    publishBlogPostMock.mockRejectedValue(new Error("supabase unreachable"))
    await runContentSchedule({ now: NOW })
    const [, updates] = updateBlogPostMock.mock.calls[0]
    expect(updates.status).toBe("draft")
    expect(updates.schedule_failed_reason).toMatch(/supabase unreachable/)
  })

  it("does NOT revert a newsletter whose send threw after the row was marked sent", async () => {
    // sendNewsletterNow marks sent before queuing. If the queue throws, the
    // row may already say sent — reverting it to draft would risk a second
    // send of the same newsletter to the whole list.
    listScheduledNewslettersMock.mockResolvedValue([{ id: "n1", scheduled_at: DUE, author_id: "a" }])
    sendNewsletterNowMock.mockRejectedValue(new Error("firestore down"))
    const out = await runContentSchedule({ now: NOW })
    expect(out.failed).toBe(1)
    expect(updateNewsletterMock).not.toHaveBeenCalled()
  })

  it("counts both kinds in one run", async () => {
    listScheduledBlogPostsMock.mockResolvedValue([{ id: "b1", scheduled_at: DUE, author_id: "a" }])
    listScheduledNewslettersMock.mockResolvedValue([{ id: "n1", scheduled_at: DUE, author_id: "a" }])
    const out = await runContentSchedule({ now: NOW })
    expect(out).toMatchObject({ considered: 2, published: 1, sent: 1, missed: 0, failed: 0 })
  })
})
