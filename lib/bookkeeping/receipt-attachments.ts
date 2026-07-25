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

export function isReceiptMime(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf"
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
