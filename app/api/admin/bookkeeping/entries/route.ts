import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listEntries, entryTotals, createEntry } from "@/lib/db/bookkeeping"
import { createEntrySchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import type { LedgerDirection, LedgerSource } from "@/types/database"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const sp = new URL(request.url).searchParams
    const bookId = sp.get("book_id")
    if (!bookId) return NextResponse.json({ error: "book_id required" }, { status: 400 })
    const pageRaw = Number(sp.get("page") ?? "1")
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1
    const params = {
      bookId,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      direction: (sp.get("direction") as LedgerDirection) ?? undefined,
      accountId: sp.get("account_id") ?? undefined,
      source: (sp.get("source") as LedgerSource) ?? undefined,
      search: sp.get("q") ?? undefined,
      page,
      perPage: 50,
    }
    const [{ rows, total }, totals] = await Promise.all([listEntries(params), entryTotals(params)])
    return NextResponse.json({ rows, total, totals, page: params.page, perPage: params.perPage })
  } catch (error) {
    console.error("List bookkeeping entries error:", error)
    return NextResponse.json({ error: "Failed to load entries" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const body = await request.json().catch(() => null)
    const parsed = createEntrySchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const d = parsed.data
    const entry = await createEntry({
      book_id: d.book_id, account_id: d.account_id ?? null, direction: d.direction,
      amount_cents: d.amount_cents, currency: d.currency ?? "usd", occurred_on: d.occurred_on,
      memo: d.memo ?? null, business_purpose: d.business_purpose ?? null, counterparty: d.counterparty ?? null,
      source: "manual", source_ref: null, import_batch_id: null,
    })
    void recordAudit({ action: "bookkeeping.entry_created", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_entry", id: entry.id, label: entry.memo ?? "" },
      metadata: { book_id: d.book_id, amount_cents: d.amount_cents, direction: d.direction }, request })
    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    console.error("Create bookkeeping entry error:", error)
    return NextResponse.json({ error: "Failed to create entry" }, { status: 500 })
  }
}
