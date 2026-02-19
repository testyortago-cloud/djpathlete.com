import { createServiceRoleClient } from "@/lib/supabase"
import type { ProgramExercise } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getProgramExercises(programId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_exercises")
    .select("*, exercises(*)")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
    .order("day_of_week", { ascending: true })
    .order("order_index", { ascending: true })
  if (error) throw error
  return data
}

export async function addExerciseToProgram(
  programExercise: Omit<ProgramExercise, "id" | "created_at">
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_exercises")
    .insert(programExercise)
    .select()
    .single()
  if (error) throw error
  return data as ProgramExercise
}

export async function removeExerciseFromProgram(id: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("program_exercises")
    .delete()
    .eq("id", id)
  if (error) throw error
}
