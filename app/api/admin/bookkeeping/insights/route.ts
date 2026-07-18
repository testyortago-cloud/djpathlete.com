// JSON screen-read: self-gated, unflagged (D10), UNAUDITED (reports-route precedent).
// Everything recomputes per request (D4) — no persistence, no cache.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deductionFindings, homeOfficeCandidate } from "@/lib/bookkeeping/deduction-finder"
import { loadInsightsBundle } from "@/lib/bookkeeping/insight-data"
import { coerceHomeOfficePercent } from "@/lib/bookkeeping/insight-types"
import { serviceLineProfit } from "@/lib/bookkeeping/service-line-profit"
import { vendorSweep } from "@/lib/bookkeeping/vendor-sweep"
import { yearEndFlags } from "@/lib/bookkeeping/year-end-flags"
import { getSetting } from "@/lib/db/system-settings"
import { reportQuerySchema } from "@/lib/validators/bookkeeping"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const sp = new URL(request.url).searchParams
    const parsed = reportQuerySchema.safeParse({ from: sp.get("from"), to: sp.get("to") })
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const { from, to } = parsed.data

    const [bundle, storedPercent] = await Promise.all([
      loadInsightsBundle(from, to),
      getSetting<number | null>("bookkeeping_home_office_percent", null),
    ])
    const percent = coerceHomeOfficePercent(storedPercent)
    const homeOffice = homeOfficeCandidate(bundle.entries, bundle.accounts, bundle.books, percent)

    const bookPayloads = bundle.books.map((book) => {
      const bookEntries = bundle.entries.filter((e) => e.book_id === book.id)
      return {
        book: {
          id: book.id,
          name: book.name,
          book_kind: book.book_kind,
          is_primary: book.is_primary,
          currency: book.currency,
        },
        deductions: deductionFindings(book.id, bundle.entries, bundle.accounts),
        profit: serviceLineProfit(bookEntries, bundle.accounts),
        vendors: vendorSweep(bookEntries, bundle.accounts),
        row_count: bookEntries.length,
      }
    })

    let gapCount = 0
    let uncategorizedCount = 0
    bookPayloads.forEach((payload, i) => {
      if (bundle.books[i].book_kind !== "business") return
      gapCount += payload.deductions.substantiation_gaps.length
      uncategorizedCount += payload.deductions.uncategorized.entry_count
    })

    const flags = yearEndFlags({
      today: new Date().toISOString().slice(0, 10),
      from,
      to,
      gap_count: gapCount,
      uncategorized_expense_count: uncategorizedCount,
      home_office_percent_set: percent !== null,
      home_office_input_total_cents: homeOffice.input_total_cents,
    })

    return NextResponse.json({
      from,
      to,
      home_office_percent: percent,
      books: bookPayloads,
      home_office: homeOffice,
      year_end_flags: flags,
    })
  } catch (error) {
    console.error("bookkeeping insights:", error)
    return NextResponse.json({ error: "Failed to build insights" }, { status: 500 })
  }
}
