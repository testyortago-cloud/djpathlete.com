// POST /api/admin/internal/outcome-tracker
// Hit daily (04:00 UTC) by the outcomeTrackerCron Firebase function.
// Finds seo_agent_memos with outcome_status='pending' and run_date <= today-14d,
// resolves each action's outcome (per tool), writes outcome_metrics back,
// flips outcome_status to 'measured'.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  resolveNewPostOutcome,
  resolveRefreshOutcome,
  resolveLinkSweepOutcome,
  resolveFlagOutcome,
  type ResolvedOutcome,
} from "@/lib/seo-agent/outcomes"
import { computeImpactScore } from "@/lib/agents/outcome-scoring"
import {
  getBaseline,
  upsertBaseline,
  recomputeBaseline,
} from "@/lib/db/agent-tool-baselines"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SeoAgentMemo, SeoAgentMemoAction, SeoAgentMemoOutcomeMetric } from "@/types/database"

const MEASUREMENT_AGE_DAYS = 14

function isoDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

async function scoreSeoMemo(
  supabase: SupabaseClient,
  metrics: SeoAgentMemoOutcomeMetric[],
  actions: SeoAgentMemoAction[],
): Promise<number | null> {
  if (actions.length === 0) return null
  let bestScore: number | null = null
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    const metric = metrics[i]
    if (!metric || !action.executed) continue
    const before = "clicks_before" in metric ? (metric.clicks_before ?? 0) : 0
    const after = "clicks_after" in metric ? (metric.clicks_after ?? 0) : 0
    const delta = after - before
    if (delta === 0 && bestScore === null) {
      bestScore = 0
      continue
    }
    const baseline = await getBaseline(supabase, "seo", action.tool)
    const score = computeImpactScore({
      delta,
      predicted_direction: "increase", // SEO actions always predict more clicks
      baseline_p95: baseline?.p95_abs_delta ?? 0,
      baseline_n_measured: baseline?.n_measured ?? 0,
    })
    if (bestScore === null || Math.abs(score) > Math.abs(bestScore)) bestScore = score
  }
  return bestScore
}

async function refreshSeoBaselines(supabase: SupabaseClient): Promise<void> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const { data: rows } = await supabase
    .from("seo_agent_memos")
    .select("actions, outcome_metrics, run_date")
    .eq("outcome_status", "measured")
    .gte("run_date", ninetyDaysAgo)
  if (!rows) return

  const byTool: Record<string, Array<{ abs_delta: number; success: boolean }>> = {}
  for (const row of rows as Array<{
    actions: SeoAgentMemoAction[]
    outcome_metrics: SeoAgentMemoOutcomeMetric[] | null
  }>) {
    const acts = row.actions ?? []
    const metrics = row.outcome_metrics ?? []
    for (let i = 0; i < acts.length; i++) {
      const action = acts[i]
      const metric = metrics[i]
      if (!action || !metric || !action.executed) continue
      const before = "clicks_before" in metric ? (metric.clicks_before ?? 0) : 0
      const after = "clicks_after" in metric ? (metric.clicks_after ?? 0) : 0
      const delta = after - before
      byTool[action.tool] ??= []
      byTool[action.tool].push({ abs_delta: Math.abs(delta), success: delta > 0 })
    }
  }
  for (const [tool, measurements] of Object.entries(byTool)) {
    await upsertBaseline(supabase, "seo", tool, recomputeBaseline(measurements))
  }
}

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_outcome_tracker_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const firestore = getAdminFirestore()

  // Pull pending memos older than 14 days.
  const cutoff = isoDateNDaysAgo(MEASUREMENT_AGE_DAYS)
  const { data: pendingMemos, error: pendingErr } = await supabase
    .from("seo_agent_memos")
    .select("id, run_date, actions")
    .eq("outcome_status", "pending")
    .lte("run_date", cutoff)
  if (pendingErr) {
    return NextResponse.json({ error: `pending fetch failed: ${pendingErr.message}` }, { status: 500 })
  }
  const memos =
    (pendingMemos as Array<Pick<SeoAgentMemo, "id" | "run_date" | "actions">> | null) ?? []

  if (memos.length === 0) {
    return NextResponse.json({ processed: 0, measured: [] }, { status: 200 })
  }

  const measured: string[] = []
  const errors: Array<{ memoId: string; message: string }> = []

  for (const memo of memos) {
    try {
      const metrics: SeoAgentMemoOutcomeMetric[] = []
      const actions = (memo.actions ?? []) as SeoAgentMemoAction[]
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]
        const action_index = i as 0 | 1

        if (!action.executed || !action.execution_target_id) {
          metrics.push({ action_index, executed: false, target_id: null })
          continue
        }

        let resolved: ResolvedOutcome
        try {
          switch (action.tool) {
            case "queue_new_post":
              resolved = await resolveNewPostOutcome(action.execution_target_id, supabase)
              break
            case "queue_refresh":
              resolved = await resolveRefreshOutcome(
                action.execution_target_id,
                supabase,
                firestore,
              )
              break
            case "queue_internal_link_sweep":
              resolved = await resolveLinkSweepOutcome(
                action.execution_target_id,
                memo.run_date,
                supabase,
                firestore,
              )
              break
            case "flag_for_human":
              resolved = await resolveFlagOutcome(action.execution_target_id, supabase)
              break
            default:
              resolved = {
                executed: action.executed,
                target_id: action.execution_target_id,
                error: `unknown tool: ${action.tool}`,
              }
          }
        } catch (err) {
          console.error(
            `[outcome-tracker] memo=${memo.id} action#${i} tool=${action.tool} resolve failed:`,
            err,
          )
          resolved = {
            executed: action.executed,
            target_id: action.execution_target_id,
            error: (err as Error).message ?? "resolver threw",
          }
        }

        metrics.push({ action_index, ...resolved })
      }

      const impact_score = await scoreSeoMemo(supabase, metrics, actions)

      const { error: updateErr } = await supabase
        .from("seo_agent_memos")
        .update({
          outcome_status: "measured",
          outcome_metrics: metrics,
          impact_score,
          measured_at: new Date().toISOString(),
        })
        .eq("id", memo.id)
      if (updateErr) {
        errors.push({ memoId: memo.id, message: updateErr.message })
        continue
      }
      measured.push(memo.id)
    } catch (err) {
      console.error(`[outcome-tracker] memo=${memo.id} failed:`, err)
      errors.push({ memoId: memo.id, message: (err as Error).message ?? "unknown" })
    }
  }

  // Refresh per-tool baselines once per batch so the next agent run sees fresh numbers.
  if (measured.length > 0) {
    try {
      await refreshSeoBaselines(supabase)
    } catch (err) {
      console.error(`[outcome-tracker] refreshSeoBaselines failed:`, err)
    }
  }

  return NextResponse.json(
    { processed: memos.length, measured, errors },
    { status: 200 },
  )
}
