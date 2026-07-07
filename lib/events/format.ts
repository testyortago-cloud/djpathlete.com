import type { Event } from "@/types/database"

/**
 * Shared "when" formatting for clinics and camps.
 *
 * Event datetimes are stored as wall-clock UTC (the admin form suffixes the
 * coach's entry with Z), so every formatter here pins timeZone: "UTC" — the
 * displayed time always matches what the coach typed, regardless of the
 * viewer's or server's timezone.
 *
 * Camps encode their daily session window in the time-of-day component of
 * start_date / end_date (start's time = daily start, end's time = daily end).
 * Legacy camps saved before daily times existed carry 00:00 on both and fall
 * back to a date-only label.
 */

type DateStyle = "short" | "long"

function formatDate(iso: string, style: DateStyle) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: style === "long" ? "long" : "short",
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function formatEventTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })
}

function utcDayKey(iso: string) {
  return iso.slice(0, 10)
}

function isMidnightUtc(iso: string) {
  const d = new Date(iso)
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0
}

/** True when a camp has a daily session window set (non-midnight times). */
export function campHasDailyTimes(event: Pick<Event, "type" | "start_date" | "end_date">) {
  if (event.type !== "camp") return false
  return !isMidnightUtc(event.start_date) || (!!event.end_date && !isMidnightUtc(event.end_date))
}

/**
 * One-line label for when an event runs.
 *
 * Clinic: "Sat, Mar 7, 2026 · 9:00 AM – 11:00 AM"
 * Camp:   "Jul 13 – Jul 17, 2026 · 9:00 AM – 11:00 AM daily"
 *         (date-only range when no daily times are set)
 */
export function formatEventWhen(event: Event, style: DateStyle = "short") {
  if (event.type === "clinic") {
    const datePart = formatDate(event.start_date, style)
    const startTime = formatEventTime(event.start_date)
    if (event.end_date) {
      return `${datePart} · ${startTime} – ${formatEventTime(event.end_date)}`
    }
    return `${datePart} · ${startTime}`
  }

  const hasTimes = campHasDailyTimes(event)
  const sameDay = !!event.end_date && utcDayKey(event.start_date) === utcDayKey(event.end_date)

  let datePart: string
  if (!event.end_date || sameDay) {
    datePart = formatDate(event.start_date, style)
  } else {
    const start = new Date(event.start_date)
    const end = new Date(event.end_date)
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
    const month = style === "long" ? ("long" as const) : ("short" as const)
    const startLabel = start.toLocaleDateString("en-US", {
      month,
      day: "numeric",
      timeZone: "UTC",
      ...(sameYear ? {} : { year: "numeric" }),
    })
    const endLabel = end.toLocaleDateString("en-US", {
      month,
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
    datePart = `${startLabel} – ${endLabel}`
  }

  if (!hasTimes) return datePart
  const times = `${formatEventTime(event.start_date)} – ${formatEventTime(event.end_date ?? event.start_date)}`
  // "daily" only reads right when the window repeats across multiple days.
  return sameDay || !event.end_date ? `${datePart} · ${times}` : `${datePart} · ${times} daily`
}

/**
 * "2-hour clinic" / "5-day camp". Camp day count is inclusive of both the
 * first and last day (Jul 13 – Jul 17 is a 5-day camp), computed from the
 * date components so daily session times don't skew the count.
 */
export function formatEventDuration(event: Event) {
  if (event.type === "clinic") return "2-hour clinic"
  if (event.end_date) {
    const startDay = Date.UTC(
      new Date(event.start_date).getUTCFullYear(),
      new Date(event.start_date).getUTCMonth(),
      new Date(event.start_date).getUTCDate(),
    )
    const endDay = Date.UTC(
      new Date(event.end_date).getUTCFullYear(),
      new Date(event.end_date).getUTCMonth(),
      new Date(event.end_date).getUTCDate(),
    )
    const days = Math.max(1, Math.round((endDay - startDay) / 86400000) + 1)
    return `${days}-day camp`
  }
  return "Performance camp"
}
