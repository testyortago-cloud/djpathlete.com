// lib/newsletter/retry-status.ts — the one line /admin/newsletter shows under a
// sent newsletter whose failed recipients are being resent. Pure, so the
// wording is tested without rendering the list.

import type { NewsletterRetrySummary } from "@/lib/db/newsletter-deliveries"

export type RetryStatusLine = { tone: "info" | "danger" | "muted"; text: string }

const n = (v: number) => v.toLocaleString("en-US")

/**
 * The "sent / failed" counts on the list and the "was sent on" banner. The
 * send records everyone Resend refused as failed; once they are queued for
 * the working-hours resend they are waiting, not failed, so they are named
 * that way. `waiting` is the queue's pending + sending rows.
 */
export function sentCountsText(sent: number, failed: number, waiting: number): string {
  const parts = [`${n(sent)} sent`]
  if (waiting > 0) parts.push(`${n(waiting)} waiting to be resent`)
  const rest = failed - waiting
  if (rest > 0) parts.push(waiting > 0 ? `${n(rest)} not sent` : `${n(rest)} failed`)
  return parts.join(", ")
}

export function retryStatusLine(r: NewsletterRetrySummary | undefined): RetryStatusLine | null {
  if (!r) return null
  // The reason is written for the owner where the pause happens
  // (lib/automation/newsletter-retry.ts, functions/src/newsletter-send.ts).
  const why = r.pause_reason ? ` ${r.pause_reason}` : ""
  const waiting = r.pending + r.sending
  if (waiting > 0) {
    const done = r.sent > 0 ? `${n(r.sent)} done, ` : ""
    const going = `Resending to people who missed it: ${done}${n(waiting)} to go. 100 an hour, weekdays 9am to 5pm.`
    // Some rows can be paused while the rest still go out (a send that got no
    // clear answer files its batch paused). Say both, in the colour that asks
    // for attention.
    if (r.paused > 0) return { tone: "danger", text: `${going} ${n(r.paused)} more are paused.${why}` }
    return { tone: "info", text: going }
  }
  if (r.paused > 0) {
    return { tone: "danger", text: `Resending paused.${why} ${n(r.paused)} people still to go.` }
  }
  if (r.sent > 0 || r.failed > 0) {
    const failed = r.failed > 0 ? ` ${n(r.failed)} could not be sent.` : ""
    return { tone: "muted", text: `Resent to ${n(r.sent)} people who missed it.${failed}` }
  }
  return null
}
