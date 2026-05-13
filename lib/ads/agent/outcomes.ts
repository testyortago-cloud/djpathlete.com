// lib/ads/agent/outcomes.ts
// Per-action 14-day post-window deltas, anchored to applied_at. Only runs
// after the recommendation has been applied; queued/rejected actions skip.

import * as T from "./thresholds"
import { computeSignificance, type Significance } from "./guardrails"
import type { GoogleAdsAgentMemoAction } from "@/types/database"

export interface CampaignWindow {
  before: { clicks: number; conversions: number; cost_usd?: number }
  after: { clicks: number; conversions: number; cost_usd?: number }
}

export interface MeasureOutcomeDeps {
  fetchCampaignWindow: (campaign_id: string, applied_at: Date) => Promise<CampaignWindow>
}

export interface ActionOutcome {
  rank: number
  tool: string
  metrics: Record<string, number>
  significance: Significance
  attribution: "clean" | "ambiguous"
  error?: "not_applied" | "not_yet_due" | "window_expired" | "no_data"
}

function pctDelta(before: number, after: number): number {
  if (before === 0) return after === 0 ? 0 : Number.POSITIVE_INFINITY
  return ((after - before) / before) * 100
}

export async function measureActionOutcome(
  action: GoogleAdsAgentMemoAction,
  deps: MeasureOutcomeDeps,
): Promise<ActionOutcome> {
  if (action.status !== "applied" || !action.applied_at) {
    return { rank: action.rank, tool: action.tool, metrics: {}, significance: "insufficient_data", attribution: "clean", error: "not_applied" }
  }
  const applied = new Date(action.applied_at)
  const ageDays = (Date.now() - applied.getTime()) / 86_400_000
  if (ageDays < T.OUTCOME_WINDOW_DAYS) {
    return { rank: action.rank, tool: action.tool, metrics: {}, significance: "insufficient_data", attribution: "clean", error: "not_yet_due" }
  }
  if (ageDays > T.OUTCOME_WINDOW_EXPIRY_DAYS) {
    return { rank: action.rank, tool: action.tool, metrics: {}, significance: "insufficient_data", attribution: "clean", error: "window_expired" }
  }
  const args = action.args as Record<string, unknown>
  const campaignId =
    (args.campaign_id as string | undefined) ?? (args.from_campaign_id as string | undefined) ?? (args.to_campaign_id as string | undefined) ?? null
  if (!campaignId) {
    return { rank: action.rank, tool: action.tool, metrics: {}, significance: "insufficient_data", attribution: "clean", error: "no_data" }
  }
  const window = await deps.fetchCampaignWindow(campaignId, applied)
  const cvrBefore = window.before.clicks === 0 ? 0 : window.before.conversions / window.before.clicks
  const cvrAfter = window.after.clicks === 0 ? 0 : window.after.conversions / window.after.clicks
  const significance = computeSignificance({
    kind: "proportion",
    before: { successes: window.before.conversions, trials: window.before.clicks },
    after: { successes: window.after.conversions, trials: window.after.clicks },
  })
  const metrics: Record<string, number> = {
    CTR_delta_pct: pctDelta(window.before.clicks, window.after.clicks),
    CVR_delta_pct: pctDelta(cvrBefore, cvrAfter),
  }
  if (window.before.cost_usd != null && window.after.cost_usd != null) {
    const cacBefore = window.before.conversions === 0 ? 0 : window.before.cost_usd / window.before.conversions
    const cacAfter = window.after.conversions === 0 ? 0 : window.after.cost_usd / window.after.conversions
    metrics.CAC_delta_pct = pctDelta(cacBefore, cacAfter)
  }
  return { rank: action.rank, tool: action.tool, metrics, significance, attribution: "clean" }
}

export function hasOverlappingAction(
  action: GoogleAdsAgentMemoAction,
  others: GoogleAdsAgentMemoAction[],
): boolean {
  if (!action.applied_at) return false
  const t0 = new Date(action.applied_at).getTime()
  const args = action.args as Record<string, unknown>
  const targetCampaign =
    (args.campaign_id as string | undefined) ?? (args.from_campaign_id as string | undefined)
  if (!targetCampaign) return false
  for (const o of others) {
    if (o.rank === action.rank || o.status !== "applied" || !o.applied_at) continue
    const otherArgs = o.args as Record<string, unknown>
    const otherCampaign =
      (otherArgs.campaign_id as string | undefined) ?? (otherArgs.from_campaign_id as string | undefined)
    if (otherCampaign !== targetCampaign) continue
    const dt = Math.abs(new Date(o.applied_at).getTime() - t0)
    if (dt <= T.OUTCOME_WINDOW_DAYS * 86_400_000) return true
  }
  return false
}
