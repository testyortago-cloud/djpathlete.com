// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { BusinessSettings } from "@/lib/db/businesses"

const sendMock = vi.fn()
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) }
  },
}))

import {
  assertSendable,
  BusinessNotConfiguredError,
  renderSequenceEmail,
  sendSequenceEmail,
  UNSUBSCRIBE_FOOTER_SENTENCE,
} from "@/lib/lead-engine/email"

const settingsA: BusinessSettings = {
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
}

const settingsB: BusinessSettings = {
  ...settingsA,
  display_name: "Zenith Coaching",
  sender_name: "Zenith Crew",
  sender_email: "hi@zenith.test",
  reply_to: "help@zenith.test",
  postal_address: "456 Zenith Blvd, Austin, TX 78701",
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY = "re_test"
  sendMock.mockResolvedValue({ data: { id: "resend-msg-1" }, error: null })
})

describe("renderSequenceEmail", () => {
  it("takes every piece of identity from settings, not from constants", () => {
    const a = renderSequenceEmail({
      settings: settingsA,
      subject: "Hello",
      body: "Body text",
      unsubscribeUrl: "https://x.test/u/1",
      contactName: null,
    })
    const b = renderSequenceEmail({
      settings: settingsB,
      subject: "Hello",
      body: "Body text",
      unsubscribeUrl: "https://x.test/u/1",
      contactName: null,
    })

    // Every piece of identity for A must be present in A's render...
    expect(a.html).toContain(settingsA.sender_name)
    expect(a.html).toContain(settingsA.display_name)
    expect(a.html).toContain(settingsA.postal_address)

    // ...and for B in B's render...
    expect(b.html).toContain(settingsB.sender_name)
    expect(b.html).toContain(settingsB.display_name)
    expect(b.html).toContain(settingsB.postal_address)

    // ...and never cross over. A hardcoded brand string cannot pass this:
    // it would appear identically in both renders regardless of settings.
    expect(a.html).not.toContain(settingsB.sender_name)
    expect(a.html).not.toContain(settingsB.display_name)
    expect(a.html).not.toContain(settingsB.postal_address)
    expect(b.html).not.toContain(settingsA.sender_name)
    expect(b.html).not.toContain(settingsA.display_name)
    expect(b.html).not.toContain(settingsA.postal_address)
  })

  it("always renders the postal address and the unsubscribe link", () => {
    const { html, text } = renderSequenceEmail({
      settings: settingsA,
      subject: "Hello",
      body: "Body",
      unsubscribeUrl: "https://x.test/u/2",
      contactName: "Sam",
    })
    expect(html).toContain(settingsA.postal_address)
    expect(html).toContain("https://x.test/u/2")
    expect(text).toContain(settingsA.postal_address)
    expect(text).toContain("https://x.test/u/2")
  })

  it("renders the postal address and unsubscribe link even with no contact name and a minimal body", () => {
    // CAN-SPAM requirements must never become conditional on anything,
    // including a sparse/empty personalization payload.
    const { html, text } = renderSequenceEmail({
      settings: settingsA,
      subject: "Hi",
      body: "",
      unsubscribeUrl: "https://x.test/u/3",
      contactName: null,
    })
    expect(html).toContain(settingsA.postal_address)
    expect(html).toContain("https://x.test/u/3")
    expect(text).toContain(settingsA.postal_address)
    expect(text).toContain("https://x.test/u/3")
  })

  it("substitutes {{name}} and falls back to empty when the contact has none", () => {
    const withName = renderSequenceEmail({
      settings: settingsA,
      subject: "Hi {{name}}",
      body: "Hey {{name}}, welcome aboard.",
      unsubscribeUrl: "https://x.test/u/4",
      contactName: "Priya",
    })
    expect(withName.subject).toBe("Hi Priya")
    expect(withName.html).toContain("Hey Priya, welcome aboard.")
    expect(withName.text).toContain("Hey Priya, welcome aboard.")

    const noName = renderSequenceEmail({
      settings: settingsA,
      subject: "Hi {{name}}",
      body: "Hey {{name}}, welcome aboard.",
      unsubscribeUrl: "https://x.test/u/4",
      contactName: null,
    })
    // Falls back to empty string — never a brand word, never a guessed name.
    // (The footer's own display_name/postal-address text is unrelated to
    // this substitution and is asserted separately above.)
    expect(noName.subject).toBe("Hi ")
    expect(noName.html).toContain("Hey , welcome aboard.")
    expect(noName.html).not.toMatch(/\{\{\s*name\s*\}\}/)
  })

  // Fix wave (Important 5). contactName comes from a funnel form — it is
  // attacker-controllable text — and it was spliced into the subject with no
  // CRLF stripping, then handed to Resend byte for byte. A bare newline in a
  // header value is header injection where the transport allows it, and a
  // mangled subject in most clients even where it does not.
  describe("a contact name carrying CRLF", () => {
    const HOSTILE = "Sam\r\nBcc: attacker@evil.test"

    it("cannot put a newline in the subject", () => {
      const { subject } = renderSequenceEmail({
        settings: settingsA,
        subject: "Hi {{name}}",
        body: "Body",
        unsubscribeUrl: "https://x.test/u/10",
        contactName: HOSTILE,
      })
      expect(subject).not.toMatch(/[\r\n]/)
      expect(subject).toBe("Hi Sam Bcc: attacker@evil.test")
    })

    it("cannot put a newline in the body either", () => {
      const { text } = renderSequenceEmail({
        settings: settingsA,
        subject: "Hi",
        body: "Hello {{name}}, welcome.",
        unsubscribeUrl: "https://x.test/u/11",
        contactName: HOSTILE,
      })
      expect(text).toContain("Hello Sam Bcc: attacker@evil.test, welcome.")
    })

    it("trims the substituted name so a whitespace-only name leaves no ragged gap", () => {
      const { subject } = renderSequenceEmail({
        settings: settingsA,
        subject: "Hi {{name}}",
        body: "Body",
        unsubscribeUrl: "https://x.test/u/12",
        contactName: "  \n Priya \r\n ",
      })
      expect(subject).toBe("Hi Priya")
    })

    it("reaches the provider with no newline in the subject", async () => {
      await sendSequenceEmail({
        to: "lead@example.com",
        subject: "Welcome {{name}}",
        body: "Body",
        unsubscribeUrl: "https://x.test/u/13",
        contactName: HOSTILE,
        settings: settingsA,
      })
      const arg = sendMock.mock.calls[0][0]
      expect(arg.subject).not.toMatch(/[\r\n]/)
    })
  })

  it("embeds the exported unsubscribe footer sentence verbatim", () => {
    const { html } = renderSequenceEmail({
      settings: settingsA,
      subject: "Hi",
      body: "Body",
      unsubscribeUrl: "https://x.test/u/5",
      contactName: null,
    })
    expect(UNSUBSCRIBE_FOOTER_SENTENCE.length).toBeGreaterThan(0)
    expect(html).toContain(UNSUBSCRIBE_FOOTER_SENTENCE)
  })
})

// Fix wave (Important 6). The alert step notifies the OPERATOR, but it reused
// the marketing sender, so an internal ops email carried an unsubscribe link
// signed for the LEAD the alert was about. The unsubscribe page writes on GET,
// and corporate mail scanners (Safe Links, Mimecast, Barracuda) GET every URL
// in an inbound message — so a scanner in the operator's own inbox would
// silently suppress that lead, exit their runs, and write a granted:false
// consent row attributing the revocation to `unsubscribe_link`: a falsified
// record in the table whose entire purpose is defensible consent.
describe("renderSequenceEmail with includeUnsubscribeFooter: false", () => {
  it("omits the unsubscribe sentence and the link from html and text", () => {
    const { html, text } = renderSequenceEmail({
      settings: settingsA,
      subject: "Alert",
      body: "A lead replied.",
      contactName: null,
      includeUnsubscribeFooter: false,
    })
    expect(html).not.toContain(UNSUBSCRIBE_FOOTER_SENTENCE)
    expect(html).not.toContain("Unsubscribe")
    expect(text).not.toContain(UNSUBSCRIBE_FOOTER_SENTENCE)
  })

  it("still renders the message itself", () => {
    const { html, text } = renderSequenceEmail({
      settings: settingsA,
      subject: "Alert",
      body: "A lead replied.",
      contactName: null,
      includeUnsubscribeFooter: false,
    })
    expect(html).toContain("A lead replied.")
    expect(text).toContain("A lead replied.")
  })

  it("defaults to including the footer — a marketing send must not opt out by omission", () => {
    const { html } = renderSequenceEmail({
      settings: settingsA,
      subject: "Hi",
      body: "Body",
      unsubscribeUrl: "https://x.test/u/20",
      contactName: null,
    })
    expect(html).toContain(UNSUBSCRIBE_FOOTER_SENTENCE)
    expect(html).toContain("https://x.test/u/20")
  })

  it("refuses to render a footer-carrying email with no unsubscribe URL", () => {
    // CAN-SPAM is not satisfied by an empty href. If the footer is on, the
    // link is mandatory, and a caller that forgets it must fail loudly rather
    // than ship a commercial email with a dead unsubscribe.
    expect(() =>
      renderSequenceEmail({
        settings: settingsA,
        subject: "Hi",
        body: "Body",
        contactName: null,
      }),
    ).toThrow(/unsubscribeUrl/i)
  })
})

describe("sendSequenceEmail", () => {
  it("sets List-Unsubscribe and List-Unsubscribe-Post headers, from and replyTo from settings", async () => {
    const result = await sendSequenceEmail({
      to: "lead@example.com",
      subject: "Hi",
      body: "Body",
      unsubscribeUrl: "https://x.test/u/6",
      oneClickUrl: "https://x.test/api/u/6",
      contactName: null,
      settings: settingsA,
    })

    expect(sendMock).toHaveBeenCalledTimes(1)
    const arg = sendMock.mock.calls[0][0]
    // RFC 8058: the URI in List-Unsubscribe is the one Gmail POSTs to, so it
    // must be the POST-capable endpoint, not the human landing page.
    expect(arg.headers["List-Unsubscribe"]).toBe("<https://x.test/api/u/6>")
    expect(arg.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
    expect(arg.from).toBe(`${settingsA.sender_name} <${settingsA.sender_email}>`)
    expect(arg.replyTo).toBe(settingsA.reply_to)
    expect(arg.to).toBe("lead@example.com")
    expect(result.providerMessageId).toBe("resend-msg-1")
  })

  // Fix wave (Important 3). List-Unsubscribe-Post declares RFC 8058 one-click,
  // which obliges the URI to accept an HTTPS POST. It used to be declared
  // against the unsubscribe PAGE — GET-only, so Gmail's one-click button got
  // a 405. Never promise one-click without a POST endpoint to back it.
  it("does not declare One-Click when no POST-capable URI was supplied", async () => {
    await sendSequenceEmail({
      to: "lead@example.com",
      subject: "Hi",
      body: "Body",
      unsubscribeUrl: "https://x.test/u/8",
      contactName: null,
      settings: settingsA,
    })

    const arg = sendMock.mock.calls[0][0]
    expect(arg.headers["List-Unsubscribe"]).toBe("<https://x.test/u/8>")
    expect(arg.headers["List-Unsubscribe-Post"]).toBeUndefined()
  })

  it("keeps the human footer link on the page even when the header points at the POST endpoint", async () => {
    await sendSequenceEmail({
      to: "lead@example.com",
      subject: "Hi",
      body: "Body",
      unsubscribeUrl: "https://x.test/u/9",
      oneClickUrl: "https://x.test/api/u/9",
      contactName: null,
      settings: settingsA,
    })

    const arg = sendMock.mock.calls[0][0]
    expect(arg.html).toContain("https://x.test/u/9")
    expect(arg.html).not.toContain("https://x.test/api/u/9")
  })

  it("skips the provider entirely when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY
    const result = await sendSequenceEmail({
      to: "lead@example.com",
      subject: "Hi",
      body: "Body",
      unsubscribeUrl: "https://x.test/u/7",
      contactName: null,
      settings: settingsA,
    })
    expect(sendMock).not.toHaveBeenCalled()
    expect(result.providerMessageId).toBeNull()
  })
})

// Fix wave (Critical 1). Migration 00212 seeds display_name / sender_name /
// sender_email / reply_to / postal_address as NOT NULL DEFAULT '' and
// `updateBusinessSettings` has no call site anywhere, so "an unconfigured
// business" is the DEFAULT state of a fresh install, not an edge case.
describe("assertSendable", () => {
  it("passes a fully configured business", () => {
    expect(() => assertSendable(settingsA)).not.toThrow()
  })

  it("throws naming every blank field, in a stable order", () => {
    const blank = { ...settingsA, sender_email: "", display_name: "", postal_address: "" }
    expect(() => assertSendable(blank)).toThrow(
      "business_settings not configured: sender_email, display_name, postal_address",
    )
  })

  it("names only the blank fields, not all three", () => {
    expect(() => assertSendable({ ...settingsA, display_name: "" })).toThrow(
      "business_settings not configured: display_name",
    )
    expect(() => assertSendable({ ...settingsA, postal_address: "" })).toThrow(
      "business_settings not configured: postal_address",
    )
    expect(() => assertSendable({ ...settingsA, sender_email: "" })).toThrow(
      "business_settings not configured: sender_email",
    )
  })

  it("treats whitespace as blank — ' ' in a From address is still no From address", () => {
    expect(() => assertSendable({ ...settingsA, sender_email: "   " })).toThrow(BusinessNotConfiguredError)
  })

  it("exposes the missing fields on the error so a caller need not parse the message", () => {
    try {
      assertSendable({ ...settingsA, sender_email: "", postal_address: "" })
      throw new Error("assertSendable did not throw")
    } catch (err) {
      expect(err).toBeInstanceOf(BusinessNotConfiguredError)
      expect((err as BusinessNotConfiguredError).missing).toEqual(["sender_email", "postal_address"])
    }
  })
})

describe("sendSequenceEmail for an internal notification", () => {
  it("sends no List-Unsubscribe headers at all", async () => {
    await sendSequenceEmail({
      to: "ops@acme.test",
      subject: "Sequence alert",
      body: "A lead needs a human.",
      contactName: null,
      settings: settingsA,
      includeUnsubscribeFooter: false,
    })

    const arg = sendMock.mock.calls[0][0]
    expect(arg.headers?.["List-Unsubscribe"]).toBeUndefined()
    expect(arg.headers?.["List-Unsubscribe-Post"]).toBeUndefined()
    expect(arg.html).not.toContain(UNSUBSCRIBE_FOOTER_SENTENCE)
  })
})
