import type { SupabaseClient } from "@supabase/supabase-js"
import type { StrategyBrief } from "@/types/database"

export async function latestApprovedBrief(
  supabase: SupabaseClient,
): Promise<StrategyBrief | null> {
  const { data } = await supabase
    .from("strategy_briefs")
    .select("*")
    .eq("approval_status", "approved")
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as StrategyBrief | null) ?? null
}

export async function briefForWeek(
  supabase: SupabaseClient,
  weekOf: string,
): Promise<StrategyBrief | null> {
  const { data } = await supabase
    .from("strategy_briefs")
    .select("*")
    .eq("week_of", weekOf)
    .maybeSingle()
  return (data as StrategyBrief | null) ?? null
}

type DraftInsert = Omit<
  StrategyBrief,
  "id" | "created_at" | "approved_at" | "approved_by" | "approval_status"
> & { approval_status?: "draft" }

export async function insertDraftBrief(
  supabase: SupabaseClient,
  brief: DraftInsert,
): Promise<StrategyBrief> {
  const { data, error } = await supabase
    .from("strategy_briefs")
    .insert({ ...brief, approval_status: "draft" })
    .select()
    .single()
  if (error || !data) throw new Error(`insertDraftBrief: ${error?.message ?? "unknown"}`)
  return data as StrategyBrief
}

export async function approveBrief(
  supabase: SupabaseClient,
  id: string,
  userId: string,
): Promise<StrategyBrief> {
  const { data, error } = await supabase
    .from("strategy_briefs")
    .update({
      approval_status: "approved",
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single()
  if (error || !data) throw new Error(`approveBrief: ${error?.message ?? "unknown"}`)
  return data as StrategyBrief
}

export async function rejectBrief(
  supabase: SupabaseClient,
  id: string,
  userId: string,
): Promise<StrategyBrief> {
  const { data, error } = await supabase
    .from("strategy_briefs")
    .update({
      approval_status: "rejected",
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single()
  if (error || !data) throw new Error(`rejectBrief: ${error?.message ?? "unknown"}`)
  return data as StrategyBrief
}

export async function patchDraftBrief(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<
    Omit<StrategyBrief, "id" | "created_at" | "approval_status" | "approved_at" | "approved_by">
  >,
): Promise<StrategyBrief> {
  const existing = await supabase
    .from("strategy_briefs")
    .select("approval_status")
    .eq("id", id)
    .maybeSingle()
  if (existing.data?.approval_status !== "draft") {
    throw new Error("patchDraftBrief: brief is not in draft state")
  }
  const { data, error } = await supabase
    .from("strategy_briefs")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error || !data) throw new Error(`patchDraftBrief: ${error?.message ?? "unknown"}`)
  return data as StrategyBrief
}

export async function listBriefs(
  supabase: SupabaseClient,
  limit = 8,
): Promise<StrategyBrief[]> {
  const { data } = await supabase
    .from("strategy_briefs")
    .select("*")
    .order("week_of", { ascending: false })
    .limit(limit)
  return (data as StrategyBrief[] | null) ?? []
}
