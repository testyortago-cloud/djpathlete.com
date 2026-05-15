// lib/db/agent-tool-baselines.ts
// Read/write DAL for the per-(channel, tool_name) baselines used by
// computeImpactScore. Updated whenever an outcome flips to 'measured'.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AgentToolBaseline } from "@/types/database"

export type Channel = "seo" | "ads" | "social"

export async function getBaseline(
  supabase: SupabaseClient,
  channel: Channel,
  toolName: string,
): Promise<AgentToolBaseline | null> {
  const { data } = await supabase
    .from("agent_tool_baselines")
    .select("*")
    .eq("channel", channel)
    .eq("tool_name", toolName)
    .maybeSingle()
  return (data as AgentToolBaseline | null) ?? null
}

export async function listChannelBaselines(
  supabase: SupabaseClient,
  channel: Channel,
): Promise<AgentToolBaseline[]> {
  const { data } = await supabase
    .from("agent_tool_baselines")
    .select("*")
    .eq("channel", channel)
    .order("n_measured", { ascending: false })
  return (data as AgentToolBaseline[] | null) ?? []
}

export interface BaselineUpdate {
  p95_abs_delta: number
  n_measured: number
  success_rate: number
}

export async function upsertBaseline(
  supabase: SupabaseClient,
  channel: Channel,
  toolName: string,
  update: BaselineUpdate,
): Promise<void> {
  const { error } = await supabase.from("agent_tool_baselines").upsert(
    {
      channel,
      tool_name: toolName,
      p95_abs_delta: update.p95_abs_delta,
      n_measured: update.n_measured,
      success_rate: update.success_rate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel,tool_name" },
  )
  if (error) throw new Error(`upsertBaseline: ${error.message}`)
}

/**
 * Helper that recomputes the running aggregates from a list of recent measurements.
 * Caller passes the full window of absolute deltas; we compute P95 and success_rate.
 */
export function recomputeBaseline(
  measurements: Array<{ abs_delta: number; success: boolean }>,
): BaselineUpdate {
  if (measurements.length === 0) {
    return { p95_abs_delta: 0, n_measured: 0, success_rate: 0 }
  }
  const sortedDeltas = measurements
    .map((m) => m.abs_delta)
    .sort((a, b) => a - b)
  const p95Index = Math.min(
    sortedDeltas.length - 1,
    Math.floor(sortedDeltas.length * 0.95),
  )
  const successes = measurements.filter((m) => m.success).length
  return {
    p95_abs_delta: sortedDeltas[p95Index],
    n_measured: measurements.length,
    success_rate: successes / measurements.length,
  }
}
