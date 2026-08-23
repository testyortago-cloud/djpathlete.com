// @vitest-environment node
//
// The `smsok.` token family, and the one property that actually keeps it
// separate from every other HMAC family in this repo.
//
// lib/lead-engine/unsubscribe-token.ts's header states the constraint this
// file exists to prove: every token family here signs with NEXTAUTH_SECRET,
// so a well-signed token from ANY family passes every OTHER family's
// signature check. Only an explicit, checked marker stops a foreign token.
// The stakes are worse in this direction than in the unsubscribe one: a
// foreign token accepted here would GRANT permission to text somebody who
// never asked for it, and that fabricated consent row is the exact artefact
// a carrier or a regulator would be shown as evidence.
import { describe, it, expect, beforeAll } from "vitest"
import { createHmac } from "crypto"
import { signSmsConsentToken, verifySmsConsentToken, smsConsentUrl } from "@/lib/lead-engine/sms-consent-token"
import { signUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/lead-engine/unsubscribe-token"
import { signPersonalCheckinToken, verifyPersonalCheckinToken } from "@/lib/qr/checkin-token"

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret"
})

const CONTACT = "3f9a2b6c-1d4e-4f7a-9b0c-8d5e6f7a8b9c"
const BUSINESS = "00000000-0000-0000-0000-000000000001"

describe("sms consent token", () => {
  it("round-trips a contact and business id", () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    expect(verifySmsConsentToken(token)).toEqual({ valid: true, contactId: CONTACT, businessId: BUSINESS })
  })

  it("rejects a tampered signature", () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    expect(verifySmsConsentToken(token.slice(0, -2) + "xx")).toEqual({ valid: false })
  })

  it("rejects a token whose payload was swapped for another contact", () => {
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    const [b64, sig] = token.split(".")
    const decoded = Buffer.from(b64, "base64url").toString()
    const swapped = decoded.replace(CONTACT, "aaaaaaaa-0000-0000-0000-000000000000")
    const swappedB64 = Buffer.from(swapped).toString("base64url")
    expect(verifySmsConsentToken(`${swappedB64}.${sig}`)).toEqual({ valid: false })
  })

  it("rejects a malformed token", () => {
    expect(verifySmsConsentToken("garbage")).toEqual({ valid: false })
  })

  // ---------------------------------------------------------------------
  // Cross-family rejection, BOTH DIRECTIONS.
  //
  // One direction on its own is not the guard. An unsubscribe link that
  // granted SMS consent and an SMS-consent link that unsubscribed someone
  // are two different bugs, and each family's own marker check is what
  // prevents its own half.
  // ---------------------------------------------------------------------
  it("REJECTS an unsubscribe token — a revocation link must never grant consent", () => {
    const foreign = signUnsubscribeToken(CONTACT, BUSINESS)
    expect(verifySmsConsentToken(foreign)).toEqual({ valid: false })
  })

  it("is itself rejected by verifyUnsubscribeToken — the guard runs both ways", () => {
    const ours = signSmsConsentToken(CONTACT, BUSINESS)
    expect(verifyUnsubscribeToken(ours)).toEqual({ valid: false })
  })

  it("REJECTS a personal check-in token", () => {
    const foreign = signPersonalCheckinToken("some-user-id")
    expect(verifySmsConsentToken(foreign)).toEqual({ valid: false })
  })

  it("is itself rejected by verifyPersonalCheckinToken", () => {
    const ours = signSmsConsentToken(CONTACT, BUSINESS)
    expect(verifyPersonalCheckinToken(ours)).toEqual({ valid: false })
  })

  it("rejects a well-signed 3-segment token whose first segment is not the smsok marker", () => {
    // Isolates the `smsok.` literal check itself. The unsubscribe family
    // produces the SAME 3-segment shape, so the shape check alone cannot be
    // what rejects it — but building the payload here by hand, with the
    // correct shape and only the marker wrong, is the only construction that
    // proves the literal comparison is read at all.
    const payload = `notsmsok.${CONTACT}.${BUSINESS}`
    const b64 = Buffer.from(payload).toString("base64url")
    const sig = createHmac("sha256", process.env.NEXTAUTH_SECRET as string)
      .update(b64)
      .digest("base64url")
    expect(verifySmsConsentToken(`${b64}.${sig}`)).toEqual({ valid: false })
  })

  it("rejects a 4-segment payload that merely STARTS with the marker", () => {
    const payload = `smsok.${CONTACT}.${BUSINESS}.extra`
    const b64 = Buffer.from(payload).toString("base64url")
    const sig = createHmac("sha256", process.env.NEXTAUTH_SECRET as string)
      .update(b64)
      .digest("base64url")
    expect(verifySmsConsentToken(`${b64}.${sig}`)).toEqual({ valid: false })
  })

  it("rejects a payload with an empty contact or business id", () => {
    for (const payload of [`smsok..${BUSINESS}`, `smsok.${CONTACT}.`]) {
      const b64 = Buffer.from(payload).toString("base64url")
      const sig = createHmac("sha256", process.env.NEXTAUTH_SECRET as string)
        .update(b64)
        .digest("base64url")
      expect(verifySmsConsentToken(`${b64}.${sig}`)).toEqual({ valid: false })
    }
  })

  describe("smsConsentUrl", () => {
    it("builds a URL whose token verifies back to the same contact and business", () => {
      const url = smsConsentUrl("https://example.com", CONTACT, BUSINESS)
      expect(url.startsWith("https://example.com/sms-consent/")).toBe(true)
      const token = url.split("/sms-consent/")[1]
      expect(verifySmsConsentToken(token)).toEqual({ valid: true, contactId: CONTACT, businessId: BUSINESS })
    })

    it("does not double up a slash when baseUrl already has a trailing one", () => {
      const url = smsConsentUrl("https://example.com/", CONTACT, BUSINESS)
      expect(url).not.toContain("//sms-consent")
    })
  })
})
