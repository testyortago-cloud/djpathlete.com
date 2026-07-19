import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { insertImportedEntries } from "@/lib/db/bookkeeping"
import { importCommitSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const body = await request.json().catch(() => null)
    const parsed = importCommitSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const batchId = crypto.randomUUID()
    const { inserted, rejected_closed, rejected_closed_rows, skipped_alt_ref } = await insertImportedEntries(parsed.data.book_id, batchId, parsed.data.entries)
    void recordAudit({ action: "bookkeeping.platform_income_imported", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_book", id: parsed.data.book_id },
      metadata: { requested: parsed.data.entries.length, inserted, rejected_closed: rejected_closed ?? 0, skipped_alt_ref: skipped_alt_ref ?? 0, import_batch_id: batchId }, request })
    return NextResponse.json({
      inserted, batchId, rejected_closed: rejected_closed ?? 0, rejected_closed_rows: rejected_closed_rows ?? [],
      skipped_alt_ref: skipped_alt_ref ?? 0,
    })
  } catch (error) {
    console.error("Commit platform income import error:", error)
    return NextResponse.json({ error: "Failed to import entries" }, { status: 500 })
  }
}
