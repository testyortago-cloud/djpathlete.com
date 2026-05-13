import { createServiceRoleClient } from "@/lib/supabase"
import type { TrainingSession, SessionType } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getByUserAndDateAndType(
  clientUserId: string,
  date: string,
  sessionType: SessionType,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("training_sessions")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("date", date)
    .eq("session_type", sessionType)
    .maybeSingle()
  if (error) return null
  return data as TrainingSession | null
}

export async function listByUser(
  clientUserId: string,
  opts: { from?: string; to?: string; sessionType?: SessionType } = {},
) {
  const supabase = getClient()
  let q = supabase.from("training_sessions").select("*").eq("client_user_id", clientUserId)
  if (opts.from) q = q.gte("date", opts.from)
  if (opts.to) q = q.lte("date", opts.to)
  if (opts.sessionType) q = q.eq("session_type", opts.sessionType)
  const { data, error } = await q.order("date", { ascending: false })
  if (error) throw error
  return data as TrainingSession[]
}

export async function getById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("training_sessions")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data as TrainingSession
}

export async function upsert(
  clientUserId: string,
  payload: Omit<
    TrainingSession,
    "id" | "client_user_id" | "session_load" | "created_at" | "updated_at"
  >,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("training_sessions")
    .upsert(
      { client_user_id: clientUserId, ...payload },
      { onConflict: "client_user_id,date,session_type" },
    )
    .select()
    .single()
  if (error) throw error
  return data as TrainingSession
}

export async function update(
  id: string,
  patch: Partial<
    Omit<
      TrainingSession,
      "id" | "client_user_id" | "session_load" | "created_at" | "updated_at"
    >
  >,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("training_sessions")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as TrainingSession
}

export async function deleteOne(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("training_sessions").delete().eq("id", id)
  if (error) throw error
}

export async function getLatest(clientUserId: string, n = 10) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("training_sessions")
    .select("*")
    .eq("client_user_id", clientUserId)
    .order("date", { ascending: false })
    .limit(n)
  if (error) throw error
  return data as TrainingSession[]
}
