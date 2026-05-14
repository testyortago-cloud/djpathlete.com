import type { SupabaseClient } from "@supabase/supabase-js"
import type { SocialAgentMemo } from "@/types/database"

type SocialMemoInsert = Omit<SocialAgentMemo, "id" | "created_at" | "measured_at">

export async function insertSocialAgentMemo(
  supabase: SupabaseClient,
  memo: SocialMemoInsert,
): Promise<SocialAgentMemo> {
  const { data, error } = await supabase
    .from("social_agent_memos")
    .insert(memo)
    .select()
    .single()
  if (error || !data) throw new Error(`insertSocialAgentMemo: ${error?.message ?? "unknown"}`)
  return data as SocialAgentMemo
}

export async function recentSocialAgentMemos(
  supabase: SupabaseClient,
  limit = 8,
): Promise<SocialAgentMemo[]> {
  const { data } = await supabase
    .from("social_agent_memos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  return (data as SocialAgentMemo[] | null) ?? []
}

export async function pendingAgedSocialMemos(
  supabase: SupabaseClient,
  olderThanDays = 14,
): Promise<SocialAgentMemo[]> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from("social_agent_memos")
    .select("*")
    .eq("outcome_status", "pending")
    .lt("created_at", cutoff)
  return (data as SocialAgentMemo[] | null) ?? []
}

export async function markMemoMeasured(
  supabase: SupabaseClient,
  id: string,
  outcomeMetrics: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("social_agent_memos")
    .update({
      outcome_status: "measured",
      outcome_metrics: outcomeMetrics,
      measured_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) throw new Error(`markMemoMeasured: ${error.message}`)
}
