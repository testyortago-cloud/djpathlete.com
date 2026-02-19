import { createServerSupabaseClient } from "@/lib/supabase"
import type { ExerciseProgress } from "@/types/database"

export async function getProgress(userId: string, exerciseId?: string) {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from("exercise_progress")
    .select("*, exercises(*)")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
  if (exerciseId) {
    query = query.eq("exercise_id", exerciseId)
  }
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function logProgress(
  progress: Omit<ExerciseProgress, "id" | "created_at">
) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("exercise_progress")
    .insert(progress)
    .select()
    .single()
  if (error) throw error
  return data as ExerciseProgress
}
