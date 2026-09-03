// lib/calendly/signature.ts — verifies the `Calendly-Webhook-Signature`
// header on every delivery to app/api/webhooks/calendly/route.ts.
//
// Calendly's documented scheme (Webhook Signatures, developer.calendly.com,
// checked 2026-09-03): the header is `t=<unix seconds>,v1=<hex digest>`. The
// digest is HMAC-SHA256, keyed by the signing key WE chose when the
// subscription was created, over the string `t + "." + <raw request body>`.
// The docs recommend rejecting anything whose `t` is more than three minutes
// old, to stop a captured delivery being replayed.
//
// THIS IS NOT TWILIO'S SCHEME, AND THE DIFFERENCE MATTERS HERE. Twilio's HMAC
// covers the full request URL, which is why an apex-vs-www mismatch once
// failed every check in this repo. Nothing about the URL is signed by
// Calendly, so that class of failure cannot happen — but a different one can:
// the signed bytes are the RAW body, so the route must read `request.text()`
// BEFORE any JSON parsing. A re-serialised body is not the signed body.
//
// Deliberately node:crypto — one HMAC does not justify a dependency (the same
// call lib/lead-engine/twilio-signature.ts made).

import { createHmac, timingSafeEqual } from "node:crypto"

export const CALENDLY_SIGNATURE_HEADER = "calendly-webhook-signature"

/** Three minutes, per Calendly's own example. Applied in both directions. */
export const CALENDLY_SIGNATURE_TOLERANCE_SECONDS = 180

export type SignatureVerdict =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" }

/** Parses `t=…,v1=…` in either order; null when either part is absent or `t` is not an integer. */
export function parseSignatureHeader(header: string | null | undefined): { t: number; v1: string } | null {
  if (!header) return null
  const parts: Record<string, string> = {}
  for (const piece of header.split(",")) {
    const idx = piece.indexOf("=")
    if (idx <= 0) continue
    parts[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim()
  }
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1 || !/^\d+$/.test(t)) return null
  return { t: Number(t), v1 }
}

/** The expected `v1` for a body signed at `timestampSeconds`. Exported so tests and scripts sign the same way. */
export function signCalendlyPayload(args: { rawBody: string; signingKey: string; timestampSeconds: number }): string {
  return createHmac("sha256", args.signingKey).update(`${args.timestampSeconds}.${args.rawBody}`, "utf8").digest("hex")
}

/** A complete header value for `rawBody`, for tests and the acceptance script. */
export function buildSignatureHeader(args: { rawBody: string; signingKey: string; timestampSeconds: number }): string {
  return `t=${args.timestampSeconds},v1=${signCalendlyPayload(args)}`
}

/**
 * True iff `header` is a valid, fresh Calendly signature for `rawBody` under
 * `signingKey`. The digest comparison is constant-time; the length check
 * before it is explicit because `timingSafeEqual` throws on unequal lengths
 * rather than returning false, and a malformed header must answer `false`,
 * not 500.
 */
export function verifyCalendlySignature(args: {
  header: string | null | undefined
  rawBody: string
  signingKey: string
  nowSeconds?: number
  toleranceSeconds?: number
}): SignatureVerdict {
  if (!args.header) return { ok: false, reason: "missing" }

  const parsed = parseSignatureHeader(args.header)
  if (!parsed) return { ok: false, reason: "malformed" }

  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = args.toleranceSeconds ?? CALENDLY_SIGNATURE_TOLERANCE_SECONDS
  if (Math.abs(now - parsed.t) > tolerance) return { ok: false, reason: "stale" }

  const expected = Buffer.from(
    signCalendlyPayload({ rawBody: args.rawBody, signingKey: args.signingKey, timestampSeconds: parsed.t }),
    "utf8",
  )
  const provided = Buffer.from(parsed.v1, "utf8")
  if (expected.length !== provided.length) return { ok: false, reason: "mismatch" }
  if (!timingSafeEqual(expected, provided)) return { ok: false, reason: "mismatch" }

  return { ok: true }
}
