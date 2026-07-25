import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { reportQuerySchema } from "@/lib/validators/bookkeeping"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { incomeByServiceLine, profitAndLossByCategory, perBookSummary } from "@/lib/bookkeeping/reports"
import { stripeFeeWindow, NO_FEE_DATA } from "@/lib/bookkeeping/payout-fees"

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
    const stripeFees = stripeFeeWindow(bundle.payoutLines ?? [], bundle.payouts ?? [], from, to)
    const summaries = perBookSummary(entries, books)
    const payload = books.map((book) => {
      const bookEntries = entries.filter((e) => e.book_id === book.id)
      const incomeByService = incomeByServiceLine(bookEntries, accounts)
      // Payouts only ever ingest into the primary business book (sync route);
      // every other book has no fee data at all.
      const fees = book.is_primary && book.book_kind === "business" ? stripeFees : NO_FEE_DATA
      // net_income_cents is NULL, never a restatement of gross, unless the fee
      // picture for the window is COMPLETE. Two ways it is not: no payout has
      // been ingested at all (the default state — the sync flag ships OFF), or
      // some ingested payout's fees never arrived (manual payouts return no
      // constituent balance transactions). The on-screen helper can hedge a
      // partial number with "fees incomplete for N of M"; a JSON field cannot
      // carry a caveat, and a chat tool or script reading net_income_cents must
      // never be handed gross under a net_ key. stripe_fees carries the counts
      // so a consumer that wants the partial estimate can compute it knowingly.
      const netAvailable = fees.payout_count > 0 && fees.unreconciled_count === 0
      return {
        book: { id: book.id, name: book.name, book_kind: book.book_kind, is_primary: book.is_primary, currency: book.currency },
        summary: summaries.find((s) => s.book_id === book.id)!,
        income_by_service: incomeByService,
        pnl: profitAndLossByCategory(bookEntries, accounts),
        row_count: bookEntries.length,
        stripe_fee_cents: fees.fee_cents,
        stripe_fees: fees,
        net_income_available: netAvailable,
        net_income_cents: netAvailable ? incomeByService.total_cents - fees.fee_cents : null,
      }
    })
    return NextResponse.json({ from, to, books: payload })
  } catch (error) {
    console.error("Bookkeeping reports error:", error)
    return NextResponse.json({ error: "Failed to build report" }, { status: 500 })
  }
}
