import { createServiceRoleClient } from "@/lib/supabase"
import type { Notification } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getNotifications(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as Notification[]
}

/**
 * Marks ONE of `userId`'s own notifications read. G45: this used to update by
 * id alone, so any signed-in user could mark anyone's notification read and be
 * handed its title and message back. Null when `id` is not this user's, which
 * the route answers as 404; a read error still throws.
 */
export async function markAsRead(userId: string, id: string): Promise<Notification | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("id", id)
    .select()
    .maybeSingle()
  if (error) throw error
  return (data as Notification | null) ?? null
}

export async function createNotification(notification: Omit<Notification, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("notifications").insert(notification).select().single()
  if (error) throw error
  return data as Notification
}

export async function markAllAsRead(userId: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false)
  if (error) throw error
}

export async function getUnreadCount(userId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false)
  if (error) throw error
  return count ?? 0
}

/**
 * Recipient and read state of the given notifications, for the SEO agent's
 * memo page, which shows whether a "needs your answer" flag was handled and
 * offers the button only to the person it was sent to. Read-only: marking
 * one read still goes through markAsRead, scoped to its owner.
 */
export async function getNotificationReadStates(
  ids: string[],
): Promise<Record<string, Pick<Notification, "user_id" | "is_read">>> {
  if (ids.length === 0) return {}
  const supabase = getClient()
  const { data, error } = await supabase.from("notifications").select("id, user_id, is_read").in("id", ids)
  if (error) throw error
  const rows = (data ?? []) as Array<Pick<Notification, "id" | "user_id" | "is_read">>
  return Object.fromEntries(rows.map((n) => [n.id, { user_id: n.user_id, is_read: n.is_read }]))
}
