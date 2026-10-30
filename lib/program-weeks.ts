import {
  buildWeekGate,
  closeRepeatsOfClosedWeeks,
  type ReleaseFields,
  type WeekAccessFields,
} from "@/lib/programs/week-visibility"

/**
 * `program_assignments.total_weeks` is a snapshot taken at assign time. When a
 * coach later expands a program (adds weeks / raises duration_weeks) through any
 * path that doesn't re-sync existing assignments, that snapshot goes stale and
 * silently caps the client below the program's real length — they never see the
 * later weeks, and week-completion can fire early. Never trust the snapshot as a
 * hard ceiling: the client should always see at least as many weeks as the
 * program currently declares (duration_weeks) and actually has content for.
 */
export function effectiveTotalWeeks(
  snapshotTotalWeeks: number | null | undefined,
  programDurationWeeks: number | null | undefined,
  maxContentWeek?: number | null,
): number {
  return Math.max(snapshotTotalWeeks ?? 0, programDurationWeeks ?? 0, maxContentWeek ?? 0, 1)
}

/**
 * Which built week's content the client actually sees for a given display week.
 *
 * The client workout view follows a "repeating weekly template" pattern: a week
 * with no exercises of its own shows the closest *earlier* built week's workout;
 * if no built week is at or before it, it shows the *earliest* built week. This
 * is why building only Week 1 makes Weeks 2..N look identical to the client.
 *
 * `definedWeeks` is the set of week numbers that have at least one exercise.
 * Returns the source week the given week repeats, or `null` when the program has
 * no content at all (the week is genuinely empty).
 *
 * Single source of truth for both the client view and the admin builder badges,
 * so the "Repeats Week X" label in the builder always matches what clients see.
 */
export function sourceWeekForDisplay(week: number, definedWeeks: number[]): number | null {
  if (definedWeeks.length === 0) return null
  const sorted = [...definedWeeks].sort((a, b) => a - b)
  let source = sorted[0]
  for (const dw of sorted) {
    if (dw <= week) source = dw
    else break
  }
  return source
}

/** The key a workout session and a program slot share: one assignment, one week, one day. */
export function slotKey(assignmentId: string, week: number, day: number): string {
  return `${assignmentId}:${week}:${day}`
}

/**
 * The week a client is on, so the workouts page opens there: the week after the latest
 * week they trained every day of, never behind `current_week`, moved forward past weeks
 * they cannot open to the next one they can (or left there, to show when it unlocks).
 *
 * "Trained a day" = a workout session exists for that slot, not status 'completed':
 * on prod (60 days to 2026-10-30) 120 sessions stayed in_progress (115 with logged sets)
 * against 88 completed, so most athletes never press finish. `current_week` itself
 * only moves on "Complete week" and check-ins, and sits at 1 for most of them.
 */
export function resumeWeek(args: {
  assignmentId: string
  currentWeek: number
  totalWeeks: number
  /** Days with exercises, per week (a blank week's are its repeat source's). */
  trainingDays: Map<number, number[]>
  /** slotKey of every workout session the client has. */
  trainedSlots: Set<string>
  /** Weeks the client can open (workouts or a price to unlock). */
  openWeeks: Set<number>
}): number {
  const { assignmentId, currentWeek, totalWeeks, trainingDays, trainedSlots, openWeeks } = args
  let lastFinished = 0
  for (const [week, days] of trainingDays) {
    if (days.length > 0 && days.every((d) => trainedSlots.has(slotKey(assignmentId, week, d)))) {
      lastFinished = Math.max(lastFinished, week)
    }
  }
  const candidate = Math.min(Math.max(currentWeek, lastFinished + 1), totalWeeks)
  for (let w = candidate; w <= totalWeeks; w++) if (openWeeks.has(w)) return w
  return candidate
}

/**
 * The week a client is on, and how many weeks their program has: what their Workouts page
 * opens on (resumeWeek, behind the same week gate). The client's page and the coach's
 * screens both call this, so the coach sees the week the client sees.
 *
 * `slots` is the (week, day) of every exercise in the program; repeats are fine.
 */
export function clientWeek(args: {
  assignment: ReleaseFields & { id: string; total_weeks: number | null }
  currentWeek: number
  program: { duration_weeks: number | null; hidden_weeks?: readonly number[] | null }
  slots: readonly { week_number: number; day_of_week: number }[]
  weekAccess: WeekAccessFields[]
  trainedSlots: Set<string>
  now: Date
}): { week: number; totalWeeks: number } {
  const { assignment, program } = args
  const daysByWeek = new Map<number, Set<number>>()
  for (const s of args.slots) {
    if (!daysByWeek.has(s.week_number)) daysByWeek.set(s.week_number, new Set())
    daysByWeek.get(s.week_number)!.add(s.day_of_week)
  }
  const definedWeeks = [...daysByWeek.keys()].sort((a, b) => a - b)
  const totalWeeks = effectiveTotalWeeks(
    assignment.total_weeks,
    program.duration_weeks,
    definedWeeks[definedWeeks.length - 1],
  )
  // A blank week repeats an earlier week's workout; it is open only while that week is.
  const gate = closeRepeatsOfClosedWeeks(
    buildWeekGate(assignment, args.weekAccess, totalWeeks, args.now, program.hidden_weeks ?? []),
    (w) => sourceWeekForDisplay(w, definedWeeks),
  )
  const trainingDays = new Map<number, number[]>()
  for (let w = 1; w <= totalWeeks; w++) {
    const source = sourceWeekForDisplay(w, definedWeeks)
    trainingDays.set(w, source == null ? [] : [...(daysByWeek.get(source) ?? [])])
  }
  const week = resumeWeek({
    assignmentId: assignment.id,
    currentWeek: args.currentWeek,
    totalWeeks,
    trainingDays,
    trainedSlots: args.trainedSlots,
    openWeeks: new Set([...gate.open, ...Object.keys(gate.locked).map(Number)]),
  })
  return { week, totalWeeks }
}

/**
 * The sets an athlete logged for THIS slot, so a form they saved comes back as they
 * entered it. Never another week's or day's log of the same exercise: that is a
 * different prescription, and refilling from it showed the athlete last week's sets
 * and reps instead of the coach's.
 *
 * `sessionSlots` maps a workout session id to its `slotKey`.
 */
export function savedSetsForSlot<T>(
  history: { session_id: string | null; set_details: T | null }[],
  sessionSlots: Map<string, string>,
  slot: string,
): T | null {
  return history.find((h) => h.session_id != null && sessionSlots.get(h.session_id) === slot)?.set_details ?? null
}
