/**
 * Addresses Resend refuses outright.
 *
 * Resend's batch endpoint validates the WHOLE batch: one such address 422s all
 * 100 emails in it. On 2026-09-11 a single `@example.com` subscriber sank
 * batches 1 and 2 of the launch newsletter — 198 real people lost to two test
 * rows. Filter these out before batching; they can never be delivered anyway.
 *
 * Only the reserved names (RFC 2606 / 6761) plus a basic shape check. Do NOT
 * grow this into a guess at "looks fake" — a false positive silently drops a
 * real subscriber, which is the failure this exists to prevent.
 */
const RESERVED_DOMAIN = /@(?:[^@]+\.)?(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/i
const BASIC_SHAPE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i

export function isUndeliverableAddress(email: string): boolean {
  const e = email.trim()
  return !BASIC_SHAPE.test(e) || RESERVED_DOMAIN.test(e)
}
