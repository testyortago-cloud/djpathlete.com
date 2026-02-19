import { createServerSupabaseClient } from "@/lib/supabase"
import type { Notification } from "@/types/database"

export async function getNotifications(userId: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as Notification[]
}

export async function markAsRead(id: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Notification
}

export async function createNotification(
  notification: Omit<Notification, "id" | "created_at">
) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("notifications")
    .insert(notification)
    .select()
    .single()
  if (error) throw error
  return data as Notification
}
