import { createServiceRoleClient } from "@/lib/supabase"
import type { ScheduledSession } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

/**
 * Idempotent insert of one occurrence. The unique (client, date, time) index
 * means a re-run is a no-op — we ignore the conflict and return the existing row.
 */
export async function upsertScheduledSession(s: Omit<ScheduledSession, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("scheduled_sessions")
    .upsert(s, { onConflict: "client_user_id,session_date,start_time", ignoreDuplicates: true })
    .select()
    .maybeSingle()
  if (error) throw error
  return data as ScheduledSession | null
}

export async function listScheduledInRange(fromDate: string, toDate: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("scheduled_sessions")
    .select("*")
    .gte("session_date", fromDate)
    .lte("session_date", toDate)
    .order("session_date", { ascending: true })
    .order("start_time", { ascending: true })
  if (error) throw error
  return data as ScheduledSession[]
}

/** Existing occurrences for a client in a date range — used to avoid re-generating. */
export async function listScheduledForClientInRange(clientUserId: string, fromDate: string, toDate: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("scheduled_sessions")
    .select("*")
    .eq("client_user_id", clientUserId)
    .gte("session_date", fromDate)
    .lte("session_date", toDate)
  if (error) throw error
  return data as ScheduledSession[]
}

/** All still-`scheduled` occurrences up to `toDate` — the no-show scan input. */
export async function listScheduledPending(toDate: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("scheduled_sessions")
    .select("*")
    .eq("status", "scheduled")
    .lte("session_date", toDate)
  if (error) throw error
  return data as ScheduledSession[]
}

/** The client's `scheduled` occurrence for a given date (nearest by time), or null. */
export async function findScheduledForClientOnDate(clientUserId: string, date: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("scheduled_sessions")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("session_date", date)
    .eq("status", "scheduled")
    .order("start_time", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as ScheduledSession | null
}

export async function getScheduledById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("scheduled_sessions").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return data as ScheduledSession | null
}

export async function updateScheduledSession(id: string, patch: Partial<ScheduledSession>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("scheduled_sessions").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as ScheduledSession
}
