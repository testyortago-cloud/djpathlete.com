// Pure send-time guardrails for the Lead Engine sequence runner.
//
// This module must import no database client and no project code beyond
// types — it is the entire reason its tests need no mocks. Keep it pure.

export type QuietHours = { startHour: number; endHour: number }

/** Wall-clock parts of `instant` as seen in `tz`. */
function partsIn(instant: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const p: Record<string, string> = {}
  for (const { type, value } of fmt.formatToParts(instant)) p[type] = value
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    second: +p.second,
  }
}

/**
 * The UTC instant at which `tz` reads the given wall-clock time.
 * Two passes converge because the offset changes by at most an hour or two.
 */
function utcForLocal(tz: string, y: number, mo: number, d: number, h: number, mi = 0): Date {
  let guess = Date.UTC(y, mo - 1, d, h, mi, 0)
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), tz)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    guess += Date.UTC(y, mo - 1, d, h, mi, 0) - asUtc
  }

  // A spring-forward transition can make the requested wall-clock time not
  // exist at all (e.g. 02:00-02:59 on America/New_York's March transition,
  // where clocks jump straight from 02:00 to 03:00). The two-pass
  // convergence above has no way to represent that — it silently lands on
  // whatever instant happens to read back closest, which is the *pre*-jump
  // offset and therefore an hour *before* the requested time. Detect that
  // by reading the result back: if it doesn't match the wall-clock time we
  // asked for, we're in a gap, and the correct fix is to snap FORWARD to
  // the first valid instant at or after the request (in practice, the
  // instant the clocks jump to) — never backward, since a window that
  // "opens" at a nonexistent local time should open when that time would
  // have arrived, not an hour early. Do not delete this check — the loop
  // above looks complete without it.
  const isAtOrAfterTarget = (ms: number): boolean => {
    const p = partsIn(new Date(ms), tz)
    if (p.year !== y) return p.year > y
    if (p.month !== mo) return p.month > mo
    if (p.day !== d) return p.day > d
    if (p.hour !== h) return p.hour > h
    return p.minute >= mi
  }

  if (!isAtOrAfterTarget(guess)) {
    // Binary-search forward, to the minute, for the earliest instant that
    // reads back at or after the requested wall-clock time. A 4-hour
    // window comfortably covers any real-world DST gap (they run 30-120
    // minutes); the outer loop is a defensive fallback that only matters
    // for a pathological zone/date this repo will never see.
    let lo = guess
    let hi = guess + 4 * 60 * 60 * 1000
    while (!isAtOrAfterTarget(hi)) hi += 4 * 60 * 60 * 1000
    while (hi - lo > 60 * 1000) {
      const mid = lo + Math.floor((hi - lo) / 2)
      if (isAtOrAfterTarget(mid)) hi = mid
      else lo = mid
    }
    return new Date(hi)
  }

  return new Date(guess)
}

/** Prefer the contact's own timezone; fall back to the business default. */
export function resolveTimezone(contactTz: string | null | undefined, businessTz: string): string {
  return contactTz ? contactTz : businessTz
}

/**
 * Returns null when `nowUtc` falls inside the allowed window
 * `[startHour, endHour)` in `tz`, otherwise the UTC instant the window next
 * opens. A window where `startHour >= endHour` wraps midnight.
 */
export function quietHoursDefer(nowUtc: Date, tz: string, quiet: QuietHours): Date | null {
  const { startHour, endHour } = quiet
  const parts = partsIn(nowUtc, tz)
  const hour = parts.hour

  const wraps = startHour >= endHour
  const allowed = wraps ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour

  if (allowed) return null

  // Blocked. Find the next instant the window opens.
  //
  // Non-wrapping window (e.g. 8→21): if we're before the window opens today
  // (hour < startHour), the next opening is today at startHour. Otherwise
  // (we're past endHour), the next opening is tomorrow at startHour.
  //
  // Wrapping window (e.g. 21→8): "blocked" only happens when
  // endHour <= hour < startHour, i.e. daytime before the window opens
  // tonight. The next opening is always today at startHour.
  let opensToday: boolean
  if (wraps) {
    opensToday = true
  } else {
    opensToday = hour < startHour
  }

  if (opensToday) {
    return utcForLocal(tz, parts.year, parts.month, parts.day, startHour)
  }

  // Tomorrow's local date, then open at startHour.
  const tomorrowUtcGuess = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12)
  const tomorrow = partsIn(new Date(tomorrowUtcGuess), tz)
  return utcForLocal(tz, tomorrow.year, tomorrow.month, tomorrow.day, startHour)
}

/** The UTC instants bracketing the contact's local calendar day. */
export function localDayBounds(nowUtc: Date, tz: string): { start: Date; end: Date } {
  const parts = partsIn(nowUtc, tz)
  const start = utcForLocal(tz, parts.year, parts.month, parts.day, 0, 0)

  // Advance the local date by one day via a noon guess (safely clear of any
  // DST transition), then read back its local calendar date.
  const nextUtcGuess = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12)
  const next = partsIn(new Date(nextUtcGuess), tz)
  const end = utcForLocal(tz, next.year, next.month, next.day, 0, 0)

  return { start, end }
}

/**
 * Returns null when fewer than `cap` entries of `sentAt` fall inside today's
 * local bounds, else the next local midnight.
 */
export function dailyCapDefer(nowUtc: Date, tz: string, cap: number, sentAt: Array<string | Date>): Date | null {
  const { start, end } = localDayBounds(nowUtc, tz)
  const startMs = start.getTime()
  const endMs = end.getTime()

  const sentToday = sentAt.filter((s) => {
    const ms = (s instanceof Date ? s : new Date(s)).getTime()
    return ms >= startMs && ms < endMs
  }).length

  if (sentToday < cap) return null
  return end
}

/**
 * Returns null when `thisRun` has the earliest `enrolled_at` among itself
 * plus `activeSiblings` (ties broken by `id` ascending), else
 * `nowUtc + 5 minutes`.
 */
export function siblingRunDefer(
  thisRun: { id: string; enrolled_at: string },
  activeSiblings: Array<{ id: string; enrolled_at: string }>,
  nowUtc: Date,
): Date | null {
  const isOlder = (a: { id: string; enrolled_at: string }, b: { id: string; enrolled_at: string }): boolean => {
    const at = new Date(a.enrolled_at).getTime()
    const bt = new Date(b.enrolled_at).getTime()
    if (at !== bt) return at < bt
    return a.id < b.id
  }

  const hasOlderSibling = activeSiblings.some((sibling) => isOlder(sibling, thisRun))
  if (!hasOlderSibling) return null

  return new Date(nowUtc.getTime() + 5 * 60 * 1000)
}
