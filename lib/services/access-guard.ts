import type { ProgramAssignment, ProgramWeekAccess } from "@/types/database"
import { getAssignmentById } from "@/lib/db/assignments"
import { getWeekAccess } from "@/lib/db/week-access"
import { weekState } from "@/lib/programs/week-visibility"

/** Pure: may this client train against this assignment (and optionally this week)? */
export function isAccessAllowed(
  assignment: Pick<ProgramAssignment, "payment_status">,
  weekAccess: Pick<ProgramWeekAccess, "access_type" | "payment_status"> | null,
): boolean {
  if (assignment.payment_status === "pending") return false
  if (weekAccess && weekAccess.access_type === "paid" && weekAccess.payment_status === "pending") return false
  return true
}

export type AccessResult = { ok: true } | { ok: false; reason: "payment" | "not_released" }

/**
 * Loads the assignment (and week, if given) and decides whether the client may
 * train it. A week the client cannot see (hidden by the coach, or not yet
 * released) is refused as `not_released`, so a client cannot log or start a
 * session in it by calling the route directly.
 */
export async function assertAssignmentPayable(
  assignmentId: string,
  weekNumber?: number,
  now: Date = new Date(),
): Promise<AccessResult> {
  const assignment = await getAssignmentById(assignmentId)
  if (assignment.payment_status === "pending") return { ok: false, reason: "payment" }
  const weekAccess = weekNumber != null ? await getWeekAccess(assignmentId, weekNumber) : null
  if (weekNumber != null && weekState(weekNumber, assignment, weekAccess?.visibility, now) !== "visible") {
    return { ok: false, reason: "not_released" }
  }
  return isAccessAllowed(assignment, weekAccess) ? { ok: true } : { ok: false, reason: "payment" }
}
