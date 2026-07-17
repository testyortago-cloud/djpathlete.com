import { NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { auth } from "@/lib/auth"
import { createDocument, findDocumentBySha256, getBook, listAccounts } from "@/lib/db/bookkeeping"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import { safeStatementName, storeStatementFile } from "@/lib/bookkeeping/documents"
import {
  parseCsvStatement,
  detectStatementColumns,
  normalizeStatementRows,
  dropNonTransactionRows,
  type NormalizedStatementRow,
} from "@/lib/bookkeeping/statement-parse"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { recordAudit } from "@/lib/audit/record"

/**
 * AI Bookkeeper Phase 2, Task 10 — statement upload route (money-path entry
 * point). Mirrors the Excel-import 202 triple-write (Supabase generation log +
 * Firestore ai_jobs doc + RTDB seed), but self-gates with the bookkeeping
 * convention (no withAudit/requireAdmin) and does its own CSV/PDF parsing so
 * the deterministic parser — not the AI — is authoritative for csv_structured
 * rows (see functions/src/statement-import.ts's joinCategorizedRows).
 */

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ROW_CAP = 500

type StatementKind = "csv_structured" | "csv_raw" | "pdf"

interface RowForJob extends NormalizedStatementRow {
  ref: string
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    if (!process.env.FIREBASE_PRIVATE_BUCKET) {
      console.error("[statement-import] FIREBASE_PRIVATE_BUCKET not set")
      return NextResponse.json({ error: "statement storage not configured" }, { status: 500 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const bookId = formData.get("book_id") as string | null

    if (!bookId) {
      return NextResponse.json({ error: "book_id is required" }, { status: 400 })
    }
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const nameLower = file.name.toLowerCase()
    const isCsv = file.type === "text/csv" || nameLower.endsWith(".csv")
    const isPdf = file.type === "application/pdf"
    if (!isCsv && !isPdf) {
      return NextResponse.json(
        { error: "Invalid file type. Upload a .csv or .pdf bank/Venmo statement." },
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

    let kind: StatementKind
    let rowsForJob: RowForJob[] | undefined
    let rawText: string | undefined
    let rowCount: number | null
    // Parse warnings + hard-truncation notice surfaced at upload time (csv_structured
    // only — the AI job itself derives these independently for pdf/csv_raw).
    let uploadWarnings: string[] = []
    let uploadTruncated = false

    if (isCsv) {
      const text = buffer.toString("utf8")
      const { headers, rows } = parseCsvStatement(text)
      const map = detectStatementColumns(headers, rows)

      if (map) {
        const normResult = normalizeStatementRows(rows, map)
        const cleaned = dropNonTransactionRows(normResult.rows).rows
        uploadWarnings = [...normResult.warnings]
        const fullCount = cleaned.length
        let norm = cleaned
        if (fullCount > ROW_CAP) {
          uploadTruncated = true
          uploadWarnings.push(
            `This statement has ${fullCount} transactions; only the first ${ROW_CAP} were imported. Split the file and re-upload the rest so nothing is missed.`,
          )
          norm = cleaned.slice(0, ROW_CAP)
        }
        kind = "csv_structured"
        rowsForJob = norm.map((row, i) => ({ ...row, ref: String(i) }))
        // Record the TRUE row count on the document — not the post-cap number —
        // so the document row reflects reality even though only ROW_CAP rows
        // were sent to the AI job.
        rowCount = fullCount
      } else {
        kind = "csv_raw"
        rawText = text.slice(0, 200_000)
        rowCount = null
      }
    } else {
      // Import inner lib to avoid pdf-parse's default test file read.
      const pdfParse = require("pdf-parse/lib/pdf-parse.js")
      const parsed = await pdfParse(buffer)
      kind = "pdf"
      rawText = (parsed.text as string).slice(0, 200_000)
      rowCount = null
    }

    const storagePath = `bookkeeping/statements/${bookId}/${randomUUID()}/${safeStatementName(file.name)}`
    await storeStatementFile(storagePath, buffer, file.type)

    const retainUntil = `${new Date().getUTCFullYear() + 7}-12-31`

    const doc = await createDocument({
      book_id: bookId,
      kind: "statement",
      original_filename: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      file_size_bytes: file.size,
      sha256,
      retain_until: retainUntil,
      uploaded_by: session.user.id,
      row_count: rowCount,
    })

    const [accountRows, book] = await Promise.all([listAccounts(bookId), getBook(bookId)])
    const accounts = accountRows.map((a) => ({
      id: a.id,
      name: a.name,
      account_type: a.account_type,
      service_line: a.service_line,
    }))

    const totalSteps = kind === "csv_structured" ? 2 : 3

    const log = await createGenerationLog({
      program_id: null,
      client_id: null,
      requested_by: session.user.id,
      status: "pending",
      input_params: { source: "statement_import", document_id: doc.id, kind },
      output_summary: null,
      error_message: null,
      model_used: "sonnet",
      tokens_used: null,
      cache_creation_tokens: null,
      cache_read_tokens: null,
      duration_ms: null,
      completed_at: null,
      current_step: 0,
      total_steps: totalSteps,
    })

    // Create Firestore job doc — Firebase Function picks it up via onDocumentCreated
    const firestoreDb = getAdminFirestore()
    const jobRef = firestoreDb.collection("ai_jobs").doc()

    await jobRef.set({
      type: "statement_import",
      status: "pending",
      input: {
        kind,
        rows: rowsForJob ?? null,
        rawText: rawText ?? null,
        accounts,
        bookName: book?.name ?? null,
        bookKind: book?.book_kind ?? null,
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
        progress: { status: "queued", current_step: 0, total_steps: totalSteps },
        result: null,
        error: null,
        updatedAt: Date.now(),
      })
    } catch (rtdbErr) {
      console.warn("[statement-import] Failed to seed RTDB node:", rtdbErr)
    }

    void recordAudit({
      action: "bookkeeping.statement_uploaded",
      category: "commerce",
      outcome: "success",
      target: { type: "bookkeeping_document", id: doc.id },
      metadata: { book_id: bookId, kind },
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
    console.error("[statement-import] Failed to start import:", error)
    return NextResponse.json({ error: "Failed to start statement import" }, { status: 500 })
  }
}
