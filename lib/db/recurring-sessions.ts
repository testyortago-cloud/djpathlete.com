import { createServiceRoleClient } from "@/lib/supabase"
import type { RecurringSession } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function createRecurringSession(s: Omit<RecurringSession, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("recurring_sessions").insert(s).select().single()
  if (error) throw error
  return data as RecurringSession
}

export async function listRecurringForClient(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("recurring_sessions")
    .select("*")
    .eq("client_user_id", clientUserId)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true })
  if (error) throw error
  return data as RecurringSession[]
}

export async function listActiveRecurringSessions() {
  const supabase = getClient()
  const { data, error } = await supabase.from("recurring_sessions").select("*").eq("status", "active")
  if (error) throw error
  return data as RecurringSession[]
}

export async function getRecurringSessionById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("recurring_sessions").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return data as RecurringSession | null
}

export async function updateRecurringSession(id: string, patch: Partial<RecurringSession>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("recurring_sessions").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as RecurringSession
}

export async function deleteRecurringSession(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("recurring_sessions").delete().eq("id", id)
  if (error) throw error
}
