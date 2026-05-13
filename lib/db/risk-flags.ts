import { createServiceRoleClient } from "@/lib/supabase"
import type { RiskFlag, RiskFlagStatus, RiskFlagType } from "@/types/database"
import type { ProposedFlag } from "@/lib/coach-intel/evaluate-rules"

function getClient() {
  return createServiceRoleClient()
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function listByUser(
  clientUserId: string,
  opts: { status?: RiskFlagStatus; flagType?: RiskFlagType } = {},
) {
  const supabase = getClient()
  let q = supabase.from("risk_flags").select("*").eq("client_user_id", clientUserId)
  if (opts.status) q = q.eq("status", opts.status)
  if (opts.flagType) q = q.eq("flag_type", opts.flagType)
  const { data, error } = await q.order("triggered_at", { ascending: false })
  if (error) throw error
  return data as RiskFlag[]
}

export async function getOpenByUser(clientUserId: string) {
  return listByUser(clientUserId, { status: "open" })
}

export async function getCountByUser(
  clientUserId: string,
  status: RiskFlagStatus = "open",
) {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("risk_flags")
    .select("*", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("status", status)
  if (error) throw error
  return count ?? 0
}

export async function createIfNew(clientUserId: string, proposed: ProposedFlag) {
  const supabase = getClient()
  const since = addDays(proposed.triggered_at, -7)
  const { data: existing, error: lookupErr } = await supabase
    .from("risk_flags")
    .select("id")
    .eq("client_user_id", clientUserId)
    .eq("flag_type", proposed.flag_type)
    .eq("status", "open")
    .gte("triggered_at", since)
  if (lookupErr) throw lookupErr
  if (existing && existing.length > 0) return null

  const { data, error } = await supabase
    .from("risk_flags")
    .insert({ client_user_id: clientUserId, ...proposed })
    .select()
    .single()
  if (error) throw error
  return data as RiskFlag
}

export async function acknowledge(id: string, byUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("risk_flags")
    .update({
      status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: byUserId,
    })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as RiskFlag
}

export async function dismiss(id: string, byUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("risk_flags")
    .update({
      status: "dismissed",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: byUserId,
    })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as RiskFlag
}

export async function closeStaleByType(clientUserId: string, flagType: RiskFlagType) {
  const supabase = getClient()
  const { error } = await supabase
    .from("risk_flags")
    .update({
      status: "dismissed",
      acknowledged_at: new Date().toISOString(),
    })
    .eq("client_user_id", clientUserId)
    .eq("flag_type", flagType)
    .eq("status", "open")
  if (error) throw error
}
