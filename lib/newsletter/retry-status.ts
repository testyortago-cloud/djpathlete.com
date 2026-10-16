// lib/newsletter/retry-status.ts — the one line /admin/newsletter shows under a
// sent newsletter whose failed recipients are being resent. Pure, so the
// wording is tested without rendering the list.

import type { NewsletterRetrySummary } from "@/lib/db/newsletter-deliveries"

export type RetryStatusLine = { tone: "info" | "danger" | "muted"; text: string }

const n = (v: number) => v.toLocaleString("en-US")

export function retryStatusLine(r: NewsletterRetrySummary | undefined): RetryStatusLine | null {
  if (!r) return null
  if (r.paused > 0) {
    return {
      tone: "danger",
      text: `Resending paused: ${n(r.bounced)} of ${n(r.sent)} resent emails bounced. ${n(r.paused)} people still to go.`,
    }
  }
  if (r.pending > 0) {
    const done = r.sent > 0 ? `${n(r.sent)} done, ` : ""
    return {
      tone: "info",
      text: `Resending to people who missed it: ${done}${n(r.pending)} to go. 100 an hour, weekdays 9am–5pm.`,
    }
  }
  if (r.sent > 0 || r.failed > 0) {
    const failed = r.failed > 0 ? ` ${n(r.failed)} could not be sent.` : ""
    return { tone: "muted", text: `Resent to ${n(r.sent)} people who missed it.${failed}` }
  }
  return null
}
