import { auth } from "@/lib/auth"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { logExerciseEdit, type ExerciseEditInput } from "@/lib/db/program-exercise-edits"

/**
 * Logs an exercise change from the program builder's routes. Awaited (a bare promise dies with the request on
 * Vercel), but never throws: the coach's edit has already been saved, and a failed log must not undo or hide that.
 */
export async function logBuilderExerciseEdit(
  request: Request,
  edit: Omit<ExerciseEditInput, "businessId" | "coachId">,
): Promise<void> {
  try {
    const session = await auth()
    if (!session?.user?.id) return
    const { businessId } = await resolveAdminTenantForRequest(request)
    await logExerciseEdit({ ...edit, businessId, coachId: session.user.id })
  } catch (error) {
    console.error("[program-exercise-edits] could not log the change:", error instanceof Error ? error.message : error)
  }
}
