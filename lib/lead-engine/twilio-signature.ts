// lib/lead-engine/twilio-signature.ts — validates the `X-Twilio-Signature`
// header Twilio attaches to every webhook request, including the SMS status
// callback app/api/webhooks/twilio/status/route.ts (Task 4) receives.
//
// Twilio's documented scheme (Request Validation,
// https://www.twilio.com/docs/usage/webhooks/webhooks-security): HMAC-SHA1,
// keyed by the account auth token, over the exact public URL the request was
// POSTed to, followed by every POST param's key and value concatenated in
// ASCII-sorted key order with no delimiter. Base64-encode the digest and
// compare it, in constant time, to the header.
//
// Deliberately node:crypto rather than the `twilio` npm SDK — same rationale
// as lib/lead-engine/sms.ts's header comment: one HMAC check doesn't justify
// a dependency, and the public surface would look identical either way.

import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * True iff `signature` is the correct Twilio signature for `params` POSTed
 * to `url`, signed with `authToken`.
 *
 * The digest comparison is constant-time (`crypto.timingSafeEqual`) — a
 * branch on early mismatch would let a timing attack narrow down the correct
 * signature byte by byte. `timingSafeEqual` itself throws on a length
 * mismatch rather than returning false, so the length check happens first
 * and explicitly: an unequal-length signature (a malformed or truncated
 * header — Twilio's own signatures are always the same length) answers
 * `false` directly rather than letting that throw escape and turn a bad
 * webhook payload into a 500.
 */
export function validateTwilioSignature(args: {
  url: string
  params: Record<string, string>
  signature: string
  authToken: string
}): boolean {
  const { url, params, signature, authToken } = args

  const sortedKeys = Object.keys(params).sort()
  const data = url + sortedKeys.map((key) => `${key}${params[key]}`).join("")
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64")

  const expectedBuf = Buffer.from(expected, "utf8")
  const signatureBuf = Buffer.from(signature, "utf8")
  if (expectedBuf.length !== signatureBuf.length) return false

  return timingSafeEqual(expectedBuf, signatureBuf)
}
