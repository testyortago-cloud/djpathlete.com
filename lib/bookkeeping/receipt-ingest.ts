// lib/bookkeeping/receipt-ingest.ts
// The receipt-ingest recipe (private-bucket store → bookkeeping_documents row
// → ai_generation_log → Firestore receipt_scan job → best-effort RTDB seed),
// extracted verbatim from app/api/admin/bookkeeping/receipts/upload/route.ts
// so the Gmail poller (Track C) and the photo upload route share ONE
// implementation. externalRef ('gmail:<messageId>:<attachmentIndex>') is the
// poller's idempotency key — check-then-insert only, never an onConflict
// target (migration 00193 comment).
import { createHash, randomUUID } from "node:crypto"
import { createDocument } from "@/lib/db/bookkeeping"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import { safeStatementName, storeStatementFile } from "@/lib/bookkeeping/documents"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

const TOTAL_STEPS = 2

// Next.js-side half of the job-input twin. functions/src/receipt-scan.ts
// re-declares this shape field-for-field (functions/ cannot import lib/).
export interface ReceiptScanJobInput {
  storagePath: string
  mimeType: string
  accounts: { name: string; account_type: "income" | "expense" }[]
  bookName: string
  bookKind: "business" | "household"
  documentId: string
  logId?: string
  requestedBy: string
}

export interface IngestReceiptArgs {
  bookId: string
  buffer: Buffer
  mimeType: string
  originalFilename: string
  /** null for cron ingestion — uploaded_by / requested_by stay NULL in the DB. */
  uploadedBy: string | null
  externalRef?: string | null
  accounts: { name: string; account_type: "income" | "expense" }[]
  bookName: string
  bookKind: "business" | "household"
}

export interface IngestReceiptResult {
  documentId: string
  jobId: string
  logId: string
  sha256: string
}

/** Job userId / ReceiptScanJobInput.requestedBy used when there is no admin
 *  actor (cron ingestion). Matches the Track C cron name. */
const SYSTEM_ACTOR = "bookkeepingGmailReceiptsCron"

export async function ingestReceiptDocument(args: IngestReceiptArgs): Promise<IngestReceiptResult> {
  const sha256 = createHash("sha256").update(args.buffer).digest("hex")
  const storageId = randomUUID()
  const storagePath = `bookkeeping/receipts/${args.bookId}/${storageId}/${safeStatementName(args.originalFilename)}`
  await storeStatementFile(storagePath, args.buffer, args.mimeType)

  const retainUntil = `${new Date().getUTCFullYear() + 7}-12-31`

  const doc = await createDocument({
    book_id: args.bookId,
    kind: "receipt",
    original_filename: args.originalFilename,
    storage_path: storagePath,
    mime_type: args.mimeType,
    file_size_bytes: args.buffer.length,
    sha256,
    retain_until: retainUntil,
    uploaded_by: args.uploadedBy,
    row_count: 1,
    external_ref: args.externalRef ?? null,
  })

  // ai_generation_log.requested_by is a NULLABLE uuid in Postgres (00037 dropped
  // the NOT NULL) but AiGenerationLog types it as required — for cron ingestion
  // we omit the key entirely and cast at this one seam rather than widening the
  // shared type.
  const log = await createGenerationLog({
    program_id: null,
    client_id: null,
    ...(args.uploadedBy ? { requested_by: args.uploadedBy } : {}),
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
  } as Parameters<typeof createGenerationLog>[0])

  // Create Firestore job doc — Firebase Function picks it up via onDocumentCreated
  const firestoreDb = getAdminFirestore()
  const jobRef = firestoreDb.collection("ai_jobs").doc()

  const jobInput: ReceiptScanJobInput = {
    storagePath,
    mimeType: args.mimeType,
    accounts: args.accounts,
    bookName: args.bookName,
    bookKind: args.bookKind,
    documentId: doc.id,
    logId: log.id,
    requestedBy: args.uploadedBy ?? SYSTEM_ACTOR,
  }

  await jobRef.set({
    type: "receipt_scan",
    status: "pending",
    input: jobInput,
    result: null,
    error: null,
    userId: args.uploadedBy ?? SYSTEM_ACTOR,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  // Seed RTDB node so the client listener gets immediate data (best-effort)
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
    console.warn("[receipt-ingest] Failed to seed RTDB node:", rtdbErr)
  }

  return { documentId: doc.id, jobId: jobRef.id, logId: log.id, sha256 }
}
