// lib/funnels/run-window.ts — how a funnel's run window reads.
//
// A leaf: no imports, no client, so the card, the detail header and the window
// closer can all share one idea of what the window SAYS without any of them
// pulling in the others.

/** UTC throughout — the columns are timestamptz and the window is a date, not a
 * local moment. Formatting in the viewer's zone would shift a camp's start date
 * by a day for anyone west of London. */
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
const DAY_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

function parse(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * "Runs 1 Jun – 15 Aug 2026", or null when there is no window.
 *
 * NULL, NOT AN EMPTY-ISH STRING. Every funnel and landing page created before
 * run windows existed has neither end, and a caller that renders whatever this
 * returns would put a meaningless line on all of them.
 *
 * The start's year is printed whenever it differs from the end's: a window
 * running Nov 2026 to Feb 2027 that borrowed the end's year would be wrong
 * about the start by a full year.
 */
export function formatRunWindow(
  startsAt: string | null,
  endsAt: string | null,
): string | null {
  const start = parse(startsAt)
  const end = parse(endsAt)
  if (!start && !end) return null
  if (start && !end) return `Runs from ${DAY_YEAR.format(start)}`
  if (!start && end) return `Runs until ${DAY_YEAR.format(end)}`

  const sameYear = start!.getUTCFullYear() === end!.getUTCFullYear()
  const left = sameYear ? DAY.format(start!) : DAY_YEAR.format(start!)
  return `Runs ${left} – ${DAY_YEAR.format(end!)}`
}

/**
 * Has the window closed as of `now`?
 *
 * `>` and not `>=`: the window includes its final instant, matching the
 * migration's own `ends_at > starts_at`. A funnel ending at midnight is still
 * running at midnight.
 */
export function hasWindowClosed(endsAt: string | null, now: Date): boolean {
  const end = parse(endsAt)
  return end !== null && now.getTime() > end.getTime()
}
