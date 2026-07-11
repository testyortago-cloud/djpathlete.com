import { createHmac, timingSafeEqual } from "crypto"

function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? "dev-insecure-secret"
}

// Public athlete-profile share link. Same HMAC construction as the personal
// check-in token; the `ap.` prefix keeps the two token families from
// cross-validating. Permanent by design (revocation = rotate NEXTAUTH_SECRET).

/** token = base64url("ap.<clientUserId>").hmac — permanent public athlete-profile link. */
export function signAthleteProfileToken(clientUserId: string): string {
  const b64 = Buffer.from(`ap.${clientUserId}`).toString("base64url")
  const sig = createHmac("sha256", secret()).update(b64).digest("base64url")
  return `${b64}.${sig}`
}

export type AthleteProfileVerifyResult = { valid: true; clientUserId: string } | { valid: false }

/** Verifies signature + the `ap.` marker. No expiry (permanent link). */
export function verifyAthleteProfileToken(token: string): AthleteProfileVerifyResult {
  const parts = token.split(".")
  if (parts.length !== 2) return { valid: false }
  const [b64, sig] = parts
  const expected = createHmac("sha256", secret()).update(b64).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false }
  const segs = Buffer.from(b64, "base64url").toString().split(".")
  if (segs[0] !== "ap" || segs.length < 2) return { valid: false }
  const clientUserId = segs.slice(1).join(".")
  if (!clientUserId) return { valid: false }
  return { valid: true, clientUserId }
}
