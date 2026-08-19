// POST /api/admin/internal/contact-timeline-retention
// Daily job (also reachable via the admin "Run now" button). Scrubs PII out
// of contact_timeline_events.metadata for rows older than the retention
// window, stamping scrubbed_at while leaving kind/source/occurred_at intact.
// Shape copied from app/api/admin/internal/inbox-sla/route.ts. The scrubbing
// operation itself lives in lib/db/contact-timeline-retention.ts — this
// route is the auth/gate/logging shell around it.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped, getSetting } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { scrubContactTimeline } from "@/lib/db/contact-timeline-retention"

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
    enabledKey: "cron_contact_timeline_retention_enabled",
    defaultEnabled: true,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "contactTimelineRetentionCron")
  try {
    const days = await getSetting<number>("contact_timeline_retention_days", 365)
    const scrubbed = await scrubContactTimeline(supabase, days)
    await logCronEnd(supabase, runId, "success", { scrubbed, days })
    return NextResponse.json({ ok: true, scrubbed, days })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[contact-timeline-retention] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
