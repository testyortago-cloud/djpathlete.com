import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { insertImportedEntries, linkDocumentBatch } from "@/lib/db/bookkeeping"
import { statementCommitSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

const STATEMENT_SOURCE_REF = /^statement:[0-9a-f]{40}$/

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const body = await request.json().catch(() => null)
    const parsed = statementCommitSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { book_id, entries, document_id } = parsed.data
    const hasMangledStatementRef = entries.some(
      (entry) => entry.source === "statement_import" && !STATEMENT_SOURCE_REF.test(entry.source_ref),
    )
    if (hasMangledStatementRef) return NextResponse.json({ error: "invalid statement source_ref" }, { status: 400 })
    const batchId = crypto.randomUUID()
    const { inserted } = await insertImportedEntries(book_id, batchId, entries)
    if (document_id) await linkDocumentBatch(document_id, book_id, batchId, inserted)
    void recordAudit({ action: "bookkeeping.statement_imported", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_book", id: book_id },
      metadata: { requested: entries.length, inserted, import_batch_id: batchId, document_id }, request })
    return NextResponse.json({ inserted, batchId })
  } catch (error) {
    console.error("Commit statement import error:", error)
    return NextResponse.json({ error: "Failed to import entries" }, { status: 500 })
  }
}
