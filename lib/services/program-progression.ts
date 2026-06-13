import type { ProgramAssignment } from "@/types/database"
import { getProgramDaySlots } from "@/lib/db/program-exercises"
import {
  ensureSession,
  completeForCheckin,
  reopenForVoid,
  listCompletedDayKeys,
} from "@/lib/db/workout-sessions"
import { updateAssignment } from "@/lib/db/assignments"

// ─── Pure: next incomplete day + week recompute (recompute-from-truth) ────────

export interface DaySlot {
  week_number: number
  day_of_week: number
}

export const dayKey = (s: DaySlot): string => `${s.week_number}-${s.day_of_week}`

/** First slot (in order) whose key is not completed, or null when all are done. */
export function nextIncompleteSlot(slots: DaySlot[], completedKeys: Set<string>): DaySlot | null {
  for (const s of slots) {
    if (!completedKeys.has(dayKey(s))) return s
  }
  return null
}

/** Lowest week_number that still has an incomplete slot, or null when complete. */
export function recomputeWeek(slots: DaySlot[], completedKeys: Set<string>): number | null {
  const next = nextIncompleteSlot(slots, completedKeys)
  return next ? next.week_number : null
}

// ─── Orchestration (DALs + the pure helpers above) ───────────────────────────

const CHECKIN_NOTE = "In-person session (checked in)"

export interface AdvanceResult {
  workoutSessionId: string | null
  programCompleted: boolean
}

/**
 * Complete the next incomplete workout day of an assignment's program (in-person
 * check-in). Returns the completed workout_session id (to stamp on the check-in)
 * and whether this completion finished the whole program. No-op (null id) when
 * the program has no remaining incomplete day.
 */
export async function advanceProgramForCheckin(input: {
  assignment: Pick<ProgramAssignment, "id" | "user_id" | "program_id" | "current_week">
  sessionDate: string
}): Promise<AdvanceResult> {
  const { assignment } = input
  const slots = await getProgramDaySlots(assignment.program_id)
  if (slots.length === 0) return { workoutSessionId: null, programCompleted: false }

  const completed = new Set(await listCompletedDayKeys(assignment.user_id, assignment.id))
  const slot = nextIncompleteSlot(slots, completed)
  if (!slot) return { workoutSessionId: null, programCompleted: false }

  const ws = await ensureSession({
    user_id: assignment.user_id,
    assignment_id: assignment.id,
    week_number: slot.week_number,
    day_of_week: slot.day_of_week,
    session_date: input.sessionDate,
  })
  await completeForCheckin(ws.id, CHECKIN_NOTE)

  completed.add(dayKey(slot))
  const week = recomputeWeek(slots, completed)
  if (week === null) {
    const lastWeek = slots[slots.length - 1].week_number
    await updateAssignment(assignment.id, { status: "completed", current_week: lastWeek })
    return { workoutSessionId: ws.id, programCompleted: true }
  }
  await updateAssignment(assignment.id, { current_week: week })
  return { workoutSessionId: ws.id, programCompleted: false }
}

/**
 * Reverse a check-in's program advance: reopen the completed workout day and
 * recompute the assignment's week position from truth (reactivating a program
 * that had been marked complete).
 */
export async function revertProgramForCheckin(input: {
  workoutSessionId: string
  assignment: Pick<ProgramAssignment, "id" | "user_id" | "program_id">
}): Promise<void> {
  const { assignment } = input
  await reopenForVoid(input.workoutSessionId)

  const slots = await getProgramDaySlots(assignment.program_id)
  if (slots.length === 0) return
  const completed = new Set(await listCompletedDayKeys(assignment.user_id, assignment.id))
  const week = recomputeWeek(slots, completed)
  if (week === null) return // still complete (shouldn't happen right after a reopen)
  await updateAssignment(assignment.id, { status: "active", current_week: week })
}
