// Pure Gmail-payload → receipt-attachment selection (Track C). Zero IO —
// separate from lib/gmail/client.ts so poller route tests keep this REAL
// while mocking the Gmail client seam.
import type { GmailMessagePart } from "@/lib/gmail/client"

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // matches the photo upload cap

export interface ReceiptAttachmentRef {
  filename: string
  mimeType: string
  attachmentId: string
  size: number
}

/** Mimes the receipt vision path can actually decode.
 *
 *  functions/src/receipt-scan.ts pipes EVERY ingested buffer through
 *  `sharp(buffer)` (resizeReceiptForVision). The pinned sharp 0.33.5 reports
 *  `format.pdf.input = {file:false,buffer:false,stream:false}` and `format.heif`
 *  with `fileSuffix ['.avif']` only — so an `application/pdf` or `image/heic`
 *  attachment would ingest, burn its external_ref, queue a receipt_scan job,
 *  and fail with "unsupported image format": a blank review row nobody can
 *  explain. This is exactly the allow-list the shipped photo-upload route
 *  already enforces (app/api/admin/bookkeeping/receipts/upload/route.ts:23), so
 *  both ingest paths now promise only what the scanner can keep.
 *
 *  DEVIATION from design §3.3 ("mime `image/*` or `application/pdf`") —
 *  recorded loudly rather than silently: unscannable receipt-shaped
 *  attachments are COUNTED into the poller's cron detail
 *  (`unsupported_attachments`) instead of ingested, so "I emailed a PDF and
 *  nothing happened" is observable. Widening this back to PDF requires a PDF
 *  branch in the vision path first (Anthropic document block, or rasterize
 *  page 1 before sharp) AND clearing the poller's settled-message list so
 *  already-seen PDF mails get reconsidered. */
export const SCANNABLE_MIMES: readonly string[] = ["image/jpeg", "image/png", "image/webp"]

export function isReceiptMime(mime: string): boolean {
  return SCANNABLE_MIMES.includes(mime.toLowerCase())
}

/** Receipt-SHAPED (pdf / image/*) attachments the scanner cannot read. Drives
 *  `unsupported_attachments` in the cron detail. Calendar invites and other
 *  non-receipt parts are deliberately not counted — they are noise, not a
 *  missed receipt. */
export function countUnsupportedReceiptAttachments(payload: GmailMessagePart | undefined): number {
  let count = 0
  const walk = (part: GmailMessagePart | undefined) => {
    if (!part) return
    const mime = (part.mimeType ?? "").toLowerCase()
    const receiptish = mime === "application/pdf" || mime.startsWith("image/")
    if (part.body?.attachmentId && receiptish && !isReceiptMime(mime)) count++
    for (const child of part.parts ?? []) walk(child)
  }
  walk(payload)
  return count
}

/** Depth-first walk of a format=full payload tree. Keeps parts that have a
 *  real attachmentId (inline text/html bodies have data, not attachmentId),
 *  a receipt mime, and 0 < size <= 10MB. Attachment index in the RETURNED
 *  array is the <attachmentIndex> used in external_ref. */
export function collectReceiptAttachments(
  payload: GmailMessagePart | undefined,
): ReceiptAttachmentRef[] {
  const out: ReceiptAttachmentRef[] = []
  const walk = (part: GmailMessagePart | undefined) => {
    if (!part) return
    const attachmentId = part.body?.attachmentId
    const size = part.body?.size ?? 0
    const mime = part.mimeType ?? ""
    if (attachmentId && isReceiptMime(mime) && size > 0 && size <= MAX_ATTACHMENT_BYTES) {
      out.push({ filename: part.filename || "receipt", mimeType: mime, attachmentId, size })
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(payload)
  return out
}
