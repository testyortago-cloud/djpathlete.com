// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock factories are hoisted above top-level `const`s, so the mocks these
// factories close over must themselves be created inside vi.hoisted() — a
// bare `const isSuppressed = vi.fn()` referenced below throws "Cannot access
// before initialization" (repo convention: see chat-escalate.test.ts's `h`).
const { isSuppressed, hasConsent, insertSmsMessage, markSmsMessageOutcome } = vi.hoisted(() => ({
  isSuppressed: vi.fn(),
  hasConsent: vi.fn(),
  insertSmsMessage: vi.fn(),
  markSmsMessageOutcome: vi.fn(),
}))

vi.mock("@/lib/db/contact-consents", () => ({ isSuppressed, hasConsent }))
vi.mock("@/lib/db/sms-messages", () => ({ insertSmsMessage, markSmsMessageOutcome }))

import {
  sendManualSms,
  SmsSuppressedError,
  SmsNotConfiguredError,
  SmsTooLongError,
  SmsUnparseablePhoneError,
  SmsNoConsentError,
} from "@/lib/lead-engine/sms"
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
const CONTACT = "22222222-2222-4222-8222-222222222222"
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
  // Default to GRANTED so the suites that are not about consent are not
  // silently exercising the refusal path. They pass `consentOverride: true`
  // as well, so neither the default nor the override alone is load-bearing
  // for them.
  hasConsent.mockResolvedValue(true)
  insertSmsMessage.mockResolvedValue({ id: "m1" })
  markSmsMessageOutcome.mockResolvedValue(undefined)
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
        consentOverride: true,
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
      consentOverride: true,
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
        consentOverride: true,
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
      consentOverride: true,
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
        consentOverride: true,
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
        consentOverride: true,
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
      consentOverride: true,
    })
    const body = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    expect(body).toContain("MessagingServiceSid=MGtest")
    expect(body).not.toContain("From=")
  })

  // Task 7. THE ROW IS WRITTEN BEFORE THE SEND, as `queued`, and the outcome
  // is stamped onto it afterwards. Why: a status callback that reaches
  // /api/webhooks/twilio/status before the row exists resolves to
  // `unknown_message` and the report is dropped on the floor.
  //
  // This does NOT close the race and the test must not be read as claiming it
  // does: the sid only exists once the POST returns, so a callback landing
  // between the response and the outcome UPDATE still finds no row by sid.
  // The window shrinks from "POST latency + an INSERT" to "response -> one
  // UPDATE".
  it("writes the queued row BEFORE the Twilio call, with no sid yet", async () => {
    // MUTANT: insert after the send. The call-order assertion is the only
    // thing that can fail on it — every field assertion below stays green.
    await sendManualSms({
      phone: PHONE,
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      contactId: "c1",
      sentBy: "u1",
      appendOptOut: false,
      consentOverride: true,
    })

    expect(insertSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ,
        contactId: "c1",
        phone: PHONE,
        direction: "outbound",
        body: "hi",
        status: "queued",
        sentBy: "u1",
      }),
    )
    // The sid is not knowable yet — asserting its ABSENCE is what pins the
    // ordering claim to reality rather than to the word "queued".
    const insertArg = insertSmsMessage.mock.calls[0][0]
    expect(insertArg.twilioSid ?? null).toBeNull()
    expect(insertSmsMessage.mock.invocationCallOrder[0]).toBeLessThan(
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    )
  })

  it("stamps the provider sid onto THAT row afterwards, rather than inserting a second one", async () => {
    const out = await sendManualSms({
      phone: PHONE,
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      contactId: "c1",
      sentBy: "u1",
      appendOptOut: false,
      consentOverride: true,
    })

    expect(out).toMatchObject({ messageId: "m1", providerMessageId: "SM123", text: "hi" })
    expect(markSmsMessageOutcome).toHaveBeenCalledWith("m1", { kind: "sent", twilioSid: "SM123" })
    // Presence control for the absence assertion: exactly ONE row per text.
    expect(insertSmsMessage).toHaveBeenCalledTimes(1)
  })

  it("appends the opt-out sentence when told to, and sends THAT text", async () => {
    const out = await sendManualSms({
      phone: PHONE,
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      appendOptOut: true,
      consentOverride: true,
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
        consentOverride: true,
      }),
    ).rejects.toThrow(/blocked/)

    // The queued row already exists, so the failure is an UPDATE onto it —
    // not a second row. MUTANT: insert a failed row here too and the
    // conversation shows the same text twice.
    expect(markSmsMessageOutcome).toHaveBeenCalledWith("m1", { kind: "failed", errorCode: "21610" })
    expect(insertSmsMessage).toHaveBeenCalledTimes(1)
    expect(insertSmsMessage).toHaveBeenCalledWith(expect.objectContaining({ status: "queued" }))
  })

  it("propagates the original provider error, not a failed record-write's own error", async () => {
    // If insertSmsMessage (recording the `failed` row) itself throws inside
    // the catch, that DB error must not replace the real cause — a coach
    // needs "the carrier blocked it", not "the database was unavailable"
    // for a text that never had a database problem.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 21610, message: "blocked by carrier" }),
    }) as unknown as typeof fetch
    insertSmsMessage.mockRejectedValue(new Error("db unavailable"))
    markSmsMessageOutcome.mockRejectedValue(new Error("db unavailable"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      sendManualSms({
        phone: PHONE,
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
        consentOverride: true,
      }),
    ).rejects.toThrow(/blocked by carrier/)

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
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
      consentOverride: true,
    })

    expect(out).toMatchObject({ messageId: null, providerMessageId: "SM123", text: "hi" })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe("sendManualSms — a DB blip before the send", () => {
  // A failure to write the queued row must NOT silence a coach's reply. The
  // send goes ahead, the outcome update is skipped (there is no row id to
  // stamp), and the message is still recorded afterwards so the conversation
  // is not left with a gap — the pre-Task-7 insert-after behaviour, kept as
  // the fallback it now is.
  it("still sends, and still records the message, when the queued row could not be written", async () => {
    insertSmsMessage.mockRejectedValueOnce(new Error("db unavailable")).mockResolvedValue({ id: "m2" })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const out = await sendManualSms({
      phone: PHONE,
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      appendOptOut: false,
      consentOverride: true,
    })

    // MUTANT: rethrow the insert error instead of logging it — the text would
    // never be sent because a row could not be written about it.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalled()
    // No row id existed to stamp, so the outcome update is skipped entirely
    // rather than called with a null id.
    expect(markSmsMessageOutcome).not.toHaveBeenCalled()
    expect(insertSmsMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: "sent", twilioSid: "SM123" }))
    expect(out).toMatchObject({ messageId: "m2", providerMessageId: "SM123", text: "hi" })

    consoleError.mockRestore()
  })

  it("records a FAILED row directly when both the queued write and the send fail", async () => {
    insertSmsMessage.mockRejectedValueOnce(new Error("db unavailable")).mockResolvedValue({ id: "m2" })
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 21610, message: "blocked" }),
    }) as unknown as typeof fetch
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      sendManualSms({
        phone: PHONE,
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
        consentOverride: true,
      }),
    ).rejects.toThrow(/blocked/)

    expect(markSmsMessageOutcome).not.toHaveBeenCalled()
    expect(insertSmsMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", errorCode: "21610" }))

    consoleError.mockRestore()
  })
})

describe("sendManualSms — segment length", () => {
  it("refuses a message over 10 segments with a typed, caller-input error", async () => {
    // Typed (not a bare Error) so a caller like the route can map it to 400
    // rather than the generic 502 every other throw here falls into — this
    // is the user's message being too long, not a provider fault.
    await expect(
      sendManualSms({
        phone: PHONE,
        body: "a".repeat(1600),
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
        consentOverride: true,
      }),
    ).rejects.toThrow(SmsTooLongError)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("carries the real segment count and the max on the thrown error", async () => {
    try {
      await sendManualSms({
        phone: PHONE,
        body: "a".repeat(1600),
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
        consentOverride: true,
      })
      throw new Error("sendManualSms did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(SmsTooLongError)
      const tooLong = err as SmsTooLongError
      expect(tooLong.maxSegments).toBe(10)
      expect(tooLong.segments).toBeGreaterThan(10)
    }
  })
})

describe("sendManualSms — phone normalisation", () => {
  // Task 4 re-review flagged this branch as untested directly: every other
  // test in this file uses PHONE/PHONE_NATIONAL, both of which normalise
  // successfully, so the `normalisePhone(...) -> null` branch (line 362-364
  // at the time of writing) never actually ran in this suite.
  it("throws SmsUnparseablePhoneError when normalisePhone returns null, before checking suppression", async () => {
    // "+12345678" is shaped like E.164 but is not an assigned NANP number —
    // libphonenumber-js's isValid() rejects it, so normalisePhone(...)
    // returns null.
    await expect(
      sendManualSms({
        phone: "+12345678",
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
        consentOverride: true,
      }),
    ).rejects.toThrow(SmsUnparseablePhoneError)

    // Refused before it ever reaches the suppression check or the provider —
    // an unparseable number cannot be checked against suppressions at all.
    expect(isSuppressed).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(insertSmsMessage).not.toHaveBeenCalled()
  })

  it("carries the raw (un-normalised) input on the error", async () => {
    try {
      await sendManualSms({
        phone: "+12345678",
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        appendOptOut: false,
        consentOverride: true,
      })
      throw new Error("sendManualSms did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(SmsUnparseablePhoneError)
      expect((err as SmsUnparseablePhoneError).phone).toBe("+12345678")
    }
  })
})

// G28 — manual texts are consent-gated, with an audited override.
// Owner ruled 2026-09-21.
//
// THE MEASURED PREMISE, and it is uncomfortable: `contact_consents` has
// ZERO rows in production. So this gate blocks EVERY manual text on day
// one, and every send needs the coach to tick "Send anyway" until consent
// rows start accumulating. The owner accepted that knowingly, because the
// alternative is texting people with no recorded permission and no record
// that anyone decided to.
//
// WHY THE OVERRIDE IS NOT A HOLE: it skips CONSENT, never SUPPRESSION. A
// STOP is not a preference, and no tick in a compose box may undo it. The
// suppression suite at the top of this file now passes
// `consentOverride: true` on every call and still expects
// SmsSuppressedError — that IS the proof, not a separate claim.
describe("sendManualSms — G28 consent gate", () => {
  it("REFUSES when the contact has no granted SMS consent, and sends nothing", async () => {
    hasConsent.mockResolvedValue(false)

    await expect(
      sendManualSms({
        phone: PHONE,
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        contactId: CONTACT,
        appendOptOut: false,
        consentOverride: false,
      }),
    ).rejects.toThrow(SmsNoConsentError)

    expect(global.fetch).not.toHaveBeenCalled()
    expect(insertSmsMessage).not.toHaveBeenCalled()
  })

  it("REFUSES when there is no contact at all — an unknown number cannot have consented", async () => {
    // The easiest way around a consent gate is to text a number that has no
    // contact row. `contactId` is optional on this function, so without this
    // branch the gate would be trivially bypassable.
    await expect(
      sendManualSms({
        phone: PHONE,
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        contactId: null,
        appendOptOut: false,
        consentOverride: false,
      }),
    ).rejects.toThrow(SmsNoConsentError)

    expect(hasConsent).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("SENDS when the contact has granted SMS consent, with no override needed", async () => {
    // The presence control. Without it every refusal above would pass just
    // as well on a function that refuses unconditionally.
    hasConsent.mockResolvedValue(true)

    await sendManualSms({
      phone: PHONE,
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      contactId: CONTACT,
      appendOptOut: false,
      consentOverride: false,
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    // G35: asked under THIS business. MUTANT: sendManualSms drops the third
    // argument — hasConsent would then read every business's consent rows.
    expect(hasConsent).toHaveBeenCalledWith(CONTACT, "sms", BIZ)
  })

  it("asks about the SMS channel, not email", async () => {
    hasConsent.mockResolvedValue(true)
    await sendManualSms({
      phone: PHONE,
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      contactId: CONTACT,
      appendOptOut: false,
      consentOverride: false,
    })
    expect(hasConsent).toHaveBeenCalledWith(CONTACT, "sms", BIZ)
    // `expect.anything()` for the tenant, not BIZ: an email ask under ANY
    // business is the bug. The line above is this line's presence control.
    expect(hasConsent).not.toHaveBeenCalledWith(CONTACT, "email", expect.anything())
  })

  it("SENDS without consent when the override is set, and does not even ask", async () => {
    hasConsent.mockResolvedValue(false)

    await sendManualSms({
      phone: PHONE,
      body: "hi",
      settings: CONFIGURED,
      businessId: BIZ,
      contactId: CONTACT,
      appendOptOut: false,
      consentOverride: true,
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(hasConsent).not.toHaveBeenCalled()
  })

  it("THE OVERRIDE DOES NOT BYPASS SUPPRESSION — a STOP still refuses", async () => {
    // The single most important assertion in this file. "Send anyway" is a
    // consent override, not a suppression override. Someone who texted STOP
    // stays unreachable however many boxes an admin ticks.
    isSuppressed.mockResolvedValue(true)
    hasConsent.mockResolvedValue(false)

    await expect(
      sendManualSms({
        phone: PHONE,
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        contactId: CONTACT,
        appendOptOut: false,
        consentOverride: true,
      }),
    ).rejects.toThrow(SmsSuppressedError)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("checks consent BEFORE configuration, so an unconfigured business cannot mask it", async () => {
    // Same reasoning the suppression check is documented with: ordering a
    // configuration error ahead of a legal one reports the wrong problem,
    // and an admin who then fixes the credentials texts someone who never
    // agreed.
    hasConsent.mockResolvedValue(false)

    await expect(
      sendManualSms({
        phone: PHONE,
        body: "hi",
        settings: UNCONFIGURED,
        businessId: BIZ,
        contactId: CONTACT,
        appendOptOut: false,
        consentOverride: false,
      }),
    ).rejects.toThrow(SmsNoConsentError)
  })

  it("checks suppression BEFORE consent, so the stronger refusal wins", async () => {
    isSuppressed.mockResolvedValue(true)
    hasConsent.mockResolvedValue(false)

    await expect(
      sendManualSms({
        phone: PHONE,
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        contactId: CONTACT,
        appendOptOut: false,
        consentOverride: false,
      }),
    ).rejects.toThrow(SmsSuppressedError)
  })

  it("does NOT treat an unreadable consent row as a refusal — the error propagates", async () => {
    // "could not read" and "they said no" are different answers, and
    // hasConsent throws rather than returning false for exactly that reason
    // (see its doc comment). Swallowing it here would turn a database blip
    // into a silent policy decision — in the safe direction today, but it
    // would also hide an outage behind a message the coach cannot act on.
    hasConsent.mockRejectedValue(new Error("consents read failed"))

    await expect(
      sendManualSms({
        phone: PHONE,
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        contactId: CONTACT,
        appendOptOut: false,
        consentOverride: false,
      }),
    ).rejects.toThrow("consents read failed")

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("carries the NORMALISED phone on the error, so the route can name the number", async () => {
    hasConsent.mockResolvedValue(false)
    try {
      await sendManualSms({
        phone: PHONE_NATIONAL,
        body: "hi",
        settings: CONFIGURED,
        businessId: BIZ,
        contactId: CONTACT,
        appendOptOut: false,
        consentOverride: false,
      })
      throw new Error("sendManualSms did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(SmsNoConsentError)
      expect((err as SmsNoConsentError).phone).toBe(PHONE)
    }
  })
})
