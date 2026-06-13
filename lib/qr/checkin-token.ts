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
export function verifyCheckinToken(token: string, now: Date, maxAgeDays = 2): VerifyResult {
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
