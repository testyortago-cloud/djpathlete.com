// lib/db/chief-strategist-memos.ts
// Read/write DAL for the Chief Strategist's per-run audit trail.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { ChiefStrategistMemo } from "@/types/database"

export type ChiefMemoInsert = Omit<
  ChiefStrategistMemo,
  "id" | "created_at" | "brief_was_rejected" | "rejection_reason"
>

export async function insertChiefMemo(
  supabase: SupabaseClient,
  memo: ChiefMemoInsert,
): Promise<ChiefStrategistMemo> {
  const { data, error } = await supabase
    .from("chief_strategist_memos")
    .insert(memo)
    .select()
    .single()
  if (error || !data) throw new Error(`insertChiefMemo: ${error?.message ?? "unknown"}`)
  return data as ChiefStrategistMemo
}

export async function latestChiefMemo(
  supabase: SupabaseClient,
): Promise<ChiefStrategistMemo | null> {
  const { data } = await supabase
    .from("chief_strategist_memos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as ChiefStrategistMemo | null) ?? null
}

export async function chiefMemoForBrief(
  supabase: SupabaseClient,
  briefId: string,
): Promise<ChiefStrategistMemo | null> {
  const { data } = await supabase
    .from("chief_strategist_memos")
    .select("*")
    .eq("brief_id", briefId)
    .maybeSingle()
  return (data as ChiefStrategistMemo | null) ?? null
}

export async function markBriefRejected(
  supabase: SupabaseClient,
  briefId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("chief_strategist_memos")
    .update({
      brief_was_rejected: true,
      rejection_reason: reason,
    })
    .eq("brief_id", briefId)
  if (error) throw new Error(`markBriefRejected: ${error.message}`)
}
