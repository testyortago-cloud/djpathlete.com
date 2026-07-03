import { createServiceRoleClient } from "@/lib/supabase"
import type { MembershipPlan } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listActiveMembershipPlans() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("membership_plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
  if (error) throw error
  return data as MembershipPlan[]
}

export async function listAllMembershipPlans() {
  const supabase = getClient()
  const { data, error } = await supabase.from("membership_plans").select("*").order("sort_order", { ascending: true })
  if (error) throw error
  return data as MembershipPlan[]
}

export async function getMembershipPlanById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("membership_plans").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return data as MembershipPlan | null
}

export async function createMembershipPlan(p: Omit<MembershipPlan, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("membership_plans").insert(p).select().single()
  if (error) throw error
  return data as MembershipPlan
}

export async function updateMembershipPlan(id: string, patch: Partial<MembershipPlan>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("membership_plans").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as MembershipPlan
}
