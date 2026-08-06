import { createServiceRoleClient } from "@/lib/supabase"
import type { ClientProfile } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getProfileByUserId(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_profiles").select("*").eq("user_id", userId).single()
  if (error) return null
  return data as ClientProfile
}

/**
 * `report_photo_url` is optional here: it is coach-set from the admin share
 * dialog long after the profile row is created, and defaults to NULL in the
 * database (migration 00200). Requiring it would force every caller to write
 * `report_photo_url: null` for a column they know nothing about.
 */
export async function createProfile(
  profile: Omit<ClientProfile, "id" | "created_at" | "updated_at" | "report_photo_url"> &
    Partial<Pick<ClientProfile, "report_photo_url">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_profiles").insert(profile).select().single()
  if (error) throw error
  return data as ClientProfile
}

export async function updateProfile(
  userId: string,
  updates: Partial<Omit<ClientProfile, "id" | "user_id" | "created_at">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_profiles").update(updates).eq("user_id", userId).select().single()
  if (error) throw error
  return data as ClientProfile
}

export async function getAllProfiles() {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_profiles").select("*")
  if (error) throw error
  return data as ClientProfile[]
}

export async function getProfilesWithQuestionnaire() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_profiles")
    .select("*, users!inner(first_name, last_name, email)")
    .not("goals", "is", null)
    .order("updated_at", { ascending: false })
  if (error) throw error
  return data
}
