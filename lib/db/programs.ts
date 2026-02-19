import { createServiceRoleClient } from "@/lib/supabase"
import type { Program } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side admin routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getPrograms() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as Program[]
}

export async function getProgramById(id: string) {
  const supabase = getClient()
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
  const supabase = getClient()
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
  const supabase = getClient()
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
  const supabase = getClient()
  const { error } = await supabase
    .from("programs")
    .update({ is_active: false })
    .eq("id", id)
  if (error) throw error
}
