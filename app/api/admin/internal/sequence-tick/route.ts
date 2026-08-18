// POST /api/admin/internal/sequence-tick
// Every-5-minutes job. Claims due sequence_runs, decides the next action for
// each via the pure `decideStep` core, and executes it (send, advance,
// defer, exit, complete, or fail). Shape copied from
// app/api/admin/internal/inbox-sla/route.ts. All the actual work lives in
// `runSequenceTick` (lib/automation/sequence-tick-runner.ts) — this route is
// the auth/gate/logging shell around it.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { runSequenceTick } from "@/lib/automation/sequence-tick-runner"

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
    enabledKey: "cron_sequence_tick_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "sequenceTickCron")
  try {
    const summary = await runSequenceTick()
    await logCronEnd(supabase, runId, "success", summary)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[sequence-tick] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
