// Called by functions bookkeepingIncomeSyncCron (daily 04:30 UTC). Sweeps the
// money-of-record tables through the SAME pipeline the manual /admin/books
// import uses and posts new income to the primary business book. Safe to
// re-run: insertImportedEntries upserts on UNIQUE(book_id,source,source_ref),
// drops alt_ref cross-run duplicates, and partitions out closed periods.
// SINGLE cron_runs owner under "bookkeepingIncomeSyncCron" — functions/ must not log.
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import {
  listBooks, listAccounts, listPlatformIncome, latestPlatformImportDate, insertImportedEntries,
} from "@/lib/db/bookkeeping"
import { buildIncomeDrafts } from "@/lib/bookkeeping/income-adapter"
import { matchAccountForServiceLine } from "@/lib/bookkeeping/account-match"
import { computeSyncWindow } from "@/lib/bookkeeping/income-sync-window"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 120

const WARNINGS_CAP = 20

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_bookkeeping_income_sync_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingIncomeSyncCron")
  try {
    const books = await listBooks()
    const book = books.find((b) => b.is_primary && b.book_kind === "business")
    if (!book) throw new Error("No primary business book found")

    const today = new Date().toISOString().slice(0, 10)
    const watermark = await latestPlatformImportDate(book.id)
    const { from, to } = computeSyncWindow(watermark, today)

    // strict: a source-table read failure here must fail the run (throw → logCronEnd
    // "failed" + 500 → health watchdog) rather than silently degrading to [] and
    // letting the watermark advance past that table's unread income.
    const sources = await listPlatformIncome(from, to, { strict: true })
    const { drafts, warnings } = buildIncomeDrafts(sources, { from, to })
    const accounts = await listAccounts(book.id)
    const withAccounts = drafts.map((d) => ({
      ...d,
      account_id: matchAccountForServiceLine(d.direction, d.service_line, accounts)?.id ?? null,
    }))

    const batchId = crypto.randomUUID()
    const { inserted, rejected_closed, skipped_alt_ref } =
      await insertImportedEntries(book.id, batchId, withAccounts)

    const detail = {
      inserted, rejected_closed, skipped_alt_ref,
      drafts: drafts.length,
      window_from: from, window_to: to,
      warnings: warnings.slice(0, WARNINGS_CAP),
    }
    if (inserted > 0) {
      void recordAudit({
        action: "bookkeeping.income_synced",
        category: "commerce",
        outcome: "success",
        actor: { id: null, email: "bookkeepingIncomeSyncCron", role: "system" },
        target: { type: "bookkeeping_book", id: book.id },
        metadata: { ...detail, import_batch_id: batchId },
      })
    }
    await logCronEnd(supabase, runId, "success", detail)
    return NextResponse.json({ ok: true, ...detail })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[bookkeeping-income-sync] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
