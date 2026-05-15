// lib/db/client-engagement.ts
// DAL for the client engagement / risk subsystem (Phase 1).
//
// Each helper covers one signal so the cron can be re-run safely; a partial
// failure (one missing table or null column) only affects one input to the
// scorer rather than tanking the whole snapshot.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { ClientEngagementSnapshot } from "@/types/database"
import type { RiskInput, RiskOutput } from "@/lib/automation/client-risk-scorer"

const MS_PER_DAY = 86_400_000

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY))
}

function daysUntil(iso: string): number {
  return Math.floor((new Date(iso).getTime() - Date.now()) / MS_PER_DAY)
}

/** Returns every users.id where role='client' AND status='active'. */
export async function listActiveClientIds(
  supabase: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("role", "client")
    .eq("status", "active")
  if (error) throw new Error(`listActiveClientIds: ${error.message}`)
  return (data ?? []).map((r: { id: string }) => r.id)
}

/**
 * Pulls every signal for one client. Each sub-query is independent: failures
 * are caught locally and result in a "high" default (for inactivity) or null
 * (for everything else) so the scorer can still produce a row.
 */
export async function collectRiskInput(
  supabase: SupabaseClient,
  clientId: string,
): Promise<RiskInput> {
  // 1) days_since_last_session — MAX(training_sessions.date) for the client
  let days_since_last_session = 999
  try {
    const { data } = await supabase
      .from("training_sessions")
      .select("date")
      .eq("client_user_id", clientId)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.date) {
      days_since_last_session = daysSince(`${data.date}T00:00:00Z`)
    }
  } catch (err) {
    console.warn(`[collectRiskInput] training_sessions failed for ${clientId}`, err)
  }

  // 2) session_frequency_pct_14d — sessions in last 14d / (preferred × 2) × 100
  let session_frequency_pct_14d: number | null = null
  try {
    const fourteenAgo = new Date(Date.now() - 14 * MS_PER_DAY).toISOString().slice(0, 10)
    const { count } = await supabase
      .from("training_sessions")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientId)
      .gte("date", fourteenAgo)
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("preferred_training_days")
      .eq("user_id", clientId)
      .maybeSingle()
    const preferred = profile?.preferred_training_days ?? null
    if (preferred && preferred > 0) {
      const expected = preferred * 2
      session_frequency_pct_14d = Math.min(100, ((count ?? 0) / expected) * 100)
    }
  } catch (err) {
    console.warn(`[collectRiskInput] session frequency failed for ${clientId}`, err)
  }

  // 3) open_form_review_days — oldest pending form_review for this client
  let open_form_review_days: number | null = null
  try {
    const { data } = await supabase
      .from("form_reviews")
      .select("created_at")
      .eq("client_user_id", clientId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data?.created_at) open_form_review_days = daysSince(data.created_at)
  } catch (err) {
    console.warn(`[collectRiskInput] form_reviews failed for ${clientId}`, err)
  }

  // 4) open_performance_assessment_days — oldest non-completed assessment
  let open_performance_assessment_days: number | null = null
  try {
    const { data } = await supabase
      .from("performance_assessments")
      .select("updated_at")
      .eq("client_user_id", clientId)
      .in("status", ["draft", "in_progress"])
      .order("updated_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data?.updated_at) open_performance_assessment_days = daysSince(data.updated_at)
  } catch (err) {
    console.warn(`[collectRiskInput] performance_assessments failed for ${clientId}`, err)
  }

  // 5) program_ending_in_days + last_renewal_conversation_at
  let program_ending_in_days: number | null = null
  let last_renewal_conversation_at: string | null = null
  try {
    const { data } = await supabase
      .from("program_assignments")
      .select("end_date, last_renewal_conversation_at")
      .eq("user_id", clientId)
      .eq("status", "active")
      .order("end_date", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (data?.end_date) {
      program_ending_in_days = daysUntil(`${data.end_date}T00:00:00Z`)
    }
    last_renewal_conversation_at = data?.last_renewal_conversation_at ?? null
  } catch (err) {
    console.warn(`[collectRiskInput] program_assignments failed for ${clientId}`, err)
  }

  return {
    days_since_last_session,
    session_frequency_pct_14d,
    open_form_review_days,
    open_performance_assessment_days,
    program_ending_in_days,
    last_renewal_conversation_at,
  }
}

export interface SnapshotRow extends RiskInput, RiskOutput {
  client_id: string
  snapshot_date: string
}

export async function upsertSnapshot(
  supabase: SupabaseClient,
  row: SnapshotRow,
): Promise<void> {
  const { error } = await supabase
    .from("client_engagement_snapshots")
    .upsert(row, { onConflict: "client_id,snapshot_date" })
  if (error) throw new Error(`upsertSnapshot: ${error.message}`)
}

export async function topRiskToday(
  supabase: SupabaseClient,
  limit = 10,
): Promise<ClientEngagementSnapshot[]> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("client_engagement_snapshots")
    .select("*")
    .eq("snapshot_date", today)
    .in("risk_tier", ["high", "medium"])
    .order("risk_score", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`topRiskToday: ${error.message}`)
  return (data ?? []) as ClientEngagementSnapshot[]
}

/** Same as topRiskToday but joins client name/email for email rendering. */
export interface RiskWithClient extends ClientEngagementSnapshot {
  client_name: string
  client_email: string
}

export async function topRiskTodayWithClients(
  supabase: SupabaseClient,
  limit = 10,
): Promise<RiskWithClient[]> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("client_engagement_snapshots")
    .select(
      "*, users:client_id (first_name, last_name, email)",
    )
    .eq("snapshot_date", today)
    .in("risk_tier", ["high", "medium"])
    .order("risk_score", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`topRiskTodayWithClients: ${error.message}`)
  return (data ?? []).map((row: ClientEngagementSnapshot & {
    users: { first_name: string | null; last_name: string | null; email: string } | null
  }) => {
    const first = row.users?.first_name?.trim() ?? ""
    const last = row.users?.last_name?.trim() ?? ""
    const name = `${first} ${last}`.trim() || row.users?.email || "Unknown"
    const { users, ...rest } = row
    return { ...rest, client_name: name, client_email: row.users?.email ?? "" }
  })
}
