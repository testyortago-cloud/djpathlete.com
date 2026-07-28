import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { findDocumentBySha256, getBook, listAccounts } from "@/lib/db/bookkeeping"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"
import { isPdfMime, isPdfUpload, pdfRejectionReasonForBuffer } from "@/lib/bookkeeping/receipt-pdf"
import { recordAudit } from "@/lib/audit/record"

/**
 * AI Bookkeeper Phase 3, Task 11 — receipt upload route.
 *
 * Clones statement-import/route.ts's money-path entry point (sha256 dedupe
 * hint, self-gated admin check, fire-and-forget audit) but accepts a single
 * receipt instead of a bank statement: a mime/extension gate
 * (jpeg/png/webp/pdf, with PDFs additionally page-capped by
 * lib/bookkeeping/receipt-pdf.ts) then delegation to
 * lib/bookkeeping/receipt-ingest.ts, which owns the shared recipe
 * (private-bucket storage → kind:"receipt" document → generation log →
 * Firestore receipt_scan job → RTDB seed). Track C extracted that recipe so
 * the Gmail receipt poller runs the exact same path.
 */

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"]

/**
 * Resolve the mime we STORE and hand to the scan job.
 *
 * The image-only predecessor defaulted every unrecognized file to
 * "image/jpeg". A PDF stored under that mime breaks twice, far from the
 * cause: sharp cannot decode it in the vision job, and GCS then serves an
 * image content type to the review iframe, which renders nothing. PDF is
 * therefore resolved FIRST and explicitly.
 */
function resolveReceiptMime(file: File): string {
  if (isPdfUpload(file.type, file.name)) return "application/pdf"
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return file.type
  const n = file.name.toLowerCase()
  if (n.endsWith(".png")) return "image/png"
  if (n.endsWith(".webp")) return "image/webp"
  return "image/jpeg"
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    if (!process.env.FIREBASE_PRIVATE_BUCKET) {
      console.error("[receipts/upload] FIREBASE_PRIVATE_BUCKET not set")
      return NextResponse.json({ error: "receipt storage not configured" }, { status: 500 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const bookId = formData.get("book_id") as string | null

    if (!bookId) {
      return NextResponse.json({ error: "book_id is required" }, { status: 400 })
    }
    if (!z.string().uuid().safeParse(bookId).success) {
      return NextResponse.json({ error: "invalid book_id" }, { status: 400 })
    }
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 })
    }

    const nameLower = file.name.toLowerCase()
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(nameLower)
    const isPdf = isPdfUpload(file.type, file.name)
    if (!isImage && !isPdf) {
      return NextResponse.json(
        { error: "Invalid file type. Upload a JPG, PNG, WEBP, or PDF receipt." },
        { status: 400 },
      )
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum 10 MB" }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const mimeType = resolveReceiptMime(file)

    // Page-cap PDFs before ANY write. storeStatementFile puts bytes in the
    // bucket before the bookkeeping_documents row that references them, so a
    // later rejection would leave an orphan object the retention cron can
    // never find — billed forever, and for a receipt, undeleted PII.
    if (isPdfMime(mimeType)) {
      const reason = await pdfRejectionReasonForBuffer(buffer)
      if (reason) return NextResponse.json({ error: reason }, { status: 400 })
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex")
    const dup = await findDocumentBySha256(bookId, sha256)

    const [accountRows, book] = await Promise.all([listAccounts(bookId), getBook(bookId)])
    if (!book) {
      return NextResponse.json({ error: "book not found" }, { status: 404 })
    }
    const accounts = accountRows.map((a) => ({ name: a.name, account_type: a.account_type }))

    const { documentId, jobId, logId } = await ingestReceiptDocument({
      bookId,
      buffer,
      mimeType,
      originalFilename: file.name,
      uploadedBy: session.user.id,
      accounts,
      bookName: book.name,
      bookKind: book.book_kind,
    })

    void recordAudit({
      action: "bookkeeping.receipt_uploaded",
      category: "commerce",
      outcome: "success",
      target: { type: "bookkeeping_document", id: documentId },
      metadata: { book_id: bookId, kind: "receipt" },
      request,
    })

    return NextResponse.json(
      {
        jobId,
        documentId,
        log_id: logId,
        duplicateUploadHint: dup ? dup.created_at : null,
      },
      { status: 202 },
    )
  } catch (error) {
    console.error("[receipts/upload] Failed to start receipt scan:", error)
    return NextResponse.json({ error: "Failed to upload receipt" }, { status: 500 })
  }
}
