import { createServerSupabaseClient } from "@/lib/supabase"
import type { ProgramAssignment } from "@/types/database"

export async function getAssignments(userId?: string) {
  const supabase = await createServerSupabaseClient()
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

export async function createAssignment(
  assignment: Omit<ProgramAssignment, "id" | "created_at" | "updated_at">
) {
  const supabase = await createServerSupabaseClient()
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
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as ProgramAssignment
}
