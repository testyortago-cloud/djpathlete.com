import { createServiceRoleClient } from "@/lib/supabase"
import { effectiveTotalWeeks } from "@/lib/program-weeks"
import type { ProgramAssignment } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getAssignments(userId?: string) {
  const supabase = getClient()
  let query = supabase.from("program_assignments").select("*, programs(*)").order("created_at", { ascending: false })
  if (userId) {
    query = query.eq("user_id", userId)
  }
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getAssignmentByUserAndProgram(userId: string, programId: string) {
  const supabase = getClient()
  // Order so active assignments come first; use limit(1) to handle duplicates
  const { data, error } = await supabase
    .from("program_assignments")
    .select("*")
    .eq("user_id", userId)
    .eq("program_id", programId)
    .order("status", { ascending: true }) // "active" < "cancelled"/"completed"
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as ProgramAssignment | null
}

export async function createAssignment(assignment: Omit<ProgramAssignment, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("program_assignments").insert(assignment).select().single()
  if (error) throw error
  return data as ProgramAssignment
}

/** Get user IDs with active assignments for a specific program. */
export async function getActiveUserIdsForProgram(programId: string): Promise<string[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .select("user_id")
    .eq("program_id", programId)
    .eq("status", "active")
  if (error) throw error
  return (data ?? []).map((r) => r.user_id)
}

/** Get active assignments for a program with assignment IDs, user IDs, and editable fields. */
export async function getActiveAssignmentsForProgram(programId: string): Promise<
  {
    id: string
    user_id: string
    start_date: string
    notes: string | null
    payment_status: string
    expires_at: string | null
  }[]
> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .select("id, user_id, start_date, notes, payment_status, expires_at")
    .eq("program_id", programId)
    .eq("status", "active")
  if (error) throw error
  return data ?? []
}

/** Get the first active assignment for a program (for AI week generation). */
export async function getFirstActiveAssignmentForProgram(programId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .select("id, user_id, current_week, total_weeks")
    .eq("program_id", programId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Get the user's active assignment (most recent, payment settled). */
export async function getActiveAssignment(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .neq("payment_status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as ProgramAssignment | null
}

export async function getAssignmentCountsByProgram(): Promise<Record<string, number>> {
  const supabase = getClient()
  const { data, error } = await supabase.from("program_assignments").select("program_id").eq("status", "active")
  if (error) throw error
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.program_id] = (counts[row.program_id] ?? 0) + 1
  }
  return counts
}

export async function updateAssignment(id: string, updates: Partial<Omit<ProgramAssignment, "id" | "created_at">>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("program_assignments").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as ProgramAssignment
}

/** Advance assignment to next week. If past total_weeks, mark as completed. */
export async function advanceWeek(assignmentId: string) {
  const supabase = getClient()

  // Fetch current assignment
  const { data: assignment, error: fetchError } = await supabase
    .from("program_assignments")
    .select("current_week, total_weeks, program_id")
    .eq("id", assignmentId)
    .single()
  if (fetchError) throw fetchError

  // total_weeks is a snapshot that can go stale when the program is later expanded;
  // resolve completion against the program's live length so it never fires early.
  const { data: program } = await supabase
    .from("programs")
    .select("duration_weeks")
    .eq("id", assignment.program_id)
    .maybeSingle()
  const totalWeeks = effectiveTotalWeeks(assignment.total_weeks, program?.duration_weeks)

  const nextWeek = (assignment.current_week ?? 1) + 1

  if (nextWeek > totalWeeks) {
    // Program complete
    const { data, error } = await supabase
      .from("program_assignments")
      .update({ status: "completed" as const, current_week: assignment.current_week })
      .eq("id", assignmentId)
      .select()
      .single()
    if (error) throw error
    return { ...(data as ProgramAssignment), program_completed: true }
  }

  // Advance to next week
  const { data, error } = await supabase
    .from("program_assignments")
    .update({ current_week: nextWeek })
    .eq("id", assignmentId)
    .select()
    .single()
  if (error) throw error
  return { ...(data as ProgramAssignment), program_completed: false }
}

/** Hard-delete an assignment row (cascades to tracked_exercises, nulls exercise_progress). */
export async function deleteAssignment(assignmentId: string) {
  const supabase = getClient()
  const { error } = await supabase.from("program_assignments").delete().eq("id", assignmentId)
  if (error) throw error
}

/** Get the assignment by ID, verifying ownership */
export async function getAssignmentById(assignmentId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("program_assignments").select("*").eq("id", assignmentId).single()
  if (error) throw error
  return data as ProgramAssignment
}
