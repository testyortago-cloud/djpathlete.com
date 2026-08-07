// Attach a receipt to an entry that ALREADY EXISTS.
//
// Every other receipt path creates a new ledger entry from a scanned document
// (receipts/upload → AI extraction → receipts/commit). That left the watchdog's
// "no receipt" findings unfixable: the offending entries are usually Amazon /
// platform imports that arrived without a document, and nothing in the app
// could set document_id on a row that was already posted (owner report,
// 2026-08-04). This route closes that loop.
//
// Deliberately NO AI leg: the entry already carries its amount, date, category
// and counterparty. The file is substantiation, not a source of new facts — so
// there is no scan job, no generation log, and no review row to clear.
import { NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { createDocument, deleteDocument, getEntry, updateEntry } from "@/lib/db/bookkeeping"
import { deleteStatementFile, safeStatementName, storeStatementFile } from "@/lib/bookkeeping/documents"
import { receiptRetainUntil } from "@/lib/bookkeeping/receipts"
import { isPdfUpload, pdfRejectionReasonForBuffer } from "@/lib/bookkeeping/receipt-pdf"
import { PERIOD_CLOSED_MESSAGE } from "@/lib/bookkeeping/period-close"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB — same ceiling as receipts/upload
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"]

/**
 * PDF resolved FIRST and explicitly — see receipts/upload for why defaulting
 * an unrecognized file to image/jpeg breaks the viewer far from the cause.
 *
 * Returns null for anything unrecognized, DIVERGING from receipts/upload's
 * lenient image/jpeg fallback: that route feeds an AI extractor that simply
 * fails on junk, whereas this one marks an entry as substantiated. A .txt
 * stored as image/jpeg would clear the watchdog finding while rendering as
 * nothing — a silent hole in the audit trail is worse than a refused upload.
 */
function resolveReceiptMime(file: File): string | null {
  if (isPdfUpload(file.type, file.name)) return "application/pdf"
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return file.type
  const n = file.name.toLowerCase()
  if (n.endsWith(".png")) return "image/png"
  if (n.endsWith(".webp")) return "image/webp"
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg"
  return null
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    if (!process.env.FIREBASE_PRIVATE_BUCKET) {
      console.error("[entries/receipt] FIREBASE_PRIVATE_BUCKET not set")
      return NextResponse.json({ error: "receipt storage not configured" }, { status: 500 })
    }

    const { id } = await ctx.params
    const entry = await getEntry(id)
    if (!entry) return NextResponse.json({ error: "entry not found" }, { status: 404 })

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file || file.size === 0) return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "File is larger than 10 MB" }, { status: 400 })

    const mimeType = resolveReceiptMime(file)
    if (!mimeType) {
      return NextResponse.json({ error: "Upload a JPEG, PNG, WEBP or PDF receipt" }, { status: 400 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    if (mimeType === "application/pdf") {
      const reason = await pdfRejectionReasonForBuffer(buffer)
      if (reason) return NextResponse.json({ error: reason }, { status: 400 })
    }

    // Retention is stamped from the ENTRY's date, not today's — the IRS clock
    // runs from when the money moved. Same rule as receipts/commit.
    const storagePath = `bookkeeping/receipts/${entry.book_id}/${randomUUID()}/${safeStatementName(file.name)}`
    await storeStatementFile(storagePath, buffer, mimeType)

    let documentId: string | null = null
    try {
      const doc = await createDocument({
        book_id: entry.book_id,
        kind: "receipt",
        original_filename: file.name,
        storage_path: storagePath,
        mime_type: mimeType,
        file_size_bytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        retain_until: receiptRetainUntil(entry.occurred_on),
        uploaded_by: session.user.id,
        row_count: 1,
        external_ref: null,
      })
      documentId = doc.id
      // Goes through the DAL's closed-period guard: attaching to a frozen month
      // throws PERIOD_CLOSED and is caught below, same as any other entry edit.
      const updated = await updateEntry(id, { document_id: doc.id })

      void recordAudit({
        action: "bookkeeping.receipt_uploaded",
        category: "commerce",
        outcome: "success",
        target: { type: "bookkeeping_entry", id, label: file.name },
        metadata: { book_id: entry.book_id, document_id: doc.id, attached_to_existing_entry: true },
        request,
      })
      return NextResponse.json({ entry: updated, document_id: doc.id })
    } catch (err) {
      // The bytes were written before the rows that reference them; an orphan
      // is billed forever AND is undeleted PII. Compensate best-effort in
      // reverse order, then rethrow the ORIGINAL error.
      if (documentId) {
        await deleteDocument(documentId).catch((e) =>
          console.warn("[entries/receipt] orphan document cleanup failed for", documentId, e),
        )
      }
      await deleteStatementFile(storagePath).catch((e) =>
        console.warn("[entries/receipt] orphan file cleanup failed for", storagePath, e),
      )
      throw err
    }
  } catch (error) {
    if ((error as { code?: string }).code === "PERIOD_CLOSED") {
      return NextResponse.json({ error: PERIOD_CLOSED_MESSAGE }, { status: 409 })
    }
    console.error("Attach receipt to bookkeeping entry error:", error)
    return NextResponse.json({ error: "Failed to attach the receipt" }, { status: 500 })
  }
}
