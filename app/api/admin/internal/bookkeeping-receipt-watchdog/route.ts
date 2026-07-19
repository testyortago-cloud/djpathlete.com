// POST /api/admin/internal/bookkeeping-receipt-watchdog
// Called by functions bookkeepingReceiptWatchdogCron (Tue 07:00 UTC).
// Scans the trailing 365 days for aged expense entries missing a receipt and/or a
// business purpose and emails the COACH the chore list. This route is the SINGLE
// cron_runs owner under "bookkeepingReceiptWatchdogCron" — functions/ must not log.
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listAccountsForInsights, listEntriesForInsights } from "@/lib/db/bookkeeping"
import { MIN_AGE_DAYS, receiptWatchdogFindings } from "@/lib/bookkeeping/receipt-watchdog"
import { WATCHDOG_EMAIL_ROW_CAP, sendReceiptWatchdogEmail } from "@/lib/bookkeeping/email-watchdog"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 120

const TRAILING_DAYS = 365

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_bookkeeping_receipt_watchdog_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingReceiptWatchdogCron")
  try {
    const today = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - TRAILING_DAYS * 86_400_000).toISOString().slice(0, 10)
    const [entries, accounts] = await Promise.all([
      listEntriesForInsights(from, today),
      listAccountsForInsights(),
    ])
    const findings = receiptWatchdogFindings(entries, accounts, { today, minAgeDays: MIN_AGE_DAYS })
    if (findings.length === 0) {
      await logCronEnd(supabase, runId, "success", { findings: 0 })
      return NextResponse.json({ ok: true, findings: 0 })
    }
    const totalCents = findings.reduce((sum, f) => sum + f.amount_cents, 0)
    const { error } = await sendReceiptWatchdogEmail({ findings })
    if (error) throw new Error(error)

    void recordAudit({
      action: "bookkeeping.receipt_watchdog_emailed",
      category: "commerce",
      outcome: "success",
      actor: { id: null, email: "bookkeepingReceiptWatchdogCron", role: "system" },
      metadata: {
        findings: findings.length,
        total_cents: totalCents,
        emailed_rows: Math.min(findings.length, WATCHDOG_EMAIL_ROW_CAP),
        window_from: from,
        window_to: today,
        trigger: "weekly_cron",
      },
    })
    await logCronEnd(supabase, runId, "success", { findings: findings.length, emailed: true })
    return NextResponse.json({ ok: true, findings: findings.length, emailed: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[bookkeeping-receipt-watchdog] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
