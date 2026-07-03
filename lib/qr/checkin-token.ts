import { createHmac, timingSafeEqual } from "crypto"

function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? "dev-insecure-secret"
}

function dayStamp(d: Date): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

/** token = base64url(coachId.day).hmac — embedded in the coach check-in QR. */
export function signCheckinToken(coachId: string, now: Date): string {
  const payload = `${coachId}.${dayStamp(now)}`
  const b64 = Buffer.from(payload).toString("base64url")
  const sig = createHmac("sha256", secret()).update(b64).digest("base64url")
  return `${b64}.${sig}`
}

export type VerifyResult = { valid: true; coachId: string } | { valid: false }

/** Verifies signature + age. Rejects tampered tokens and tokens older than maxAgeDays. */
export function verifyCheckinToken(token: string, now: Date, maxAgeDays = 1): VerifyResult {
  const parts = token.split(".")
  if (parts.length !== 2) return { valid: false }
  const [b64, sig] = parts
  const expected = createHmac("sha256", secret()).update(b64).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false }
  const decoded = Buffer.from(b64, "base64url").toString()
  const [coachId, day] = decoded.split(".")
  if (!coachId || !day) return { valid: false }
  const ageDays = (now.getTime() - new Date(`${day}T00:00:00Z`).getTime()) / 86_400_000
  if (ageDays < 0 || ageDays > maxAgeDays) return { valid: false }
  return { valid: true, coachId }
}

// ─── Personal (stable, per-client) check-in token ───────────────────────────
//
// Unlike the coach QR (which rotates daily and lists everyone), a personal
// token encodes ONE client id and never expires, so a regular can bookmark
// their own "Check in, <name>" link and use it every session — no daily QR to
// print, no roster. The `pc.` prefix keeps it from cross-validating with a
// coach token even though the HMAC construction is identical.

/** token = base64url("pc.<clientUserId>").hmac — a client's permanent check-in link. */
export function signPersonalCheckinToken(clientUserId: string): string {
  const b64 = Buffer.from(`pc.${clientUserId}`).toString("base64url")
  const sig = createHmac("sha256", secret()).update(b64).digest("base64url")
  return `${b64}.${sig}`
}

export type PersonalVerifyResult = { valid: true; clientUserId: string } | { valid: false }

/** Verifies signature + the `pc.` marker. No expiry (stable link). */
export function verifyPersonalCheckinToken(token: string): PersonalVerifyResult {
  const parts = token.split(".")
  if (parts.length !== 2) return { valid: false }
  const [b64, sig] = parts
  const expected = createHmac("sha256", secret()).update(b64).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false }
  const segs = Buffer.from(b64, "base64url").toString().split(".")
  if (segs[0] !== "pc" || segs.length < 2) return { valid: false }
  const clientUserId = segs.slice(1).join(".")
  if (!clientUserId) return { valid: false }
  return { valid: true, clientUserId }
}
