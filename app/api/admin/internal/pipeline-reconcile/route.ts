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

  // Started BEFORE the flag gate, on purpose. Production has no
  // cron_pipeline_reconcile_enabled row yet, so a route that only logs past
  // the gate would write NO cron_runs row for as long as the flag stays off —
  // which the health scanner cannot tell apart from a dead scheduler (audit
  // §4 #9). Logging the skipped run as "success" (never left "running", never
  // "failed") with `detail: { skipped: reason }` records that the schedule
  // fired while keeping "never succeeded once" from paging on a cron that is
  // off by design.
  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "pipelineReconcileCron")

  const gate = await isCronSkipped({
    enabledKey: "cron_pipeline_reconcile_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) {
    await logCronEnd(supabase, runId, "success", { skipped: gate.reason })
    return NextResponse.json({ skipped: gate.reason })
  }

  try {
    const summary = await runPipelineReconcile()

    // Task 10 (multi-coach ops): `runPipelineReconcile` now loops over every
    // active business but still returns ONE summary for the whole tick, so
    // this route still writes exactly ONE cron_runs row per tick regardless
    // of how many businesses were processed — see the design note on
    // `PipelineReconcileSummary.failures` (lib/automation/pipeline-reconcile.ts).
    // A non-empty `failures` means at least one business's pass threw; that
    // must not be silently reported as a healthy tick.
    const businessFailed = (summary.failures?.length ?? 0) > 0
    await logCronEnd(supabase, runId, businessFailed ? "failed" : "success", summary)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[pipeline-reconcile] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
