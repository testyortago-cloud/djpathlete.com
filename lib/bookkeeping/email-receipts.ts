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

/** Addresses whose mail (from: OR to:) the poller ingests without the label
 *  (00196; Decision B-2). Admin-editable jsonb string array. */
export const GMAIL_RECEIPT_FORWARDERS_KEY = "bookkeeping_gmail_receipt_forwarders"

/** Gmail search query for the forwarder watch, or null when no valid address.
 *  from: catches manual forwards (sender = forwarder account); to: catches
 *  Gmail auto-forwards (original sender preserved, To: = forwarder account);
 *  -in:sent excludes the coach's own outgoing mail to those addresses.
 *  Takes the RAW settings value: non-arrays, non-strings and anything not
 *  email-shaped are dropped so a malformed row can never inject query syntax. */
export function buildForwarderQuery(stored: unknown): string | null {
  if (!Array.isArray(stored)) return null
  const addresses = stored
    .filter((v): v is string => typeof v === "string")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))
  if (addresses.length === 0) return null
  const clauses = addresses.flatMap((a) => [`from:${a}`, `to:${a}`])
  return `(${clauses.join(" OR ")}) -in:sent`
}

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
    isBody: doc.mime_type === "text/html" || doc.mime_type === "text/plain",
  }
  if (!doc.scan_result) {
    return { ...base, status: "scan_failed", included: false, error: SCAN_INCOMPLETE_MESSAGE }
  }
  return { ...applyScanResult(base, doc.scan_result, accounts), included: true }
}
