import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  isCronSkipped: vi.fn(),
  createServiceRoleClient: vi.fn(() => ({})),
  logCronStart: vi.fn(async () => "run-1"),
  logCronEnd: vi.fn(async () => {}),
  listUnnotifiedMessages: vi.fn(),
  stampNotified: vi.fn(async () => {}),
  listConversationsForNotify: vi.fn(),
  sendNewMessageEmail: vi.fn(async () => ({ error: null })),
  getPreferences: vi.fn(),
  getUserById: vi.fn(),
}))

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: mocks.isCronSkipped }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: mocks.createServiceRoleClient }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: mocks.logCronStart, logCronEnd: mocks.logCronEnd }))
vi.mock("@/lib/db/messages", () => ({
  listUnnotifiedMessages: mocks.listUnnotifiedMessages,
  stampNotified: mocks.stampNotified,
}))
vi.mock("@/lib/db/conversations", () => ({ listConversationsForNotify: mocks.listConversationsForNotify }))
vi.mock("@/lib/messaging/email-new-message", () => ({ sendNewMessageEmail: mocks.sendNewMessageEmail }))
vi.mock("@/lib/db/notification-preferences", () => ({ getPreferences: mocks.getPreferences }))
vi.mock("@/lib/db/users", () => ({ getUserById: mocks.getUserById }))

import { POST } from "@/app/api/admin/internal/messaging-notify/route"

const CONV = "11111111-1111-4111-8111-111111111111"
const CLIENT = "33333333-3333-4333-8333-333333333333"

// Old enough that the five-minute delay has certainly elapsed, without pinning
// the clock: the route computes `now` itself.
const LONG_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString()

const conversation = (over = {}) => ({
  id: CONV,
  client_user_id: CLIENT,
  created_at: LONG_AGO,
  last_message_at: LONG_AGO,
  last_message_preview: "Hello",
  last_message_sender_role: "admin",
  client_last_read_at: null,
  admin_last_read_at: null,
  ...over,
})

const message = (over = {}) => ({
  id: "m1",
  conversation_id: CONV,
  sender_user_id: "admin-1",
  sender_role: "admin",
  body: "Hello",
  attachment_count: 0,
  created_at: LONG_AGO,
  email_notified_at: null,
  ...over,
})

function req(token = "secret-token") {
  return new NextRequest("http://localhost/api/admin/internal/messaging-notify", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = "secret-token"
  process.env.COACH_EMAIL = "coach@example.com"
  mocks.isCronSkipped.mockResolvedValue({ skipped: false })
  mocks.listUnnotifiedMessages.mockResolvedValue([message()])
  mocks.listConversationsForNotify.mockResolvedValue([conversation()])
  mocks.getPreferences.mockResolvedValue({ email_notifications: true })
  mocks.getUserById.mockResolvedValue({
    id: CLIENT,
    email: "client@example.com",
    first_name: "Sam",
    last_name: "Rivera",
  })
})

describe("POST /api/admin/internal/messaging-notify", () => {
  it("401 without the bearer token", async () => {
    const res = await POST(req("wrong-token"))
    expect(res.status).toBe(401)
    expect(mocks.logCronStart).not.toHaveBeenCalled()
  })

  it("skips entirely when the flag is off, without opening a cron run", async () => {
    mocks.isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "disabled" })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ skipped: "disabled" })
    expect(mocks.logCronStart).not.toHaveBeenCalled()
    expect(mocks.sendNewMessageEmail).not.toHaveBeenCalled()
  })

  it("emails the client and stamps the message", async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(mocks.sendNewMessageEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "client@example.com", recipientName: "Sam Rivera" }),
    )
    expect(mocks.stampNotified).toHaveBeenCalledWith(["m1"])
    expect(await res.json()).toMatchObject({ emailed: 1, stamped: 1 })
  })

  it("routes a client's message to the coach address", async () => {
    mocks.listUnnotifiedMessages.mockResolvedValueOnce([
      message({ sender_role: "client", sender_user_id: CLIENT }),
    ])
    await POST(req())
    expect(mocks.sendNewMessageEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "coach@example.com" }),
    )
  })

  it("stamps a message the recipient already read WITHOUT emailing", async () => {
    // Read after it was sent: the widget did its job, the email would be noise.
    mocks.listConversationsForNotify.mockResolvedValueOnce([
      conversation({ client_last_read_at: new Date().toISOString() }),
    ])
    const res = await POST(req())
    expect(mocks.sendNewMessageEmail).not.toHaveBeenCalled()
    expect(mocks.stampNotified).toHaveBeenCalledWith(["m1"])
    expect(await res.json()).toMatchObject({ emailed: 0, stamped: 1 })
  })

  it("skips an opted-out recipient but still stamps, so it is not reconsidered forever", async () => {
    mocks.getPreferences.mockResolvedValueOnce({ email_notifications: false })
    const res = await POST(req())
    expect(mocks.sendNewMessageEmail).not.toHaveBeenCalled()
    expect(mocks.stampNotified).toHaveBeenCalledWith(["m1"])
    expect(await res.json()).toMatchObject({ emailed: 0, stamped: 1 })
  })

  it("leaves a failed send UNSTAMPED so the next run retries it", async () => {
    mocks.sendNewMessageEmail.mockResolvedValueOnce({ error: "Resend exploded" })
    const res = await POST(req())
    expect(mocks.stampNotified).toHaveBeenCalledWith([])
    expect(res.status).toBe(200)
    expect((await res.json()).failures).toHaveLength(1)
    expect(mocks.logCronEnd).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      "failed",
      expect.objectContaining({ emailed: 0 }),
    )
  })

  it("does nothing when there is no eligible message", async () => {
    mocks.listUnnotifiedMessages.mockResolvedValueOnce([])
    const res = await POST(req())
    expect(await res.json()).toMatchObject({ emailed: 0, stamped: 0 })
    expect(mocks.sendNewMessageEmail).not.toHaveBeenCalled()
  })

  it("asks only for messages older than the delay", async () => {
    await POST(req())
    const [olderThan] = mocks.listUnnotifiedMessages.mock.calls[0]
    // A query without the delay would hand fresh messages to the selector and
    // rely entirely on it to hold them back.
    expect(Date.parse(olderThan as string)).toBeLessThanOrEqual(Date.now() - 5 * 60 * 1000)
  })
})
