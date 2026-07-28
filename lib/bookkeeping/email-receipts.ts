// Pure adapter: polled Gmail receipt document → editable ReceiptBatchRow, plus
// the system_settings key names the poller and the review page BOTH read (the
// route is a server module the page must not import, so the shared constants
// live here).
import { applyScanResult, newReceiptRow, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount, BookkeepingDocument } from "@/types/database"

/** Durable "this message needs no further work" marker set (jsonb string array). */
export const GMAIL_SETTLED_IDS_KEY = "bookkeeping_gmail_settled_message_ids"
/** Message ids settled ONLY because every receipt-shaped attachment was
 *  unreadable (unsupported mime, or over the size cap) — i.e. "needs manual
 *  upload". Surfaced on /admin/books/email-receipts and re-opened wholesale
 *  when the readable-mime fingerprint changes. */
export const GMAIL_UNREADABLE_IDS_KEY = "bookkeeping_gmail_unreadable_message_ids"
/** Fingerprint of SCANNABLE_MIMES at the time of the last run. */
export const GMAIL_SCANNABLE_MIMES_KEY = "bookkeeping_gmail_scannable_mimes"
/** Record<messageId, consecutiveFailedRuns> — the poison-pill counter. */
export const GMAIL_MESSAGE_ATTEMPTS_KEY = "bookkeeping_gmail_message_attempts"
/** Cron feature flag (00193 seeds it false). */
export const GMAIL_RECEIPTS_CRON_KEY = "cron_bookkeeping_gmail_receipts_enabled"
/** Watched Gmail label name. */
export const GMAIL_RECEIPT_LABEL_KEY = "bookkeeping_gmail_receipt_label"
export const DEFAULT_GMAIL_RECEIPT_LABEL = "DJP Receipts"

/** Shown on the row when the vision job never wrote scan_result. */
export const SCAN_INCOMPLETE_MESSAGE =
  "Scan didn't finish — the AI never returned a result for this attachment. Fill the fields in from the image below and post it manually."

/** scan_result present → the SAME fold-in the photo flow uses (applyScanResult
 *  over the RTDB-shaped result).
 *
 *  scan_result ABSENT → status "scan_failed", NOT "scanned". Migration 00193
 *  makes this a written requirement: the poller's external_ref key means
 *  "already INGESTED", not "already SCANNED", so if the document row lands and
 *  the receipt_scan job write (or the job itself) fails, every later poll skips
 *  that message forever. Reporting such a row as "scanned" makes it visually
 *  identical to a real scan where the AI simply found no vendor/amount — the
 *  coach reads two blank fields as "the AI says there's nothing here" and the
 *  receipt is silently lost. It is the only signal that a retry is needed. */
export function rowFromEmailDocument(
  doc: BookkeepingDocument,
  accounts: BookkeepingAccount[],
): ReceiptBatchRow {
  const base: ReceiptBatchRow = {
    ...newReceiptRow(
      doc.id,
      doc.original_filename ?? "Email receipt",
      null,
      doc.mime_type === "application/pdf",
    ),
    documentId: doc.id,
    status: "scanned",
    included: true,
  }
  if (!doc.scan_result) {
    return { ...base, status: "scan_failed", included: false, error: SCAN_INCOMPLETE_MESSAGE }
  }
  return { ...applyScanResult(base, doc.scan_result, accounts), included: true }
}
