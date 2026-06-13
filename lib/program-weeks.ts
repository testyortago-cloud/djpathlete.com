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
