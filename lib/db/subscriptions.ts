import { createServiceRoleClient } from "@/lib/supabase"
import type { Subscription } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function createSubscription(subscription: Omit<Subscription, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("subscriptions").insert(subscription).select().single()
  if (error) throw error
  return data as Subscription
}

export async function getSubscriptionByStripeId(stripeSubscriptionId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle()
  if (error) throw error
  return data as Subscription | null
}

export async function getActiveSubscription(userId: string, programId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("program_id", programId)
    .in("status", ["active", "trialing", "past_due"])
    .maybeSingle()
  if (error) throw error
  return data as Subscription | null
}

export async function getSubscriptionsByUser(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*, programs(name, description)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as (Subscription & {
    programs: { name: string; description: string | null } | null
  })[]
}

export async function updateSubscription(id: string, updates: Partial<Omit<Subscription, "id" | "created_at">>) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("subscriptions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Subscription
}

export async function updateSubscriptionByStripeId(
  stripeSubscriptionId: string,
  updates: Partial<Omit<Subscription, "id" | "created_at">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("subscriptions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .select()
    .single()
  if (error) throw error
  return data as Subscription
}
