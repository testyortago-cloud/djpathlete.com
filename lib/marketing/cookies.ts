import { randomBytes } from "node:crypto"

export const ATTR_COOKIE_NAME = "djp_attr"
export const ATTR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year in seconds

const VALID_VALUE = /^[A-Za-z0-9_-]+$/

/**
 * Parse the djp_attr session id from a Cookie header. Returns null if missing
 * or malformed (we treat malformed values as missing — middleware will issue a
 * fresh cookie).
 */
export function parseAttrCookie(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(";")
  for (const part of parts) {
    const [rawName, rawVal] = part.trim().split("=")
    if (rawName !== ATTR_COOKIE_NAME) continue
    const val = (rawVal ?? "").trim()
    if (!VALID_VALUE.test(val)) return null
    return val
  }
  return null
}

/**
 * Generate a URL-safe session id (~22 chars). Uses 16 random bytes (128 bits
 * of entropy) which is plenty for a non-security-bearing identifier.
 */
export function generateSessionId(): string {
  return randomBytes(16).toString("base64url")
}
