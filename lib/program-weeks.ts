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
