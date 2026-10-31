// POST /api/admin/internal/output-sync
// Hourly, from the outputSyncCron Firebase function. Brings in new Output Sports results for
// every linked client of every business that has Output connected, so they appear without
// anyone pressing "Sync from Output". The work lives in syncAllLinkedClients
// (lib/output-sports/sync.ts); this route is the auth, gate and logging shell.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { syncAllLinkedClients } from "@/lib/output-sports/sync"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ON by default: with no business connected to Output it does nothing, and the coach was
  // told results arrive within the hour.
  const gate = await isCronSkipped({ enabledKey: "cron_output_sync_enabled", defaultEnabled: true })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "outputSyncCron")
  try {
    const summary = await syncAllLinkedClients()
    await logCronEnd(supabase, runId, summary.failures.length > 0 ? "failed" : "success", { ...summary })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[output-sync] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
