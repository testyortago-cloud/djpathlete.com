// lib/resend/signature.ts — verifies the Svix signature on every delivery to
// app/api/webhooks/resend/route.ts (G09).
//
// Resend signs webhooks with Svix. The scheme (Svix "Verifying Webhooks",
// checked 2026-09-20) is three headers:
//
//   svix-id          the message id, unique per delivery
//   svix-timestamp   unix seconds
//   svix-signature   space-separated list of `v<version>,<base64 digest>`
//
// The digest is HMAC-SHA256 over the string `${svix-id}.${svix-timestamp}.${body}`,
// keyed by the RAW BYTES of the secret — i.e. the part after `whsec_`,
// base64-DECODED. Keying with the literal string is the classic mistake here:
// it produces a perfectly well-formed digest that never matches.
//
// THREE PROPERTIES THIS BUYS, and each one is load-bearing on that route:
//
//   1. The body is signed, so nobody can change which message was opened.
//      The route must therefore read `request.text()` BEFORE any JSON parse —
//      a re-serialised body is not the signed body. (The same rule as
//      lib/calendly/signature.ts, and the reason a compact-JSON round trip was
//      once the only survivor of a mutation sweep on the Calendly route.)
//   2. The ID is signed, so a captured delivery cannot be replayed under a
//      fresh id inside the tolerance window.
//   3. The TIMESTAMP is signed and checked in both directions, so a captured
//      delivery expires.
//
// NOT TWILIO'S SCHEME: nothing about the URL is signed, so the apex-vs-www
// failure this repo has already paid for cannot happen here.
//
// The header can carry SEVERAL signatures at once — that is how Svix rotates a
// secret without dropping deliveries — so any one matching is a pass.
//
// node:crypto rather than the `svix` package: one HMAC does not justify a
// dependency, which is the same call lib/calendly/signature.ts and
// lib/lead-engine/twilio-signature.ts both made.

import { createHmac, timingSafeEqual } from "node:crypto"

export const SVIX_ID_HEADER = "svix-id"
export const SVIX_TIMESTAMP_HEADER = "svix-timestamp"
export const SVIX_SIGNATURE_HEADER = "svix-signature"

/** Svix's own documented tolerance. Applied in both directions. */
export const SVIX_TOLERANCE_SECONDS = 300

export type SvixVerdict =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "missing" | "malformed" | "stale" | "mismatch" }

/**
 * `true` only for a signature this secret actually produced, over this exact
 * body, for this exact delivery id, within the tolerance window.
 *
 * Never throws: a malformed header is a verdict, not an exception, so the
 * route can answer a status code rather than a 500 that invites Svix to retry
 * a delivery that will never verify.
 */
export function verifySvixSignature(args: {
  secret: string | null | undefined
  id: string | null | undefined
  timestamp: string | null | undefined
  signatureHeader: string | null | undefined
  body: string
  /** Injectable so a test can pin the window instead of racing the clock. */
  nowSeconds?: number
}): SvixVerdict {
  const { secret, id, timestamp, signatureHeader, body } = args

  // A missing secret is its OWN verdict, never a mismatch. Deployed without
  // the env var, every delivery would otherwise look like an attack in the
  // logs, and the real fault — nobody set RESEND_WEBHOOK_SECRET — would be
  // invisible behind a wall of "invalid signature".
  if (!secret) return { ok: false, reason: "not_configured" }
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: "missing" }
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: "malformed" }

  const sent = Number(timestamp)
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - sent) > SVIX_TOLERANCE_SECONDS) return { ok: false, reason: "stale" }

  const offered = signatureHeader
    .split(" ")
    .map((piece) => piece.trim())
    .filter((piece) => piece.startsWith("v1,"))
    .map((piece) => piece.slice("v1,".length))
  if (offered.length === 0) return { ok: false, reason: "malformed" }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest()

  for (const candidate of offered) {
    let decoded: Buffer
    try {
      decoded = Buffer.from(candidate, "base64")
    } catch {
      continue
    }
    // Length-check first: timingSafeEqual THROWS on a length mismatch rather
    // than returning false, and an attacker controls this length.
    if (decoded.length === expected.length && timingSafeEqual(decoded, expected)) {
      return { ok: true }
    }
  }

  return { ok: false, reason: "mismatch" }
}
