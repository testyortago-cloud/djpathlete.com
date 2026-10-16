// lib/newsletter/results.ts — the words and numbers a newsletter's results
// are shown in (/admin/newsletter and the newsletter's own page). Pure, so the
// arithmetic and the wording are tested without rendering anything.

import type { NewsletterResults } from "@/lib/db/newsletter-deliveries"

const n = (v: number) => v.toLocaleString("en-US")

/** "32%", "4.3%" below 10, "4%" not "4.0%". Null when the base is 0: no rate, never NaN%. */
export function pct(part: number, base: number): string | null {
  if (base <= 0) return null
  const v = (part / base) * 100
  const rounded = v < 10 ? Math.round(v * 10) / 10 : Math.round(v)
  return `${rounded}%`
}

/** One line under a sent newsletter in the list. Null when there are no results. */
export function resultsLine(r: NewsletterResults | undefined): string | null {
  if (!r || r.recipients === 0) return null
  const parts = [
    ["Opened", pct(r.opened, r.delivered)],
    ["Clicked", pct(r.clicked, r.delivered)],
    ["Bounced", pct(r.bounced, r.recipients)],
  ]
    .filter(([, rate]) => rate !== null)
    .map(([label, rate]) => `${label} ${rate}`)
  return parts.length > 0 ? parts.join(" · ") : null
}

export type ResultTile = { label: string; value: string; detail: string | null }

/** The six numbers on the newsletter's own page, each with what its rate is out of. */
export function resultTiles(r: NewsletterResults): ResultTile[] {
  const of = (rate: string | null, base: string) => (rate === null ? null : `${rate} of ${base}`)
  return [
    { label: "Sent", value: n(r.recipients), detail: null },
    { label: "Delivered", value: n(r.delivered), detail: of(pct(r.delivered, r.recipients), "sent") },
    { label: "Opened", value: n(r.opened), detail: of(pct(r.opened, r.delivered), "delivered") },
    { label: "Clicked", value: n(r.clicked), detail: of(pct(r.clicked, r.delivered), "delivered") },
    {
      label: "Bounced (the address does not exist)",
      value: n(r.bounced),
      detail: of(pct(r.bounced, r.recipients), "sent"),
    },
    { label: "Marked as spam", value: n(r.complained), detail: of(pct(r.complained, r.delivered), "delivered") },
  ]
}
