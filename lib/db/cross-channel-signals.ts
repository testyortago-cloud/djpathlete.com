import type { SupabaseClient } from "@supabase/supabase-js"
import type { CrossChannelSignal } from "@/types/database"

export async function latestSignal(
  supabase: SupabaseClient,
): Promise<CrossChannelSignal | null> {
  const { data } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as CrossChannelSignal | null) ?? null
}

export async function signalForWeek(
  supabase: SupabaseClient,
  weekOf: string,
): Promise<CrossChannelSignal | null> {
  const { data } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .eq("week_of", weekOf)
    .maybeSingle()
  return (data as CrossChannelSignal | null) ?? null
}

type SignalInsert = Omit<CrossChannelSignal, "id" | "created_at">

export async function insertSignal(
  supabase: SupabaseClient,
  signal: SignalInsert,
): Promise<CrossChannelSignal> {
  const { data, error } = await supabase
    .from("cross_channel_signals")
    .insert(signal)
    .select()
    .single()
  if (error || !data) throw new Error(`insertSignal: ${error?.message ?? "unknown"}`)
  return data as CrossChannelSignal
}

export async function insertPreflightFailedSignal(
  supabase: SupabaseClient,
  weekOf: string,
  reasons: string[],
): Promise<CrossChannelSignal> {
  return insertSignal(supabase, {
    week_of: weekOf,
    winners: [],
    losers: [],
    anomalies: [],
    attribution_summary: {},
    recommendations_for_brief: [],
    preflight_status: "failed",
    preflight_reasons: reasons,
    rationale: `Preflight failed: ${reasons.join("; ")}`,
  })
}

export async function listSignals(
  supabase: SupabaseClient,
  limit = 8,
): Promise<CrossChannelSignal[]> {
  const { data } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  return (data as CrossChannelSignal[] | null) ?? []
}
