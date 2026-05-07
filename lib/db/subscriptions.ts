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

export async function listSubscriptionsChangedInRange(
  from: Date,
  to: Date,
): Promise<{ created: number; cancelled: number }> {
  const supabase = getClient()
  const fromIso = from.toISOString()
  const toIso = to.toISOString()
  const [createdRes, cancelledRes] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("id", { head: true, count: "exact" })
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    supabase
      .from("subscriptions")
      .select("id", { head: true, count: "exact" })
      .not("canceled_at", "is", null)
      .gte("canceled_at", fromIso)
      .lt("canceled_at", toIso),
  ])
  if (createdRes.error) throw createdRes.error
  if (cancelledRes.error) throw cancelledRes.error
  return { created: createdRes.count ?? 0, cancelled: cancelledRes.count ?? 0 }
}

export async function countRenewalsInRange(from: Date, to: Date): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("subscriptions")
    .select("id", { head: true, count: "exact" })
    .eq("status", "active")
    .gte("current_period_start", from.toISOString())
    .lt("current_period_start", to.toISOString())
  if (error) throw error
  return count ?? 0
}

/**
 * Approximate MRR from active subscriptions. Joins to programs to read
 * price_cents + billing_interval. Annual prices are normalised to monthly.
 * Snapshot at "now" — not historical. Used for the weekly review headline.
 */
export async function getMrrCents(): Promise<number> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("subscriptions")
    .select("programs(price_cents, billing_interval)")
    .in("status", ["active", "trialing", "past_due"])
  if (error) throw error
  let total = 0
  for (const r of (data ?? []) as unknown as Array<{
    programs: { price_cents: number | null; billing_interval: string | null } | null
  }>) {
    const p = r.programs
    if (!p || p.price_cents == null) continue
    if (p.billing_interval === "year") total += Math.round(p.price_cents / 12)
    else total += p.price_cents
  }
  return total
}
