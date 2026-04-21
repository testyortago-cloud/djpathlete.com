export interface CalendarWindow {
  from: string
  to: string
}

export function computeCalendarWindow(
  view: string | undefined,
  anchor: string | undefined,
): CalendarWindow {
  const anchorDate = anchor ? new Date(`${anchor}T00:00:00Z`) : new Date()
  anchorDate.setUTCHours(0, 0, 0, 0)
  const from = new Date(anchorDate)
  const to = new Date(anchorDate)
  if (view === "day") {
    // single day
  } else if (view === "week") {
    const dow = from.getUTCDay()
    from.setUTCDate(from.getUTCDate() - ((dow + 6) % 7))
    to.setTime(from.getTime())
    to.setUTCDate(to.getUTCDate() + 6)
  } else {
    // month: pad +/- one month so the 6-week grid always has data
    from.setUTCDate(1)
    from.setUTCMonth(from.getUTCMonth() - 1)
    to.setUTCDate(1)
    to.setUTCMonth(to.getUTCMonth() + 2)
    to.setUTCDate(0)
  }
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}
