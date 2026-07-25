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
import { isCronSkipped, getSetting, setSetting } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listBooks, listAccounts, listExternalRefsWithPrefix } from "@/lib/db/bookkeeping"
import {
  getAccessTokenForConnection, listLabels, listMessages, getMessage, getAttachment, GmailNotConnectedError,
} from "@/lib/gmail/client"
import {
  collectReceiptAttachments, countUnsupportedReceiptAttachments,
} from "@/lib/bookkeeping/receipt-attachments"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 300

/** Cap on NEW (not-yet-settled) messages fully fetched per run — bounds
 *  Gmail getMessage calls; the remainder is picked up next hour
 *  (more_pending in detail). Backlog labeling Just Works (Decision C-8). */
export const MAX_MESSAGES_PER_RUN = 25
const DEFAULT_LABEL = "DJP Receipts"

/** Durable "this message needs no further work" marker set (system_settings
 *  jsonb array of Gmail message ids).
 *
 *  WHY IT EXISTS: without it, a message that yields nothing usable (a body-only
 *  HTML receipt — the common Uber/Amazon shape that Decision C-7 says will not
 *  import, or an email whose only attachment is an unscannable PDF) consumes a
 *  slot of MAX_MESSAGES_PER_RUN on EVERY run and never drops out of the working
 *  set. Gmail lists newest-first, so 26 such emails permanently starve an older
 *  message that really does carry the receipt: the run keeps succeeding while
 *  the receipt is never ingested, and the only signal is more_pending in a
 *  cron_runs detail nothing alerts on.
 *
 *  A message settles when (a) it produced no ingestible attachment, or (b) every
 *  ingestible attachment landed with no failure. A message with a FAILED
 *  attachment deliberately stays unsettled so the next run retries it. */
export const SETTLED_IDS_KEY = "bookkeeping_gmail_settled_message_ids"
/** Newest-N cap on the stored marker set. Truncation is safe: a truncated id
 *  is merely re-fetched once, and the per-attachment external_ref check below
 *  still prevents a duplicate ingest. */
export const MAX_SETTLED_IDS = 5000

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
  // `skipped` is a string here and a count on a real run (income-sync
  // convention) — skipped_reason is the single-typed alias for consumers.
  if (gate.skipped) {
    return NextResponse.json({ skipped: gate.reason, skipped_reason: gate.reason }, { status: 200 })
  }

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

    const storedSettled = await getSetting<unknown>(SETTLED_IDS_KEY, [])
    const settled = new Set<string>(
      Array.isArray(storedSettled) ? storedSettled.filter((v): v is string => typeof v === "string") : [],
    )
    const newlySettled: string[] = []

    let processed = 0
    let skipped = 0
    let ingested = 0
    let attachmentless = 0
    let unsupportedAttachments = 0
    let failed = 0
    const failures: string[] = []
    let more_pending = false

    for (const messageId of messageIds) {
      // Settled first: an already-answered message must never consume a slot
      // of the per-run budget (that is the starvation bug) and costs zero IO.
      if (settled.has(messageId)) {
        skipped++
        continue
      }
      if (processed >= MAX_MESSAGES_PER_RUN) {
        more_pending = true
        break
      }
      processed++
      const full = await getMessage(accessToken, messageId)
      const attachments = collectReceiptAttachments(full.payload)
      unsupportedAttachments += countUnsupportedReceiptAttachments(full.payload)
      if (attachments.length === 0) {
        // Body-only email, or one whose only attachments are unscannable
        // (PDF/HEIC) — produces nothing, v1 by design (Decision C-7).
        // Settled so it stops costing a fetch forever.
        attachmentless++
        newlySettled.push(messageId)
        continue
      }
      // Idempotency is PER ATTACHMENT, not per message: a run that ingested
      // index 0 and then died on index 1 must retry only index 1 next hour.
      const existingRefs = new Set(await listExternalRefsWithPrefix(`gmail:${messageId}:`))
      let failedHere = 0
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i]
        const externalRef = `gmail:${messageId}:${i}`
        if (existingRefs.has(externalRef)) {
          skipped++
          continue
        }
        try {
          const buffer = await getAttachment(accessToken, messageId, att.attachmentId)
          await ingestReceiptDocument({
            bookId: book.id,
            buffer,
            mimeType: att.mimeType,
            originalFilename: att.filename,
            uploadedBy: null,
            externalRef,
            accounts,
            bookName: book.name,
            bookKind: book.book_kind,
          })
          ingested++
        } catch (attErr) {
          // One bad part must not abort the run and strand its siblings — a
          // 500 here would leave the sibling documents written while the
          // message never gets retried. Count it, keep going, stay unsettled.
          failedHere++
          failed++
          const msg = attErr instanceof Error ? attErr.message : String(attErr)
          if (failures.length < 5) failures.push(`${externalRef}: ${msg}`)
          console.error(`[bookkeeping-gmail-receipts] ${externalRef} failed:`, attErr)
        }
      }
      if (failedHere === 0) newlySettled.push(messageId)
    }

    if (newlySettled.length > 0) {
      await setSetting(SETTLED_IDS_KEY, [...settled, ...newlySettled].slice(-MAX_SETTLED_IDS))
    }

    const detail = {
      fetch_status: "ok", label: labelName,
      listed: messageIds.length, processed, skipped, attachmentless,
      unsupported_attachments: unsupportedAttachments, ingested, failed,
      ...(failures.length > 0 ? { failures } : {}),
      more_pending,
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
