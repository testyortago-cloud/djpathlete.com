/** Server-side fetch bundle for insight surfaces (finders route + future insight
 *  pages) — one place that knows which DAL readers the insights need. Server-only
 *  (DAL is service-role). Mirrors report-data.ts. */
import { listAccountsForInsights, listBooks, listEntriesForInsights } from "@/lib/db/bookkeeping"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"
import type { BookkeepingBook } from "@/types/database"

export interface InsightsBundle {
  books: BookkeepingBook[]
  accounts: InsightAccount[]
  entries: InsightEntry[]
}

export async function loadInsightsBundle(from: string, to: string): Promise<InsightsBundle> {
  const [books, accounts, entries] = await Promise.all([
    listBooks(),
    listAccountsForInsights(),
    listEntriesForInsights(from, to),
  ])
  return { books, accounts, entries }
}
