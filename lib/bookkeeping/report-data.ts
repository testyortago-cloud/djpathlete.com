/** Server-side fetch bundle for report surfaces (JSON route, CSV route,
 *  pack route, print page) — one place that knows which DAL readers a
 *  report needs. Server-only (DAL is service-role). */
import { listBooks, listAccountsForReports, listEntriesForReports } from "@/lib/db/bookkeeping"
import type { ReportAccount, ReportEntry } from "@/lib/bookkeeping/reports"
import type { BookkeepingBook } from "@/types/database"

export interface ReportBundle {
  books: BookkeepingBook[]
  accounts: ReportAccount[]
  entries: ReportEntry[]
}

export async function loadReportBundle(from: string, to: string): Promise<ReportBundle> {
  const [books, accounts, entries] = await Promise.all([
    listBooks(),
    listAccountsForReports(),
    listEntriesForReports(from, to),
  ])
  return { books, accounts, entries }
}
