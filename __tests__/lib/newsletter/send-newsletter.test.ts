import { describe, it, expect, vi, beforeEach } from "vitest"

const getNewsletterByIdMock = vi.fn()
const updateNewsletterMock = vi.fn()
const buildNewsletterHtmlMock = vi.fn()
const firestoreSetMock = vi.fn()

vi.mock("@/lib/db/newsletters", () => ({
  getNewsletterById: (id: string) => getNewsletterByIdMock(id),
  updateNewsletter: (id: string, u: unknown) => updateNewsletterMock(id, u),
}))
vi.mock("@/lib/email", () => ({ buildNewsletterHtml: (c: string) => buildNewsletterHtmlMock(c) }))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ set: (d: unknown) => firestoreSetMock(d) }) }) }),
}))

import { sendNewsletterNow, NewsletterNotSendableError } from "@/lib/newsletter/send-newsletter"

const READY = { id: "n1", subject: "August round-up", content: "x".repeat(50), status: "scheduled" }

describe("sendNewsletterNow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getNewsletterByIdMock.mockResolvedValue(READY)
    updateNewsletterMock.mockResolvedValue(READY)
    buildNewsletterHtmlMock.mockReturnValue("<html/>")
    firestoreSetMock.mockResolvedValue(undefined)
  })

  it("refuses a newsletter that was already sent", async () => {
    getNewsletterByIdMock.mockResolvedValue({ ...READY, status: "sent" })
    await expect(sendNewsletterNow({ id: "n1", actorId: "a" })).rejects.toThrow(NewsletterNotSendableError)
    expect(firestoreSetMock).not.toHaveBeenCalled()
  })

  it("refuses a newsletter whose body is too short", async () => {
    // Re-checked here and not only at schedule time: a scheduled newsletter
    // stays editable, so it can be emptied after it was armed.
    getNewsletterByIdMock.mockResolvedValue({ ...READY, content: "hi" })
    await expect(sendNewsletterNow({ id: "n1", actorId: "a" })).rejects.toMatchObject({ code: "too_short" })
    expect(firestoreSetMock).not.toHaveBeenCalled()
  })

  it("marks the row sent BEFORE queuing the job", async () => {
    const order: string[] = []
    updateNewsletterMock.mockImplementation(async (_id, u) => {
      if ((u as { status?: string }).status === "sent") order.push("marked")
      return READY
    })
    firestoreSetMock.mockImplementation(async () => { order.push("queued") })
    await sendNewsletterNow({ id: "n1", actorId: "a" })
    expect(order).toEqual(["marked", "queued"])
  })

  it("clears the schedule bookkeeping as it sends", async () => {
    await sendNewsletterNow({ id: "n1", actorId: "a" })
    const [, updates] = updateNewsletterMock.mock.calls[0]
    expect(updates.scheduled_at).toBeNull()
    expect(updates.schedule_failed_reason).toBeNull()
  })

  it("queues the send job with the rendered html and the actor", async () => {
    await sendNewsletterNow({ id: "n1", actorId: "cron-actor" })
    const doc = firestoreSetMock.mock.calls[0][0]
    expect(doc.type).toBe("newsletter_send")
    expect(doc.status).toBe("pending")
    expect(doc.input).toMatchObject({ newsletterId: "n1", subject: "August round-up", html: "<html/>" })
    expect(doc.userId).toBe("cron-actor")
  })
})
