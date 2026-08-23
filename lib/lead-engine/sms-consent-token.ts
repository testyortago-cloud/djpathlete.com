// lib/lead-engine/sms-consent-token.ts — the signed link a contact taps to
// say "yes, you can text me".
//
// Same HMAC construction as lib/lead-engine/unsubscribe-token.ts (`unsub.`),
// lib/qr/checkin-token.ts (`pc.`) and lib/profile-share/token.ts (`ap.`):
// HMAC-SHA256 over NEXTAUTH_SECRET, base64url, timingSafeEqual. Every token
// family in this codebase shares that secret, so a well-signed token from ANY
// family verifies its signature correctly against every OTHER family's
// verifier too — the only thing that can stop a foreign token from being
// accepted is an explicit, checked marker. That is the `smsok.` literal
// below, checked on every verify.
//
// THIS FAMILY IS THE ONE WHERE CROSS-VALIDATION WOULD BE WORST. The
// unsubscribe family's failure mode is over-honouring a person's wishes: a
// foreign token accepted there unsubscribes somebody who never asked to be
// unsubscribed. Here it runs the other way — a foreign token accepted here
// would file a `contact_consents` row saying a person AGREED TO BE TEXTED
// when they did nothing of the sort, and that row is precisely the artefact
// produced as evidence if a carrier or a regulator asks why this business
// texted them. Fabricated consent is not a UX bug; it is the thing the
// consent record exists to make impossible.
//
// __tests__/lib/lead-engine/sms-consent-token.test.ts proves the guard holds
// in BOTH directions against the nearest neighbour — this file rejects an
// `unsub.` token, and `verifyUnsubscribeToken` rejects this file's tokens
// right back — because one direction alone leaves the other half of the pair
// unguarded.

import { createHmac, timingSafeEqual } from "crypto"

function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? "dev-insecure-secret"
}

/** token = base64url("smsok.<contactId>.<businessId>").hmac */
export function signSmsConsentToken(contactId: string, businessId: string): string {
  const b64 = Buffer.from(`smsok.${contactId}.${businessId}`).toString("base64url")
  const sig = createHmac("sha256", secret()).update(b64).digest("base64url")
  return `${b64}.${sig}`
}

export type SmsConsentVerify = { valid: true; contactId: string; businessId: string } | { valid: false }

/**
 * Verifies signature + the `smsok.` marker + exact payload shape.
 *
 * NO EXPIRY, for the same reason `verifyUnsubscribeToken` has none: the email
 * carrying this link may sit unread in an inbox for weeks, and a re-permission
 * ask that quietly stops working is worse than useless — the contact taps it,
 * gets a dead page, and the business is left with no answer either way. The
 * link grants nothing on its own: tapping it only renders a page, and the
 * consent row is written solely by the explicit press of the "I agree" button
 * on that page (see lib/lead-engine/sms-consent.ts).
 */
export function verifySmsConsentToken(token: string): SmsConsentVerify {
  const parts = token.split(".")
  if (parts.length !== 2) return { valid: false }
  const [b64, sig] = parts
  const expected = createHmac("sha256", secret()).update(b64).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  // The length guard is not decoration: timingSafeEqual THROWS on
  // mismatched lengths rather than returning false, so a short signature
  // would become a 500 instead of a rejection.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false }

  const segs = Buffer.from(b64, "base64url").toString().split(".")
  // The `smsok.` marker (plus the exact 3-segment shape it implies) is the
  // ONLY thing separating this family from every other HMAC token sharing
  // NEXTAUTH_SECRET — including `unsub.`, which produces the very same
  // 3-segment shape, so the shape check alone rejects nothing here. Do not
  // relax this to a `startsWith`, and do not drop the literal comparison —
  // see the file header.
  if (segs[0] !== "smsok" || segs.length !== 3) return { valid: false }

  const [, contactId, businessId] = segs
  if (!contactId || !businessId) return { valid: false }
  return { valid: true, contactId, businessId }
}

/**
 * Builds the public consent-page URL for a contact — the link rendered into
 * the `sms_repermission` sequence email in place of the
 * `{{sms_consent_url}}` placeholder (see `renderSequenceEmail` in
 * lib/lead-engine/email.ts).
 *
 * One path only, unlike the unsubscribe family's page/one-click pair. There
 * is no machine endpoint here on purpose: no RFC obliges a mail client to
 * POST this, and anything that fired it automatically would be fabricating
 * the agreement it claims to record.
 */
export function smsConsentUrl(baseUrl: string, contactId: string, businessId: string): string {
  const token = signSmsConsentToken(contactId, businessId)
  return `${baseUrl.replace(/\/+$/, "")}/sms-consent/${token}`
}
