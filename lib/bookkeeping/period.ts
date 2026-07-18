/** Pure period-preset math for bookkeeping reports. All inputs/outputs are
 *  YYYY-MM-DD strings; `today` is injected (never `new Date()` here) so the
 *  logic is deterministic and testable. Windows are inclusive occurred_on
 *  ranges (D4: recompute-able, no close). */

export type PeriodPreset = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_year" | "last_year"

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  last_quarter: "Last quarter",
  this_year: "This year",
  last_year: "Last year",
}

const fmt = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
/** Day count of month m (1-12) in year y — Date.UTC day-0 trick, no local tz. */
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function presetRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  switch (preset) {
    case "this_month":
      return { from: fmt(y, m, 1), to: fmt(y, m, lastDay(y, m)) }
    case "last_month": {
      const yy = m === 1 ? y - 1 : y
      const mm = m === 1 ? 12 : m - 1
      return { from: fmt(yy, mm, 1), to: fmt(yy, mm, lastDay(yy, mm)) }
    }
    case "this_quarter": {
      const startM = Math.floor((m - 1) / 3) * 3 + 1
      return { from: fmt(y, startM, 1), to: fmt(y, startM + 2, lastDay(y, startM + 2)) }
    }
    case "last_quarter": {
      const q = Math.floor((m - 1) / 3) - 1
      const yy = q < 0 ? y - 1 : y
      const startM = ((q + 4) % 4) * 3 + 1
      return { from: fmt(yy, startM, 1), to: fmt(yy, startM + 2, lastDay(yy, startM + 2)) }
    }
    case "this_year":
      return { from: fmt(y, 1, 1), to: fmt(y, 12, 31) }
    case "last_year":
      return { from: fmt(y - 1, 1, 1), to: fmt(y - 1, 12, 31) }
  }
}
