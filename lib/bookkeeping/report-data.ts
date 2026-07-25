/** Server-side fetch bundle for report surfaces (JSON route, CSV route,
 *  pack route, print page) — one place that knows which DAL readers a
 *  report needs. Server-only (DAL is service-role). payoutLines feed the
 *  net-revenue second line (Track A §1.4) — gross stays primary (D3).
 *  `payouts` is the availability half: a MANUAL payout produces no lines at
 *  all, so without it a window of manual payouts would read as "no payouts
 *  ingested" and print a clean, false net. */
import {
  listBooks, listAccountsForReports, listEntriesForReports,
  listPayoutLinesForWindow, listPayoutRefsForWindow,
} from "@/lib/db/bookkeeping"
import type { PayoutLineWindowRow, PayoutWindowRefRow } from "@/lib/db/bookkeeping"
import type { ReportAccount, ReportEntry } from "@/lib/bookkeeping/reports"
import type { BookkeepingBook } from "@/types/database"

export interface ReportBundle {
  books: BookkeepingBook[]
  accounts: ReportAccount[]
  entries: ReportEntry[]
  payoutLines: PayoutLineWindowRow[]
  payouts: PayoutWindowRefRow[]
}

export async function loadReportBundle(from: string, to: string): Promise<ReportBundle> {
  // Books resolve FIRST: bookkeeping_payout_lines carries no book_id, so the
  // line read has to be scoped through its parent payout's book — and every
  // report surface attributes that sum wholly to the primary business book.
  // One extra round-trip buys reads that cannot pick up another book's fees.
  const books = await listBooks()
  const feeBook = books.find((b) => b.is_primary && b.book_kind === "business")
  const [accounts, entries, payoutLines, payouts] = await Promise.all([
    listAccountsForReports(),
    listEntriesForReports(from, to),
    feeBook ? listPayoutLinesForWindow(feeBook.id, from, to) : Promise.resolve([]),
    feeBook ? listPayoutRefsForWindow(feeBook.id, from, to) : Promise.resolve([]),
  ])
  return { books, accounts, entries, payoutLines, payouts }
}
