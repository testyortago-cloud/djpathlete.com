// functions/src/social/outcome-scoring.ts
// Social outcome scoring helpers. Duplicates the shape from
// lib/agents/outcome-scoring.ts and lib/db/agent-tool-baselines.ts because the
// Firebase Functions package has `rootDir: "src"` and cannot import from `lib/`.

import type { SupabaseClient } from "@supabase/supabase-js"

// ─────────────────────────────────────────────────────────────────
// Social-specific delta: weighted engagement per 1000 impressions.
// ─────────────────────────────────────────────────────────────────

export interface SocialOutcomeInput {
  likes: number
  comments: number
  shares: number
  impressions: number
}

/**
 * Weighted engagement: shares > comments > likes. Normalized to
 * per-1000-impressions so different audience sizes are comparable. Returns 0
 * when impressions is 0.
 */
export function socialEngagementDelta(input: SocialOutcomeInput): number {
  if (input.impressions === 0) return 0
  const weighted = input.likes + 2 * input.comments + 3 * input.shares
  return (weighted / input.impressions) * 1000
}

// ─────────────────────────────────────────────────────────────────
// computeImpactScore — mirror of lib/agents/outcome-scoring.ts.
// Kept in sync manually; functions/ cannot import lib/.
// ─────────────────────────────────────────────────────────────────

export interface ImpactScoreInput {
  delta: number
  predicted_direction: "increase" | "decrease"
  baseline_p95: number
  baseline_n_measured: number
}

const WARM_UP_THRESHOLD = 5

export function computeImpactScore(input: ImpactScoreInput): number {
  const { delta, predicted_direction, baseline_p95, baseline_n_measured } =
    input

  if (delta === 0) return 0

  const movedAsPredicted =
    predicted_direction === "increase" ? delta > 0 : delta < 0
  const sign = movedAsPredicted ? 1 : -1

  if (baseline_n_measured < WARM_UP_THRESHOLD) {
    return sign * 50
  }

  if (baseline_p95 === 0) return 0
  const magnitude = Math.abs(delta) / baseline_p95
  const score = Math.round(sign * magnitude * 100)
  return Math.max(-100, Math.min(100, score))
}

// ─────────────────────────────────────────────────────────────────
// Baseline read + refresh — inlined to avoid importing lib/db.
// ─────────────────────────────────────────────────────────────────

export interface AgentToolBaselineRow {
  channel: string
  tool_name: string
  p95_abs_delta: number
  n_measured: number
  success_rate: number
}

export async function getSocialBaseline(
  supabase: SupabaseClient,
  toolName: string,
): Promise<AgentToolBaselineRow | null> {
  const { data } = await supabase
    .from("agent_tool_baselines")
    .select("*")
    .eq("channel", "social")
    .eq("tool_name", toolName)
    .maybeSingle()
  return (data as AgentToolBaselineRow | null) ?? null
}

/**
 * Recompute the social/drafted_social_post baseline from the last 90 days of
 * measured memos. Reads `outcome_metrics.engagement_delta` written by the
 * tracker when each memo was flipped to 'measured'.
 */
export async function refreshSocialBaseline(
  supabase: SupabaseClient,
): Promise<void> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const { data: rows } = await supabase
    .from("social_agent_memos")
    .select("outcome_metrics")
    .eq("outcome_status", "measured")
    .gte("run_date", ninetyDaysAgo)
  if (!rows) return

  const measurements: Array<{ abs_delta: number; success: boolean }> = []
  for (const r of rows as Array<{
    outcome_metrics: { engagement_delta?: number } | null
  }>) {
    const delta = r.outcome_metrics?.engagement_delta
    if (delta === null || delta === undefined) continue
    measurements.push({ abs_delta: Math.abs(delta), success: delta > 0 })
  }
  if (measurements.length === 0) return

  const sortedDeltas = measurements
    .map((m) => m.abs_delta)
    .sort((a, b) => a - b)
  const p95Index = Math.min(
    sortedDeltas.length - 1,
    Math.floor(sortedDeltas.length * 0.95),
  )
  const successes = measurements.filter((m) => m.success).length

  await supabase.from("agent_tool_baselines").upsert(
    {
      channel: "social",
      tool_name: "drafted_social_post",
      p95_abs_delta: sortedDeltas[p95Index],
      n_measured: measurements.length,
      success_rate: successes / measurements.length,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel,tool_name" },
  )
}
