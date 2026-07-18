import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { receiptCashSchema } from "@/lib/validators/bookkeeping"
import { getAccount, createEntry } from "@/lib/db/bookkeeping"
import { businessPurposeMissing } from "@/lib/bookkeeping/receipts"
import { recordAudit } from "@/lib/audit/record"
import { PERIOD_CLOSED_MESSAGE } from "@/lib/bookkeeping/period-close"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const parsed = receiptCashSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const d = parsed.data

    const account = await getAccount(d.account_id)
    if (!account || account.book_id !== d.book_id) return NextResponse.json({ error: "account not in book" }, { status: 409 })
    if (account.account_type !== "expense") return NextResponse.json({ error: "cash receipts must use an expense category" }, { status: 409 })
    if (businessPurposeMissing(account, d.business_purpose ?? null)) {
      return NextResponse.json({ error: "business_purpose required for this category" }, { status: 422 })
    }

    const entry = await createEntry({
      book_id: d.book_id, account_id: d.account_id, direction: "expense",
      amount_cents: d.amount_cents, currency: "usd", occurred_on: d.occurred_on,
      memo: d.memo ?? null, business_purpose: d.business_purpose ?? null,
      counterparty: d.counterparty ?? null,
      source: "receipt", source_ref: null, import_batch_id: null, document_id: null,
    })
    void recordAudit({
      action: "bookkeeping.receipt_cash_recorded", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_entry", id: entry.id, label: entry.memo ?? "" },
      metadata: { book_id: d.book_id, amount_cents: d.amount_cents }, request,
    })
    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    if ((error as { code?: string }).code === "PERIOD_CLOSED") {
      return NextResponse.json({ error: PERIOD_CLOSED_MESSAGE }, { status: 409 })
    }
    console.error("receipt cash error:", error)
    return NextResponse.json({ error: "Failed to record receipt" }, { status: 500 })
  }
}
