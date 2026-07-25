import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { reportQuerySchema } from "@/lib/validators/bookkeeping"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { incomeByServiceLine, profitAndLossByCategory, perBookSummary } from "@/lib/bookkeeping/reports"
import { stripeFeesInWindow } from "@/lib/bookkeeping/payout-fees"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const sp = new URL(request.url).searchParams
    const parsed = reportQuerySchema.safeParse({ from: sp.get("from"), to: sp.get("to") })
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { from, to } = parsed.data

    const bundle = await loadReportBundle(from, to)
    const { books, accounts, entries } = bundle
    // ?? [] keeps older test doubles of loadReportBundle (pre-payoutLines) valid;
    // the real bundle always supplies the array.
    const stripeFees = stripeFeesInWindow(bundle.payoutLines ?? [], from, to)
    const summaries = perBookSummary(entries, books)
    const payload = books.map((book) => {
      const bookEntries = entries.filter((e) => e.book_id === book.id)
      const incomeByService = incomeByServiceLine(bookEntries, accounts)
      // Payouts only ever ingest into the primary business book (sync route);
      // every other book reports 0 fees and net == gross.
      const feeCents = book.is_primary && book.book_kind === "business" ? stripeFees : 0
      return {
        book: { id: book.id, name: book.name, book_kind: book.book_kind, is_primary: book.is_primary, currency: book.currency },
        summary: summaries.find((s) => s.book_id === book.id)!,
        income_by_service: incomeByService,
        pnl: profitAndLossByCategory(bookEntries, accounts),
        row_count: bookEntries.length,
        stripe_fee_cents: feeCents,
        net_income_cents: incomeByService.total_cents - feeCents,
      }
    })
    return NextResponse.json({ from, to, books: payload })
  } catch (error) {
    console.error("Bookkeeping reports error:", error)
    return NextResponse.json({ error: "Failed to build report" }, { status: 500 })
  }
}
