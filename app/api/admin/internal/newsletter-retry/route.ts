// POST /api/admin/internal/newsletter-retry
// Hourly. Sends the next batch of a newsletter's failed recipients, during the
// business's working hours only. The work lives in runNewsletterRetryTick
// (lib/automation/newsletter-retry.ts); this route is the auth, gate and
// logging shell, shaped like sequence-tick's.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { runNewsletterRetryTick } from "@/lib/automation/newsletter-retry"

export const runtime = "nodejs"
export const maxDuration = 60

const PROBLEMS = new Set(["failed", "refused", "send_error", "unconfirmed"])

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ON by default: the queue only ever holds rows a send failed on or that a
  // person enqueued by hand, so an empty queue makes this a no-op.
  const gate = await isCronSkipped({ enabledKey: "cron_newsletter_retry_enabled", defaultEnabled: true })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "newsletterRetryCron")
  try {
    const summary = await runNewsletterRetryTick()
    const problems = summary.businesses.filter((b) => PROBLEMS.has(b.outcome))
    await logCronEnd(supabase, runId, problems.length > 0 ? "failed" : "success", summary)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[newsletter-retry] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
