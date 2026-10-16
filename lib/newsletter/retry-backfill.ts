// lib/newsletter/retry-backfill.ts — who a PAST newsletter send missed.
//
// The send keeps no per-recipient record, so scripts/enqueue-newsletter-retry.ts
// rebuilds it: the list as it stood when the send started, minus every address
// Resend's own log shows it accepted for that newsletter. Pure, so the rule is
// tested without a database or the Resend API.

export type SubscriberAtSend = {
  email: string
  subscribed_at: string
  unsubscribed_at: string | null
}

export type MissedRecipients = {
  /** On the list when the send started (what the send function selected, before its undeliverable filter). */
  listed: number
  /** Resend's log shows an email for this newsletter to them. */
  reached: number
  /** On the list, never reached. What the newsletter's failed_count should equal. */
  missed: string[]
  /** Missed, but unsubscribed since. Not queued: they asked to stop. */
  unsubscribedSince: string[]
  /** Missed and still subscribed. These are the rows to queue. */
  toQueue: string[]
}

/**
 * Why this rebuild must NOT be queued, whatever flags are passed, or null.
 * Fewer reached than the send recorded means the log is missing people who
 * DID get it (another Resend account, or older than the log), and every one
 * of them would be "missed" and sent a second copy. The 2026-09-25 newsletter
 * is exactly this: 0 in the current key's log, 1,300 recorded as sent.
 */
export function unsafeToQueue(result: MissedRecipients, recordedSent: number): string | null {
  if (result.reached >= recordedSent) return null
  return `Resend's log shows ${result.reached} sends but the newsletter recorded ${recordedSent}; this key cannot see who got it, so nothing can be queued safely`
}

export function missedRecipients(args: {
  subscribers: SubscriberAtSend[]
  sendStartedAt: Date
  reachedAddresses: Iterable<string>
  isUndeliverable: (email: string) => boolean
}): MissedRecipients {
  const start = args.sendStartedAt.getTime()
  const reached = new Set([...args.reachedAddresses].map((a) => a.trim().toLowerCase()))
  const onList = args.subscribers.filter(
    (s) =>
      new Date(s.subscribed_at).getTime() <= start &&
      (s.unsubscribed_at === null || new Date(s.unsubscribed_at).getTime() > start),
  )
  const sendable = onList.filter((s) => !args.isUndeliverable(s.email))
  const missedRows = sendable.filter((s) => !reached.has(s.email.trim().toLowerCase()))
  const gone = missedRows.filter((s) => s.unsubscribed_at !== null)
  return {
    listed: onList.length,
    reached: sendable.length - missedRows.length,
    missed: missedRows.map((s) => s.email),
    unsubscribedSince: gone.map((s) => s.email),
    toQueue: missedRows.filter((s) => s.unsubscribed_at === null).map((s) => s.email),
  }
}
