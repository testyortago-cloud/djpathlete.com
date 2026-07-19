/** Pure report aggregators over posted ledger rows. Zero IO — callers fetch
 *  windowed entries via the DAL (fetchAllRows) and pass plain arrays.
 *  Sign discipline: amount_cents is a magnitude; `direction` carries sign.
 *  Sums are per-direction; net = income − expense is the only subtraction. */
import type { BookkeepingBook, BookKind, LedgerAccountType, LedgerDirection, LedgerSource } from "@/types/database"
// insight-types imports only TYPES from this file (insight-types.ts:4), so this
// runtime import cannot form a cycle — one lib-side normalizer, not a third copy.
import { normalizeCounterparty } from "./insight-types"

export interface ReportEntry {
  book_id: string
  account_id: string | null
  direction: LedgerDirection
  amount_cents: number
  occurred_on: string
  counterparty: string | null
  memo: string | null
  source: LedgerSource
}

export interface ReportAccount {
  id: string
  book_id: string
  name: string
  account_type: LedgerAccountType
  service_line: string | null
  tax_category: string | null
  sort_order: number
}

export interface ServiceLineRow { service_line: string | null; label: string; total_cents: number; entry_count: number }
export interface IncomeByServiceLine { rows: ServiceLineRow[]; total_cents: number }
export interface CategoryRow { account_id: string | null; name: string; tax_category: string | null; total_cents: number; entry_count: number }
export interface ProfitAndLoss {
  income: CategoryRow[]
  expense: CategoryRow[]
  income_total_cents: number
  expense_total_cents: number
  net_cents: number
}
export interface BookSummaryRow {
  book_id: string
  name: string
  book_kind: BookKind
  income_cents: number
  expense_cents: number
  net_cents: number
  entry_count: number
}

export const SERVICE_LINE_LABELS: Record<string, string> = {
  performance_training: "Performance Training",
  session_packs: "Session Packs",
  camps: "Camps & Clinics",
  teams_center: "Teams / Center Work",
  memberships: "Memberships",
  shop: "Shop",
  other: "Other",
}

const byTotalDesc = <T extends { total_cents: number }>(label: (r: T) => string) => (a: T, b: T) =>
  b.total_cents - a.total_cents || label(a).localeCompare(label(b))

export function incomeByServiceLine(entries: ReportEntry[], accounts: ReportAccount[]): IncomeByServiceLine {
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const buckets = new Map<string | null, ServiceLineRow>()
  let total = 0
  for (const e of entries) {
    if (e.direction !== "income") continue
    const account = e.account_id ? accountById.get(e.account_id) : undefined
    // Account without a service line folds into the seeded "other" line;
    // no (or unknown) account is a distinct Uncategorized bucket for review.
    const line = account ? (account.service_line ?? "other") : null
    const row = buckets.get(line) ?? {
      service_line: line,
      label: line === null ? "Uncategorized" : (SERVICE_LINE_LABELS[line] ?? line),
      total_cents: 0,
      entry_count: 0,
    }
    row.total_cents += e.amount_cents
    row.entry_count += 1
    buckets.set(line, row)
    total += e.amount_cents
  }
  return { rows: [...buckets.values()].sort(byTotalDesc((r) => r.label)), total_cents: total }
}

export function profitAndLossByCategory(entries: ReportEntry[], accounts: ReportAccount[]): ProfitAndLoss {
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const sides: Record<LedgerDirection, Map<string | null, CategoryRow>> = {
    income: new Map(),
    expense: new Map(),
  }
  let incomeTotal = 0
  let expenseTotal = 0
  for (const e of entries) {
    const account = e.account_id ? accountById.get(e.account_id) : undefined
    const key = account?.id ?? null
    const side = sides[e.direction]
    const row = side.get(key) ?? {
      account_id: key,
      name: account?.name ?? "Uncategorized",
      tax_category: account?.tax_category ?? null,
      total_cents: 0,
      entry_count: 0,
    }
    row.total_cents += e.amount_cents
    row.entry_count += 1
    side.set(key, row)
    if (e.direction === "income") incomeTotal += e.amount_cents
    else expenseTotal += e.amount_cents
  }
  const sort = (m: Map<string | null, CategoryRow>) => [...m.values()].sort(byTotalDesc((r) => r.name))
  return {
    income: sort(sides.income),
    expense: sort(sides.expense),
    income_total_cents: incomeTotal,
    expense_total_cents: expenseTotal,
    net_cents: incomeTotal - expenseTotal,
  }
}

export function perBookSummary(entries: ReportEntry[], books: BookkeepingBook[]): BookSummaryRow[] {
  const rows = books.map((b) => ({
    book_id: b.id, name: b.name, book_kind: b.book_kind,
    income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0,
  }))
  const byId = new Map(rows.map((r) => [r.book_id, r]))
  for (const e of entries) {
    const s = byId.get(e.book_id)
    if (!s) continue // entry for a book not passed in (archived) — no archive UI exists today
    if (e.direction === "income") s.income_cents += e.amount_cents
    else s.expense_cents += e.amount_cents
    s.entry_count += 1
  }
  for (const s of rows) s.net_cents = s.income_cents - s.expense_cents
  return rows // caller passes books in sort_order (listBooks order)
}

// ── Counterparty rollup (Phase 6c — chat tools; reusable by future UI) ──────
// Twin: functions/src/lib/bookkeeping-aggregate.ts — keep in lockstep; the
// fixture-parity test (__tests__/lib/bookkeeping/chat-tools-parity.test.ts)
// pins the two to identical outputs.

export interface CounterpartyRow {
  counterparty: string | null
  total_cents: number
  entry_count: number
}

/** Rank counterparties for ONE direction by total cents. Grouping key is the
 *  normalized (trim/lowercase/collapse-ws) name; blank/missing names share the
 *  null bucket. Sort: total desc, tie name asc with null last. Sliced to
 *  `limit` AFTER sorting; limit ≤ 0 → empty (clamped — never slice(0, -1)). */
export function topCounterparties(
  entries: ReportEntry[],
  opts: { direction: LedgerDirection; limit: number },
): CounterpartyRow[] {
  const limit = Math.max(0, Math.floor(opts.limit))
  const buckets = new Map<string | null, CounterpartyRow>()
  for (const e of entries) {
    if (e.direction !== opts.direction) continue
    const key = normalizeCounterparty(e.counterparty)
    const row = buckets.get(key) ?? { counterparty: key, total_cents: 0, entry_count: 0 }
    row.total_cents += e.amount_cents
    row.entry_count += 1
    buckets.set(key, row)
  }
  return [...buckets.values()]
    .sort((a, b) => {
      if (b.total_cents !== a.total_cents) return b.total_cents - a.total_cents
      if (a.counterparty === null) return 1
      if (b.counterparty === null) return -1
      return a.counterparty.localeCompare(b.counterparty)
    })
    .slice(0, limit)
}
