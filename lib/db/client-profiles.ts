import { createServiceRoleClient } from "@/lib/supabase"
import type { ClientProfile } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getProfileByUserId(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_profiles")
    .select("*")
    .eq("user_id", userId)
    .single()
  if (error) return null
  return data as ClientProfile
}

export async function createProfile(
  profile: Omit<ClientProfile, "id" | "created_at" | "updated_at">
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_profiles")
    .insert(profile)
    .select()
    .single()
  if (error) throw error
  return data as ClientProfile
}

export async function updateProfile(
  userId: string,
  updates: Partial<Omit<ClientProfile, "id" | "user_id" | "created_at">>
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_profiles")
    .update(updates)
    .eq("user_id", userId)
    .select()
    .single()
  if (error) throw error
  return data as ClientProfile
}
