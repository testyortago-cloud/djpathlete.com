// Identifier normalisation for contact matching.
//
// Both functions return null instead of throwing. These run on the lead-capture
// path, where an unparseable identifier must cost you that identifier and never
// the lead itself.

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js"

const EMAIL_RE = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+$/

export function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  if (!EMAIL_RE.test(trimmed)) return null
  return trimmed
}

export function normalisePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "US",
): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = parsePhoneNumberFromString(trimmed, defaultCountry)
    if (!parsed || !parsed.isValid()) return null
    return parsed.number
  } catch {
    return null
  }
}
