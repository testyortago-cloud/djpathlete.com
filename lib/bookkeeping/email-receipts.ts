// Pure adapter: polled Gmail receipt document → editable ReceiptBatchRow, plus
// the system_settings key names the poller and the review page BOTH read (the
// route is a server module the page must not import, so the shared constants
// live here).
import {
  applyScanResult, detectWithinBatchDuplicates, newReceiptRow, type ReceiptBatchRow,
} from "@/lib/bookkeeping/receipt-batch"
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

/** Forwarder-watch cutoff date (YYYY-MM-DD; 00197). The forwarder query only
 *  sees mail AFTER this date so flipping the poller on cannot walk years of
 *  mailbox history into the review queue. The LABEL source is deliberately
 *  unbounded — labeling old mail "DJP Receipts" stays the explicit opt-in
 *  backfill path (Decision C-8). */
export const GMAIL_RECEIPT_FORWARDERS_SINCE_KEY = "bookkeeping_gmail_receipt_forwarders_since"

/** Gmail search query for the forwarder watch, or null when no valid address.
 *  from: catches manual forwards (sender = forwarder account); to: catches
 *  Gmail auto-forwards (original sender preserved, To: = forwarder account);
 *  -in:sent excludes the coach's own outgoing mail to those addresses.
 *  Takes the RAW settings values: non-arrays, non-strings and anything not
 *  email-shaped are dropped so a malformed row can never inject query syntax;
 *  `since` must be a strict YYYY-MM-DD or it is ignored (unbounded). */
export function buildForwarderQuery(stored: unknown, since?: unknown): string | null {
  if (!Array.isArray(stored)) return null
  const addresses = stored
    .filter((v): v is string => typeof v === "string")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))
  if (addresses.length === 0) return null
  const clauses = addresses.flatMap((a) => [`from:${a}`, `to:${a}`])
  const sinceClause =
    typeof since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(since.trim())
      ? ` after:${since.trim().replace(/-/g, "/")}`
      : ""
  return `(${clauses.join(" OR ")}) -in:sent${sinceClause}`
}

/** Vendor-mail watch (2026-09-01). A third listing source: a Gmail search the
 *  poller runs alongside the label and the forwarder watch.
 *
 *  WHY IT EXISTS: the forwarder watch (B-2) assumed receipts arrive at a
 *  forwarding account and reach the coach's inbox from there, so both its
 *  clauses key on a forwarder ADDRESS. An invoice a vendor sends STRAIGHT to
 *  the coach matches neither, carries no label, and is invisible — which is
 *  exactly what happened: `label_missing` on every run since the poller went
 *  live, so the label source had never supplied a message, and the forwarder
 *  query had matched nothing new for two weeks while invoices kept arriving.
 *  This source needs nothing done to the mailbox, which is the point. */
export const GMAIL_RECEIPT_QUERY_KEY = "bookkeeping_gmail_receipt_query"
/** Rolling window for the vendor watch, in days. A number, not a date: a fixed
 *  `after:` (the forwarder watch's shape) silently widens forever as it ages,
 *  and this source is far broader than a named-address one. */
export const GMAIL_RECEIPT_QUERY_WINDOW_KEY = "bookkeeping_gmail_receipt_query_window_days"

/** Subject-scoped ON PURPOSE. The poller ingests the BODY of any listed message
 *  that has no usable attachment, so a body-wide search would file every email
 *  that merely mentions a receipt as a receipt — real documents, real AI spend
 *  and a review board nobody can triage. A vendor invoice names itself in the
 *  subject line. */
export const DEFAULT_GMAIL_RECEIPT_QUERY =
  'subject:(invoice OR receipt OR "payment received" OR "payment confirmation" OR "your order")'
export const DEFAULT_GMAIL_RECEIPT_QUERY_WINDOW_DAYS = 45
/** Cap on the stored window. Not a style rule — MAX_MESSAGES_PER_RUN is 25/hour,
 *  so a mistyped window is paid for one review-board row at a time for weeks. */
export const MAX_GMAIL_RECEIPT_QUERY_WINDOW_DAYS = 365

/** Gmail search for the vendor watch, or null when the setting is blank (the
 *  off switch). Unlike the forwarder key this one is DELIBERATELY raw Gmail
 *  query syntax — that is the whole feature — so it is not validated for
 *  injection. What is enforced is the part that must never be negotiable:
 *  `-in:sent -in:chats` and a bounded `newer_than:`, appended AFTER whatever is
 *  stored. Gmail ANDs the clauses, so a stored date bound narrows it further
 *  and can never widen it. */
export function buildReceiptQuery(stored: unknown, windowDays?: unknown): string | null {
  if (typeof stored !== "string") return null
  const query = stored.trim()
  if (query === "") return null
  const days =
    typeof windowDays === "number" && Number.isFinite(windowDays) && windowDays >= 1
      ? Math.min(Math.floor(windowDays), MAX_GMAIL_RECEIPT_QUERY_WINDOW_DAYS)
      : DEFAULT_GMAIL_RECEIPT_QUERY_WINDOW_DAYS
  return `${query} -in:sent -in:chats newer_than:${days}d`
}

/** Triage buckets for the email-receipts board. One row lands in exactly one
 *  column; priority attention > duplicates > review, because a failed or
 *  low-confidence read needs the human regardless of whether it also looks
 *  like a twin. */
export interface EmailReceiptBuckets {
  review: ReceiptBatchRow[]
  attention: ReceiptBatchRow[]
  duplicates: ReceiptBatchRow[]
  /** clientId → clientId of the EARLIER row it matches (card hint). */
  duplicateOf: Record<string, string>
}

/** Board triage. "Duplicates" reuses the photo-batch matcher (normalized
 *  vendor + cents + date): a Vercel email carries BOTH an invoice PDF and a
 *  receipt PDF for one payment, and a double-forwarded email lands twice —
 *  the later twin goes to the duplicates column so the reviewer posts one and
 *  ignores the rest instead of double-counting an expense. */
export function bucketEmailReceiptRows(rows: ReceiptBatchRow[]): EmailReceiptBuckets {
  const dupOf = detectWithinBatchDuplicates(rows)
  const out: EmailReceiptBuckets = { review: [], attention: [], duplicates: [], duplicateOf: {} }
  rows.forEach((row, i) => {
    const needsLook =
      row.status === "scan_failed" ||
      row.status === "post_failed" ||
      row.result?.confidence === "low" ||
      (row.result?.warnings.length ?? 0) > 0
    if (needsLook) {
      out.attention.push(row)
      return
    }
    const earlier = dupOf[i]
    if (earlier != null) {
      out.duplicates.push(row)
      out.duplicateOf[row.clientId] = rows[earlier].clientId
      return
    }
    out.review.push(row)
  })
  return out
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
