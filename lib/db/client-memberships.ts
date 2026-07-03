import { createServiceRoleClient } from "@/lib/supabase"
import type { ClientMembership } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createClientMembership(m: Omit<ClientMembership, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("client_memberships").insert(m).select().single()
  if (error) throw error
  return data as ClientMembership
}

export async function getMembershipBySubscriptionId(stripeSubscriptionId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_memberships")
    .select("*")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle()
  if (error) throw error
  return data as ClientMembership | null
}

export async function updateMembershipBySubscriptionId(stripeSubscriptionId: string, patch: Partial<ClientMembership>) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_memberships")
    .update(patch)
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .select()
    .maybeSingle()
  if (error) throw error
  return data as ClientMembership | null
}

export async function getActiveMembershipForUser(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_memberships")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as ClientMembership | null
}
