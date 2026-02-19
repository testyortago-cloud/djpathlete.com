import { createServerSupabaseClient } from "@/lib/supabase"
import type { Exercise } from "@/types/database"

export async function getExercises() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true })
  if (error) throw error
  return data as Exercise[]
}

export async function getExerciseById(id: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("id", id)
    .single()
  if (error) throw error
  return data as Exercise
}

export async function createExercise(
  exercise: Omit<Exercise, "id" | "created_at" | "updated_at">
) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("exercises")
    .insert(exercise)
    .select()
    .single()
  if (error) throw error
  return data as Exercise
}

export async function updateExercise(
  id: string,
  updates: Partial<Omit<Exercise, "id" | "created_at">>
) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("exercises")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Exercise
}

export async function deleteExercise(id: string) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("exercises")
    .update({ is_active: false })
    .eq("id", id)
  if (error) throw error
}
