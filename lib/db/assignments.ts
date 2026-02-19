import { createServiceRoleClient } from "@/lib/supabase"
import type { ProgramAssignment } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getAssignments(userId?: string) {
  const supabase = getClient()
  let query = supabase
    .from("program_assignments")
    .select("*, programs(*)")
    .order("created_at", { ascending: false })
  if (userId) {
    query = query.eq("user_id", userId)
  }
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getAssignmentByUserAndProgram(
  userId: string,
  programId: string
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .select("*")
    .eq("user_id", userId)
    .eq("program_id", programId)
    .maybeSingle()
  if (error) throw error
  return data as ProgramAssignment | null
}

export async function createAssignment(
  assignment: Omit<ProgramAssignment, "id" | "created_at" | "updated_at">
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .insert(assignment)
    .select()
    .single()
  if (error) throw error
  return data as ProgramAssignment
}

export async function updateAssignment(
  id: string,
  updates: Partial<Omit<ProgramAssignment, "id" | "created_at">>
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as ProgramAssignment
}
