import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { quickbooksQuerySchema } from "@/lib/validators/bookkeeping"
import { getBook, listEntriesForReports, listAccountsForReports } from "@/lib/db/bookkeeping"
import { buildQuickBooksCsv } from "@/lib/bookkeeping/quickbooks-csv"
import { recordAudit } from "@/lib/audit/record"

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "book"
}

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const sp = new URL(request.url).searchParams
    const parsed = quickbooksQuerySchema.safeParse({ from: sp.get("from"), to: sp.get("to"), book_id: sp.get("book_id") })
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { from, to, book_id } = parsed.data

    const book = await getBook(book_id)
    if (!book) return NextResponse.json({ error: "book not found" }, { status: 404 })

    const [entries, accounts] = await Promise.all([
      listEntriesForReports(from, to, book_id),
      listAccountsForReports(),
    ])
    const csv = buildQuickBooksCsv(entries, accounts)

    void recordAudit({
      action: "bookkeeping.report_exported", category: "admin_read_sensitive", outcome: "success",
      target: { type: "bookkeeping_book", id: book_id, label: book.name },
      metadata: { format: "quickbooks_csv", book_id, from, to, row_count: entries.length }, request,
    })
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="quickbooks-${slugify(book.name)}-${from}-${to}.csv"`,
        "cache-control": "no-store",
      },
    })
  } catch (error) {
    console.error("QuickBooks CSV export error:", error)
    return NextResponse.json({ error: "Failed to build export" }, { status: 500 })
  }
}
