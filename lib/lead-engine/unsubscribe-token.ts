// lib/lead-engine/unsubscribe-token.ts — the one-click unsubscribe link.
//
// Same HMAC construction as lib/qr/checkin-token.ts (`pc.` personal
// check-in, the bare `coachId.day` coach token) and lib/profile-share/token.ts
// (`ap.` athlete profile): HMAC-SHA256 over NEXTAUTH_SECRET, base64url,
// timingSafeEqual. Every token family in this codebase shares that secret,
// so a well-signed token from ANY family verifies its signature correctly
// against every OTHER family's verifier too — the only thing that can stop
// a foreign token from being accepted is an explicit, checked marker.
//
// lib/qr/checkin-token.ts documents exactly this going wrong: the coach
// verifier's date-age check received a non-date second segment from a `pc.`
// or `ap.` token, producing NaN, and `NaN < 0` is `false` — so without an
// explicit `Number.isNaN` guard the comparison silently failed OPEN instead
// of closed. This module's mistake-shaped version would be worse: a
// check-in QR or a profile-share link cross-validating here would silently
// unsubscribe someone from every sequence email they're enrolled in. The
// `unsub.` marker below, checked on every verify, is what prevents that —
// see __tests__/lib/lead-engine/unsubscribe-token.test.ts, which proves the
// guard holds in both directions (this file rejects a `pc.` token, and
// `verifyPersonalCheckinToken` rejects this file's tokens right back).

import { createHmac, timingSafeEqual } from "crypto"

function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? "dev-insecure-secret"
}

/** token = base64url("unsub.<contactId>.<businessId>").hmac */
export function signUnsubscribeToken(contactId: string, businessId: string): string {
  const b64 = Buffer.from(`unsub.${contactId}.${businessId}`).toString("base64url")
  const sig = createHmac("sha256", secret()).update(b64).digest("base64url")
  return `${b64}.${sig}`
}

export type UnsubVerify = { valid: true; contactId: string; businessId: string } | { valid: false }

/**
 * Verifies signature + the `unsub.` marker + exact payload shape. No
 * expiry — an unsubscribe link must keep working for as long as the email
 * that carried it might still be sitting unread in someone's inbox.
 */
export function verifyUnsubscribeToken(token: string): UnsubVerify {
  const parts = token.split(".")
  if (parts.length !== 2) return { valid: false }
  const [b64, sig] = parts
  const expected = createHmac("sha256", secret()).update(b64).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false }

  const segs = Buffer.from(b64, "base64url").toString().split(".")
  // The `unsub.` marker (plus the exact 3-segment shape it implies) is the
  // ONLY thing separating this family from every other HMAC token sharing
  // NEXTAUTH_SECRET. Do not relax this to `segs.length < 3` or drop the
  // literal comparison — see the file header.
  if (segs[0] !== "unsub" || segs.length !== 3) return { valid: false }

  const [, contactId, businessId] = segs
  if (!contactId || !businessId) return { valid: false }
  return { valid: true, contactId, businessId }
}

/** Builds the public unsubscribe URL for a contact, e.g. for an email footer. */
export function unsubscribeUrl(baseUrl: string, contactId: string, businessId: string): string {
  const token = signUnsubscribeToken(contactId, businessId)
  return `${baseUrl.replace(/\/+$/, "")}/unsubscribe/${token}`
}

/**
 * Builds the RFC 8058 one-click endpoint for the `List-Unsubscribe` header —
 * the URI a mail client POSTs to when the reader presses its unsubscribe
 * button.
 *
 * It is a DIFFERENT path from `unsubscribeUrl` above because Next.js App
 * Router cannot serve a `route.ts` and a `page.tsx` from the same segment:
 * both normalise to the same pathname. The human link keeps the rendered page
 * at `/unsubscribe/<token>`; the machine endpoint is
 * `/api/unsubscribe/<token>`. Both carry the same token and both run the same
 * flow (`processUnsubscribe`, lib/lead-engine/unsubscribe.ts).
 */
export function unsubscribeOneClickUrl(baseUrl: string, contactId: string, businessId: string): string {
  const token = signUnsubscribeToken(contactId, businessId)
  return `${baseUrl.replace(/\/+$/, "")}/api/unsubscribe/${token}`
}
