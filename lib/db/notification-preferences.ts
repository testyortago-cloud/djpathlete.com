import { createServiceRoleClient } from "@/lib/supabase"
import type { NotificationPreferences } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

const DEFAULTS: Omit<NotificationPreferences, "id" | "user_id" | "created_at" | "updated_at"> = {
  notify_new_client: true,
  notify_payment_received: true,
  notify_program_completed: true,
  email_notifications: true,
  workout_reminders: false,
}

export async function getPreferences(
  userId: string
): Promise<NotificationPreferences> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error

  // Return existing or defaults
  if (data) return data as NotificationPreferences
  return {
    id: "",
    user_id: userId,
    created_at: "",
    updated_at: "",
    ...DEFAULTS,
  }
}

export async function upsertPreferences(
  userId: string,
  updates: Partial<Omit<NotificationPreferences, "id" | "user_id" | "created_at" | "updated_at">>
): Promise<NotificationPreferences> {
  const supabase = getClient()

  // Check if row exists
  const { data: existing } = await supabase
    .from("notification_preferences")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()

  if (existing) {
    const { data, error } = await supabase
      .from("notification_preferences")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select()
      .single()
    if (error) throw error
    return data as NotificationPreferences
  }

  // Insert with defaults + overrides
  const { data, error } = await supabase
    .from("notification_preferences")
    .insert({ user_id: userId, ...DEFAULTS, ...updates })
    .select()
    .single()
  if (error) throw error
  return data as NotificationPreferences
}
