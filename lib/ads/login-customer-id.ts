// lib/ads/login-customer-id.ts
// Normalizes the Google Ads `login-customer-id` value before it is sent as a
// request header. A valid value is exactly 10 digits, no dashes (see
// .env.example). Twin copy lives at functions/src/ads/login-customer-id.ts —
// functions/ has rootDir "src" and cannot import from lib/, so keep them in sync.

/**
 * Returns a clean 10-digit login-customer-id, or undefined for empty input.
 * - Strips dashes / spaces / any non-digit (handles "123-456-7890" etc).
 * - Heals an accidentally-doubled value (the 10-digit id pasted twice → 20
 *   digits) — the misconfiguration behind Google's
 *   "The login customer id header 'Optional[...]' could not be validated" error.
 * - Warns (never throws) when the result still isn't 10 digits, so a bad env
 *   var surfaces in logs instead of failing cryptically inside the Ads API.
 */
export function normalizeLoginCustomerId(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  let digits = String(raw).replace(/\D/g, "")
  if (!digits) return undefined
  if (digits.length === 20 && digits.slice(0, 10) === digits.slice(10)) {
    console.warn(
      `[google-ads] GOOGLE_ADS_LOGIN_CUSTOMER_ID looks doubled ("${digits}"); using "${digits.slice(0, 10)}". Set it to a single 10-digit ID.`,
    )
    digits = digits.slice(0, 10)
  }
  if (digits.length !== 10) {
    console.warn(
      `[google-ads] GOOGLE_ADS_LOGIN_CUSTOMER_ID should be a 10-digit Customer ID (got "${digits}"). Google Ads will reject it.`,
    )
  }
  return digits
}
