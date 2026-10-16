// lib/newsletter/retry-status.ts — the one line /admin/newsletter shows under a
// sent newsletter whose failed recipients are being resent. Pure, so the
// wording is tested without rendering the list.

import type { NewsletterRetrySummary } from "@/lib/db/newsletter-deliveries"

export type RetryStatusLine = { tone: "info" | "danger" | "muted"; text: string }

const n = (v: number) => v.toLocaleString("en-US")

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
