import { createServiceRoleClient } from "@/lib/supabase"
import type { SessionCheckin } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function createCheckin(c: Omit<SessionCheckin, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("session_checkins").insert(c).select().single()
  if (error) throw error
  return data as SessionCheckin
}

export async function getCheckinById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("session_checkins").select("*").eq("id", id).single()
  if (error) throw error
  return data as SessionCheckin
}

export async function listCheckinsForPackage(clientPackageId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_checkins")
    .select("*")
    .eq("client_package_id", clientPackageId)
    .order("checked_in_at", { ascending: false })
  if (error) throw error
  return data as SessionCheckin[]
}

export async function countActiveCheckinsForPackage(clientPackageId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("session_checkins")
    .select("*", { count: "exact", head: true })
    .eq("client_package_id", clientPackageId)
    .eq("voided", false)
  if (error) throw error
  return count ?? 0
}

/** Most recent non-voided check-in for a package since `sinceIso` — used for the
 *  idempotency window (reject an accidental double check-in). Returns null if none. */
export async function recentNonVoidedForPackage(clientPackageId: string, sinceIso: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_checkins")
    .select("*")
    .eq("client_package_id", clientPackageId)
    .eq("voided", false)
    .gte("checked_in_at", sinceIso)
    .order("checked_in_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as SessionCheckin | null
}

/** Stamp the completed workout_session this check-in advanced (for later undo). */
export async function setWorkoutSession(checkinId: string, workoutSessionId: string | null) {
  const supabase = getClient()
  const { error } = await supabase
    .from("session_checkins")
    .update({ workout_session_id: workoutSessionId })
    .eq("id", checkinId)
  if (error) throw error
}

export async function voidCheckin(id: string, opts: { voided_by: string | null; voided_reason: string | null }) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_checkins")
    .update({
      voided: true,
      voided_by: opts.voided_by,
      voided_reason: opts.voided_reason,
      voided_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as SessionCheckin
}

// ─── Attendance arrangements (00234) ─────────────────────────────────────────
// The same ledger holds attendance-only rows (credit_delta 0, no pack). These
// readers are the arrangement-keyed twins of the package-keyed ones above.

/** Idempotency-window twin of recentNonVoidedForPackage, keyed on the
 *  arrangement — an attendance check-in has no package to key on. */
export async function recentNonVoidedForArrangement(arrangementId: string, sinceIso: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_checkins")
    .select("*")
    .eq("arrangement_id", arrangementId)
    .eq("voided", false)
    .gte("checked_in_at", sinceIso)
    .order("checked_in_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as SessionCheckin | null
}

export async function listCheckinsForArrangement(arrangementId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_checkins")
    .select("*")
    .eq("arrangement_id", arrangementId)
    .order("checked_in_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as SessionCheckin[]
}

/**
 * Every non-voided attendance check-in whose session_date falls in
 * [fromDate, toDate] (inclusive, both `YYYY-MM-DD`). Powers the monthly
 * roll-up the coach reconciles against the facility's invoice.
 *
 * Filters on session_date rather than checked_in_at deliberately: session_date
 * is the day the session happened, which is what the facility bills for, and a
 * late/corrected entry stays on the day it belongs to.
 */
export async function listAttendanceCheckinsBetween(fromDate: string, toDate: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_checkins")
    .select("*")
    .not("arrangement_id", "is", null)
    .eq("voided", false)
    .gte("session_date", fromDate)
    .lte("session_date", toDate)
    .order("session_date", { ascending: false })
  if (error) throw error
  return (data ?? []) as SessionCheckin[]
}
