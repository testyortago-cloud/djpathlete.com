// Shared PDF gate for the two Next.js-side receipt ingest paths (the upload
// button and the Gmail poller). Both import from here so the page cap can
// never drift between them. functions/ never counts pages — it receives an
// already-vetted buffer and hands it to Claude as a document block.
//
// pdf-parse is imported as its inner lib to avoid the package's default
// test-file read at require time (same as statement-import/route.ts:124).
//
// SERVER ONLY. Never import this from a client component — `pdf-parse` would
// be pulled into the browser bundle. Client-side file checks live in
// lib/bookkeeping/receipt-batch.ts (isPdfFile / isAcceptedReceiptFile).

/** Claude reads PDFs natively, but a receipt is one transaction. Ten pages is
 *  generous for an invoice and doubles as the cost ceiling (a PDF bills as
 *  text + one page image per page) and the "this is a statement" guard. */
export const MAX_RECEIPT_PDF_PAGES = 10

const UNREADABLE_MESSAGE =
  "Couldn't read that PDF. Try re-exporting it, or upload a photo of the receipt."

export function isPdfMime(mime: string): boolean {
  return mime.trim().toLowerCase() === "application/pdf"
}

/** Browsers send a blank or generic mime for PDFs often enough that the
 *  extension has to count too — same mime-or-extension shape the image gate
 *  in the upload route already uses. */
export function isPdfUpload(mime: string, filename: string): boolean {
  return isPdfMime(mime) || /\.pdf$/i.test(filename.trim())
}

export async function countPdfPages(buffer: Buffer): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse/lib/pdf-parse.js")
  const parsed = await pdfParse(buffer)
  return parsed.numpages
}

/** null = accept. Any string is a user-facing 400 message. */
export function pdfRejectionReason(pages: number): string | null {
  if (!Number.isFinite(pages) || pages < 1) return UNREADABLE_MESSAGE
  if (pages > MAX_RECEIPT_PDF_PAGES) {
    return `This PDF has ${pages} pages — that looks like a statement, not a receipt. Use Import statement instead.`
  }
  return null
}

/** The form both ingest paths actually call: never throws, so a malformed PDF
 *  becomes a reportable reason rather than a 500 that strands sibling work. */
export async function pdfRejectionReasonForBuffer(buffer: Buffer): Promise<string | null> {
  let pages: number
  try {
    pages = await countPdfPages(buffer)
  } catch {
    return UNREADABLE_MESSAGE
  }
  return pdfRejectionReason(pages)
}
