// Pure deduction finders (Phase 5). Zero IO; integer cents; direction carries sign.
// Every output is a CANDIDATE the accountant confirms — never a filed decision.
import type { BookkeepingBook, LedgerDirection, LedgerSource } from "@/types/database"
import type { InsightAccount, InsightEntry } from "./insight-types"
import { normalizeCounterparty } from "./insight-types"

export interface WatchlistCounterparty {
  counterparty: string | null
  total_cents: number
  entry_count: number
}

export interface WatchlistRow {
  account_id: string
  name: string
  tax_category: string | null
  archived: boolean
  total_cents: number
  entry_count: number
  top_counterparties: WatchlistCounterparty[]
}

export interface SubstantiationGap {
  entry_id: string
  account_id: string
  account_name: string
  occurred_on: string
  direction: LedgerDirection
  amount_cents: number
  counterparty: string | null
  memo: string | null
  source: LedgerSource
  has_document: boolean
}

export interface UncategorizedEntry {
  entry_id: string
  occurred_on: string
  amount_cents: number
  counterparty: string | null
  memo: string | null
  source: LedgerSource
}

export interface UncategorizedSweep {
  total_cents: number
  entry_count: number
  entries: UncategorizedEntry[]
}

export interface DeductionFindings {
  watchlist: WatchlistRow[]
  watchlist_total_cents: number
  substantiation_gaps: SubstantiationGap[]
  gap_total_cents: number
  uncategorized: UncategorizedSweep
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === ""
}

function newestFirst(a: { occurred_on: string; entry_id: string }, b: { occurred_on: string; entry_id: string }): number {
  return b.occurred_on.localeCompare(a.occurred_on) || a.entry_id.localeCompare(b.entry_id)
}

/** bookId explicit so zero-entry watch accounts still get a row; entries re-filtered defensively. */
export function deductionFindings(
  bookId: string,
  entries: InsightEntry[],
  accounts: InsightAccount[],
): DeductionFindings {
  const bookEntries = entries.filter((e) => e.book_id === bookId)
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const entriesByAccount = new Map<string, InsightEntry[]>()
  for (const e of bookEntries) {
    if (e.account_id === null) continue
    const list = entriesByAccount.get(e.account_id)
    if (list) list.push(e)
    else entriesByAccount.set(e.account_id, [e])
  }

  const watchlist: WatchlistRow[] = accounts
    .filter((a) => a.book_id === bookId && a.is_deductible_candidate)
    .map((account) => {
      const rows = entriesByAccount.get(account.id) ?? []
      let total = 0
      const byCounterparty = new Map<string | null, WatchlistCounterparty>()
      for (const e of rows) {
        const signed = e.direction === "income" ? -e.amount_cents : e.amount_cents
        total += signed
        const key = normalizeCounterparty(e.counterparty)
        const bucket = byCounterparty.get(key) ?? { counterparty: key, total_cents: 0, entry_count: 0 }
        bucket.total_cents += signed
        bucket.entry_count += 1
        byCounterparty.set(key, bucket)
      }
      const top = [...byCounterparty.values()]
        .sort((a, b) => {
          if (b.total_cents !== a.total_cents) return b.total_cents - a.total_cents
          if (a.counterparty === null) return 1
          if (b.counterparty === null) return -1
          return a.counterparty.localeCompare(b.counterparty)
        })
        .slice(0, 3)
      return {
        account_id: account.id,
        name: account.name,
        tax_category: account.tax_category,
        archived: account.archived_at !== null,
        total_cents: total,
        entry_count: rows.length,
        top_counterparties: top,
      }
    })
    .sort((a, b) => b.total_cents - a.total_cents || a.name.localeCompare(b.name))

  const substantiationGaps: SubstantiationGap[] = []
  let gapTotal = 0
  for (const e of bookEntries) {
    if (e.account_id === null) continue
    const account = accountById.get(e.account_id)
    if (!account?.requires_business_purpose || !isBlank(e.business_purpose)) continue
    substantiationGaps.push({
      entry_id: e.id,
      account_id: account.id,
      account_name: account.name,
      occurred_on: e.occurred_on,
      direction: e.direction,
      amount_cents: e.amount_cents,
      counterparty: e.counterparty,
      memo: e.memo,
      source: e.source,
      has_document: e.document_id !== null,
    })
    gapTotal += e.amount_cents
  }
  substantiationGaps.sort(newestFirst)

  const uncategorizedRows = bookEntries.filter((e) => e.direction === "expense" && e.account_id === null)
  const uncategorized: UncategorizedSweep = {
    total_cents: uncategorizedRows.reduce((sum, e) => sum + e.amount_cents, 0),
    entry_count: uncategorizedRows.length,
    entries: uncategorizedRows
      .map((e) => ({
        entry_id: e.id,
        occurred_on: e.occurred_on,
        amount_cents: e.amount_cents,
        counterparty: e.counterparty,
        memo: e.memo,
        source: e.source,
      }))
      .sort(newestFirst),
  }

  return {
    watchlist,
    watchlist_total_cents: watchlist.reduce((sum, w) => sum + w.total_cents, 0),
    substantiation_gaps: substantiationGaps,
    gap_total_cents: gapTotal,
    uncategorized,
  }
}

// --- Home-office allocation candidate (D1: reads Household, WRITES NOTHING — a labeled proposal) ---

export const HOME_OFFICE_ACCOUNT_NAMES = [
  "rent",
  "utilities",
  "internet",
  "renter's insurance",
  "home repairs & maintenance",
] as const

export interface HomeOfficeInput {
  account_id: string
  name: string
  entry_count: number
  total_cents: number
  proposed_cents: number | null
}

export interface HomeOfficeCandidate {
  percent: number | null
  target_book_id: string | null
  household_books: { id: string; name: string }[]
  inputs: HomeOfficeInput[]
  input_total_cents: number
  proposed_total_cents: number | null
  excluded_household_expense_cents: number
}

export function homeOfficeCandidate(
  entries: InsightEntry[],
  accounts: InsightAccount[],
  books: BookkeepingBook[],
  percent: number | null,
): HomeOfficeCandidate {
  const householdBooks = books.filter((b) => b.book_kind === "household")
  const householdIds = new Set(householdBooks.map((b) => b.id))
  const businessBooks = books.filter((b) => b.book_kind === "business")
  const target = businessBooks.find((b) => b.is_primary) ?? businessBooks[0] ?? null

  const allowlist = new Set<string>(HOME_OFFICE_ACCOUNT_NAMES)
  const matched = accounts.filter(
    (a) => householdIds.has(a.book_id) && allowlist.has(normalizeCounterparty(a.name) ?? ""),
  )
  const matchedIds = new Set(matched.map((a) => a.id))

  const netByAccount = new Map<string, { total_cents: number; entry_count: number }>()
  let excluded = 0
  for (const e of entries) {
    if (!householdIds.has(e.book_id)) continue
    if (e.account_id !== null && matchedIds.has(e.account_id)) {
      const agg = netByAccount.get(e.account_id) ?? { total_cents: 0, entry_count: 0 }
      agg.total_cents += e.direction === "expense" ? e.amount_cents : -e.amount_cents
      agg.entry_count += 1
      netByAccount.set(e.account_id, agg)
    } else if (e.direction === "expense") {
      excluded += e.amount_cents
    }
  }

  const inputs: HomeOfficeInput[] = matched
    .map((a) => {
      const agg = netByAccount.get(a.id) ?? { total_cents: 0, entry_count: 0 }
      return {
        account_id: a.id,
        name: a.name,
        entry_count: agg.entry_count,
        total_cents: agg.total_cents,
        proposed_cents: percent === null ? null : Math.round((agg.total_cents * percent) / 100),
      }
    })
    .sort((a, b) => b.total_cents - a.total_cents || a.name.localeCompare(b.name))

  return {
    percent,
    target_book_id: target?.id ?? null,
    household_books: householdBooks.map((b) => ({ id: b.id, name: b.name })),
    inputs,
    input_total_cents: inputs.reduce((sum, i) => sum + i.total_cents, 0),
    proposed_total_cents:
      percent === null ? null : inputs.reduce((sum, i) => sum + (i.proposed_cents ?? 0), 0),
    excluded_household_expense_cents: excluded,
  }
}
