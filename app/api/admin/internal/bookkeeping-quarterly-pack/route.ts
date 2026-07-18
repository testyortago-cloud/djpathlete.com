// POST /api/admin/internal/bookkeeping-quarterly-pack
// Called by functions bookkeepingQuarterlyPackCron on Jan/Apr/Jul/Oct 1.
// Emails the PRIOR calendar quarter's accountant pack to the stored address.
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped, getSetting } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { presetRange } from "@/lib/bookkeeping/period"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { sendAccountantPack } from "@/lib/bookkeeping/email-pack"
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
    enabledKey: "cron_bookkeeping_quarterly_pack_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingQuarterlyPackCron")
  try {
    const recipient = await getSetting<string>("bookkeeping_accountant_email", "")
    if (!recipient) {
      await logCronEnd(supabase, runId, "success", { skipped: "no accountant email configured" })
      return NextResponse.json({ skipped: "no accountant email configured" }, { status: 200 })
    }

    const today = new Date().toISOString().slice(0, 10)
    const { from, to } = presetRange("last_quarter", today)
    const [{ books, accounts, entries }, documents] = await Promise.all([
      loadReportBundle(from, to),
      listAllDocuments(),
    ])
    const buffer = await buildAccountantPack({ from, to, books, accounts, entries, documents })
    const { error } = await sendAccountantPack({ recipient, from, to, buffer })
    if (error) throw new Error(error)

    void recordAudit({
      action: "bookkeeping.report_emailed",
      category: "commerce",
      outcome: "success",
      actor: { id: null, email: "bookkeepingQuarterlyPackCron", role: "system" },
      metadata: { recipient_email: recipient, from, to, entry_count: entries.length, trigger: "quarterly_cron" },
    })
    await logCronEnd(supabase, runId, "success", { sentTo: recipient, from, to, entry_count: entries.length })
    return NextResponse.json({ ok: true, sentTo: recipient, from, to })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[bookkeeping-quarterly-pack] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
