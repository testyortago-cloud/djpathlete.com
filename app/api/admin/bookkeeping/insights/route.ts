// JSON screen-read: self-gated, unflagged (D10), UNAUDITED (reports-route precedent).
// Everything recomputes per request (D4) — no persistence, no cache.
// Phase 6b adds two sections: `forecast` (calendar-YTD per business book, D-8/D-9 —
// its OWN dedicated YTD read, independent of the page window) and `watchdog`
// (missing receipts/purposes over the page window, D-10).
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deductionFindings, homeOfficeCandidate } from "@/lib/bookkeeping/deduction-finder"
import { loadInsightsBundle } from "@/lib/bookkeeping/insight-data"
import { coerceHomeOfficePercent, coerceTaxRatePercent } from "@/lib/bookkeeping/insight-types"
import { MIN_AGE_DAYS, receiptWatchdogFindings } from "@/lib/bookkeeping/receipt-watchdog"
import { serviceLineProfit } from "@/lib/bookkeeping/service-line-profit"
import { bookYtdTotals, taxForecast } from "@/lib/bookkeeping/tax-forecast"
import { vendorSweep } from "@/lib/bookkeeping/vendor-sweep"
import { yearEndFlags } from "@/lib/bookkeeping/year-end-flags"
import { listDismissedFingerprints, listEntriesForInsights } from "@/lib/db/bookkeeping"
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
    const today = new Date().toISOString().slice(0, 10)
    const ytdFrom = `${today.slice(0, 4)}-01-01` // D-9: pinned calendar YTD, never the page window

    const [bundle, storedPercent, storedRate, ytdEntries] = await Promise.all([
      loadInsightsBundle(from, to),
      getSetting<number | null>("bookkeeping_home_office_percent", null),
      getSetting<number | null>("bookkeeping_tax_rate_percent", null),
      listEntriesForInsights(ytdFrom, today),
    ])
    const percent = coerceHomeOfficePercent(storedPercent)
    const rate = coerceTaxRatePercent(storedRate)
    const homeOffice = homeOfficeCandidate(bundle.entries, bundle.accounts, bundle.books, percent)

    // Dismissals (5b, B-2) gate DISPLAY only — the recompute above/below is
    // untouched; the client filters rows by these fingerprints. Keyed by book id
    // (never positional) so a later filter on either pass cannot cross-feed one
    // book's dismissals into another and silently hide real findings.
    const dismissedByBook = new Map(
      await Promise.all(
        bundle.books.map(async (b) => [b.id, await listDismissedFingerprints(b.id)] as const),
      ),
    )

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
        dismissed_fingerprints: dismissedByBook.get(book.id) ?? [],
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
      today,
      from,
      to,
      gap_count: gapCount,
      uncategorized_expense_count: uncategorizedCount,
      home_office_percent_set: percent !== null,
      home_office_input_total_cents: homeOffice.input_total_cents,
    })

    // Forecast (D-8/D-9): per BUSINESS book, from the dedicated YTD read. The
    // home-office proposal is recomputed on the YTD window and applies ONLY to
    // its target (primary business) book. Household books get no forecast.
    const ytdHomeOffice = homeOfficeCandidate(ytdEntries, bundle.accounts, bundle.books, percent)
    const forecastBooks = bundle.books
      .filter((book) => book.book_kind === "business")
      .map((book) => {
        const totals = bookYtdTotals(ytdEntries, book.id)
        return {
          book_id: book.id,
          book_name: book.name,
          forecast: taxForecast({
            ytd_income_cents: totals.ytd_income_cents,
            ytd_expense_cents: totals.ytd_expense_cents,
            home_office_deduction_cents:
              book.id === ytdHomeOffice.target_book_id ? ytdHomeOffice.proposed_total_cents : null,
            rate_percent: rate,
            today,
          }),
        }
      })

    // Watchdog (D-10): the PAGE window, all books; the client filters per tab.
    const watchdog = receiptWatchdogFindings(bundle.entries, bundle.accounts, {
      today,
      minAgeDays: MIN_AGE_DAYS,
    })

    return NextResponse.json({
      from,
      to,
      home_office_percent: percent,
      books: bookPayloads,
      home_office: homeOffice,
      year_end_flags: flags,
      forecast: { ytd_from: ytdFrom, ytd_to: today, rate_percent: rate, books: forecastBooks },
      watchdog,
    })
  } catch (error) {
    console.error("bookkeeping insights:", error)
    return NextResponse.json({ error: "Failed to build insights" }, { status: 500 })
  }
}
