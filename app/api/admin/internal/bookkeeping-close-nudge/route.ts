// POST /api/admin/internal/bookkeeping-close-nudge
// Called by functions bookkeepingCloseNudgeCron (3rd of each month, 13:00 UTC).
// Finds finished months that still have no close row and emails the COACH the
// list. This route is the SINGLE cron_runs owner under "bookkeepingCloseNudgeCron"
// — functions/ must not log (the receipt-watchdog precedent).
//
// No dedupe state: the schedule IS the cadence (once a month). A month the coach
// ignores reappears next month, which is the point.
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listBooks, listCloses, listEntriesForReports } from "@/lib/db/bookkeeping"
import { closeNudgeTargets, nudgeWindow } from "@/lib/bookkeeping/close-nudge"
import { sendCloseNudgeEmail, totalOpenMonths } from "@/lib/bookkeeping/email-close-nudge"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_bookkeeping_close_nudge_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingCloseNudgeCron")
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { from, to } = nudgeWindow(today)
    const [books, entries, closes] = await Promise.all([
      listBooks(),
      listEntriesForReports(from, to),
      listCloses(),
    ])
    const nudges = closeNudgeTargets({ books, entries, closedPeriods: closes, today })
    if (nudges.length === 0) {
      await logCronEnd(supabase, runId, "success", { open_months: 0 })
      return NextResponse.json({ ok: true, open_months: 0 })
    }

    const openMonths = totalOpenMonths(nudges)
    const { error } = await sendCloseNudgeEmail({ nudges })
    if (error) throw new Error(error)

    void recordAudit({
      action: "bookkeeping.close_nudge_emailed",
      category: "commerce",
      outcome: "success",
      actor: { id: null, email: "bookkeepingCloseNudgeCron", role: "system" },
      metadata: {
        open_months: openMonths,
        books: nudges.length,
        periods: nudges.flatMap((n) => n.open_months.map((m) => `${n.book_name}:${m.period}`)),
        window_from: from,
        window_to: to,
        trigger: "monthly_cron",
      },
    })
    await logCronEnd(supabase, runId, "success", { open_months: openMonths, emailed: true })
    return NextResponse.json({ ok: true, open_months: openMonths, emailed: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[bookkeeping-close-nudge] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
