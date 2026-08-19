// POST /api/admin/internal/pipeline-reconcile
// Hourly catch-up job. A hook that throws AFTER its booking/payment row is
// already written loses a pipeline card permanently — the only symptom is a
// deal missing from a board nobody audits. This route is the auth/gate/
// logging shell (shape copied from
// app/api/admin/internal/sequence-tick/route.ts); all the actual work lives
// in `runPipelineReconcile` (lib/automation/pipeline-reconcile.ts).

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { runPipelineReconcile } from "@/lib/automation/pipeline-reconcile"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_pipeline_reconcile_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "pipelineReconcileCron")
  try {
    const summary = await runPipelineReconcile()
    await logCronEnd(supabase, runId, "success", summary)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[pipeline-reconcile] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
