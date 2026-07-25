// Called by functions bookkeepingGmailReceiptsCron (hourly :20). Reads the
// coach's Gmail via the SHIPPED /admin/inbox OAuth connection
// (platform_connections row "gmail" — no Firebase secrets), lists messages
// under the configured receipt label, and ingests image/PDF attachments
// through the same recipe as photo upload (ingestReceiptDocument).
//
// STRICTLY READ-ONLY on the mailbox (Decision C-3): never marks read, never
// touches labels — idempotency is entirely external_ref check-then-insert
// ('gmail:<messageId>:<attachmentIndex>', 00193; NEVER an onConflict target).
// Gmail-not-connected / label-missing are SUCCESSFUL degraded runs
// (inbox-SLA precedent, lib/db/inbox-sla.ts) — a missing integration must
// never page. SINGLE cron_runs owner "bookkeepingGmailReceiptsCron".
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped, getSetting } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listBooks, listAccounts, hasDocumentsForExternalRefPrefix } from "@/lib/db/bookkeeping"
import {
  getAccessTokenForConnection, listLabels, listMessages, getMessage, getAttachment, GmailNotConnectedError,
} from "@/lib/gmail/client"
import { collectReceiptAttachments } from "@/lib/bookkeeping/receipt-attachments"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 300

/** Cap on NEW (not-yet-ingested) messages fully fetched per run — bounds
 *  Gmail getMessage calls; the remainder is picked up next hour
 *  (more_pending in detail). Backlog labeling Just Works (Decision C-8). */
export const MAX_MESSAGES_PER_RUN = 25
const DEFAULT_LABEL = "DJP Receipts"

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_bookkeeping_gmail_receipts_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingGmailReceiptsCron")
  try {
    const labelName = await getSetting<string>("bookkeeping_gmail_receipt_label", DEFAULT_LABEL)

    let accessToken: string
    try {
      ;({ accessToken } = await getAccessTokenForConnection())
    } catch (err) {
      if (err instanceof GmailNotConnectedError) {
        const detail = { fetch_status: "degraded", fetch_detail: "gmail_not_connected", label: labelName }
        await logCronEnd(supabase, runId, "success", detail)
        return NextResponse.json({ ok: true, ...detail })
      }
      throw err
    }

    const labels = await listLabels(accessToken)
    const label = labels.find((l) => l.name === labelName)
    if (!label) {
      const detail = { fetch_status: "degraded", fetch_detail: "label_not_found", label: labelName }
      await logCronEnd(supabase, runId, "success", detail)
      return NextResponse.json({ ok: true, ...detail })
    }

    const books = await listBooks()
    const book = books.find((b) => b.is_primary && b.book_kind === "business")
    if (!book) throw new Error("No primary business book found")
    const accountRows = await listAccounts(book.id)
    const accounts = accountRows.map((a) => ({ name: a.name, account_type: a.account_type }))

    // Label-only listing, no date bound (Decision C-8) — the label is the
    // coach's explicit opt-in set; per-message skip keeps re-polls cheap.
    const messageIds: string[] = []
    let pageToken: string | undefined
    do {
      const page = await listMessages(accessToken, { labelIds: [label.id], pageToken })
      for (const m of page.messages ?? []) messageIds.push(m.id)
      pageToken = page.nextPageToken
    } while (pageToken)

    let processed = 0
    let skipped = 0
    let ingested = 0
    let attachmentless = 0
    let more_pending = false

    for (const messageId of messageIds) {
      if (processed >= MAX_MESSAGES_PER_RUN) {
        more_pending = true
        break
      }
      if (await hasDocumentsForExternalRefPrefix(`gmail:${messageId}:`)) {
        skipped++
        continue
      }
      processed++
      const full = await getMessage(accessToken, messageId)
      const attachments = collectReceiptAttachments(full.payload)
      if (attachments.length === 0) {
        // Body-only email — produces nothing, v1 by design (Decision C-7);
        // cheaply re-listed each poll.
        attachmentless++
        continue
      }
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i]
        const buffer = await getAttachment(accessToken, messageId, att.attachmentId)
        await ingestReceiptDocument({
          bookId: book.id,
          buffer,
          mimeType: att.mimeType,
          originalFilename: att.filename,
          uploadedBy: null,
          externalRef: `gmail:${messageId}:${i}`,
          accounts,
          bookName: book.name,
          bookKind: book.book_kind,
        })
        ingested++
      }
    }

    const detail = {
      fetch_status: "ok", label: labelName,
      listed: messageIds.length, processed, skipped, attachmentless, ingested, more_pending,
    }
    if (ingested > 0) {
      void recordAudit({
        action: "bookkeeping.gmail_receipt_ingested",
        category: "commerce",
        outcome: "success",
        actor: { id: null, email: "bookkeepingGmailReceiptsCron", role: "system" },
        target: { type: "bookkeeping_book", id: book.id },
        metadata: detail,
      })
    }
    await logCronEnd(supabase, runId, "success", detail)
    return NextResponse.json({ ok: true, ...detail })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[bookkeeping-gmail-receipts] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
