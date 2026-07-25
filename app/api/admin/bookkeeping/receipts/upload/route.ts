import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { findDocumentBySha256, getBook, listAccounts } from "@/lib/db/bookkeeping"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"
import { recordAudit } from "@/lib/audit/record"

/**
 * AI Bookkeeper Phase 3, Task 11 — receipt image upload route.
 *
 * Clones statement-import/route.ts's money-path entry point (sha256 dedupe
 * hint, self-gated admin check, fire-and-forget audit) but accepts a single
 * photographed receipt image instead of a bank statement: image
 * mime/extension gate (jpeg/png/webp) then delegation to
 * lib/bookkeeping/receipt-ingest.ts, which owns the shared recipe
 * (private-bucket storage → kind:"receipt" document → generation log →
 * Firestore receipt_scan job → RTDB seed). Track C extracted that recipe so
 * the Gmail receipt poller runs the exact same path.
 */

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

function resolveImageMime(file: File): string {
  if (ALLOWED_TYPES.includes(file.type)) return file.type
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
    const isImage = ALLOWED_TYPES.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(nameLower)
    if (!isImage) {
      return NextResponse.json(
        { error: "Invalid file type. Upload a JPG, PNG, or WEBP receipt photo." },
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
    const sha256 = createHash("sha256").update(buffer).digest("hex")
    const dup = await findDocumentBySha256(bookId, sha256)

    const [accountRows, book] = await Promise.all([listAccounts(bookId), getBook(bookId)])
    if (!book) {
      return NextResponse.json({ error: "book not found" }, { status: 404 })
    }
    const accounts = accountRows.map((a) => ({ name: a.name, account_type: a.account_type }))

    const mimeType = resolveImageMime(file)
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
