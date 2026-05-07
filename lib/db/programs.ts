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
  const { data, error } = await supabase.from("programs").select("*").eq("id", id).single()
  if (error) throw error
  return data as Program
}

export async function createProgram(program: Omit<Program, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("programs").insert(program).select().single()
  if (error) throw error
  return data as Program
}

export async function updateProgram(id: string, updates: Partial<Omit<Program, "id" | "created_at">>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("programs").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as Program
}

export async function getActiveProgramById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("programs").select("*").eq("id", id).eq("is_active", true).single()
  if (error) throw error
  return data as Program
}

export async function getPublicPrograms() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("is_active", true)
    .eq("is_public", true)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as Program[]
}

export async function getClientPrograms(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .select("program_id, programs(*)")
    .eq("user_id", userId)
    .eq("status", "active")
  if (error) throw error
  return (data ?? []).map((row) => (row as unknown as { programs: Program }).programs).filter(Boolean)
}

/**
 * Program completion rate = assignments with status='completed' / all assignments
 * with `created_at` falling in the range, expressed as a 0-100 integer.
 */
export async function getProgramCompletionRate(from: Date, to: Date): Promise<number> {
  const supabase = getClient()
  const fromIso = from.toISOString()
  const toIso = to.toISOString()
  const [completedRes, totalRes] = await Promise.all([
    supabase
      .from("program_assignments")
      .select("id", { head: true, count: "exact" })
      .eq("status", "completed")
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    supabase
      .from("program_assignments")
      .select("id", { head: true, count: "exact" })
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
  ])
  if (completedRes.error) throw completedRes.error
  if (totalRes.error) throw totalRes.error
  const total = totalRes.count ?? 0
  if (total === 0) return 0
  return Math.round(((completedRes.count ?? 0) / total) * 100)
}

export async function deleteProgram(id: string) {
  const supabase = getClient()

  // Clear assessment references to this program before deletion
  const { error: assessmentError } = await supabase
    .from("assessment_results")
    .update({ triggered_program_id: null })
    .eq("triggered_program_id", id)
  if (assessmentError) throw assessmentError

  // Hard delete — CASCADE removes program_exercises and program_assignments
  const { error } = await supabase.from("programs").delete().eq("id", id)
  if (error) throw error
}
