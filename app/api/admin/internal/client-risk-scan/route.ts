// POST /api/admin/internal/client-risk-scan
// Hit daily (05:00 UTC) by the clientRiskScanCron Firebase function.
// For each active client (users.role='client' AND status='active'), collect
// engagement signals, score risk, and upsert a row into
// client_engagement_snapshots keyed by (client_id, snapshot_date).

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import {
  collectRiskInput,
  listActiveClientIds,
  upsertSnapshot,
} from "@/lib/db/client-engagement"
import { scoreClientRisk } from "@/lib/automation/client-risk-scorer"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_client_risk_scan_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) {
    return NextResponse.json({ skipped: gate.reason }, { status: 200 })
  }

  const supabase = createServiceRoleClient()
  const snapshot_date = new Date().toISOString().slice(0, 10)

  let ids: string[]
  try {
    ids = await listActiveClientIds(supabase)
  } catch (err) {
    return NextResponse.json(
      { error: `listActiveClientIds: ${(err as Error).message}` },
      { status: 500 },
    )
  }

  const counters = {
    snapshot_date,
    total: ids.length,
    scored: 0,
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
    errors: 0,
  }
  const errorDetail: Array<{ client_id: string; message: string }> = []

  for (const client_id of ids) {
    try {
      const input = await collectRiskInput(supabase, client_id)
      const scored = scoreClientRisk(input)
      await upsertSnapshot(supabase, {
        client_id,
        snapshot_date,
        ...input,
        ...scored,
      })
      counters.scored += 1
      counters[scored.risk_tier] += 1
    } catch (err) {
      counters.errors += 1
      const message = (err as Error).message ?? "unknown"
      errorDetail.push({ client_id, message })
      console.error(`[client-risk-scan] failed for ${client_id}:`, err)
    }
  }

  return NextResponse.json({ ...counters, errors_detail: errorDetail }, { status: 200 })
}
