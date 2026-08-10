import type { ProgramAssignment, ScheduledSession } from "@/types/database"
import { getProgramDaySlots } from "@/lib/db/program-exercises"
import {
  ensureSession,
  completeForCheckin,
  reopenForVoid,
  listCompletedDayKeys,
  hasCompletedOnDate,
} from "@/lib/db/workout-sessions"
import { updateAssignment, getAssignmentById } from "@/lib/db/assignments"
import { getRecurringSessionById } from "@/lib/db/recurring-sessions"
import { updateScheduledSession } from "@/lib/db/scheduled-sessions"
import { setWorkoutSession } from "@/lib/db/session-checkins"
import { getProgramById } from "@/lib/db/programs"
import { getUserById } from "@/lib/db/users"
import { createNotification } from "@/lib/db/notifications"
import { sendCoachProgramCompletedNotification, sendReassessmentReminderEmail } from "@/lib/email"

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
  await completeForCheckin(ws.id, CHECKIN_NOTE, input.sessionDate)

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

// ─── Check-in/void entry points (called from the credit service) ─────────────

/**
 * Advance the pack's linked program for a check-in: load the assignment, complete
 * the next day, stamp the workout_session on the check-in, and (if the program is
 * now finished) fire the existing completion notifications. Safe to call when the
 * assignment is missing/inactive (no-op).
 */
export async function handleCheckinProgramAdvance(input: {
  checkinId: string
  assignmentId: string
  clientUserId: string
  sessionDate: string
}): Promise<{ programCompleted: boolean }> {
  const assignment = await getAssignmentById(input.assignmentId)
  if (!assignment || assignment.status !== "active") return { programCompleted: false }

  const { workoutSessionId, programCompleted } = await advanceProgramForCheckin({
    assignment,
    sessionDate: input.sessionDate,
  })
  if (workoutSessionId) await setWorkoutSession(input.checkinId, workoutSessionId)
  if (programCompleted) await notifyProgramCompleted(input.clientUserId, assignment.program_id)
  return { programCompleted }
}

/**
 * Advance the standing slot's linked program when an occurrence is marked
 * attended (hybrid clients: the in-person session IS their program workout).
 * Inert unless the slot links an assignment. The (assignment, date)
 * completed-day guard kills every double-advance path: pack check-in + bridge
 * on the same day, re-marking attended, a client who already logged today's
 * workout online, and twice-daily slots on one assignment.
 */
export async function handleAttendanceProgramAdvance(
  session: Pick<ScheduledSession, "id" | "client_user_id" | "recurring_session_id" | "session_date">,
): Promise<{ advanced: boolean }> {
  if (!session.recurring_session_id) return { advanced: false }
  const slot = await getRecurringSessionById(session.recurring_session_id)
  if (!slot?.assignment_id) return { advanced: false }
  const assignment = await getAssignmentById(slot.assignment_id)
  if (!assignment || assignment.status !== "active") return { advanced: false }
  // A reassigned occurrence must not advance the ORIGINAL client's program.
  if (assignment.user_id !== session.client_user_id) return { advanced: false }
  if (await hasCompletedOnDate(assignment.user_id, assignment.id, session.session_date)) return { advanced: false }

  const { workoutSessionId, programCompleted } = await advanceProgramForCheckin({
    assignment,
    sessionDate: session.session_date,
  })
  if (workoutSessionId) await updateScheduledSession(session.id, { workout_session_id: workoutSessionId })
  if (programCompleted) await notifyProgramCompleted(assignment.user_id, assignment.program_id)
  return { advanced: workoutSessionId != null }
}

/** Reverse a voided check-in's program advance (reopen day + reactivate). No-op when missing. */
export async function handleVoidProgramRevert(input: {
  workoutSessionId: string
  assignmentId: string
}): Promise<void> {
  const assignment = await getAssignmentById(input.assignmentId)
  if (!assignment) return
  await revertProgramForCheckin({ workoutSessionId: input.workoutSessionId, assignment })
}

/** Mirror complete-week/route.ts completion notifications (best-effort each). */
async function notifyProgramCompleted(clientUserId: string, programId: string): Promise<void> {
  const [client, program] = await Promise.all([
    getUserById(clientUserId).catch(() => null),
    getProgramById(programId).catch(() => null),
  ])
  const programName = program?.name ?? "your program"

  if (client) {
    try {
      await sendCoachProgramCompletedNotification({
        coachEmail: process.env.COACH_EMAIL ?? "admin@darrenjpaul.com",
        coachFirstName: process.env.COACH_FIRST_NAME ?? "Coach",
        clientName: `${client.first_name} ${client.last_name}`.trim(),
        clientId: clientUserId,
        programName,
      })
    } catch {
      /* non-blocking */
    }
    try {
      await sendReassessmentReminderEmail({
        to: client.email,
        firstName: client.first_name,
        programName,
        clientUserId,
      })
    } catch {
      /* non-blocking */
    }
  }

  try {
    await createNotification({
      user_id: clientUserId,
      title: "Program Complete!",
      message: `You've finished ${programName}. Take a reassessment to get your next program.`,
      type: "success",
      is_read: false,
      link: "/client/reassessment",
    })
  } catch {
    /* non-blocking */
  }
}
