import { NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { createDocument, findDocumentBySha256, getBook, listAccounts } from "@/lib/db/bookkeeping"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import { safeStatementName, storeStatementFile } from "@/lib/bookkeeping/documents"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { recordAudit } from "@/lib/audit/record"

/**
 * AI Bookkeeper Phase 3, Task 11 — receipt image upload route.
 *
 * Clones statement-import/route.ts's money-path entry point (sha256 dedupe
 * hint, private-bucket storage, Supabase generation-log + Firestore ai_jobs
 * doc + RTDB seed triple-write, self-gated admin check, fire-and-forget
 * audit) but accepts a single photographed receipt image instead of a bank
 * statement: image mime/extension gate (jpeg/png/webp), storage path under
 * bookkeeping/receipts/, kind:"receipt" document, and a receipt_scan job
 * whose input shape matches functions/src/receipt-scan.ts's
 * ReceiptScanJobInput field-for-field. That handler cannot import from lib/
 * or types/ (functions/ has its own rootDir), so ReceiptScanJobInput is
 * intentionally re-declared here rather than imported — this is the
 * Next.js-side half of the twin.
 */

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]
const TOTAL_STEPS = 2

interface ReceiptScanJobInput {
  storagePath: string
  mimeType: string
  accounts: { name: string; account_type: "income" | "expense" }[]
  bookName: string
  bookKind: "business" | "household"
  documentId: string
  logId?: string
  requestedBy: string
}

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
    const documentId = randomUUID()
    const storagePath = `bookkeeping/receipts/${bookId}/${documentId}/${safeStatementName(file.name)}`
    await storeStatementFile(storagePath, buffer, mimeType)

    const retainUntil = `${new Date().getUTCFullYear() + 7}-12-31`

    const doc = await createDocument({
      book_id: bookId,
      kind: "receipt",
      original_filename: file.name,
      storage_path: storagePath,
      mime_type: mimeType,
      file_size_bytes: file.size,
      sha256,
      retain_until: retainUntil,
      uploaded_by: session.user.id,
      row_count: 1,
    })

    const log = await createGenerationLog({
      program_id: null,
      client_id: null,
      requested_by: session.user.id,
      status: "pending",
      input_params: { source: "receipt_scan", document_id: doc.id },
      output_summary: null,
      error_message: null,
      model_used: "sonnet",
      tokens_used: null,
      cache_creation_tokens: null,
      cache_read_tokens: null,
      duration_ms: null,
      completed_at: null,
      current_step: 0,
      total_steps: TOTAL_STEPS,
    })

    // Create Firestore job doc — Firebase Function picks it up via onDocumentCreated
    const firestoreDb = getAdminFirestore()
    const jobRef = firestoreDb.collection("ai_jobs").doc()

    const jobInput: ReceiptScanJobInput = {
      storagePath,
      mimeType,
      accounts,
      bookName: book.name,
      bookKind: book.book_kind,
      documentId: doc.id,
      logId: log.id,
      requestedBy: session.user.id,
    }

    await jobRef.set({
      type: "receipt_scan",
      status: "pending",
      input: jobInput,
      result: null,
      error: null,
      userId: session.user.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Seed RTDB node so client listener gets immediate data
    try {
      const rtdb = getAdminRtdb()
      await rtdb.ref(`ai_jobs/${jobRef.id}`).set({
        status: "pending",
        progress: { status: "queued", current_step: 0, total_steps: TOTAL_STEPS },
        result: null,
        error: null,
        updatedAt: Date.now(),
      })
    } catch (rtdbErr) {
      console.warn("[receipts/upload] Failed to seed RTDB node:", rtdbErr)
    }

    void recordAudit({
      action: "bookkeeping.receipt_uploaded",
      category: "commerce",
      outcome: "success",
      target: { type: "bookkeeping_document", id: doc.id },
      metadata: { book_id: bookId, kind: "receipt" },
      request,
    })

    return NextResponse.json(
      {
        jobId: jobRef.id,
        documentId: doc.id,
        log_id: log.id,
        duplicateUploadHint: dup ? dup.created_at : null,
      },
      { status: 202 },
    )
  } catch (error) {
    console.error("[receipts/upload] Failed to start receipt scan:", error)
    return NextResponse.json({ error: "Failed to upload receipt" }, { status: 500 })
  }
}
