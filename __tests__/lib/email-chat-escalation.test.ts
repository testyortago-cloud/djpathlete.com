// The transcript email the chat assistant sends when it hands a conversation
// to a person.
//
// Two things here are load-bearing and neither is cosmetic:
//
//  1. Every line of this message is text an ANONYMOUS visitor typed into a
//     public box. It is rendered into HTML that lands in the operator's own
//     inbox, so it is escaped. Nothing else in this flow escapes it.
//  2. The function reports whether it actually delivered, and the caller uses
//     that flag to decide what the visitor is promised. Its own RESEND_API_KEY
//     check is what produces `{ delivered: false }`: the shared wrapper
//     reports a missing key as an `error`, which this sender's `if (error)`
//     arm would turn into a THROW, not into the flag.
//
// WHOSE identity it sends under is pinned next door, in
// __tests__/lib/email/lead-alerts.test.ts. This file is about the body.
import { describe, it, expect, vi, beforeEach } from "vitest"

const sendMock = vi.fn()
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) }
    batch = { send: vi.fn() }
  },
}))

const getBusinessSettings = vi.fn()
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: (...a: unknown[]) => getBusinessSettings(...a),
}))

import { sendChatEscalationEmail } from "@/lib/email"

/** A tenant whose `reply_to` is the mailbox this alert must reach. */
const SETTINGS = {
  business_id: "b0000000-0000-0000-0000-00000000000a",
  display_name: "Northfield Strength",
  sender_name: "Coach Priya",
  sender_email: "hello@northfieldstrength.test",
  reply_to: "coach@example.com",
  logo_url: null,
  timezone: "Europe/London",
  quiet_hours_start: 21,
  quiet_hours_end: 8,
  daily_message_cap: 50,
  postal_address: "4 Mill Lane, Northfield, NF1 2AB",
  sms_help_text: "",
  sms_messaging_service_sid: "",
  sms_sender_phone: "",
  brand_color: null,
  accent_color: null,
}

const base = {
  businessId: "b0000000-0000-0000-0000-00000000000a",
  conversationId: "11111111-1111-1111-1111-111111111111",
  summary: "Wants to know if there is a goalkeeper track",
  landingPath: "/programs",
  transcript: [
    { role: "user" as const, content: "Do you coach goalkeepers?", created_at: "2026-08-23T10:00:00.000Z" },
    { role: "assistant" as const, content: "Let me put you to a person.", created_at: "2026-08-23T10:00:04.000Z" },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.RESEND_API_KEY = "re_test"
  sendMock.mockResolvedValue({ data: { id: "e_1" }, error: null })
  getBusinessSettings.mockResolvedValue(SETTINGS)
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("sendChatEscalationEmail", () => {
  it("sends to the tenant's own reply_to and nowhere else", async () => {
    const out = await sendChatEscalationEmail(base)

    expect(out).toEqual({ delivered: true })
    const arg = sendMock.mock.calls[0][0]
    expect(arg.to).toBe("coach@example.com")
    // No CC to a hardcoded mailbox: the spec names ONE destination, the
    // operator's own reply-to, because that is the inbox they already read.
    expect(arg.cc).toBeUndefined()
  })

  it("carries both sides of the transcript in the body", async () => {
    await sendChatEscalationEmail(base)

    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("Do you coach goalkeepers?")
    expect(html).toContain("Let me put you to a person.")
    expect(html).toContain("Wants to know if there is a goalkeeper track")
  })

  it("escapes visitor text so typed markup cannot ride into the inbox", async () => {
    await sendChatEscalationEmail({
      ...base,
      summary: "<b>urgent</b>",
      transcript: [
        {
          role: "user",
          content: '<script>alert("x")</script><img src=x onerror=1>',
          created_at: "2026-08-23T10:00:00.000Z",
        },
      ],
    })

    const html = sendMock.mock.calls[0][0].html as string
    // The vector is the TAG, not the attribute text: `onerror=1` survives as
    // inert prose inside an escaped element, and asserting on it would be
    // asserting the wrong thing.
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("<b>urgent</b>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("&lt;img src=x onerror=1&gt;")
    expect(html).toContain("&lt;b&gt;urgent&lt;/b&gt;")
  })

  it("reports delivered:false without sending when the provider has no key", async () => {
    delete process.env.RESEND_API_KEY

    const out = await sendChatEscalationEmail(base)

    expect(out).toEqual({ delivered: false })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("throws when the provider rejects the send", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "rate limited" } })

    await expect(sendChatEscalationEmail(base)).rejects.toThrow(/chat escalation/i)
  })

  it("names the conversation in the subject so the reply can be traced back", async () => {
    await sendChatEscalationEmail(base)

    const subject = sendMock.mock.calls[0][0].subject as string
    expect(subject).toContain("11111111")
  })
})
