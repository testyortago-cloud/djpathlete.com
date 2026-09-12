// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock factories are hoisted above top-level `const`s, so the mocks these
// factories close over must themselves be created inside vi.hoisted() — a
// bare `const isSuppressed = vi.fn()` referenced below throws "Cannot access
// before initialization" (repo convention: see chat-escalate.test.ts's `h`).
const { isSuppressed, insertSmsMessage } = vi.hoisted(() => ({
  isSuppressed: vi.fn(),
  insertSmsMessage: vi.fn(),
}))

vi.mock("@/lib/db/contact-consents", () => ({ isSuppressed }))
vi.mock("@/lib/db/sms-messages", () => ({ insertSmsMessage }))

import { sendManualSms, SmsSuppressedError, SmsNotConfiguredError } from "@/lib/lead-engine/sms"
import type { BusinessSettings } from "@/lib/db/businesses"

const BIZ = "11111111-1111-1111-1111-111111111111"
const CONFIGURED = {
  sms_messaging_service_sid: "MGtest",
  sms_sender_phone: "",
} as unknown as BusinessSettings
const UNCONFIGURED = {
  sms_messaging_service_sid: "",
  sms_sender_phone: "",
} as unknown as BusinessSettings

beforeEach(() => {
  vi.resetAllMocks()
  isSuppressed.mockResolvedValue(false)
  insertSmsMessage.mockResolvedValue({ id: "m1" })
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC1")
  vi.stubEnv("TWILIO_MAIN_SID", "SK1")
  vi.stubEnv("TWILIO_CLIENT_SECRET", "secret")
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ sid: "SM123" }),
  }) as unknown as typeof fetch
})

describe("sendManualSms — suppression", () => {
  it("REFUSES a suppressed number and sends nothing", async () => {
    isSuppressed.mockResolvedValue(true)

    await expect(
      sendManualSms({
        phone: "+15551230000",
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
      }),
    ).rejects.toThrow(SmsSuppressedError)

    // The guard is worthless if the provider was still called.
    expect(global.fetch).not.toHaveBeenCalled()
    expect(insertSmsMessage).not.toHaveBeenCalled()
  })

  it("checks suppression against the normalised phone and this tenant", async () => {
    await sendManualSms({
      phone: "+15551230000",
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      appendOptOut: false,
    })
    expect(isSuppressed).toHaveBeenCalledWith("+15551230000", BIZ)
  })

  it("checks suppression BEFORE configuration", async () => {
    // Both are wrong. The suppression error is the one that must surface —
    // an unconfigured business must never mask a suppressed number.
    isSuppressed.mockResolvedValue(true)
    await expect(
      sendManualSms({
        phone: "+15551230000",
        body: "hi",
        settings: UNCONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
      }),
    ).rejects.toThrow(SmsSuppressedError)
  })
})

describe("sendManualSms — configuration", () => {
  it("THROWS on an unconfigured business rather than returning a success shape", async () => {
    await expect(
      sendManualSms({
        phone: "+15551230000",
        body: "hi",
        settings: UNCONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
      }),
    ).rejects.toThrow(SmsNotConfiguredError)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe("sendManualSms — the send", () => {
  it("sends with MessagingServiceSid, never From", async () => {
    await sendManualSms({
      phone: "+15551230000",
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      appendOptOut: false,
    })
    const body = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    expect(body).toContain("MessagingServiceSid=MGtest")
    expect(body).not.toContain("From=")
  })

  it("records the message with the provider sid and the sender", async () => {
    const out = await sendManualSms({
      phone: "+15551230000",
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      contactId: "c1",
      sentBy: "u1",
      appendOptOut: false,
    })

    expect(out).toMatchObject({ messageId: "m1", providerMessageId: "SM123", text: "hi" })
    expect(insertSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ,
        contactId: "c1",
        phone: "+15551230000",
        direction: "outbound",
        body: "hi",
        twilioSid: "SM123",
        status: "sent",
        sentBy: "u1",
      }),
    )
  })

  it("appends the opt-out sentence when told to, and sends THAT text", async () => {
    const out = await sendManualSms({
      phone: "+15551230000",
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      appendOptOut: true,
    })
    expect(out.text).toContain("Reply STOP to opt out")
    const body = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    // form encoding (application/x-www-form-urlencoded) uses "+" for spaces,
    // which plain decodeURIComponent does NOT turn back into " " — parse it
    // the same way the real form was built, via URLSearchParams.
    expect(new URLSearchParams(body).get("Body")).toContain("Reply STOP to opt out")
  })

  it("records a failed row rather than swallowing a provider error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 21610, message: "blocked" }),
    }) as unknown as typeof fetch

    await expect(
      sendManualSms({
        phone: "+15551230000",
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
      }),
    ).rejects.toThrow(/blocked/)

    expect(insertSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "21610" }),
    )
  })
})

describe("sendManualSms — segment length", () => {
  it("refuses a message over 10 segments", async () => {
    await expect(
      sendManualSms({
        phone: "+15551230000",
        body: "a".repeat(1600),
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
      }),
    ).rejects.toThrow(/segment/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
