import { createServiceRoleClient } from "@/lib/supabase"
import type { AttendanceArrangement } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export type ArrangementWithUser = AttendanceArrangement & {
  users: { id: string; first_name: string; last_name: string; email: string } | null
}

/** The one active arrangement for a client, or null. At most one can exist
 *  (partial unique index in 00234), so this is a maybeSingle, not a list. */
export async function getActiveArrangementForClient(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("attendance_arrangements")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("status", "active")
    .maybeSingle()
  if (error) throw error
  return data as AttendanceArrangement | null
}

/** Every arrangement a client has had, newest first — active plus ended history. */
export async function listArrangementsForClient(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("attendance_arrangements")
    .select("*")
    .eq("client_user_id", clientUserId)
    .order("started_on", { ascending: false })
  if (error) throw error
  return (data ?? []) as AttendanceArrangement[]
}

export async function createArrangement(
  a: Omit<AttendanceArrangement, "id" | "created_at" | "updated_at">,
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("attendance_arrangements").insert(a).select().single()
  if (error) throw error
  return data as AttendanceArrangement
}

export async function getArrangementById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("attendance_arrangements")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return data as AttendanceArrangement | null
}

/** End an arrangement. Past check-ins keep pointing at it — the history stays
 *  readable, and the partial unique index frees the client for a new one. */
export async function endArrangement(id: string, endedOn: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("attendance_arrangements")
    .update({ status: "ended", ended_on: endedOn })
    .eq("id", id)
    .eq("status", "active")
    .select()
    .maybeSingle()
  if (error) throw error
  return data as AttendanceArrangement | null
}

/** Every active arrangement with its client — the roll-up page's roster.
 *  Pins the FK name for the same reason listActivePackClients does: this table
 *  has two FKs to users (client_user_id + created_by), so a bare embed is
 *  ambiguous (PostgREST PGRST201) and the query throws. */
export async function listActiveArrangements() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("attendance_arrangements")
    .select("*, users!attendance_arrangements_client_user_id_fkey(id, first_name, last_name, email)")
    .eq("status", "active")
    .order("started_on", { ascending: true })
  if (error) throw error
  return (data ?? []) as ArrangementWithUser[]
}

/** Arrangements by id — used to name the ones a month's check-ins point at that
 *  are no longer active. An arrangement ENDED mid-month still owns the sessions
 *  it recorded before it ended, and those must still be billed. */
export async function listArrangementsByIds(ids: string[]) {
  if (ids.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from("attendance_arrangements")
    .select("*, users!attendance_arrangements_client_user_id_fkey(id, first_name, last_name, email)")
    .in("id", ids)
  if (error) throw error
  return (data ?? []) as ArrangementWithUser[]
}
