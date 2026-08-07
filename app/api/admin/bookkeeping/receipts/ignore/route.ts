import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getDocument, ignoreEmailReceiptDocument } from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

// Dismiss an email-ingested receipt from the review queue without posting.
// posted_count 0 = "reviewed, posted nothing" (the pending filter is
// posted_count IS NULL) — the document and its stored email/PDF stay put for
// retention; only the queue forgets it. Gmail-ref, never-posted docs only.
const ignoreSchema = z.object({ document_id: z.string().uuid() })

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const parsed = ignoreSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }

    const doc = await getDocument(parsed.data.document_id)
    if (!doc) return NextResponse.json({ error: "document not found" }, { status: 404 })

    const ignored = await ignoreEmailReceiptDocument(parsed.data.document_id)
    if (!ignored) {
      // Not an email receipt, or already posted/ignored — nothing to dismiss.
      return NextResponse.json({ error: "document is not an open email receipt" }, { status: 409 })
    }

    void recordAudit({
      action: "bookkeeping.receipt_ignored",
      category: "commerce",
      outcome: "success",
      target: { type: "bookkeeping_document", id: doc.id },
      metadata: { book_id: doc.book_id, external_ref: doc.external_ref },
      request,
    })
    return NextResponse.json({ ignored: true })
  } catch (error) {
    console.error("receipt ignore error:", error)
    return NextResponse.json({ error: "Failed to ignore receipt" }, { status: 500 })
  }
}
