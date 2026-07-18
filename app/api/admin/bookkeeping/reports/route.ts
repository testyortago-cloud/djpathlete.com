import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { reportQuerySchema } from "@/lib/validators/bookkeeping"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { incomeByServiceLine, profitAndLossByCategory, perBookSummary } from "@/lib/bookkeeping/reports"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const sp = new URL(request.url).searchParams
    const parsed = reportQuerySchema.safeParse({ from: sp.get("from"), to: sp.get("to") })
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { from, to } = parsed.data

    const { books, accounts, entries } = await loadReportBundle(from, to)
    const summaries = perBookSummary(entries, books)
    const payload = books.map((book) => {
      const bookEntries = entries.filter((e) => e.book_id === book.id)
      return {
        book: { id: book.id, name: book.name, book_kind: book.book_kind, is_primary: book.is_primary, currency: book.currency },
        summary: summaries.find((s) => s.book_id === book.id)!,
        income_by_service: incomeByServiceLine(bookEntries, accounts),
        pnl: profitAndLossByCategory(bookEntries, accounts),
        row_count: bookEntries.length,
      }
    })
    return NextResponse.json({ from, to, books: payload })
  } catch (error) {
    console.error("Bookkeeping reports error:", error)
    return NextResponse.json({ error: "Failed to build report" }, { status: 500 })
  }
}
