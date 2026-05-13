// app/api/admin/internal/ads/outcome-tracker/route.ts
// Daily 04:30 UTC — measure outcomes for pending ads-agent memos older than
// 14 days. Iterates each memo's applied actions, computes per-action
// before/after deltas via measureActionOutcome, tags ambiguous attribution
// when sibling applied actions touched the same campaign, persists results
// to outcome_metrics, and promotes outcome_status → 'measured' once any
// action is measurable (or all actions are past the 30-day window).
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

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const memos = await listMemosPendingOutcomes(OUTCOME_WINDOW_DAYS)
  const summary: Array<{
    memo_id: string
    measured: number
    skipped: number
    status: "measured" | "pending"
  }> = []

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
      const args = action.args as Record<string, unknown>
      const key =
        (args.campaign_id as string | undefined) ??
        (args.from_campaign_id as string | undefined) ??
        action.recommendation_id ??
        `r${action.rank}`
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

    try {
      await updateAgentMemoLifecycle(memo.id, {
        signals_summary: memo.signals_summary,
        actions: memo.actions,
        guardrail_rejections: memo.guardrail_rejections,
        outcome_status: nextStatus,
        outcome_metrics,
      })
    } catch (err) {
      console.error(`[ads-outcome-tracker] memo=${memo.id} update failed:`, err)
      continue
    }

    summary.push({ memo_id: memo.id, measured, skipped, status: nextStatus })
  }

  return NextResponse.json({ ok: true, processed: memos.length, summary })
}
