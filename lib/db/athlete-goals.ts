import { createServiceRoleClient } from "@/lib/supabase"
import type { AthleteGoal, GoalStatus, GoalMetricKind } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listByUser(
  clientUserId: string,
  opts: { status?: GoalStatus; metricKind?: GoalMetricKind } = {},
) {
  const supabase = getClient()
  let q = supabase.from("athlete_goals").select("*").eq("client_user_id", clientUserId)
  if (opts.status) q = q.eq("status", opts.status)
  if (opts.metricKind) q = q.eq("metric_kind", opts.metricKind)
  const { data, error } = await q.order("created_at", { ascending: false })
  if (error) throw error
  return data as AthleteGoal[]
}

export async function getActive(clientUserId: string) {
  return listByUser(clientUserId, { status: "active" })
}

export async function getById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("athlete_goals")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data as AthleteGoal
}

export async function create(
  clientUserId: string,
  payload: Omit<
    AthleteGoal,
    "id" | "client_user_id" | "status" | "achieved_at" | "created_at" | "updated_at"
  >,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("athlete_goals")
    .insert({
      client_user_id: clientUserId,
      status: "active",
      achieved_at: null,
      ...payload,
    })
    .select()
    .single()
  if (error) throw error
  return data as AthleteGoal
}

export async function update(
  id: string,
  patch: Partial<Omit<AthleteGoal, "id" | "client_user_id" | "created_at" | "updated_at">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("athlete_goals")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as AthleteGoal
}

export async function markAchieved(id: string, achievedAt: string) {
  return update(id, { status: "achieved", achieved_at: achievedAt })
}

export async function archive(id: string) {
  return update(id, { status: "archived" })
}
