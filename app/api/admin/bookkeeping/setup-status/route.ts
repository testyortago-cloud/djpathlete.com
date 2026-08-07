// GET/PATCH /api/admin/bookkeeping/setup-status
// GET: auto-detected accounting setup checklist (pure compute in
// lib/bookkeeping/setup-status over DAL-gathered sources).
// PATCH: toggle a manual check, or stamp tour completion.
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { computeSetupItems, MANUAL_CHECK_KEYS } from "@/lib/bookkeeping/setup-status"
import { latestCronRun } from "@/lib/db/cron-runs"
import { hasStatementImportEntries } from "@/lib/db/bookkeeping"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { getPlatformConnection } from "@/lib/db/platform-connections"
import { createServiceRoleClient } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const patchSchema = z.union([
  z.object({ key: z.enum(MANUAL_CHECK_KEYS), checked: z.boolean() }),
  z.object({ tour_completed: z.literal(true) }),
])

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const supabase = createServiceRoleClient()
    const [connection, cronRun, forwarders, gmailReceipts, incomeSync, payoutSync, retention, receiptWatchdog, quarterlyPack, taxRatePercent, accountantEmail, statementEntryExists, manualChecks, tourCompletedAt] = await Promise.all([
      getPlatformConnection("gmail").catch(() => null),
      latestCronRun(supabase, "bookkeepingGmailReceiptsCron"),
      getSetting<unknown>("bookkeeping_gmail_receipt_forwarders", []),
      getSetting<boolean>("cron_bookkeeping_gmail_receipts_enabled", false),
      getSetting<boolean>("cron_bookkeeping_income_sync_enabled", false),
      getSetting<boolean>("cron_bookkeeping_payout_sync_enabled", false),
      getSetting<boolean>("cron_bookkeeping_retention_enabled", false),
      getSetting<boolean>("cron_bookkeeping_receipt_watchdog_enabled", false),
      getSetting<boolean>("cron_bookkeeping_quarterly_pack_enabled", false),
      getSetting<number | null>("bookkeeping_tax_rate_percent", null),
      getSetting<string>("bookkeeping_accountant_email", ""),
      hasStatementImportEntries(),
      getSetting<unknown>("bookkeeping_setup_manual_checks", []),
      getSetting<string | null>("bookkeeping_tour_completed_at", null),
    ])
    const items = computeSetupItems({
      gmailConnected: connection !== null,
      latestGmailCronDetail: cronRun?.detail ?? null,
      forwarders,
      flags: { gmailReceipts, incomeSync, payoutSync, retention, receiptWatchdog, quarterlyPack },
      taxRatePercent,
      accountantEmail,
      statementEntryExists,
      manualChecks,
    })
    // Banner counts cover the BASICS only — advanced extras never nag from
    // the banner ("basic only", owner 2026-08-03). The panel still shows all.
    const basics = items.filter((i) => !i.advanced)
    return NextResponse.json({
      items,
      doneCount: basics.filter((i) => i.status === "done").length,
      totalCount: basics.length,
      tourCompletedAt,
    })
  } catch (error) {
    console.error("bookkeeping setup-status:", error)
    return NextResponse.json({ error: "Failed to load setup status" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    if ("tour_completed" in parsed.data) {
      await setSetting("bookkeeping_tour_completed_at", new Date().toISOString(), session.user.id)
      void recordAudit({ action: "bookkeeping.tour_completed", category: "admin_write", outcome: "success",
        target: { type: "system_setting", id: "bookkeeping_tour_completed_at" }, request })
      return NextResponse.json({ ok: true })
    }
    const { key, checked } = parsed.data
    const stored = await getSetting<unknown>("bookkeeping_setup_manual_checks", [])
    const list = Array.isArray(stored) ? stored.filter((k): k is string => typeof k === "string") : []
    const next = checked ? Array.from(new Set([...list, key])) : list.filter((k) => k !== key)
    await setSetting("bookkeeping_setup_manual_checks", next, session.user.id)
    void recordAudit({ action: "bookkeeping.setup_manual_check_set", category: "admin_write", outcome: "success",
      target: { type: "system_setting", id: "bookkeeping_setup_manual_checks" }, metadata: { key, checked }, request })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("bookkeeping setup-status patch:", error)
    return NextResponse.json({ error: "Failed to save" }, { status: 500 })
  }
}
