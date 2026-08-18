// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest"
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrl,
} from "@/lib/lead-engine/unsubscribe-token"
import { signPersonalCheckinToken, verifyPersonalCheckinToken } from "@/lib/qr/checkin-token"

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret"
})

const CONTACT = "3f9a2b6c-1d4e-4f7a-9b0c-8d5e6f7a8b9c"
const BUSINESS = "00000000-0000-0000-0000-000000000001"

describe("unsubscribe token", () => {
  it("round-trips a contact and business id", () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    expect(verifyUnsubscribeToken(token)).toEqual({ valid: true, contactId: CONTACT, businessId: BUSINESS })
  })

  it("rejects a tampered signature", () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    expect(verifyUnsubscribeToken(token.slice(0, -2) + "xx")).toEqual({ valid: false })
  })

  it("rejects a token whose payload was swapped for another contact", () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    const [b64, sig] = token.split(".")
    const decoded = Buffer.from(b64, "base64url").toString()
    // Same shape, different contact — re-encoded but keeping the ORIGINAL
    // signature (an attacker who cannot compute a valid HMAC without the
    // secret still tries substituting the payload).
    const swapped = decoded.replace(CONTACT, "aaaaaaaa-0000-0000-0000-000000000000")
    const swappedB64 = Buffer.from(swapped).toString("base64url")
    expect(verifyUnsubscribeToken(`${swappedB64}.${sig}`)).toEqual({ valid: false })
  })

  it("rejects a malformed token", () => {
    expect(verifyUnsubscribeToken("garbage")).toEqual({ valid: false })
  })

  it("REJECTS a personal check-in token — token families must not cross-validate", () => {
    // This is the regression guard for the documented `pc.`/NaN bug in
    // lib/qr/checkin-token.ts: every HMAC token family in this codebase
    // shares NEXTAUTH_SECRET, so only an explicit family marker check stops
    // a well-signed foreign token from validating here.
    const foreign = signPersonalCheckinToken("some-user-id")
    expect(verifyUnsubscribeToken(foreign)).toEqual({ valid: false })
  })

  it("is itself rejected by verifyPersonalCheckinToken — the guard runs both ways", () => {
    const ours = signUnsubscribeToken(CONTACT, BUSINESS)
    expect(verifyPersonalCheckinToken(ours)).toEqual({ valid: false })
  })

  describe("unsubscribeUrl", () => {
    it("builds a URL whose token verifies back to the same contact and business", () => {
      const url = unsubscribeUrl("https://example.com", CONTACT, BUSINESS)
      expect(url.startsWith("https://example.com/unsubscribe/")).toBe(true)
      const token = url.split("/unsubscribe/")[1]
      expect(verifyUnsubscribeToken(token)).toEqual({ valid: true, contactId: CONTACT, businessId: BUSINESS })
    })

    it("does not double up a slash when baseUrl already has a trailing one", () => {
      const url = unsubscribeUrl("https://example.com/", CONTACT, BUSINESS)
      expect(url).not.toContain("//unsubscribe")
    })
  })
})
