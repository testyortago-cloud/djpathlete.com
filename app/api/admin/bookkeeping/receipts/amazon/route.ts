import { NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { createDocument, findDocumentBySha256, getBook, listAccounts } from "@/lib/db/bookkeeping"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import { safeStatementName, storeStatementFile } from "@/lib/bookkeeping/documents"
import { parseAmazonCsv } from "@/lib/bookkeeping/amazon-parse"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { recordAudit } from "@/lib/audit/record"

/**
 * AI Bookkeeper Phase 3, Task 13 — Amazon order-history CSV import route.
 *
 * Reuses the SHIPPED statement_import job (Task 9/10's csv_structured path —
 * see functions/src/statement-import.ts) for AI categorization instead of a
 * new job type: parseAmazonCsv (deterministic, money-safe — shares
 * statement-parse.ts's cents/date primitives) produces authoritative rows,
 * each tagged with an `amazon:<orderId>:<lineIndex>` source_ref instead of
 * the statement route's positional `String(i)` ref. Mirrors Task 11's
 * (receipts/upload) triple-write (Supabase generation log + Firestore
 * ai_jobs doc + RTDB seed) and Task 10's (statement-import) account/job
 * input shape, but stores the upload as kind:"receipt" (not "statement")
 * and always emits `refs` in input order so the review dialog can zip the
 * AI job's result rows back to source_refs by index.
 */

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ROW_CAP = 500
const TOTAL_STEPS = 2

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    if (!process.env.FIREBASE_PRIVATE_BUCKET) {
      console.error("[receipts/amazon] FIREBASE_PRIVATE_BUCKET not set")
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
    const isCsv = file.type === "text/csv" || nameLower.endsWith(".csv")
    if (!isCsv) {
      return NextResponse.json({ error: "Amazon export must be a .csv file" }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum 10 MB" }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const text = buffer.toString("utf8")
    const { rows: allRows, warnings } = parseAmazonCsv(text)
    if (allRows.length === 0) {
      return NextResponse.json({ error: warnings[0] ?? "No Amazon orders detected in the CSV." }, { status: 400 })
    }

    let rows = allRows
    let uploadTruncated = false
    const uploadWarnings = [...warnings]
    if (allRows.length > ROW_CAP) {
      uploadTruncated = true
      rows = allRows.slice(0, ROW_CAP)
      uploadWarnings.push(`Only the first ${ROW_CAP} of ${allRows.length} order lines were imported.`)
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex")
    const dup = await findDocumentBySha256(bookId, sha256)

    const [accountRows, book] = await Promise.all([listAccounts(bookId), getBook(bookId)])
    if (!book) {
      return NextResponse.json({ error: "book not found" }, { status: 404 })
    }
    const accounts = accountRows.map((a) => ({
      id: a.id,
      name: a.name,
      account_type: a.account_type,
      service_line: a.service_line,
    }))

    const documentId = randomUUID()
    const storagePath = `bookkeeping/receipts/${bookId}/${documentId}/${safeStatementName(file.name)}`
    await storeStatementFile(storagePath, buffer, "text/csv")

    const retainUntil = `${new Date().getUTCFullYear() + 7}-12-31`

    const doc = await createDocument({
      book_id: bookId,
      kind: "receipt",
      original_filename: file.name,
      storage_path: storagePath,
      mime_type: "text/csv",
      file_size_bytes: file.size,
      sha256,
      retain_until: retainUntil,
      uploaded_by: session.user.id,
      row_count: rows.length,
    })

    const log = await createGenerationLog({
      program_id: null,
      client_id: null,
      requested_by: session.user.id,
      status: "pending",
      input_params: { source: "amazon_import", document_id: doc.id, kind: "csv_structured" },
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

    // Create Firestore job doc — Firebase Function picks it up via onDocumentCreated.
    // type/kind match the shipped statement_import handler exactly; only the
    // rows (amazon: source_refs) and the document's kind differ from a bank
    // statement import.
    const firestoreDb = getAdminFirestore()
    const jobRef = firestoreDb.collection("ai_jobs").doc()

    await jobRef.set({
      type: "statement_import",
      status: "pending",
      input: {
        kind: "csv_structured",
        rows: rows.map((r) => ({
          ref: r.source_ref,
          occurred_on: r.occurred_on,
          description: r.description,
          amount_cents: r.amount_cents,
          direction: r.direction,
        })),
        rawText: null,
        accounts,
        bookName: book.name,
        bookKind: book.book_kind,
        documentId: doc.id,
        logId: log.id,
        requestedBy: session.user.id,
        uploadWarnings,
        uploadTruncated,
      },
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
      console.warn("[receipts/amazon] Failed to seed RTDB node:", rtdbErr)
    }

    void recordAudit({
      action: "bookkeeping.receipt_uploaded",
      category: "commerce",
      outcome: "success",
      target: { type: "bookkeeping_document", id: doc.id },
      metadata: { book_id: bookId, kind: "amazon" },
      request,
    })

    return NextResponse.json(
      {
        jobId: jobRef.id,
        documentId: doc.id,
        log_id: log.id,
        refs: rows.map((r) => r.source_ref),
        duplicateUploadHint: dup ? dup.created_at : null,
      },
      { status: 202 },
    )
  } catch (error) {
    console.error("[receipts/amazon] Failed to start Amazon import:", error)
    return NextResponse.json({ error: "Failed to import Amazon CSV" }, { status: 500 })
  }
}
