// functions/src/ads/login-customer-id.ts
// Twin of lib/ads/login-customer-id.ts (functions/ has rootDir "src" and cannot
// import from lib/). Normalizes the Google Ads `login-customer-id` before it is
// sent. A valid value is exactly 10 digits, no dashes. Keep both copies in sync.

/**
 * Returns a clean 10-digit login-customer-id, or undefined for empty input.
 * Strips non-digits, heals an accidentally-doubled value (10-digit id pasted
 * twice → 20 digits) — the cause of Google's "login customer id header
 * 'Optional[...]' could not be validated" error — and warns (never throws) when
 * the result still isn't 10 digits.
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
