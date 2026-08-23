// POST /api/admin/internal/chat-retention
//
// Nightly job (also reachable by hand with the internal cron token). Deletes
// chat conversations older than the retention window; their messages go with
// them by ON DELETE CASCADE. Shape copied from
// app/api/admin/internal/contact-timeline-retention/route.ts — this file is
// the auth / gate / logging shell, and the delete itself lives in
// lib/db/chat-retention.ts.
//
// THE FLAG DEFAULTS TO FALSE, which is the opposite of the timeline scrubber
// next door, and deliberately so. That job SCRUBS: it clears personal detail
// out of rows it leaves in place, so the cost of it running unattended is
// nearly nothing. This one DELETES transcripts, and an unreviewed destructive
// job that switches itself on the moment the code lands is how a business
// loses records it had not finished reading. It ships off; turning it on is a
// decision someone makes, once, on purpose.
//
// THE FUNCTION THAT CALLS THIS IS NOT DEPLOYED YET, and that is why
// `chatRetentionCron` is NOT in the automation-health scanner's expected list.
// A cron on that list with no `cron_runs` history alerts every single day for
// a job nobody broke, which teaches an operator to ignore the one alert that
// subsystem exists to raise. It goes on the list when it goes to production —
// both steps are in the handover.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped, getSetting } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { pruneChatConversations } from "@/lib/db/chat-retention"

export const runtime = "nodejs"
export const maxDuration = 120

/** 90 days. Long enough to answer "what did the assistant tell that person last quarter", and no longer. */
export const CHAT_RETENTION_DEFAULT_DAYS = 90

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_chat_retention_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "chatRetentionCron")
  try {
    const days = await getSetting<number>("chat_retention_days", CHAT_RETENTION_DEFAULT_DAYS)
    const deleted = await pruneChatConversations(supabase, days)
    await logCronEnd(supabase, runId, "success", { deleted, days })
    return NextResponse.json({ ok: true, deleted, days })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[chat-retention] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
