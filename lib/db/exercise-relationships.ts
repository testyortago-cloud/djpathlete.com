import { createServiceRoleClient } from "@/lib/supabase"
import type { ExerciseRelationship } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getRelationships(exerciseId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_relationships")
    .select("*, exercises!exercise_relationships_related_exercise_id_fkey(*)")
    .eq("exercise_id", exerciseId)
    .order("relationship_type")
  if (error) throw error
  return data
}

export async function getProgressions(exerciseId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_relationships")
    .select("*, exercises!exercise_relationships_related_exercise_id_fkey(*)")
    .eq("exercise_id", exerciseId)
    .eq("relationship_type", "progression")
  if (error) throw error
  return data
}

export async function getAlternatives(exerciseId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_relationships")
    .select("*, exercises!exercise_relationships_related_exercise_id_fkey(*)")
    .eq("exercise_id", exerciseId)
    .eq("relationship_type", "alternative")
  if (error) throw error
  return data
}

export async function createRelationship(data: Omit<ExerciseRelationship, "id" | "created_at">) {
  const supabase = getClient()
  const { data: result, error } = await supabase.from("exercise_relationships").insert(data).select().single()
  if (error) throw error
  return result as ExerciseRelationship
}

export async function deleteRelationship(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("exercise_relationships").delete().eq("id", id)
  if (error) throw error
}
