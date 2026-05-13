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
import type { SeoAgentMemo, SeoAgentMemoAction, SeoAgentMemoOutcomeMetric } from "@/types/database"

const MEASUREMENT_AGE_DAYS = 14

function isoDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
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

      const { error: updateErr } = await supabase
        .from("seo_agent_memos")
        .update({
          outcome_status: "measured",
          outcome_metrics: metrics,
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

  return NextResponse.json(
    { processed: memos.length, measured, errors },
    { status: 200 },
  )
}
