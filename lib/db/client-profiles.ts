import { createServerSupabaseClient } from "@/lib/supabase"
import type { ClientProfile } from "@/types/database"

export async function getProfileByUserId(userId: string) {
  const supabase = await createServerSupabaseClient()
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
  const supabase = await createServerSupabaseClient()
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
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("client_profiles")
    .update(updates)
    .eq("user_id", userId)
    .select()
    .single()
  if (error) throw error
  return data as ClientProfile
}
