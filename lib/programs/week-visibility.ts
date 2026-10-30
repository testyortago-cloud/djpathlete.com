// lib/programs/week-visibility.ts
//
// What a client may see of their program, week by week. Pure: the workouts
// page, the workout routes' access guard and the admin week panel all decide
// from these functions, so they cannot disagree.
import type { ProgramAssignment, ProgramWeekAccess, WeekVisibility } from "@/types/database"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type ReleaseFields = Pick<ProgramAssignment, "release_base_week" | "release_anchor_at">
type WeekAccessFields = Pick<
  ProgramWeekAccess,
  "week_number" | "access_type" | "payment_status" | "price_cents" | "visibility"
>

/**
 * The last week the release schedule has reached, or null when the assignment
 * has no schedule (every week visible).
 *
 * TWIN: program_assignment_release_clock() in
 * supabase/migrations/00289_program_library_and_week_release.sql freezes with
 * the same formula. Change both.
 */
export function releasedThroughWeek(a: ReleaseFields, now: Date): number | null {
  const base = a.release_base_week ?? null
  if (base == null) return null
  if (!a.release_anchor_at) return base
  const elapsed = now.getTime() - new Date(a.release_anchor_at).getTime()
  return base + Math.max(0, Math.floor(elapsed / WEEK_MS))
}

export type WeekState = "visible" | "scheduled" | "hidden"

/**
 * `hiddenOnProgram`: the coach hid this week on the program itself (programs.hidden_weeks),
 * for every client on it. This client's own setting still wins: "shown" opens it for them.
 * Required, not defaulted, so a caller that forgets the program cannot open the week.
 */
export function weekState(
  week: number,
  a: ReleaseFields,
  visibility: WeekVisibility | undefined,
  now: Date,
  hiddenOnProgram: boolean,
): WeekState {
  const v = visibility ?? "auto"
  if (v === "hidden") return "hidden"
  if (v === "shown") return "visible"
  if (hiddenOnProgram) return "hidden"
  const released = releasedThroughWeek(a, now)
  return released == null || week <= released ? "visible" : "scheduled"
}

/** When `week` is released if the clock keeps running. Null when paused or unscheduled. */
export function unlockDate(week: number, a: ReleaseFields): Date | null {
  if (a.release_base_week == null || !a.release_anchor_at) return null
  return new Date(new Date(a.release_anchor_at).getTime() + (week - a.release_base_week) * WEEK_MS)
}

export interface WeekGate {
  /** Weeks whose workouts may be sent to the client. */
  open: Set<number>
  /** Visible paid weeks awaiting payment: the client gets the price (Unlock card), never the workouts. */
  locked: Record<number, { priceCents: number }>
  /** Weeks the client cannot see. unlocksOn is an ISO time for a scheduled week; null if hidden or paused. */
  unavailable: Record<number, { unlocksOn: string | null }>
}

export function buildWeekGate(
  a: ReleaseFields,
  rows: WeekAccessFields[],
  totalWeeks: number,
  now: Date,
  hiddenWeeks: readonly number[],
): WeekGate {
  const byWeek = new Map(rows.map((r) => [r.week_number, r]))
  const gate: WeekGate = { open: new Set(), locked: {}, unavailable: {} }
  for (let w = 1; w <= totalWeeks; w++) {
    const row = byWeek.get(w)
    const state = weekState(w, a, row?.visibility, now, hiddenWeeks.includes(w))
    if (state !== "visible") {
      gate.unavailable[w] = {
        unlocksOn: state === "scheduled" ? (unlockDate(w, a)?.toISOString() ?? null) : null,
      }
    } else if (row && row.access_type === "paid" && row.payment_status === "pending") {
      gate.locked[w] = { priceCents: row.price_cents ?? 0 }
    } else {
      gate.open.add(w)
    }
  }
  return gate
}

/**
 * A blank week shows the workout of the week it repeats (`sourceOf`, i.e. sourceWeekForDisplay).
 * It stays open only while that week is open too: otherwise hiding a week, or pricing it, would
 * still hand its workout to the client under the numbers of every blank week after it.
 */
export function closeRepeatsOfClosedWeeks(gate: WeekGate, sourceOf: (week: number) => number | null): WeekGate {
  const open = new Set<number>()
  const unavailable = { ...gate.unavailable }
  for (const w of gate.open) {
    const source = sourceOf(w)
    if (source == null || source === w || gate.open.has(source)) open.add(w)
    else unavailable[w] = { unlocksOn: null }
  }
  return { open, locked: gate.locked, unavailable }
}

/** The program's hidden weeks with `week` added or removed, sorted and without duplicates. */
export function setWeekHidden(hidden: readonly number[], week: number, hide: boolean): number[] {
  const set = new Set(hidden)
  if (hide) set.add(week)
  else set.delete(week)
  return [...set].sort((x, y) => x - y)
}

/** Remove Week renumbers every later week down by one; the hidden weeks move with them. */
export function hiddenWeeksAfterRemoving(hidden: readonly number[], removed: number): number[] {
  return hidden.filter((w) => w !== removed).map((w) => (w > removed ? w - 1 : w))
}

/** "Monday, October 19". UTC, so a server render and the browser print the same day. */
export function formatUnlockDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

/** Where a new schedule's clock starts: the start date's midnight UTC, or now once that has passed. */
export function releaseAnchorFor(startDate: string, now: Date): string {
  const start = new Date(`${startDate}T00:00:00Z`)
  return (start > now ? start : now).toISOString()
}
