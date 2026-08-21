// @vitest-environment node
//
// lib/lead-engine/twilio-signature.ts — validates the `X-Twilio-Signature`
// header Twilio attaches to every status callback. Twilio's documented
// scheme: HMAC-SHA1, keyed by the account auth token, over
// `url + sortedKeys.map(k => k + params[k]).join("")`, base64-encoded, and
// compared to the header in constant time.

import { describe, it, expect } from "vitest"
import { validateTwilioSignature } from "@/lib/lead-engine/twilio-signature"

// ─── Golden vector ──────────────────────────────────────────────────────────
//
// Fixed inputs below. The expected signature is pinned as a literal, derived
// OUTSIDE the implementation under test (so this is a real external check,
// not a tautology that would pass even if validateTwilioSignature signed the
// wrong bytes).
//
//   AUTH_TOKEN = "test_auth_token_12345"
//   SIGNED_URL = "https://example.test/api/webhooks/twilio/status"
//   PARAMS     = { MessageSid: "SMabc123", MessageStatus: "delivered", To: "+15551234567" }
//
// Twilio's scheme ASCII-sorts the param keys and concatenates key+value
// pairs directly onto the URL with no delimiter between pairs or between the
// url and the first pair:
//   sortedKeys = ["MessageSid", "MessageStatus", "To"]
//     ("MessageSid" < "MessageStatus": both share the "Message" prefix, then
//     'i' < 't'; "To" sorts last because 'T' > 'M' in ASCII)
//   data = SIGNED_URL
//        + "MessageSid"     + "SMabc123"
//        + "MessageStatus"  + "delivered"
//        + "To"             + "+15551234567"
//        = "https://example.test/api/webhooks/twilio/statusMessageSidSMabc123MessageStatusdeliveredTo+15551234567"
//
// EXPECTED_SIGNATURE was computed independently of this codebase's
// implementation via:
//   node -e 'const c=require("crypto");console.log(c.createHmac("sha1","test_auth_token_12345").update("https://example.test/api/webhooks/twilio/statusMessageSidSMabc123MessageStatusdeliveredTo+15551234567","utf8").digest("base64"))'
// which printed "hJ2DYjebyLz8AL+A3Nv2RiE9QdM=" — pinned below as a literal,
// never recomputed at test time.

const AUTH_TOKEN = "test_auth_token_12345"
const SIGNED_URL = "https://example.test/api/webhooks/twilio/status"
const PARAMS = { MessageSid: "SMabc123", MessageStatus: "delivered", To: "+15551234567" }
const EXPECTED_SIGNATURE = "hJ2DYjebyLz8AL+A3Nv2RiE9QdM="

describe("validateTwilioSignature", () => {
  it("accepts the golden vector's independently-derived signature", () => {
    expect(
      validateTwilioSignature({
        url: SIGNED_URL,
        params: PARAMS,
        signature: EXPECTED_SIGNATURE,
        authToken: AUTH_TOKEN,
      }),
    ).toBe(true)
  })

  it("rejects when a single param byte changes (signature stays the same length)", () => {
    // Last character of MessageStatus flipped: "delivered" -> "delivereD".
    // Same string length, so this exercises the "wrong bytes, same length"
    // path distinctly from the unequal-length tests below.
    const tampered = { ...PARAMS, MessageStatus: "delivereD" }
    expect(
      validateTwilioSignature({
        url: SIGNED_URL,
        params: tampered,
        signature: EXPECTED_SIGNATURE,
        authToken: AUTH_TOKEN,
      }),
    ).toBe(false)
  })

  it("rejects a shorter signature without throwing", () => {
    const shortSignature = EXPECTED_SIGNATURE.slice(0, -1)
    expect(() =>
      validateTwilioSignature({ url: SIGNED_URL, params: PARAMS, signature: shortSignature, authToken: AUTH_TOKEN }),
    ).not.toThrow()
    expect(
      validateTwilioSignature({ url: SIGNED_URL, params: PARAMS, signature: shortSignature, authToken: AUTH_TOKEN }),
    ).toBe(false)
  })

  it("rejects an empty signature without throwing", () => {
    expect(() =>
      validateTwilioSignature({ url: SIGNED_URL, params: PARAMS, signature: "", authToken: AUTH_TOKEN }),
    ).not.toThrow()
    expect(validateTwilioSignature({ url: SIGNED_URL, params: PARAMS, signature: "", authToken: AUTH_TOKEN })).toBe(
      false,
    )
  })

  it("rejects a much longer signature without throwing", () => {
    const longSignature = EXPECTED_SIGNATURE + "extra-bytes-that-do-not-belong"
    expect(() =>
      validateTwilioSignature({ url: SIGNED_URL, params: PARAMS, signature: longSignature, authToken: AUTH_TOKEN }),
    ).not.toThrow()
    expect(
      validateTwilioSignature({ url: SIGNED_URL, params: PARAMS, signature: longSignature, authToken: AUTH_TOKEN }),
    ).toBe(false)
  })

  it("rejects the right signature under the wrong auth token", () => {
    expect(
      validateTwilioSignature({
        url: SIGNED_URL,
        params: PARAMS,
        signature: EXPECTED_SIGNATURE,
        authToken: "wrong_token",
      }),
    ).toBe(false)
  })

  it("rejects the right signature over a tampered URL", () => {
    expect(
      validateTwilioSignature({
        url: SIGNED_URL + "x",
        params: PARAMS,
        signature: EXPECTED_SIGNATURE,
        authToken: AUTH_TOKEN,
      }),
    ).toBe(false)
  })
})
