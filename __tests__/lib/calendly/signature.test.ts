// @vitest-environment node
//
// lib/calendly/signature.ts. Every verdict is exercised, and the expected
// digest in the first test is computed independently with node:crypto rather
// than through the module's own signer — a test that signs and verifies with
// the same function passes for any scheme at all.
import { describe, it, expect } from "vitest"
import { createHmac } from "node:crypto"

import {
  CALENDLY_SIGNATURE_TOLERANCE_SECONDS,
  buildSignatureHeader,
  parseSignatureHeader,
  verifyCalendlySignature,
} from "@/lib/calendly/signature"

const KEY = "0123456789abcdef0123456789abcdef"
const BODY = '{"event":"invitee.created","payload":{"email":"a@b.test"}}'
const NOW = 1_800_000_000

function independentHeader(t: number, body = BODY, key = KEY): string {
  const v1 = createHmac("sha256", key).update(`${t}.${body}`).digest("hex")
  return `t=${t},v1=${v1}`
}

describe("verifyCalendlySignature", () => {
  it("accepts HMAC-SHA256 over `t.rawBody` computed independently", () => {
    const verdict = verifyCalendlySignature({ header: independentHeader(NOW), rawBody: BODY, signingKey: KEY, nowSeconds: NOW })
    expect(verdict).toEqual({ ok: true })
  })

  it("agrees with the module's own header builder (so scripts and tests sign the same way)", () => {
    const header = buildSignatureHeader({ rawBody: BODY, signingKey: KEY, timestampSeconds: NOW })
    expect(header).toBe(independentHeader(NOW))
  })

  it("rejects a body that differs by one byte — the RAW body is what is signed", () => {
    const verdict = verifyCalendlySignature({
      header: independentHeader(NOW),
      rawBody: BODY.replace("a@b.test", "a@b.tesT"),
      signingKey: KEY,
      nowSeconds: NOW,
    })
    expect(verdict).toEqual({ ok: false, reason: "mismatch" })
  })

  it("rejects a re-serialised body even when it means the same JSON", () => {
    const pretty = JSON.stringify(JSON.parse(BODY), null, 2)
    expect(verifyCalendlySignature({ header: independentHeader(NOW), rawBody: pretty, signingKey: KEY, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "mismatch",
    })
  })

  it("rejects the wrong key", () => {
    expect(verifyCalendlySignature({ header: independentHeader(NOW), rawBody: BODY, signingKey: "other", nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "mismatch",
    })
  })

  it("rejects a timestamp older than the tolerance (replay)", () => {
    const old = NOW - CALENDLY_SIGNATURE_TOLERANCE_SECONDS - 1
    expect(verifyCalendlySignature({ header: independentHeader(old), rawBody: BODY, signingKey: KEY, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "stale",
    })
  })

  it("rejects a timestamp too far in the future too", () => {
    const future = NOW + CALENDLY_SIGNATURE_TOLERANCE_SECONDS + 1
    expect(verifyCalendlySignature({ header: independentHeader(future), rawBody: BODY, signingKey: KEY, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "stale",
    })
  })

  it("accepts a timestamp exactly at the tolerance edge", () => {
    const edge = NOW - CALENDLY_SIGNATURE_TOLERANCE_SECONDS
    expect(verifyCalendlySignature({ header: independentHeader(edge), rawBody: BODY, signingKey: KEY, nowSeconds: NOW })).toEqual({ ok: true })
  })

  it("does not compute a digest for a stale header — staleness is checked before the HMAC", () => {
    // A stale header with a CORRECT digest is still stale; a stale header with
    // a garbage digest is reported as stale, not mismatch. If the digest were
    // checked first the second case would say "mismatch".
    const old = NOW - 10_000
    expect(verifyCalendlySignature({ header: `t=${old},v1=deadbeef`, rawBody: BODY, signingKey: KEY, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "stale",
    })
  })

  it("answers missing / malformed without throwing", () => {
    expect(verifyCalendlySignature({ header: null, rawBody: BODY, signingKey: KEY, nowSeconds: NOW })).toEqual({ ok: false, reason: "missing" })
    expect(verifyCalendlySignature({ header: "", rawBody: BODY, signingKey: KEY, nowSeconds: NOW })).toEqual({ ok: false, reason: "missing" })
    expect(verifyCalendlySignature({ header: "v1=abc", rawBody: BODY, signingKey: KEY, nowSeconds: NOW })).toEqual({ ok: false, reason: "malformed" })
    expect(verifyCalendlySignature({ header: `t=${NOW}`, rawBody: BODY, signingKey: KEY, nowSeconds: NOW })).toEqual({ ok: false, reason: "malformed" })
    expect(verifyCalendlySignature({ header: `t=soon,v1=abc`, rawBody: BODY, signingKey: KEY, nowSeconds: NOW })).toEqual({ ok: false, reason: "malformed" })
    // A digest of the wrong length must be a plain `false`, not a timingSafeEqual throw.
    expect(verifyCalendlySignature({ header: `t=${NOW},v1=abc`, rawBody: BODY, signingKey: KEY, nowSeconds: NOW })).toEqual({ ok: false, reason: "mismatch" })
  })

  it("parses the two parts in either order and ignores whitespace", () => {
    expect(parseSignatureHeader(`v1=abc, t=${NOW}`)).toEqual({ t: NOW, v1: "abc" })
    expect(parseSignatureHeader(` t=${NOW} , v1=abc `)).toEqual({ t: NOW, v1: "abc" })
  })
})
