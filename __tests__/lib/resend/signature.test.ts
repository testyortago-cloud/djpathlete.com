// @vitest-environment node
//
// G09. Resend signs webhooks with Svix. This suite pins the scheme itself,
// because every other guarantee on that endpoint rests on it: an attacker who
// can forge a delivery can mark any message opened, and — with the bounce arm
// — suppress any address the engine knows.
import { describe, it, expect } from "vitest"
import { createHmac } from "node:crypto"
import { verifySvixSignature, SVIX_TOLERANCE_SECONDS } from "@/lib/resend/signature"

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"

/** Signs exactly the way Svix documents, so the test is not just the implementation twice. */
function sign(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  const digest = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")
  return `v1,${digest}`
}

const BODY = JSON.stringify({ type: "email.opened", data: { email_id: "abc" } })
const ID = "msg_2abc"

function now(): number {
  return Math.floor(Date.now() / 1000)
}

describe("verifySvixSignature", () => {
  it("matches Svix's OWN published test vector", () => {
    // Everything else in this file signs with a hand-rolled mirror of the
    // implementation, so a shared mistake — the classic being keying the HMAC
    // with the literal `whsec_…` string instead of its base64-decoded bytes —
    // would be green on both sides. This vector comes from Svix's docs, so it
    // is the one assertion here that could catch that.
    expect(
      verifySvixSignature({
        secret: "whsec_plJ3nmyCDGBKInavdOK15jsl",
        id: "msg_loFOjxBNrRLzqYUf",
        timestamp: "1731705121",
        signatureHeader: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
        body: '{"event_type":"ping","data":{"success":true}}',
        nowSeconds: 1731705121,
      }),
    ).toEqual({ ok: true })
  })

  it("accepts a correctly signed delivery", () => {
    const t = now()
    const verdict = verifySvixSignature({
      secret: SECRET,
      id: ID,
      timestamp: String(t),
      signatureHeader: sign(SECRET, ID, t, BODY),
      body: BODY,
    })
    expect(verdict).toEqual({ ok: true })
  })

  it("accepts when the header carries SEVERAL signatures and one matches", () => {
    // Svix sends space-separated versions during a secret rotation. Taking
    // only the first would reject every delivery mid-rotation.
    const t = now()
    const good = sign(SECRET, ID, t, BODY)
    const header = `v1,AAAAinvalidAAAA ${good}`
    expect(
      verifySvixSignature({ secret: SECRET, id: ID, timestamp: String(t), signatureHeader: header, body: BODY }),
    ).toEqual({ ok: true })
  })

  it("rejects a body that changed by one byte", () => {
    const t = now()
    const header = sign(SECRET, ID, t, BODY)
    const tampered = BODY.replace("email.opened", "email.clicked")
    expect(
      verifySvixSignature({ secret: SECRET, id: ID, timestamp: String(t), signatureHeader: header, body: tampered }),
    ).toEqual({ ok: false, reason: "mismatch" })
  })

  it("rejects a signature made with a different secret", () => {
    const t = now()
    const header = sign("whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ID, t, BODY)
    expect(
      verifySvixSignature({ secret: SECRET, id: ID, timestamp: String(t), signatureHeader: header, body: BODY }),
    ).toEqual({ ok: false, reason: "mismatch" })
  })

  it("rejects a REPLAYED delivery outside the tolerance, in both directions", () => {
    const stale = now() - SVIX_TOLERANCE_SECONDS - 5
    const future = now() + SVIX_TOLERANCE_SECONDS + 5
    for (const t of [stale, future]) {
      expect(
        verifySvixSignature({
          secret: SECRET,
          id: ID,
          timestamp: String(t),
          signatureHeader: sign(SECRET, ID, t, BODY),
          body: BODY,
        }),
      ).toEqual({ ok: false, reason: "stale" })
    }
  })

  it("binds the signature to the message id — a valid signature cannot be moved to another delivery", () => {
    // The id is part of the signed string. Without it, a captured delivery
    // could be replayed under a fresh id inside the tolerance window.
    const t = now()
    const header = sign(SECRET, ID, t, BODY)
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: "msg_different",
        timestamp: String(t),
        signatureHeader: header,
        body: BODY,
      }),
    ).toEqual({ ok: false, reason: "mismatch" })
  })

  it("reports missing parts as missing, not as a mismatch", () => {
    const t = String(now())
    expect(verifySvixSignature({ secret: SECRET, id: "", timestamp: t, signatureHeader: "v1,x", body: BODY }).ok).toBe(
      false,
    )
    expect(verifySvixSignature({ secret: SECRET, id: ID, timestamp: t, signatureHeader: null, body: BODY })).toEqual({
      ok: false,
      reason: "missing",
    })
    expect(verifySvixSignature({ secret: "", id: ID, timestamp: t, signatureHeader: "v1,x", body: BODY })).toEqual({
      ok: false,
      reason: "not_configured",
    })
  })

  it("rejects a header with no v1 entry at all", () => {
    const t = String(now())
    expect(
      verifySvixSignature({ secret: SECRET, id: ID, timestamp: t, signatureHeader: "v2,something", body: BODY }),
    ).toEqual({ ok: false, reason: "malformed" })
  })

  it("rejects a non-numeric timestamp rather than treating it as epoch 0", () => {
    expect(
      verifySvixSignature({ secret: SECRET, id: ID, timestamp: "not-a-number", signatureHeader: "v1,x", body: BODY }),
    ).toEqual({ ok: false, reason: "malformed" })
  })
})
