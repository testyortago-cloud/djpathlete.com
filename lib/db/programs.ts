import { createServerSupabaseClient } from "@/lib/supabase"
import type { Program } from "@/types/database"

export async function getPrograms() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as Program[]
}

export async function getProgramById(id: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("id", id)
    .single()
  if (error) throw error
  return data as Program
}

export async function createProgram(
  program: Omit<Program, "id" | "created_at" | "updated_at">
) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("programs")
    .insert(program)
    .select()
    .single()
  if (error) throw error
  return data as Program
}

export async function updateProgram(
  id: string,
  updates: Partial<Omit<Program, "id" | "created_at">>
) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("programs")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Program
}

export async function deleteProgram(id: string) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("programs")
    .update({ is_active: false })
    .eq("id", id)
  if (error) throw error
}
