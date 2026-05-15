// lib/db/google-ads-agent-memos.ts
// DAL for the senior-marketer agent's weekly strategist memos.

import { createServiceRoleClient } from "@/lib/supabase"
import type {
  GoogleAdsAgentMemo,
  GoogleAdsAgentMemoSections,
  GoogleAdsAgentMemoSource,
  GoogleAdsAgentMemoAction,
  GoogleAdsAgentMemoGuardrailRejection,
  GoogleAdsAgentMemoOutcomeStatus,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface InsertAgentMemoInput {
  week_of: string // YYYY-MM-DD (Monday)
  subject: string
  sections: GoogleAdsAgentMemoSections
  source: GoogleAdsAgentMemoSource
  triggered_by?: string | null
  tokens_used?: number
  /** FK to strategy_briefs(id); null when no approved brief was available. */
  brief_id?: string | null
  /** Model self-rating 1-10 of how well actions align with the brief. */
  brief_alignment_score?: number | null
  /** True when no approved brief was available at memo time. */
  ran_without_brief?: boolean
  /** Model's calibrated self-confidence 1-10 for the overall decision. */
  agent_confidence?: number | null
  /** True when the agent's plan deviates from the upstream brief. */
  dissents_from_brief?: boolean
  /** One-sentence rationale for the dissent (required when dissents_from_brief=true). */
  dissent_reason?: string | null
}

export async function insertAgentMemo(
  input: InsertAgentMemoInput,
): Promise<GoogleAdsAgentMemo> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_agent_memos")
    .insert({
      week_of: input.week_of,
      subject: input.subject,
      sections: input.sections,
      source: input.source,
      triggered_by: input.triggered_by ?? null,
      tokens_used: input.tokens_used ?? 0,
      brief_id: input.brief_id ?? null,
      brief_alignment_score: input.brief_alignment_score ?? null,
      ran_without_brief: input.ran_without_brief ?? false,
      agent_confidence: input.agent_confidence ?? null,
      dissents_from_brief: input.dissents_from_brief ?? false,
      dissent_reason: input.dissent_reason ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsAgentMemo
}

export async function listAgentMemos(limit: number = 30): Promise<GoogleAdsAgentMemo[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_agent_memos")
    .select("*")
    .order("week_of", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as GoogleAdsAgentMemo[]
}

export async function getAgentMemoById(id: string): Promise<GoogleAdsAgentMemo | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_agent_memos")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as GoogleAdsAgentMemo | null) ?? null
}

export async function setAgentMemoEmailSent(
  id: string,
  recipient: string,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_agent_memos")
    .update({
      email_sent_at: new Date().toISOString(),
      email_recipient: recipient,
    })
    .eq("id", id)
  if (error) throw error
}

export interface UpdateAgentMemoLifecycleInput {
  signals_summary: Record<string, unknown> | null
  actions: GoogleAdsAgentMemoAction[]
  guardrail_rejections: GoogleAdsAgentMemoGuardrailRejection[]
  outcome_status: GoogleAdsAgentMemoOutcomeStatus
  outcome_metrics?: Record<string, unknown> | null
}

export async function updateAgentMemoLifecycle(
  id: string,
  input: UpdateAgentMemoLifecycleInput,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_agent_memos")
    .update({
      signals_summary: input.signals_summary,
      actions: input.actions,
      guardrail_rejections: input.guardrail_rejections,
      outcome_status: input.outcome_status,
      outcome_metrics: input.outcome_metrics ?? null,
    })
    .eq("id", id)
  if (error) throw error
}

export async function listMemosPendingOutcomes(
  olderThanDays: number = 14,
): Promise<GoogleAdsAgentMemo[]> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from("google_ads_agent_memos")
    .select("*")
    .eq("outcome_status", "pending")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as GoogleAdsAgentMemo[]
}
