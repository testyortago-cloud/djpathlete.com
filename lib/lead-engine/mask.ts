// lib/lead-engine/mask.ts
//
// PII-masking for human-run Lead Engine scripts whose dry-run/execute
// transcripts print real contact identifiers to a terminal — and, per
// scripts/import-ghl-contacts.ts's own incident (a dry-run's unmasked
// email/phone examples already leaked into a saved local report), a file on
// disk too.
//
// `maskEmail` started life as a private helper inside
// scripts/enrol-repermission.ts; it moved here once
// scripts/import-ghl-contacts.ts needed the exact same shape for its own
// dry-run examples, alongside `maskPhone`, which neither script had yet.
// scripts/enrol-repermission.ts still re-exports `maskEmail` from here so
// its own call sites and its existing unit tests
// (__tests__/scripts/enrol-repermission.test.ts) are untouched by the move.

import { parsePhoneNumberFromString } from "libphonenumber-js"

/**
 * `m***@d***` — first character of the local part and first character of
 * the domain, everything else replaced. Enough to spot-check which record a
 * masked transcript line refers to without putting a real email address in
 * that output.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@")
  if (at === -1) return `${email[0] ?? ""}***`
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const maskedLocal = local ? `${local[0]}***` : "***"
  const maskedDomain = domain ? `${domain[0]}***` : "***"
  return `${maskedLocal}@${maskedDomain}`
}

/**
 * `+1********69` — the country calling code is kept (it identifies a
 * region, not a person), the last 2 digits are kept (enough to spot-check a
 * record against its source without exposing the number), everything in
 * between is replaced with one `*` per hidden digit.
 *
 * Country-code boundary is resolved via `libphonenumber-js` (already a
 * dependency here — `lib/lead-engine/identity.ts` parses with the same
 * library) rather than a fixed-width guess: a naive "first N digits after
 * the +" rule cannot tell a 1-digit calling code (+1) from a 3-digit one
 * (+971) without parsing. Every real record in this codebase's GHL export is
 * a valid E.164 US number, so the parse succeeds in practice; the fallback
 * below exists only for a malformed or partial value a script might still
 * want to print without crashing the whole run over a formatting concern.
 */
export function maskPhone(phone: string): string {
  const parsed = parsePhoneNumberFromString(phone)
  if (parsed) {
    const countryCode = `+${parsed.countryCallingCode}`
    const national = parsed.nationalNumber
    return `${countryCode}${maskKeepingLastTwo(national)}`
  }
  const trimmed = phone.trim()
  const hasPlus = trimmed.startsWith("+")
  const digits = hasPlus ? trimmed.slice(1) : trimmed
  return `${hasPlus ? "+" : ""}${maskKeepingLastTwo(digits)}`
}

function maskKeepingLastTwo(digits: string): string {
  if (digits.length <= 2) return "*".repeat(digits.length)
  const last2 = digits.slice(-2)
  return `${"*".repeat(digits.length - 2)}${last2}`
}
