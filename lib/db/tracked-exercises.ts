import { createServiceRoleClient } from "@/lib/supabase"
import type { TrackedExercise } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getTrackedExercises(assignmentId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("tracked_exercises")
    .select("*, exercises(*)")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data
}

export async function getTrackedExercisesForUser(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("tracked_exercises")
    .select("*, exercises(*), program_assignments!inner(*)")
    .eq("program_assignments.user_id", userId)
    .eq("program_assignments.status", "active")
    .order("created_at", { ascending: false })
  if (error) throw error
  return data
}

export async function createTrackedExercise(data: {
  assignment_id: string
  exercise_id: string
  target_metric?: string
  notes?: string | null
  created_by: string
}) {
  const supabase = getClient()
  const { data: result, error } = await supabase
    .from("tracked_exercises")
    .insert({
      assignment_id: data.assignment_id,
      exercise_id: data.exercise_id,
      target_metric: data.target_metric ?? "weight",
      notes: data.notes ?? null,
      created_by: data.created_by,
    })
    .select()
    .single()
  if (error) throw error
  return result as TrackedExercise
}

export async function deleteTrackedExercise(id: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("tracked_exercises")
    .delete()
    .eq("id", id)
  if (error) throw error
}

export async function isExerciseTracked(
  assignmentId: string,
  exerciseId: string
): Promise<boolean> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("tracked_exercises")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId)
    .eq("exercise_id", exerciseId)
  if (error) throw error
  return (count ?? 0) > 0
}
