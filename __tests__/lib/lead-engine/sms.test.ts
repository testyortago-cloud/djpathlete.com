// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { BusinessSettings } from "@/lib/db/businesses"
import {
  assertSmsSendable,
  renderSequenceSms,
  sendRenderedSequenceSms,
  smsConfigured,
  smsEnvPresent,
  SmsNotConfiguredError,
  SMS_OPT_OUT_SENTENCE,
} from "@/lib/lead-engine/sms"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const baseSettings: BusinessSettings = {
  business_id: "00000000-0000-0000-0000-000000000001",
  display_name: "Acme Fitness",
  sender_name: "Acme Team",
  sender_email: "hello@acme.test",
  reply_to: "support@acme.test",
  logo_url: null,
  timezone: "America/New_York",
  quiet_hours_start: 8,
  quiet_hours_end: 21,
  daily_message_cap: 3,
  postal_address: "123 Acme Way, Springfield, IL 62704",
  sms_help_text: "Reply STOP to unsubscribe",
  sms_messaging_service_sid: "",
  sms_sender_phone: "",
}

beforeEach(() => {
  mockFetch.mockReset()
  process.env.TWILIO_ACCOUNT_SID = "AC_test_account"
  process.env.TWILIO_MAIN_SID = "SK_test_key"
  process.env.TWILIO_CLIENT_SECRET = "test_secret"
})

afterEach(() => {
  delete process.env.TWILIO_ACCOUNT_SID
  delete process.env.TWILIO_MAIN_SID
  delete process.env.TWILIO_CLIENT_SECRET
  vi.restoreAllMocks()
})

describe("SMS_OPT_OUT_SENTENCE", () => {
  it("is the exact house wording", () => {
    expect(SMS_OPT_OUT_SENTENCE).toBe("Reply STOP to opt out, HELP for help.")
  })
})

describe("renderSequenceSms", () => {
  it("appends the opt-out sentence exactly once, after a blank line", () => {
    const { text } = renderSequenceSms({ body: "See you at 6am!", contactName: null })
    expect(text).toBe("See you at 6am!\n\n" + SMS_OPT_OUT_SENTENCE)
    // Exactly once — a naive implementation could double-append on re-render
    // or a template that itself contains the sentence.
    const occurrences = text.split(SMS_OPT_OUT_SENTENCE).length - 1
    expect(occurrences).toBe(1)
  })

  it("substitutes {{name}} when a contact name is present", () => {
    const { text } = renderSequenceSms({ body: "Hey {{name}}, ready?", contactName: "Priya" })
    expect(text).toBe("Hey Priya, ready?\n\n" + SMS_OPT_OUT_SENTENCE)
  })

  it("falls back to an empty string with no double-space artifact when there is no name", () => {
    const { text } = renderSequenceSms({ body: "Hey {{name}}, ready?", contactName: null })
    // "Hey {{name}}, ready?" -> "Hey , ready?" — the fallback is an empty
    // string spliced in place, not a removed token, so the space before the
    // comma survives exactly as written in the template.
    expect(text).toBe("Hey , ready?\n\n" + SMS_OPT_OUT_SENTENCE)
    expect(text).not.toMatch(/\{\{\s*name\s*\}\}/)
  })

  it("trims a whitespace/CRLF-carrying name and strips embedded newlines", () => {
    const { text } = renderSequenceSms({
      body: "Hi {{name}}!",
      contactName: "  \n Priya \r\n ",
    })
    expect(text).toBe("Hi Priya!\n\n" + SMS_OPT_OUT_SENTENCE)
  })

  it("is pure — the same inputs always render the same text", () => {
    const a = renderSequenceSms({ body: "Body {{name}}", contactName: "Sam" })
    const b = renderSequenceSms({ body: "Body {{name}}", contactName: "Sam" })
    expect(a).toEqual(b)
  })
})

describe("smsConfigured", () => {
  it("is false when both sid and phone are blank", () => {
    expect(smsConfigured(baseSettings)).toBe(false)
  })

  it("is false when both are whitespace-only", () => {
    expect(smsConfigured({ ...baseSettings, sms_messaging_service_sid: "   ", sms_sender_phone: "   " })).toBe(false)
  })

  it("is true when only the messaging service sid is set", () => {
    expect(smsConfigured({ ...baseSettings, sms_messaging_service_sid: "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" })).toBe(
      true,
    )
  })

  it("is true when only the sender phone is set", () => {
    expect(smsConfigured({ ...baseSettings, sms_sender_phone: "+15005550006" })).toBe(true)
  })

  it("is true when both are set", () => {
    expect(
      smsConfigured({
        ...baseSettings,
        sms_messaging_service_sid: "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        sms_sender_phone: "+15005550006",
      }),
    ).toBe(true)
  })
})

describe("smsEnvPresent", () => {
  it("is true when all three Twilio env vars are set (the beforeEach default)", () => {
    expect(smsEnvPresent()).toBe(true)
  })

  it("is false when TWILIO_ACCOUNT_SID is missing", () => {
    delete process.env.TWILIO_ACCOUNT_SID
    expect(smsEnvPresent()).toBe(false)
  })

  it("is false when TWILIO_MAIN_SID is missing", () => {
    delete process.env.TWILIO_MAIN_SID
    expect(smsEnvPresent()).toBe(false)
  })

  it("is false when TWILIO_CLIENT_SECRET is missing", () => {
    delete process.env.TWILIO_CLIENT_SECRET
    expect(smsEnvPresent()).toBe(false)
  })

  it("is false when a var is whitespace-only", () => {
    process.env.TWILIO_ACCOUNT_SID = "   "
    expect(smsEnvPresent()).toBe(false)
  })
})

describe("assertSmsSendable", () => {
  it("passes when the messaging service sid is set", () => {
    expect(() =>
      assertSmsSendable({ ...baseSettings, sms_messaging_service_sid: "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }),
    ).not.toThrow()
  })

  it("passes when the sender phone is set", () => {
    expect(() => assertSmsSendable({ ...baseSettings, sms_sender_phone: "+15005550006" })).not.toThrow()
  })

  it("throws SmsNotConfiguredError with the combined field name when neither is set", () => {
    try {
      assertSmsSendable(baseSettings)
      throw new Error("assertSmsSendable did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(SmsNotConfiguredError)
      expect((err as SmsNotConfiguredError).missing).toEqual(["sms_messaging_service_sid|sms_sender_phone"])
    }
  })

  it("treats whitespace-only values as unset", () => {
    expect(() =>
      assertSmsSendable({ ...baseSettings, sms_messaging_service_sid: "  ", sms_sender_phone: "  " }),
    ).toThrow(SmsNotConfiguredError)
  })
})

describe("sendRenderedSequenceSms", () => {
  it("posts To/Body/MessagingServiceSid with Basic auth to the Messages endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM1234567890abcdef1234567890abcdef", status: "queued" }), {
        status: 201,
      }),
    )
    const settings = { ...baseSettings, sms_messaging_service_sid: "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }

    const result = await sendRenderedSequenceSms({
      to: "+15005550006",
      text: "Hello there\n\n" + SMS_OPT_OUT_SENTENCE,
      settings,
    })

    expect(result.providerMessageId).toBe("SM1234567890abcdef1234567890abcdef")
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test_account/Messages.json")
    expect(init.method).toBe("POST")

    const expectedAuth = "Basic " + Buffer.from("SK_test_key:test_secret").toString("base64")
    expect(init.headers.Authorization).toBe(expectedAuth)

    const body = new URLSearchParams(init.body as string)
    expect(body.get("To")).toBe("+15005550006")
    expect(body.get("Body")).toBe("Hello there\n\n" + SMS_OPT_OUT_SENTENCE)
    expect(body.get("MessagingServiceSid")).toBe("MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
    expect(body.get("From")).toBeNull()
  })

  it("falls back to From (sender phone) when no messaging service sid is set", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM_from_phone", status: "queued" }), { status: 201 }),
    )
    const settings = { ...baseSettings, sms_sender_phone: "+15005550006" }

    await sendRenderedSequenceSms({ to: "+15005550010", text: "hi", settings })

    const [, init] = mockFetch.mock.calls[0]
    const body = new URLSearchParams(init.body as string)
    expect(body.get("From")).toBe("+15005550006")
    expect(body.get("MessagingServiceSid")).toBeNull()
  })

  it("includes StatusCallback only when supplied", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ sid: "SM_cb", status: "queued" }), { status: 201 }))
    const settings = { ...baseSettings, sms_sender_phone: "+15005550006" }

    await sendRenderedSequenceSms({
      to: "+15005550010",
      text: "hi",
      settings,
      statusCallbackUrl: "https://x.test/api/webhooks/twilio/status",
    })

    const [, init] = mockFetch.mock.calls[0]
    const body = new URLSearchParams(init.body as string)
    expect(body.get("StatusCallback")).toBe("https://x.test/api/webhooks/twilio/status")
  })

  it("omits StatusCallback when not supplied", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM_no_cb", status: "queued" }), { status: 201 }),
    )
    const settings = { ...baseSettings, sms_sender_phone: "+15005550006" }

    await sendRenderedSequenceSms({ to: "+15005550010", text: "hi", settings })

    const [, init] = mockFetch.mock.calls[0]
    const body = new URLSearchParams(init.body as string)
    expect(body.has("StatusCallback")).toBe(false)
  })

  it("throws an Error carrying Twilio's code and message on a non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 21211, message: "Invalid 'To' Phone Number" }), {
        status: 400,
      }),
    )
    const settings = { ...baseSettings, sms_sender_phone: "+15005550006" }

    await expect(sendRenderedSequenceSms({ to: "not-a-phone", text: "hi", settings })).rejects.toThrow(/21211/)
    // Re-run to check the message text too (the mock only queues one response).
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 21211, message: "Invalid 'To' Phone Number" }), {
        status: 400,
      }),
    )
    await expect(sendRenderedSequenceSms({ to: "not-a-phone", text: "hi", settings })).rejects.toThrow(
      /Invalid 'To' Phone Number/,
    )
  })

  // Fix wave (Important 2, task-3 review): this used to console.warn and
  // return `{ providerMessageId: null }` without calling fetch — a fail-safe
  // pattern copied from email.ts's Resend guard. But a caller that then
  // RECORDS the send (the sequence-tick runner) would call
  // `markSent(messageId, "twilio", null)` on a message nothing ever
  // transmitted: a permanent "sent" row for a delivery that never happened.
  // Throwing instead lets the runner's per-run catch defer the run for a
  // retry — see `smsEnvPresent()`, which exists so a caller can check this
  // BEFORE ever claiming a `sequence_messages` row.
  it("throws naming the missing var, without calling fetch, when TWILIO_ACCOUNT_SID is missing", async () => {
    delete process.env.TWILIO_ACCOUNT_SID
    const settings = { ...baseSettings, sms_sender_phone: "+15005550006" }

    await expect(sendRenderedSequenceSms({ to: "+15005550010", text: "hi", settings })).rejects.toThrow(
      /TWILIO_ACCOUNT_SID/,
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("throws naming the missing var, without calling fetch, when TWILIO_MAIN_SID is missing", async () => {
    delete process.env.TWILIO_MAIN_SID
    const settings = { ...baseSettings, sms_sender_phone: "+15005550006" }

    await expect(sendRenderedSequenceSms({ to: "+15005550010", text: "hi", settings })).rejects.toThrow(
      /TWILIO_MAIN_SID/,
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("throws naming the missing var, without calling fetch, when TWILIO_CLIENT_SECRET is missing", async () => {
    delete process.env.TWILIO_CLIENT_SECRET
    const settings = { ...baseSettings, sms_sender_phone: "+15005550006" }

    await expect(sendRenderedSequenceSms({ to: "+15005550010", text: "hi", settings })).rejects.toThrow(
      /TWILIO_CLIENT_SECRET/,
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("names every missing var when more than one is absent", async () => {
    delete process.env.TWILIO_ACCOUNT_SID
    delete process.env.TWILIO_MAIN_SID
    const settings = { ...baseSettings, sms_sender_phone: "+15005550006" }

    await expect(sendRenderedSequenceSms({ to: "+15005550010", text: "hi", settings })).rejects.toThrow(
      /TWILIO_ACCOUNT_SID.*TWILIO_MAIN_SID/,
    )
  })

  it("warns but does not block when the text exceeds 3 GSM-7 segments", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ sid: "SM_long", status: "queued" }), { status: 201 }))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const settings = { ...baseSettings, sms_sender_phone: "+15005550006" }
    const longText = "a".repeat(460)

    const result = await sendRenderedSequenceSms({ to: "+15005550010", text: longText, settings })

    expect(result.providerMessageId).toBe("SM_long")
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("460"))
  })

  it("does not warn about segment length at exactly 459 characters", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM_exact", status: "queued" }), { status: 201 }),
    )
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const settings = { ...baseSettings, sms_sender_phone: "+15005550006" }
    const exactText = "a".repeat(459)

    await sendRenderedSequenceSms({ to: "+15005550010", text: exactText, settings })

    expect(warnSpy).not.toHaveBeenCalled()
  })
})
