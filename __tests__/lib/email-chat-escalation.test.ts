// The transcript email the chat assistant sends when it hands a conversation
// to a person.
//
// Two things here are load-bearing and neither is cosmetic:
//
//  1. Every line of this message is text an ANONYMOUS visitor typed into a
//     public box. It is rendered into HTML that lands in the operator's own
//     inbox, so it is escaped. Nothing else in this flow escapes it.
//  2. The function reports whether it actually delivered. The Resend wrapper
//     in lib/email.ts returns a success SHAPE when RESEND_API_KEY is unset,
//     so "it did not throw" is not the same as "somebody was told" — and the
//     caller uses that distinction to decide what the visitor is promised.
import { describe, it, expect, vi, beforeEach } from "vitest"

const sendMock = vi.fn()
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) }
    batch = { send: vi.fn() }
  },
}))

import { sendChatEscalationEmail } from "@/lib/email"

const base = {
  to: "coach@example.com",
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
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("sendChatEscalationEmail", () => {
  it("sends to the address it was handed and nowhere else", async () => {
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
