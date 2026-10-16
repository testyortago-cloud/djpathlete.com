// lib/newsletter/resend-log.ts — one newsletter's emails, read back from
// Resend's own log (GET /emails). Used by scripts/enqueue-newsletter-retry.ts
// (who did the send miss?) and scripts/backfill-newsletter-results.ts (what
// happened to each email?). Resend's log reaches back about 30 days.

export type LoggedEmail = { id: string; to: string[]; last_event: string; created_at: string }

/** Resend writes "2026-10-09 13:01:22.157+00"; Date wants ISO. */
export function resendTime(raw: string): Date {
  return new Date(raw.replace(" ", "T").replace(/\+00$/, "Z"))
}

/**
 * Every email with this exact subject from 10 minutes before the send to a day
 * after it: the blast itself, not a retry days later. `until` reaches further,
 * for the retry's later sends. Throws when the log starts after the send,
 * because then it cannot say who got it.
 */
export async function fetchNewsletterEmails(
  apiKey: string,
  subject: string,
  sentAt: Date,
  opts: { pauseMs?: number; until?: Date } = {},
): Promise<LoggedEmail[]> {
  const windowStart = sentAt.getTime() - 10 * 60 * 1000
  const windowEnd = opts.until?.getTime() ?? sentAt.getTime() + 24 * 60 * 60 * 1000
  const out: LoggedEmail[] = []
  let oldest = Infinity
  let after: string | null = null
  for (let page = 0; page < 200; page++) {
    const res = await fetch(`https://api.resend.com/emails?limit=100${after ? `&after=${after}` : ""}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) throw new Error(`Resend GET /emails ${res.status}: ${await res.text()}`)
    const body = (await res.json()) as {
      data: (LoggedEmail & { subject: string })[]
      has_more?: boolean
    }
    for (const e of body.data) {
      const at = resendTime(e.created_at).getTime()
      oldest = Math.min(oldest, at)
      if (e.subject === subject && at >= windowStart && at <= windowEnd) {
        out.push({ id: e.id, to: e.to, last_event: e.last_event, created_at: e.created_at })
      }
    }
    if (!body.has_more || body.data.length === 0 || oldest < windowStart) break
    after = body.data[body.data.length - 1].id
    // Resend's limit is 10 requests a second for the whole team; the app's own
    // sends share it.
    await new Promise((r) => setTimeout(r, opts.pauseMs ?? 250))
  }
  if (oldest > windowStart) {
    throw new Error(`Resend's log starts ${new Date(oldest).toISOString()}, after this send; it cannot be rebuilt`)
  }
  return out
}
