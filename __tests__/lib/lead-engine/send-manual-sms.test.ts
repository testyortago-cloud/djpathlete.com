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
// A real, VALID E.164 number. "+15551230000" (this suite's original fixture)
// fails libphonenumber's isValid() check — 555 is not an assigned NANP area
// code — so once sendManualSms normalises the phone it would be refused as
// unparseable and every test below would throw before reaching the
// behaviour under test.
const PHONE = "+12025550123"
// A national-format spelling of the SAME number, for the normalisation test.
const PHONE_NATIONAL = "(202) 555-0123"
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
        phone: PHONE,
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
      phone: PHONE,
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      appendOptOut: false,
    })
    expect(isSuppressed).toHaveBeenCalledWith(PHONE, BIZ)
  })

  it("checks suppression BEFORE configuration", async () => {
    // Both are wrong. The suppression error is the one that must surface —
    // an unconfigured business must never mask a suppressed number.
    isSuppressed.mockResolvedValue(true)
    await expect(
      sendManualSms({
        phone: PHONE,
        body: "hi",
        settings: UNCONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
      }),
    ).rejects.toThrow(SmsSuppressedError)
  })

  it("normalises a national-format number to E.164 before checking suppression", async () => {
    // The STOP webhook writes suppressions keyed on Twilio's E.164 `From`.
    // A caller passing "(202) 555-0123" must still be checked (and later
    // recorded) against "+12025550123" — otherwise a suppressed contact who
    // gets dialed in national format is never caught.
    await sendManualSms({
      phone: PHONE_NATIONAL,
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      appendOptOut: false,
    })
    expect(isSuppressed).toHaveBeenCalledWith(PHONE, BIZ)
  })

  it("propagates when the suppression check itself fails, rather than treating a broken check as a pass", async () => {
    // The dangerous regression this guards against: something like
    // `isSuppressed(...).catch(() => false)` would fail OPEN — a suppressed
    // contact becomes textable the moment the consent lookup has a bad day.
    isSuppressed.mockRejectedValue(new Error("consent lookup unavailable"))

    await expect(
      sendManualSms({
        phone: PHONE,
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
      }),
    ).rejects.toThrow(/consent lookup unavailable/)

    expect(global.fetch).not.toHaveBeenCalled()
    expect(insertSmsMessage).not.toHaveBeenCalled()
  })
})

describe("sendManualSms — configuration", () => {
  it("THROWS on an unconfigured business rather than returning a success shape", async () => {
    await expect(
      sendManualSms({
        phone: PHONE,
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
      phone: PHONE,
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
      phone: PHONE,
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
        phone: PHONE,
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
      phone: PHONE,
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
        phone: PHONE,
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

  it("does not report a delivered text as failed when recording it afterward fails", async () => {
    // Twilio has already accepted the message by this point. Losing the
    // local row must not surface as a send failure — that would report a
    // text that really went out as never sent, the mirror image of the
    // "record before rethrowing" failure mode above.
    insertSmsMessage.mockRejectedValue(new Error("db unavailable"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const out = await sendManualSms({
      phone: PHONE,
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      appendOptOut: false,
    })

    expect(out).toMatchObject({ messageId: null, providerMessageId: "SM123", text: "hi" })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe("sendManualSms — segment length", () => {
  it("refuses a message over 10 segments", async () => {
    await expect(
      sendManualSms({
        phone: PHONE,
        body: "a".repeat(1600),
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
      }),
    ).rejects.toThrow(/segment/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
