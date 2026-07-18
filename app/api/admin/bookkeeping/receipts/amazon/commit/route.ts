import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { auth } from "@/lib/auth"
import { amazonCommitSchema } from "@/lib/validators/bookkeeping"
import { AMAZON_SOURCE_REF, businessPurposeMissing } from "@/lib/bookkeeping/receipts"
import { assertAccountsInBook, getAccount, insertAmazonEntries, linkDocumentBatch, type AccountScopeError } from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

/**
 * AI Bookkeeper Phase 3, Task 13 — Amazon batch commit route.
 *
 * Mirrors receipts/commit/route.ts's scope-checked post-and-link shape, but
 * posts a whole reviewed batch of `amazon:<orderId>:<lineIndex>` entries in
 * one call (source="receipt", same as the single-receipt commit route) and
 * optionally links them all to one document via linkDocumentBatch.
 */

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const parsed = amazonCommitSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { book_id, document_id, entries } = parsed.data

    if (entries.some((e) => !AMAZON_SOURCE_REF.test(e.source_ref))) {
      return NextResponse.json({ error: "invalid amazon source_ref" }, { status: 400 })
    }

    await assertAccountsInBook(
      book_id,
      entries.map((e) => ({ accountId: e.account_id ?? null, direction: e.direction })),
    )

    // Business-purpose substantiation gate (mirrors receipts/commit + receipts/cash):
    // any entry aimed at an IRS-sensitive account (Meals/Travel/Vehicle) must carry a
    // non-blank business_purpose before anything posts. Dedupe account_ids first so a
    // large batch doesn't fire one getAccount per row.
    const accountIds = Array.from(new Set(entries.map((e) => e.account_id).filter((id): id is string => !!id)))
    const accounts = await Promise.all(accountIds.map((id) => getAccount(id)))
    const accountById = new Map(accountIds.map((id, i) => [id, accounts[i]] as const))
    for (const e of entries) {
      if (!e.account_id) continue
      const account = accountById.get(e.account_id)
      if (account && businessPurposeMissing(account, e.business_purpose ?? null)) {
        return NextResponse.json(
          { error: "business_purpose required for one or more IRS-sensitive categories" },
          { status: 422 },
        )
      }
    }

    const batchId = randomUUID()
    const { inserted } = await insertAmazonEntries(
      book_id,
      batchId,
      entries.map((e) => ({
        direction: e.direction,
        amount_cents: e.amount_cents,
        occurred_on: e.occurred_on,
        memo: e.memo,
        counterparty: e.counterparty,
        business_purpose: e.business_purpose ?? null,
        source_ref: e.source_ref,
        account_id: e.account_id ?? null,
      })),
    )

    if (document_id) {
      await linkDocumentBatch(document_id, book_id, batchId, inserted)
    }

    void recordAudit({
      action: "bookkeeping.receipt_imported",
      category: "commerce",
      outcome: "success",
      target: { type: "bookkeeping_book", id: book_id },
      metadata: { requested: entries.length, inserted, import_batch_id: batchId, document_id: document_id ?? null, source: "amazon" },
      request,
    })

    return NextResponse.json({ inserted, batchId })
  } catch (error) {
    const code = (error as AccountScopeError)?.code
    if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
    if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: "account scope" }, { status: 409 })
    console.error("[receipts/amazon/commit] Failed to post Amazon entries:", error)
    return NextResponse.json({ error: "Failed to import Amazon entries" }, { status: 500 })
  }
}
