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
  emailEnvPresent,
  renderSequenceEmail,
  sendSequenceEmail,
  SMS_CONSENT_URL_PLACEHOLDER,
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
  sms_messaging_service_sid: "",
  sms_sender_phone: "",
  brand_color: null,
  accent_color: null,
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

// Migration 00226 rewrites the `sms_repermission` step body to offer a tappable
// consent link, stored in the flat `sequence_steps.body` column as the literal
// placeholder `{{sms_consent_url}}`. The seed copy cannot hold the real URL:
// the token is per-contact, and the origin is per-deployment. So the renderer
// substitutes it, and the runner supplies it — exactly the split that already
// keeps `renderSequenceEmail` pure for the unsubscribe URL.
describe("renderSequenceEmail and the {{sms_consent_url}} placeholder", () => {
  const BODY = "Tap to say yes:\n\n{{sms_consent_url}}\n\nThanks."
  const URL = "https://x.test/sms-consent/abc.def"

  it("replaces the placeholder in the plain-text part with the real URL", () => {
    const { text } = renderSequenceEmail({
      settings: settingsA,
      subject: "Can we text you?",
      body: BODY,
      unsubscribeUrl: "https://x.test/u/30",
      smsConsentUrl: URL,
      contactName: null,
    })
    expect(text).toContain(URL)
    expect(text).not.toContain("{{sms_consent_url}}")
  })

  it("renders it as a real anchor in the html, with the href escaped", () => {
    const { html } = renderSequenceEmail({
      settings: settingsA,
      subject: "Can we text you?",
      body: BODY,
      unsubscribeUrl: "https://x.test/u/31",
      smsConsentUrl: "https://x.test/sms-consent/a&b",
      contactName: null,
    })
    // The href goes through the same escapeHtml the unsubscribe href uses —
    // a token is base64url so it cannot contain `&` today, but an origin with
    // a query string could, and an unescaped `&` silently truncates the href.
    expect(html).toContain('href="https://x.test/sms-consent/a&amp;b"')
    expect(html).not.toContain("{{sms_consent_url}}")
  })

  it("leaves a body that does not mention the placeholder completely unchanged", () => {
    const plain = {
      settings: settingsA,
      subject: "Hi",
      body: "Nothing to substitute here.\n\nSecond paragraph.",
      unsubscribeUrl: "https://x.test/u/32",
      contactName: "Marissa" as string | null,
    }
    const without = renderSequenceEmail(plain)
    const withUrl = renderSequenceEmail({ ...plain, smsConsentUrl: URL })
    expect(withUrl).toEqual(without)
    expect(withUrl.html).not.toContain(URL)
  })

  it("refuses to render a body that carries the placeholder with no URL supplied", () => {
    // The alternative is shipping `{{sms_consent_url}}` as visible template
    // syntax to a real person, or an anchor pointing nowhere. Both are worse
    // than a loud failure the runner can never actually reach — it always
    // passes the URL.
    expect(() =>
      renderSequenceEmail({
        settings: settingsA,
        subject: "Can we text you?",
        body: BODY,
        unsubscribeUrl: "https://x.test/u/33",
        contactName: null,
      }),
    ).toThrow(/sms_consent_url/i)
  })

  it("substitutes {{name}} and the URL in the same body", () => {
    const { text } = renderSequenceEmail({
      settings: settingsA,
      subject: "Hi {{name}}",
      body: "Hi {{name}}\n\n{{sms_consent_url}}",
      unsubscribeUrl: "https://x.test/u/34",
      smsConsentUrl: URL,
      contactName: "Marissa",
    })
    expect(text).toContain("Hi Marissa")
    expect(text).toContain(URL)
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

  // Task 1 (2026-08-22-lead-engine-stage4-spine): this used to warn and
  // return { data: null, error: null } — a "safe" failure indistinguishable
  // from a successful send to every caller. sendRenderedSequenceEmail
  // unwrapped that into { providerMessageId: null }, and the sequence-tick
  // runner then called markSent(messageId, "resend", null): a permanent
  // "sent" row in sequence_messages for a message nothing ever transmitted,
  // burning recordSend's one-shot idempotency claim for good. Mirrors
  // sendRenderedSequenceSms's contract in lib/lead-engine/sms.ts, which
  // throws for the identical reason.
  it("throws naming RESEND_API_KEY when unset, rather than skipping the provider silently", async () => {
    delete process.env.RESEND_API_KEY
    await expect(
      sendSequenceEmail({
        to: "lead@example.com",
        subject: "Hi",
        body: "Body",
        unsubscribeUrl: "https://x.test/u/7",
        contactName: null,
        settings: settingsA,
      }),
    ).rejects.toThrow(/RESEND_API_KEY/)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("also throws for a whitespace-only RESEND_API_KEY", async () => {
    process.env.RESEND_API_KEY = "   "
    await expect(
      sendSequenceEmail({
        to: "lead@example.com",
        subject: "Hi",
        body: "Body",
        unsubscribeUrl: "https://x.test/u/14",
        contactName: null,
        settings: settingsA,
      }),
    ).rejects.toThrow(/RESEND_API_KEY/)
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe("emailEnvPresent", () => {
  it("is true when RESEND_API_KEY is set and non-blank", () => {
    process.env.RESEND_API_KEY = "re_test"
    expect(emailEnvPresent()).toBe(true)
  })

  it("is false when RESEND_API_KEY is unset", () => {
    delete process.env.RESEND_API_KEY
    expect(emailEnvPresent()).toBe(false)
  })

  it("is false when RESEND_API_KEY is whitespace only", () => {
    process.env.RESEND_API_KEY = "   "
    expect(emailEnvPresent()).toBe(false)
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

// ---------------------------------------------------------------------------
// G16 — merge fields and the tenant's own colours.
//
// Before this, a sequence step could say `{{name}}` and nothing else. Every
// other token a coach typed shipped to a real person as visible template
// syntax: "Hi {{first_name}}," is not a slightly plain email, it is a broken
// one, and it is the kind of thing a coach only finds out about from a reply.
// ---------------------------------------------------------------------------

function render(overrides: Parameters<typeof renderSequenceEmail>[0] extends infer T ? Partial<T> : never) {
  return renderSequenceEmail({
    settings: settingsA,
    subject: "Subject",
    body: "Body",
    unsubscribeUrl: "https://example.test/u/tok",
    contactName: "Sam Athlete",
    ...(overrides as object),
  } as Parameters<typeof renderSequenceEmail>[0])
}

describe("renderSequenceEmail merge fields", () => {
  it("fills in the contact's first name, derived from the whole one", () => {
    const out = render({ subject: "Hi {{first_name}}", body: "Hello {{first_name}}, welcome." })

    expect(out.subject).toBe("Hi Sam")
    expect(out.text).toContain("Hello Sam, welcome.")
  })

  it("gives a one-word name back whole rather than blank", () => {
    expect(render({ subject: "Hi {{first_name}}", contactName: "Priya" }).subject).toBe("Hi Priya")
  })

  it("leaves nothing behind for a contact with no name at all", () => {
    // The same answer `{{name}}` has always given, for the same reason: never a
    // brand word, never a guessed name.
    const out = render({ subject: "Hi {{first_name}}", body: "Hello {{name}}.", contactName: null })

    // The brace is gone; the space around it is not. Trimming the whole
    // subject would change every OTHER subject too, for a case that is
    // already the minority.
    expect(out.subject).toBe("Hi ")
    expect(out.text).toContain("Hello .")
  })

  it("fills in what the enrolling event let the run remember", () => {
    const out = render({
      subject: "About your {{service}} enquiry",
      body: "You asked about {{camp_name}}, and you told us you are a {{role}}.",
      enrolmentMetadata: { service: "camp", camp_name: "Summer Camp 2026", role: "parent" },
    })

    expect(out.subject).toBe("About your camp enquiry")
    expect(out.text).toContain("You asked about Summer Camp 2026, and you told us you are a parent.")
  })

  it("BLANKS a token nobody wrote rather than shipping template syntax to a person", () => {
    // `{{sport}}` has no producer — see this gap's note in the header. The
    // failure it replaces is a real person receiving the literal braces.
    const out = render({ subject: "Your {{sport}} plan", body: "Ready, {{nonsense_token}}?" })

    expect(out.subject).toBe("Your  plan")
    expect(out.subject).not.toContain("{{")
    expect(out.text).not.toContain("{{")
  })

  it("blanks a KNOWN token the run has no value for", () => {
    // Indistinguishable from the unknown case on purpose: both mean "there is
    // nothing to say here", and a coach cannot tell them apart anyway.
    const out = render({ subject: "About {{camp_name}}", enrolmentMetadata: {} })

    expect(out.subject).toBe("About ")
  })

  it("tolerates spacing inside the braces, which is what a person types", () => {
    expect(render({ subject: "Hi {{ first_name }}" }).subject).toBe("Hi Sam")
  })

  it("does NOT blank the two link placeholders — that would delete the unsubscribe link", () => {
    // PRESENCE CONTROL for the blanking rule above. A tidy-up that treated
    // every unknown `{{token}}` as blank would silently strip the unsubscribe
    // href, which is a CAN-SPAM violation produced by a cleanup.
    const out = render({ body: `Say yes: ${SMS_CONSENT_URL_PLACEHOLDER}`, smsConsentUrl: "https://example.test/c/tok" })

    expect(out.html).toContain("https://example.test/c/tok")
    expect(out.html).toContain("https://example.test/u/tok")
    expect(out.html).toContain(UNSUBSCRIBE_FOOTER_SENTENCE)
  })

  it("collapses newlines in a spliced value, so a subject cannot carry a header injection", () => {
    const out = render({
      subject: "About {{camp_name}}",
      enrolmentMetadata: { camp_name: "Summer\r\nBcc: someone@evil.test" },
    })

    expect(out.subject).not.toContain("\n")
    expect(out.subject).not.toContain("\r")
    expect(out.subject).toBe("About Summer Bcc: someone@evil.test")
  })
})

describe("renderSequenceEmail brand colours", () => {
  const BRAND_FALLBACK = "#0E3F50"
  const ACCENT_FALLBACK = "#C49B7A"

  it("uses the layout's own colours when the tenant has chosen none", () => {
    // NULL until a coach picks a palette, and never defaulted — so this is the
    // answer for every tenant today, not a placeholder.
    const out = render({})

    expect(out.html).toContain(BRAND_FALLBACK)
    expect(out.html).toContain(ACCENT_FALLBACK)
  })

  it("paints the header band and the strip in the tenant's own colours", () => {
    const out = render({ settings: { ...settingsA, brand_color: "#123456", accent_color: "#abcdef" } })

    expect(out.html).toContain("background-color:#123456")
    expect(out.html).toContain("background:#abcdef")
    // And the layout's defaults are gone, rather than both being present.
    expect(out.html).not.toContain(BRAND_FALLBACK)
    expect(out.html).not.toContain(ACCENT_FALLBACK)
  })

  it("DERIVES the accent from the brand when a coach picked one and left the accent blank", () => {
    // That is the state the write route models explicitly, and the funnel side
    // already answers it with `resolvePalette`. Falling back to the layout's
    // own gold here would give a coach their brand band above the incumbent
    // tenant's strip — the one combination nobody chose.
    const out = render({ settings: { ...settingsA, brand_color: "#123456", accent_color: null } })

    expect(out.html).toContain("background-color:#123456")
    expect(out.html).not.toContain(ACCENT_FALLBACK)
  })

  it("prints the wordmark in an ink that can be READ on the chosen band", () => {
    // A pale brand with the hardcoded white wordmark is a business name
    // invisible in every sequence email. `resolvePalette` measures the contrast
    // rather than thresholding, so the answer here is black.
    const pale = render({ settings: { ...settingsA, brand_color: "#fff8e1" } })
    expect(pale.html).toContain("color:#000000")

    // The presence control: a dark brand still gets white.
    const dark = render({ settings: { ...settingsA, brand_color: "#101820" } })
    expect(dark.html).toContain("color:#ffffff")
  })

  it("REFUSES anything that is not a plain hex, rather than splicing it into a style attribute", () => {
    // `escapeHtml` would stop a quote breaking out, but this needs no quote:
    // a second declaration loads a remote image, which is a tracking pixel
    // somebody else chose.
    const out = render({
      settings: {
        ...settingsA,
        brand_color: "red; background-image:url(https://tracker.example/x.png)",
        accent_color: "javascript:alert(1)",
      },
    })

    expect(out.html).not.toContain("tracker.example")
    expect(out.html).not.toContain("javascript:")
    expect(out.html).toContain(BRAND_FALLBACK)
    expect(out.html).toContain(ACCENT_FALLBACK)
  })

  it("accepts ONLY #rrggbb — the exact shape three other places already enforce", () => {
    // `paletteSchema`'s `hexColor`, POST /api/admin/businesses/brand and
    // migration 00260's CHECK constraints all require six digits, so nothing
    // else can be in the column. Accepting a short or long hex here would be
    // this file disagreeing with the database about what a colour is, and
    // `resolvePalette` throws on one.
    expect(render({ settings: { ...settingsA, brand_color: "#AABBCC" } }).html).toContain("background-color:#aabbcc")
    expect(render({ settings: { ...settingsA, brand_color: "#abc" } }).html).toContain("background-color:#0E3F50")
    expect(render({ settings: { ...settingsA, brand_color: "#aabbccdd" } }).html).toContain("background-color:#0E3F50")
  })

  it("keeps the default strip a real gradient, and a chosen one flat", () => {
    // Three stops of one colour is a no-op wearing a gradient's clothes, and
    // there is no honest way to derive a lighter midpoint for an arbitrary
    // brand — so the gradient belongs to the default palette only.
    expect(render({}).html).toContain("linear-gradient(90deg, #C49B7A 0%, #d4b08e 50%, #C49B7A 100%)")
    expect(render({ settings: { ...settingsA, brand_color: "#123456", accent_color: "#abcdef" } }).html).not.toContain(
      "linear-gradient",
    )
  })
})
