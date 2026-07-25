/** Server-side fetch bundle for report surfaces (JSON route, CSV route,
 *  pack route, print page) — one place that knows which DAL readers a
 *  report needs. Server-only (DAL is service-role). payoutLines feed the
 *  net-revenue second line (Track A §1.4) — gross stays primary (D3). */
import { listBooks, listAccountsForReports, listEntriesForReports, listPayoutLinesForWindow } from "@/lib/db/bookkeeping"
import type { PayoutLineWindowRow } from "@/lib/db/bookkeeping"
import type { ReportAccount, ReportEntry } from "@/lib/bookkeeping/reports"
import type { BookkeepingBook } from "@/types/database"

export interface ReportBundle {
  books: BookkeepingBook[]
  accounts: ReportAccount[]
  entries: ReportEntry[]
  payoutLines: PayoutLineWindowRow[]
}

export async function loadReportBundle(from: string, to: string): Promise<ReportBundle> {
  const [books, accounts, entries, payoutLines] = await Promise.all([
    listBooks(),
    listAccountsForReports(),
    listEntriesForReports(from, to),
    listPayoutLinesForWindow(from, to),
  ])
  return { books, accounts, entries, payoutLines }
}
