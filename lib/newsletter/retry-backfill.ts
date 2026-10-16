// lib/newsletter/retry-backfill.ts — who a PAST newsletter send missed.
//
// The send keeps no per-recipient record, so scripts/enqueue-newsletter-retry.ts
// rebuilds it: the list as it stood when the send started, minus every address
// Resend's own log shows it accepted for that newsletter. Pure, so the rule is
// tested without a database or the Resend API.

import { resendTime } from "@/lib/newsletter/resend-log"

export type ResultStamps = Partial<
  Record<"delivered_at" | "opened_at" | "clicked_at" | "bounced_at" | "complained_at", string>
>

/**
 * What one email's LAST event in Resend's log implies about it, for
 * scripts/backfill-newsletter-results.ts. A click means it was opened and
 * delivered; a spam report means it was delivered. The log keeps only the
 * last event, so the time is the email's own send time: approximate, and the
 * results only count whether a stamp is there. Suppressed, failed, delayed or
 * merely sent emails imply nothing.
 */
export function stampsFromLastEvent(lastEvent: string, at: string): ResultStamps {
  const t = resendTime(at).toISOString()
  switch (lastEvent) {
    case "clicked":
      return { delivered_at: t, opened_at: t, clicked_at: t }
    case "opened":
      return { delivered_at: t, opened_at: t }
    case "delivered":
      return { delivered_at: t }
    case "complained":
      return { delivered_at: t, complained_at: t }
    case "bounced":
      return { bounced_at: t }
    default:
      return {}
  }
}

export type SubscriberAtSend = {
  email: string
  subscribed_at: string
  unsubscribed_at: string | null
}

export type MissedRecipients = {
  /** On the list when the send started (what the send function selected, before its undeliverable filter). */
  listed: number
  /** On the list, and Resend's log shows an email for this newsletter to them. */
  reached: number
  /** Distinct addresses in Resend's log for this newsletter, on the list or not (a deleted subscriber still got it). */
  logged: number
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
  if (result.logged >= recordedSent) return null
  return `Resend's log shows ${result.logged} sends but the newsletter recorded ${recordedSent}; this key cannot see who got it, so nothing can be queued safely`
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
    logged: reached.size,
    missed: missedRows.map((s) => s.email),
    unsubscribedSince: gone.map((s) => s.email),
    toQueue: missedRows.filter((s) => s.unsubscribed_at === null).map((s) => s.email),
  }
}
