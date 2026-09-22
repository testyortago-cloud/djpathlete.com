// The five transactional lead emails, once they stopped being this platform's.
//
// WHAT EACH TEST IS ACTUALLY PINNING. Not "an email was sent" -- that passed
// before G30 too, from the wrong address in the wrong wordmark. Every case
// below asserts a value came from the TENANT'S OWN `business_settings` row and
// that the constant it used to come from is absent. A settings fixture whose
// values could be mistaken for the old constants would prove nothing, so
// `OTHER_COACH` deliberately shares no word with them.
//
// The absence assertions each have a presence control in the same test: "the
// platform's wordmark is gone" passes just as well when nothing rendered at
// all, so every one of them is paired with an assertion that the tenant's own
// wordmark IS there.
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { BusinessSettings } from "@/lib/db/businesses"

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
  BusinessSettingsMissingError: class extends Error {},
}))

import {
  sendChatEscalationEmail,
  sendInquiryAutoReply,
  sendInquiryEmail,
  sendQuizAlertEmail,
} from "@/lib/email/lead-alerts"
import { BusinessNotConfiguredError } from "@/lib/email/business-identity"

const BUSINESS_ID = "b0000000-0000-0000-0000-00000000000a"

/**
 * A tenant that is NOT this platform. Every string is chosen so that a test
 * asserting it cannot accidentally be satisfied by a leftover constant: no
 * word here appears in `FROM_EMAIL`, `ADMIN_CC`, `SALES_EMAIL` or the layout's
 * own wordmark.
 */
const OTHER_COACH: BusinessSettings = {
  business_id: BUSINESS_ID,
  display_name: "Northfield Strength",
  sender_name: "Coach Priya",
  sender_email: "hello@northfieldstrength.test",
  reply_to: "priya@northfieldstrength.test",
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

/** The strings G30 had to stop sending. */
const PLATFORM_LITERALS = [/DJP\s*Athlete/i, /\bDarren\b/i, /darrenjpaul\.com/i]

function expectNoPlatformLiterals(text: string) {
  for (const re of PLATFORM_LITERALS) expect(text).not.toMatch(re)
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.RESEND_API_KEY = "re_test"
  sendMock.mockResolvedValue({ data: { id: "e_1" }, error: null })
  getBusinessSettings.mockResolvedValue(OTHER_COACH)
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

const quizArgs = {
  businessId: BUSINESS_ID,
  name: "Sam Okafor",
  email: "sam@example.test",
  phone: "+447700900123",
  score: 42,
  tierKey: "red",
  tierHeadline: "Large gaps in recovery",
  branchName: "Endurance",
  profileName: "In season",
  attemptId: "a0000000-0000-0000-0000-00000000000b",
}

describe("sendQuizAlertEmail", () => {
  it("reads the settings of the business it was given, not a default", async () => {
    await sendQuizAlertEmail(quizArgs)

    expect(getBusinessSettings).toHaveBeenCalledWith(BUSINESS_ID)
  })

  it("sends FROM the tenant's own sender, not the platform's", async () => {
    const out = await sendQuizAlertEmail(quizArgs)

    expect(out).toEqual({ delivered: true })
    const arg = sendMock.mock.calls[0][0]
    expect(arg.from).toBe("Coach Priya <hello@northfieldstrength.test>")
    expectNoPlatformLiterals(String(arg.from))
  })

  it("addresses the coach at their own reply_to, and replies there too", async () => {
    await sendQuizAlertEmail(quizArgs)

    const arg = sendMock.mock.calls[0][0]
    expect(arg.to).toBe("priya@northfieldstrength.test")
    expect(arg.replyTo).toBe("priya@northfieldstrength.test")
    // Decision 9: one destination, the tenant's own. No CC to a mailbox
    // nobody on this tenant configured.
    expect(arg.cc).toBeUndefined()
  })

  it("renders the tenant's wordmark and postal address, and none of the platform's", async () => {
    await sendQuizAlertEmail(quizArgs)

    const html = String(sendMock.mock.calls[0][0].html)
    // The presence control for the absence assertion below.
    expect(html).toContain("Northfield Strength")
    expect(html).toContain("4 Mill Lane, Northfield, NF1 2AB")
    expect(html).toContain("Coach Priya")
    expectNoPlatformLiterals(html)
  })

  it("uses the tenant's logo when they have one", async () => {
    getBusinessSettings.mockResolvedValue({ ...OTHER_COACH, logo_url: "https://cdn.test/nf-logo.png" })

    await sendQuizAlertEmail(quizArgs)

    const html = String(sendMock.mock.calls[0][0].html)
    expect(html).toContain('<img src="https://cdn.test/nf-logo.png"')
    expect(html).toContain('alt="Northfield Strength"')
  })

  it("still carries the quiz result the operator is being alerted about", async () => {
    await sendQuizAlertEmail(quizArgs)

    const arg = sendMock.mock.calls[0][0]
    expect(arg.subject).toContain("Sam Okafor")
    expect(arg.subject).toContain("42")
    expect(String(arg.html)).toContain("Large gaps in recovery")
  })

  it("reports NOT delivered, and sends nothing, when the tenant has no reply_to", async () => {
    // MUTANT: drop the reply_to check and `to: ""` reaches the provider, which
    // rejects it -- so "nobody has configured an address" would be recorded on
    // the attempt as a delivery failure, which is a different fault with a
    // different fix.
    getBusinessSettings.mockResolvedValue({ ...OTHER_COACH, reply_to: "   " })

    const out = await sendQuizAlertEmail(quizArgs)

    expect(out).toEqual({ delivered: false })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("reports NOT delivered, naming the missing field, when the tenant is unconfigured", async () => {
    getBusinessSettings.mockResolvedValue({ ...OTHER_COACH, postal_address: "" })

    const out = await sendQuizAlertEmail(quizArgs)

    expect(out).toEqual({ delivered: false })
    expect(sendMock).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("postal_address"))
  })

  it("still reports delivered for a tenant with no LOGO -- that is not an unconfigured tenant", async () => {
    // The permissive control. `assertSendable` must keep letting a business
    // with a name and no logo send: a guard with no permissive case refuses
    // too much without anyone noticing.
    getBusinessSettings.mockResolvedValue({ ...OTHER_COACH, logo_url: null })

    const out = await sendQuizAlertEmail(quizArgs)

    expect(out).toEqual({ delivered: true })
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it("reports NOT delivered when the provider refuses, and does not throw", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "domain is not verified" } })

    const out = await sendQuizAlertEmail(quizArgs)

    expect(out).toEqual({ delivered: false })
  })
})

const escalationArgs = {
  businessId: BUSINESS_ID,
  conversationId: "11111111-1111-1111-1111-111111111111",
  summary: "Wants to know if there is a goalkeeper track",
  landingPath: "/programs",
  transcript: [
    { role: "user" as const, content: "Do you coach goalkeepers?", created_at: "2026-08-23T10:00:00.000Z" },
    { role: "assistant" as const, content: "Let me put you to a person.", created_at: "2026-08-23T10:00:04.000Z" },
  ],
}

describe("sendChatEscalationEmail", () => {
  it("sends FROM the tenant, TO the tenant's own reply_to, and nowhere else", async () => {
    const out = await sendChatEscalationEmail(escalationArgs)

    expect(out).toEqual({ delivered: true })
    const arg = sendMock.mock.calls[0][0]
    expect(getBusinessSettings).toHaveBeenCalledWith(BUSINESS_ID)
    expect(arg.from).toBe("Coach Priya <hello@northfieldstrength.test>")
    expect(arg.to).toBe("priya@northfieldstrength.test")
    // Still no CC. The transcript can contain a stranger's phone number typed
    // into a public box, and a second recipient nobody on this tenant
    // configured has no claim on it.
    expect(arg.cc).toBeUndefined()
  })

  it("does NOT reply to the tenant's own address -- the visitor is anonymous", async () => {
    // The one alert of the five that sets no replyTo, and it is not an
    // oversight: there may be no address to reply to at all, and the default
    // mail-client reply must not put the coach's answer in front of whoever
    // `reply_to` happens to be rather than the visitor.
    await sendChatEscalationEmail(escalationArgs)

    expect(sendMock.mock.calls[0][0].replyTo).toBeUndefined()
  })

  it("renders the tenant's wordmark and postal address, and none of the platform's", async () => {
    await sendChatEscalationEmail(escalationArgs)

    const html = String(sendMock.mock.calls[0][0].html)
    expect(html).toContain("Northfield Strength")
    expect(html).toContain("4 Mill Lane, Northfield, NF1 2AB")
    expectNoPlatformLiterals(html)
  })

  it("still carries both sides of the transcript", async () => {
    await sendChatEscalationEmail(escalationArgs)

    const html = String(sendMock.mock.calls[0][0].html)
    expect(html).toContain("Do you coach goalkeepers?")
    expect(html).toContain("Let me put you to a person.")
    expect(html).toContain("Wants to know if there is a goalkeeper track")
  })

  it("reports NOT delivered, and sends nothing, when the tenant has no reply_to", async () => {
    getBusinessSettings.mockResolvedValue({ ...OTHER_COACH, reply_to: "" })

    const out = await sendChatEscalationEmail(escalationArgs)

    expect(out).toEqual({ delivered: false })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("lets a settings read failure THROW, because that is not 'nobody to tell'", async () => {
    // The caller records `failed` for this and `not_configured` for the case
    // above. Collapsing a database outage into "this tenant has nobody to
    // email" would hide an outage behind a configuration message.
    getBusinessSettings.mockRejectedValue(new Error("supabase down"))

    await expect(sendChatEscalationEmail(escalationArgs)).rejects.toThrow(/supabase down/)
  })
})

const inquiryArgs = {
  businessId: BUSINESS_ID,
  name: "Sam Okafor",
  email: "sam@example.test",
  phone: "+447700900123",
  serviceLabel: "1-to-1 Coaching",
  sport: "Football",
  experience: "3 years",
  goals: "Add 10kg to my squat before pre-season",
  injuries: null,
  how_heard: "A teammate",
  aiAnalysis: null,
}

describe("sendInquiryEmail", () => {
  it("goes to the tenant's own reply_to, from the tenant, with no CC to anyone else", async () => {
    await sendInquiryEmail(inquiryArgs)

    const arg = sendMock.mock.calls[0][0]
    expect(getBusinessSettings).toHaveBeenCalledWith(BUSINESS_ID)
    expect(arg.from).toBe("Coach Priya <hello@northfieldstrength.test>")
    expect(arg.to).toBe("priya@northfieldstrength.test")
    // It used to go to a hardcoded sales mailbox and CC a hardcoded personal
    // one. Both belonged to one tenant; neither had any claim on another
    // coach's applicant.
    expect(arg.cc).toBeUndefined()
  })

  it("still replies to the APPLICANT, not to the coach's own inbox", async () => {
    // Deliberately NOT the tenant's reply_to. Hitting reply on a new-inquiry
    // alert answers the person who applied; pointed at the coach's own
    // address it would mail them their own alert back.
    await sendInquiryEmail(inquiryArgs)

    expect(sendMock.mock.calls[0][0].replyTo).toBe("sam@example.test")
  })

  it("renders the tenant's wordmark and postal address, and none of the platform's", async () => {
    await sendInquiryEmail(inquiryArgs)

    const html = String(sendMock.mock.calls[0][0].html)
    expect(html).toContain("Northfield Strength")
    expect(html).toContain("4 Mill Lane, Northfield, NF1 2AB")
    expectNoPlatformLiterals(html)
  })

  it("still carries what the applicant wrote", async () => {
    await sendInquiryEmail(inquiryArgs)

    const html = String(sendMock.mock.calls[0][0].html)
    expect(html).toContain("Add 10kg to my squat before pre-season")
    expect(html).toContain("Sam Okafor")
    expect(String(sendMock.mock.calls[0][0].subject)).toContain("1-to-1 Coaching")
  })

  it("throws when the tenant cannot lawfully send, rather than sending anyway", async () => {
    // This sender's contract is an exception, not a flag -- its caller catches
    // and logs. So an unconfigured tenant must NOT fall through to a send with
    // an empty From.
    getBusinessSettings.mockResolvedValue({ ...OTHER_COACH, sender_email: "" })

    await expect(sendInquiryEmail(inquiryArgs)).rejects.toThrow(/sender_email/)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("throws when the tenant has no reply_to, rather than sending to an empty address", async () => {
    getBusinessSettings.mockResolvedValue({ ...OTHER_COACH, reply_to: "" })

    await expect(sendInquiryEmail(inquiryArgs)).rejects.toThrow(/reply_to/)
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe("sendInquiryAutoReply", () => {
  const autoReplyArgs = {
    businessId: BUSINESS_ID,
    to: "sam@example.test",
    firstName: "Sam",
    serviceLabel: "1-to-1 Coaching",
  }

  it("goes to the APPLICANT -- the one alert of the five whose recipient is not the coach", async () => {
    await sendInquiryAutoReply(autoReplyArgs)

    const arg = sendMock.mock.calls[0][0]
    expect(arg.to).toBe("sam@example.test")
    expect(arg.from).toBe("Coach Priya <hello@northfieldstrength.test>")
    // And replying reaches the coach, because this one IS from the coach.
    expect(arg.replyTo).toBe("priya@northfieldstrength.test")
  })

  it("signs off as the tenant's own coach and business, not the platform's", async () => {
    await sendInquiryAutoReply(autoReplyArgs)

    const html = String(sendMock.mock.calls[0][0].html)
    expect(html).toContain("Coach Priya")
    expect(html).toContain("Northfield Strength")
    expectNoPlatformLiterals(html)
  })

  it("names the tenant, not the platform, in the subject the applicant sees", async () => {
    await sendInquiryAutoReply(autoReplyArgs)

    const subject = String(sendMock.mock.calls[0][0].subject)
    expect(subject).toContain("Northfield Strength")
    expectNoPlatformLiterals(subject)
  })

  it("still tells the applicant what they applied for", async () => {
    await sendInquiryAutoReply(autoReplyArgs)

    const html = String(sendMock.mock.calls[0][0].html)
    expect(html).toContain("1-to-1 Coaching")
    expect(html).toContain("Sam")
  })

  it("sends to the applicant even when the tenant has no reply_to", async () => {
    // THE PERMISSIVE CASE. `reply_to` is the DESTINATION for the four coach
    // alerts, so a blank one stops them. Here the destination is the
    // applicant's own address, which is present -- refusing this send would
    // leave a person who just applied with silence, to fix a field that is not
    // in the way.
    getBusinessSettings.mockResolvedValue({ ...OTHER_COACH, reply_to: "" })

    await sendInquiryAutoReply(autoReplyArgs)

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0].to).toBe("sam@example.test")
    expect(sendMock.mock.calls[0][0].replyTo).toBeUndefined()
  })

  it("refuses when the tenant cannot lawfully send at all", async () => {
    // But a missing postal address IS in the way: this is a commercial message
    // to a member of the public, and CAN-SPAM wants an address on it.
    getBusinessSettings.mockResolvedValue({ ...OTHER_COACH, postal_address: "" })

    await expect(sendInquiryAutoReply(autoReplyArgs)).rejects.toThrow(/postal_address/)
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe("BusinessNotConfiguredError is the shared gate, not a second copy", () => {
  it("is the same class the sequence mailer re-exports", async () => {
    const leadEngine = await import("@/lib/lead-engine/email")
    expect(leadEngine.BusinessNotConfiguredError).toBe(BusinessNotConfiguredError)
  })
})
