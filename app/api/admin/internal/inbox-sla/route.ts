// POST /api/admin/internal/inbox-sla
// Weekday-morning job. Fetches GHL conversations, computes SLA metrics,
// persists one inbox_sla_snapshots row.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import {
  fetchInboxConversations,
  insertInboxSnapshot,
} from "@/lib/db/inbox-sla"
import { aggregateInboxSla } from "@/lib/automation/inbox-sla-aggregator"

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
    enabledKey: "cron_inbox_sla_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const { rows, status, detail } = await fetchInboxConversations()
  const aggregated = aggregateInboxSla(rows)
  try {
    await insertInboxSnapshot(supabase, {
      ...aggregated,
      fetch_status: status,
      raw: { fetch_detail: detail, conv_count: rows.length },
    })
  } catch (err) {
    console.error("[inbox-sla] insert failed:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  return NextResponse.json(
    { ok: true, status, conv_count: rows.length, ...aggregated },
    { status: 200 },
  )
}
