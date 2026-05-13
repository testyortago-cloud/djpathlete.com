import { createServiceRoleClient } from "@/lib/supabase"
import type { Injury, RehabMilestone, InjuryStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listByUser(
  clientUserId: string,
  opts: { status?: InjuryStatus } = {},
) {
  const supabase = getClient()
  let q = supabase.from("injuries").select("*").eq("client_user_id", clientUserId)
  if (opts.status) q = q.eq("status", opts.status)
  const { data, error } = await q.order("date_occurred", { ascending: false })
  if (error) throw error
  return data as Injury[]
}

export async function getActive(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .select("*")
    .eq("client_user_id", clientUserId)
    .in("status", ["active", "recovering"])
    .order("date_occurred", { ascending: false })
  if (error) throw error
  return data as Injury[]
}

export async function getById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("injuries").select("*").eq("id", id).single()
  if (error) return null
  return data as Injury
}

export async function create(
  clientUserId: string,
  payload: Omit<Injury, "id" | "client_user_id" | "days_lost" | "created_at" | "updated_at">,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .insert({ client_user_id: clientUserId, ...payload })
    .select()
    .single()
  if (error) throw error
  return data as Injury
}

export async function update(
  id: string,
  patch: Partial<Omit<Injury, "id" | "client_user_id" | "days_lost" | "created_at" | "updated_at">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Injury
}

export async function resolve(id: string, dateResolved: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .update({ status: "resolved", date_resolved: dateResolved })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Injury
}

export async function addMilestone(id: string, milestone: RehabMilestone) {
  const existing = await getById(id)
  if (!existing) throw new Error("injury not found")
  const next = [...existing.rehab_milestones, milestone]
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .update({ rehab_milestones: next })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Injury
}

export async function completeMilestone(
  id: string,
  index: number,
  completedDate: string,
  notes?: string,
) {
  const existing = await getById(id)
  if (!existing) throw new Error("injury not found")
  const next = existing.rehab_milestones.map((m, i) =>
    i === index ? { ...m, completed_date: completedDate, notes: notes ?? m.notes } : m,
  )
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .update({ rehab_milestones: next })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Injury
}
