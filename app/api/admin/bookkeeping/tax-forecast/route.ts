// Compact per-book tax forecast for the books-page strip. Mirrors the insights
// route's forecast semantics EXACTLY (D-8/D-9): calendar-YTD window, business
// books only, home-office deduction applied only to its target book, flat
// CPA-entered rate. The strip and the Insights card must never disagree.
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { homeOfficeCandidate } from "@/lib/bookkeeping/deduction-finder"
import { loadInsightsBundle } from "@/lib/bookkeeping/insight-data"
import { coerceHomeOfficePercent, coerceTaxRatePercent } from "@/lib/bookkeeping/insight-types"
import { bookYtdTotals, taxForecast } from "@/lib/bookkeeping/tax-forecast"
import { getSetting } from "@/lib/db/system-settings"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const querySchema = z.object({ book_id: z.string().uuid() })

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const parsed = querySchema.safeParse({ book_id: new URL(request.url).searchParams.get("book_id") })
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const { book_id } = parsed.data

    const today = new Date().toISOString().slice(0, 10)
    const ytdFrom = `${today.slice(0, 4)}-01-01`
    const [bundle, storedPercent, storedRate] = await Promise.all([
      loadInsightsBundle(ytdFrom, today),
      getSetting<number | null>("bookkeeping_home_office_percent", null),
      getSetting<number | null>("bookkeeping_tax_rate_percent", null),
    ])

    const book = bundle.books.find((b) => b.id === book_id)
    if (!book || book.book_kind !== "business") {
      // Household books get no forecast — same rule as Insights.
      return NextResponse.json({ business: false })
    }

    const percent = coerceHomeOfficePercent(storedPercent)
    const rate = coerceTaxRatePercent(storedRate)
    const homeOffice = homeOfficeCandidate(bundle.entries, bundle.accounts, bundle.books, percent)
    const totals = bookYtdTotals(bundle.entries, book.id)
    const forecast = taxForecast({
      ytd_income_cents: totals.ytd_income_cents,
      ytd_expense_cents: totals.ytd_expense_cents,
      home_office_deduction_cents:
        book.id === homeOffice.target_book_id ? homeOffice.proposed_total_cents : null,
      rate_percent: rate,
      today,
    })
    return NextResponse.json({ business: true, forecast })
  } catch (error) {
    console.error("bookkeeping tax-forecast strip:", error)
    return NextResponse.json({ error: "Failed to load the tax forecast" }, { status: 500 })
  }
}
