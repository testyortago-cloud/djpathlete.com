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
  /** Stable per-message key used as the `<attachmentIndex>` half of
   *  external_ref ('gmail:<messageId>:<refKey>'). Gmail's own `partId` when it
   *  is present and safe to embed, else the part's position in the FULL payload
   *  walk ('p<n>').
   *
   *  WHY NOT the index in the returned array: that index moves whenever the
   *  mime filter moves. Widening SCANNABLE_MIMES to application/pdf would slide
   *  every jpeg in a mixed-attachment mail down a slot, so already-ingested
   *  receipts would no longer match their stored external_ref and would be
   *  re-ingested — a duplicate document AND a second vision spend per receipt.
   *  Both key sources here are computed from the payload tree alone and are
   *  therefore filter-independent. */
  refKey: string
}

/** Mimes the receipt vision path can actually decode.
 *
 *  Two decode paths sit behind this list. Images are resized by `sharp`
 *  (resizeReceiptForVision); PDFs bypass sharp entirely and go to Claude as a
 *  base64 document block (functions/src/receipt-scan.ts:buildReceiptVisionPayload),
 *  which reads both the text layer and the page images.
 *
 *  PDF was excluded here until that branch existed, because the pinned sharp
 *  0.33.5 reports `format.pdf.input = {file:false,buffer:false,stream:false}` —
 *  an ingested PDF would burn its external_ref, queue a receipt_scan job, and
 *  fail with "unsupported image format": a blank review row nobody can explain.
 *
 *  Still excluded: `image/heic` / `image/heif` (sharp's pinned build lists
 *  heif with `fileSuffix ['.avif']` only, and there is no document-block
 *  escape hatch for it). Those are COUNTED into the poller's cron detail
 *  (`unsupported_attachments`) and recorded on the review surface as "needs
 *  manual upload", so "I emailed it and nothing happened" stays observable.
 *
 *  Page-capping is NOT done here — this walk sees only Gmail part metadata,
 *  never bytes. The poller applies pdfRejectionReasonForBuffer after download
 *  (lib/bookkeeping/receipt-pdf.ts), the same gate the upload button uses.
 *
 *  Changing this array changes the poller's mime fingerprint, which re-opens
 *  every message settled only because its attachments were unreadable. That is
 *  intended: adding PDF here is what makes already-labeled PDF receipt mail get
 *  picked up. */
export const SCANNABLE_MIMES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]

export function isReceiptMime(mime: string): boolean {
  return SCANNABLE_MIMES.includes(mime.toLowerCase())
}

export interface UnusableAttachmentCounts {
  /** Receipt-SHAPED (pdf / image/*) parts whose mime the scanner cannot read. */
  unsupportedMime: number
  /** Parts whose mime IS readable but whose bytes exceed MAX_ATTACHMENT_BYTES. */
  oversized: number
}

/** Receipt-shaped attachments this pipeline drops on the floor, split by WHY.
 *
 *  Both arms matter and neither may be silent. The size filter in
 *  collectReceiptAttachments below removes an over-10MB image/jpeg from the
 *  ingest list, and a mime-only "unsupported" count cannot see it — so before
 *  `oversized` existed, a coach who emailed one high-res phone photo got a run
 *  that reported `attachmentless` and permanently settled the message. Nothing
 *  anywhere said a receipt had been dropped.
 *
 *  Calendar invites and other non-receipt parts are deliberately not counted —
 *  they are noise, not a missed receipt. */
export function countUnusableReceiptAttachments(
  payload: GmailMessagePart | undefined,
): UnusableAttachmentCounts {
  let unsupportedMime = 0
  let oversized = 0
  const walk = (part: GmailMessagePart | undefined) => {
    if (!part) return
    const mime = (part.mimeType ?? "").toLowerCase()
    const receiptish = mime === "application/pdf" || mime.startsWith("image/")
    if (part.body?.attachmentId && receiptish) {
      if (!isReceiptMime(mime)) unsupportedMime++
      else if ((part.body?.size ?? 0) > MAX_ATTACHMENT_BYTES) oversized++
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(payload)
  return { unsupportedMime, oversized }
}

/** Gmail partIds look like "1" or "0.1.2". Anything else (absent, or exotic)
 *  falls back to the walk position, which is equally filter-independent. */
function safeRefKey(partId: string | undefined, walkIndex: number): string {
  return partId && /^[A-Za-z0-9.-]+$/.test(partId) ? partId : `p${walkIndex}`
}

/** Depth-first walk of a format=full payload tree. Keeps parts that have a
 *  real attachmentId (inline text/html bodies have data, not attachmentId),
 *  a receipt mime, and 0 < size <= 10MB. Each kept ref carries its own
 *  filter-independent `refKey` — see ReceiptAttachmentRef above. */
export function collectReceiptAttachments(
  payload: GmailMessagePart | undefined,
): ReceiptAttachmentRef[] {
  const out: ReceiptAttachmentRef[] = []
  let walkIndex = 0
  const walk = (part: GmailMessagePart | undefined) => {
    if (!part) return
    // Counted for EVERY visited part, kept or not, so the fallback key does not
    // move when the mime allow-list does.
    const myIndex = walkIndex++
    const attachmentId = part.body?.attachmentId
    const size = part.body?.size ?? 0
    const mime = part.mimeType ?? ""
    if (attachmentId && isReceiptMime(mime) && size > 0 && size <= MAX_ATTACHMENT_BYTES) {
      out.push({
        filename: part.filename || "receipt",
        mimeType: mime,
        attachmentId,
        size,
        refKey: safeRefKey(part.partId, myIndex),
      })
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(payload)
  return out
}
