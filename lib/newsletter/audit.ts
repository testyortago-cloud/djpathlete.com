/**
 * Lightweight, dependency-free auditing for a pasted/CSV email list.
 *
 * This is an *advisory* clean-up — format validation, duplicate removal, and a
 * known-disposable-domain filter — not a deliverability/spam check. True spam /
 * bounce scoring needs an external validator (ZeroBounce, NeverBounce, etc.);
 * run that on the file before importing if hard-bounce rate matters.
 */

/** Common disposable / throwaway inbox domains (lowercased). */
export const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "getnada.com",
  "trashmail.com",
  "sharklasers.com",
  "grr.la",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "emailondeck.com",
  "spamgourmet.com",
  "tempinbox.com",
  "mailcatch.com",
  "33mail.com",
  "anonbox.net",
  "burnermail.io",
  "getairmail.com",
  "tempr.email",
  "discard.email",
  "mailto.plus",
  "fakemail.net",
])

// Pragmatic format check (matches the existing admin parser). Not RFC-perfect by
// design — catches the obviously-broken rows without rejecting valid addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmailFormat(email: string): boolean {
  return EMAIL_RE.test(email)
}

export function isDisposableDomain(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase()
  return DISPOSABLE_DOMAINS.has(domain)
}

export interface EmailAudit {
  /** Normalized, unique, valid-format, non-disposable — safe to import. */
  valid: string[]
  /** Raw rows with no recognizable email (skipped). */
  invalidFormat: string[]
  /** Valid-format but disposable-domain addresses (excluded from `valid`). */
  disposable: string[]
  /** Count of duplicate addresses removed. */
  duplicates: number
}

/**
 * Audit raw CSV lines: skips header rows, extracts the email column from
 * multi-column rows, normalizes, de-dupes, and separates invalid / disposable.
 */
export function auditCsvLines(rawLines: string[]): EmailAudit {
  const seen = new Set<string>()
  const valid: string[] = []
  const invalidFormat: string[] = []
  const disposable: string[] = []
  let duplicates = 0

  for (const raw of rawLines) {
    const line = raw.trim()
    if (!line) continue

    const lower = line.toLowerCase()
    // Skip common header rows.
    if (lower.startsWith("email") || lower.startsWith("name") || lower.startsWith("first")) continue

    // Find the email in a possibly multi-column row.
    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""))
    const candidate = parts.find((p) => isValidEmailFormat(p))

    if (!candidate) {
      invalidFormat.push(line)
      continue
    }

    const email = candidate.toLowerCase()
    if (seen.has(email)) {
      duplicates++
      continue
    }
    seen.add(email)

    if (isDisposableDomain(email)) {
      disposable.push(email)
      continue
    }
    valid.push(email)
  }

  return { valid, invalidFormat, disposable, duplicates }
}
