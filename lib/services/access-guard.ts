import type { ProgramAssignment, ProgramWeekAccess } from "@/types/database"
import { getAssignmentById } from "@/lib/db/assignments"
import { getWeekAccess } from "@/lib/db/week-access"

/** Pure: may this client train against this assignment (and optionally this week)? */
export function isAccessAllowed(
  assignment: Pick<ProgramAssignment, "payment_status">,
  weekAccess: Pick<ProgramWeekAccess, "access_type" | "payment_status"> | null,
): boolean {
  if (assignment.payment_status === "pending") return false
  if (weekAccess && weekAccess.access_type === "paid" && weekAccess.payment_status === "pending") return false
  return true
}

/** Loads the assignment (and week, if given) and applies isAccessAllowed. */
export async function assertAssignmentPayable(
  assignmentId: string,
  weekNumber?: number,
): Promise<{ ok: boolean }> {
  const assignment = await getAssignmentById(assignmentId)
  const weekAccess = weekNumber != null ? await getWeekAccess(assignmentId, weekNumber) : null
  return { ok: isAccessAllowed(assignment, weekAccess) }
}
