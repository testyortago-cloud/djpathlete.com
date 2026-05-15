// app/api/admin/internal/ads/outcome-tracker/route.ts
// Daily 04:30 UTC — measure outcomes for pending ads-agent memos older than
// 14 days. Iterates each memo's applied actions, computes per-action
// before/after deltas via measureActionOutcome, tags ambiguous attribution
// when sibling applied actions touched the same campaign, persists results
// to outcome_metrics, computes a normalized impact_score against per-tool
// baselines, and promotes outcome_status → 'measured' once any action is
// measurable (or all actions are past the 30-day window).
//
// Auth: Bearer ${INTERNAL_CRON_TOKEN} — same as agent-strategist.

import { NextRequest, NextResponse } from "next/server"
import {
  listMemosPendingOutcomes,
  updateAgentMemoLifecycle,
} from "@/lib/db/google-ads-agent-memos"
import { measureActionOutcome, hasOverlappingAction } from "@/lib/ads/agent/outcomes"
import { getCampaignWindow } from "@/lib/db/google-ads-metrics"
import { OUTCOME_WINDOW_DAYS, OUTCOME_WINDOW_EXPIRY_DAYS } from "@/lib/ads/agent/thresholds"
import { createServiceRoleClient } from "@/lib/supabase"
import { computeImpactScore } from "@/lib/agents/outcome-scoring"
import {
  getBaseline,
  upsertBaseline,
  recomputeBaseline,
} from "@/lib/db/agent-tool-baselines"
import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  GoogleAdsAgentMemoAction,
  GoogleAdsAgentMemo,
} from "@/types/database"

/**
 * Pick the relevant per-action delta out of the outcome_metrics shape.
 * outcome_metrics for ads is Record<scopeKey, { CTR_delta_pct, CVR_delta_pct, CAC_delta_pct? }>.
 * The "good" direction is action-specific: CAC drops are good (negative is good),
 * everything else (CVR/CTR/ROAS/spend_efficiency/impression_share) wants positive.
 *
 * computeImpactScore handles direction internally — we just hand it the raw
 * delta plus action.expected_direction.
 */
function pickDeltaForAction(
  action: GoogleAdsAgentMemoAction,
  metric: Record<string, unknown> | undefined,
): number {
  if (!metric) return 0
  switch (action.expected_metric) {
    case "CAC":
      return Number(metric.CAC_delta_pct ?? 0)
    case "CTR":
      return Number(metric.CTR_delta_pct ?? metric.CVR_delta_pct ?? 0)
    case "CVR":
    case "ROAS":
    case "spend_efficiency":
    case "impression_share":
    default:
      return Number(metric.CVR_delta_pct ?? metric.CTR_delta_pct ?? 0)
  }
}

function scopeKeyForAction(action: GoogleAdsAgentMemoAction): string {
  const args = action.args as Record<string, unknown>
  return (
    (args.campaign_id as string | undefined) ??
    (args.from_campaign_id as string | undefined) ??
    action.recommendation_id ??
    `r${action.rank}`
  )
}

async function scoreAdsMemo(
  supabase: SupabaseClient,
  actions: GoogleAdsAgentMemoAction[],
  outcome_metrics: Record<string, unknown>,
): Promise<number | null> {
  if (actions.length === 0) return null
  let bestScore: number | null = null
  for (const action of actions) {
    if (action.status !== "applied") continue
    const key = scopeKeyForAction(action)
    const metric = outcome_metrics[key] as Record<string, unknown> | undefined
    if (!metric) continue
    const delta = pickDeltaForAction(action, metric)
    const baseline = await getBaseline(supabase, "ads", action.tool)
    const score = computeImpactScore({
      delta,
      predicted_direction: action.expected_direction,
      baseline_p95: baseline?.p95_abs_delta ?? 0,
      baseline_n_measured: baseline?.n_measured ?? 0,
    })
    if (bestScore === null || Math.abs(score) > Math.abs(bestScore)) {
      bestScore = score
    }
  }
  return bestScore
}

async function refreshAdsBaselines(supabase: SupabaseClient): Promise<void> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const { data: rows } = await supabase
    .from("google_ads_agent_memos")
    .select("actions, outcome_metrics, created_at")
    .eq("outcome_status", "measured")
    .gte("created_at", ninetyDaysAgo)
  if (!rows) return

  const byTool: Record<string, Array<{ abs_delta: number; success: boolean }>> = {}
  for (const row of rows as Array<
    Pick<GoogleAdsAgentMemo, "actions" | "outcome_metrics">
  >) {
    const acts = (row.actions ?? []) as GoogleAdsAgentMemoAction[]
    const metrics = (row.outcome_metrics ?? {}) as Record<string, unknown>
    for (const action of acts) {
      if (action.status !== "applied") continue
      const key = scopeKeyForAction(action)
      const metric = metrics[key] as Record<string, unknown> | undefined
      if (!metric) continue
      const delta = pickDeltaForAction(action, metric)
      const movedAsPredicted =
        action.expected_direction === "increase" ? delta > 0 : delta < 0
      byTool[action.tool] ??= []
      byTool[action.tool].push({
        abs_delta: Math.abs(delta),
        success: movedAsPredicted,
      })
    }
  }
  for (const [tool, measurements] of Object.entries(byTool)) {
    await upsertBaseline(supabase, "ads", tool, recomputeBaseline(measurements))
  }
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const memos = await listMemosPendingOutcomes(OUTCOME_WINDOW_DAYS)
  const summary: Array<{
    memo_id: string
    measured: number
    skipped: number
    status: "measured" | "pending"
    impact_score: number | null
  }> = []
  const measuredMemoIds: string[] = []

  for (const memo of memos) {
    let measured = 0
    let skipped = 0
    const outcome_metrics: Record<string, unknown> = {}

    for (const action of memo.actions) {
      const out = await measureActionOutcome(action, {
        fetchCampaignWindow: (campaignId, applied) =>
          getCampaignWindow(campaignId, applied, OUTCOME_WINDOW_DAYS),
      })
      if (out.error) {
        skipped += 1
        continue
      }
      const ambiguous = hasOverlappingAction(action, memo.actions)
      const key = scopeKeyForAction(action)
      outcome_metrics[key] = {
        rank: action.rank,
        tool: action.tool,
        significance: out.significance,
        ...out.metrics,
        attribution: ambiguous ? "ambiguous" : "clean",
      }
      measured += 1
    }

    // Promote to 'measured' when at least one action produced a real signal
    // OR when every action's window has expired (past 30 days) — we won't
    // get any more data, so leaving pending forever would be wrong.
    const allWindowExpired =
      memo.actions.length > 0 &&
      memo.actions.every((a) => {
        if (!a.applied_at) return true
        const ageDays = (Date.now() - new Date(a.applied_at).getTime()) / 86_400_000
        return ageDays > OUTCOME_WINDOW_EXPIRY_DAYS
      })
    const nextStatus: "measured" | "pending" =
      measured > 0 || allWindowExpired ? "measured" : "pending"

    // Score the memo only when we're actually flipping to 'measured'.
    let impact_score: number | null = null
    if (nextStatus === "measured") {
      try {
        impact_score = await scoreAdsMemo(supabase, memo.actions, outcome_metrics)
      } catch (err) {
        console.error(`[ads-outcome-tracker] memo=${memo.id} scoring failed:`, err)
        impact_score = null
      }
    }

    try {
      await updateAgentMemoLifecycle(memo.id, {
        signals_summary: memo.signals_summary,
        actions: memo.actions,
        guardrail_rejections: memo.guardrail_rejections,
        outcome_status: nextStatus,
        outcome_metrics,
        impact_score,
      })
    } catch (err) {
      console.error(`[ads-outcome-tracker] memo=${memo.id} update failed:`, err)
      continue
    }

    if (nextStatus === "measured") measuredMemoIds.push(memo.id)
    summary.push({ memo_id: memo.id, measured, skipped, status: nextStatus, impact_score })
  }

  // Refresh per-tool baselines once per batch so the next agent run sees fresh numbers.
  if (measuredMemoIds.length > 0) {
    try {
      await refreshAdsBaselines(supabase)
    } catch (err) {
      console.error(`[ads-outcome-tracker] refreshAdsBaselines failed:`, err)
    }
  }

  return NextResponse.json({ ok: true, processed: memos.length, summary })
}
