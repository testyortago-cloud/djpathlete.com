import { getDaySlotsByProgram } from "@/lib/db/program-exercises"
import { getWeekAccessByAssignments } from "@/lib/db/week-access"
import { listTrainedSlots } from "@/lib/db/workout-sessions"
import { clientWeek } from "@/lib/program-weeks"
import type { Program, ProgramAssignment } from "@/types/database"

export type AssignmentForWeek = Pick<
  ProgramAssignment,
  "id" | "program_id" | "current_week" | "total_weeks" | "release_base_week" | "release_anchor_at"
> & { programs: Pick<Program, "duration_weeks" | "hidden_weeks"> | null }

/**
 * The week each client is on, by assignment id: the week their Workouts page opens on.
 * `current_week` alone is not it; it sits at 1 for most athletes (see clientWeek).
 *
 * Three reads for the whole list, keyed by the ids passed in, so the caller decides whose
 * assignments these are. Call it once per screen with every assignment on it.
 */
export async function getClientWeeks(
  assignments: AssignmentForWeek[],
  now = new Date(),
): Promise<Map<string, { week: number; totalWeeks: number }>> {
  const weeks = new Map<string, { week: number; totalWeeks: number }>()
  if (assignments.length === 0) return weeks
  const ids = assignments.map((a) => a.id)
  const [slotsByProgram, trainedSlots, access] = await Promise.all([
    getDaySlotsByProgram([...new Set(assignments.map((a) => a.program_id))]),
    listTrainedSlots(ids),
    getWeekAccessByAssignments(ids),
  ])
  for (const a of assignments) {
    weeks.set(
      a.id,
      clientWeek({
        assignment: a,
        currentWeek: a.current_week,
        program: a.programs ?? { duration_weeks: null },
        slots: slotsByProgram.get(a.program_id) ?? [],
        weekAccess: access.filter((r) => r.assignment_id === a.id),
        trainedSlots,
        now,
      }),
    )
  }
  return weeks
}
