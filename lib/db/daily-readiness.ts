import { createServiceRoleClient } from "@/lib/supabase"
import type { DailyReadiness } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getByUserAndDate(clientUserId: string, date: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("daily_readiness")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("date", date)
    .single()
  if (error) return null
  return data as DailyReadiness
}

export async function listByUser(clientUserId: string, opts: { from?: string; to?: string } = {}) {
  const supabase = getClient()
  let q = supabase.from("daily_readiness").select("*").eq("client_user_id", clientUserId)
  if (opts.from) q = q.gte("date", opts.from)
  if (opts.to) q = q.lte("date", opts.to)
  const { data, error } = await q.order("date", { ascending: false })
  if (error) throw error
  return data as DailyReadiness[]
}

export async function upsert(
  clientUserId: string,
  date: string,
  payload: Omit<DailyReadiness, "id" | "client_user_id" | "date" | "readiness_score" | "created_at" | "updated_at">,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("daily_readiness")
    .upsert({ client_user_id: clientUserId, date, ...payload }, { onConflict: "client_user_id,date" })
    .select()
    .single()
  if (error) throw error
  return data as DailyReadiness
}

export async function getLatest(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("daily_readiness")
    .select("*")
    .eq("client_user_id", clientUserId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data as DailyReadiness | null
}

export async function getReadinessTrend(clientUserId: string, days = 30) {
  const supabase = getClient()
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("daily_readiness")
    .select("date, readiness_score")
    .eq("client_user_id", clientUserId)
    .gte("date", from)
    .order("date", { ascending: true })
  if (error) throw error
  return data as { date: string; readiness_score: number }[]
}
