import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { auth } from "@/lib/auth"
import { receiptCommitSchema } from "@/lib/validators/bookkeeping"
import { isValidReceiptCommitRef, businessPurposeMissing, receiptRetainUntil } from "@/lib/bookkeeping/receipts"
import {
  getAccount,
  getDocument,
  insertReceiptEntry,
  updateDocumentRetainUntil,
  linkDocumentBatch,
  rehomeEmailReceiptDocument,
} from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { PERIOD_CLOSED_MESSAGE } from "@/lib/bookkeeping/period-close"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const parsed = receiptCommitSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const d = parsed.data
    if (!isValidReceiptCommitRef(d.source_ref)) {
      return NextResponse.json({ error: "invalid receipt source_ref" }, { status: 400 })
    }

    const doc = await getDocument(d.document_id)
    if (!doc) return NextResponse.json({ error: "document not found" }, { status: 404 })
    if (doc.book_id !== d.book_id) {
      // Email-ingested receipts land in the primary business book only because
      // the poller has to pick one; the reviewer choosing another book is the
      // correction, so the document follows the entry. The DAL guard restricts
      // this to gmail-ref, never-posted documents — photo-flow docs (uploaded
      // inside a book's own UI) and posted docs keep the hard 409.
      const rehomed = (doc.external_ref ?? "").startsWith("gmail:") && doc.posted_count == null
        ? await rehomeEmailReceiptDocument(d.document_id, d.book_id)
        : false
      if (!rehomed) return NextResponse.json({ error: "document not in book" }, { status: 409 })
    }

    if (d.account_id) {
      const account = await getAccount(d.account_id)
      if (!account || account.book_id !== d.book_id) return NextResponse.json({ error: "account not in book" }, { status: 409 })
      if (account.account_type !== "expense") return NextResponse.json({ error: "receipts must use an expense category" }, { status: 409 })
      if (businessPurposeMissing(account, d.business_purpose ?? null)) {
        return NextResponse.json({ error: "business_purpose required for this category" }, { status: 422 })
      }
    }

    const batchId = randomUUID()
    const { inserted } = await insertReceiptEntry({
      book_id: d.book_id,
      account_id: d.account_id ?? null,
      amount_cents: d.amount_cents,
      occurred_on: d.occurred_on,
      counterparty: d.counterparty ?? null,
      business_purpose: d.business_purpose ?? null,
      memo: d.memo ?? null,
      source_ref: d.source_ref,
      document_id: d.document_id,
      import_batch_id: batchId,
    })
    await updateDocumentRetainUntil(d.document_id, receiptRetainUntil(d.occurred_on))
    await linkDocumentBatch(d.document_id, d.book_id, batchId, inserted)

    void recordAudit({
      action: "bookkeeping.receipt_imported",
      category: "commerce",
      outcome: "success",
      target: { type: "bookkeeping_document", id: d.document_id },
      metadata: { book_id: d.book_id, inserted, import_batch_id: batchId },
      request,
    })
    return NextResponse.json({ inserted, batchId })
  } catch (error) {
    if ((error as { code?: string }).code === "PERIOD_CLOSED") {
      return NextResponse.json({ error: PERIOD_CLOSED_MESSAGE }, { status: 409 })
    }
    console.error("receipt commit error:", error)
    return NextResponse.json({ error: "Failed to post receipt" }, { status: 500 })
  }
}
