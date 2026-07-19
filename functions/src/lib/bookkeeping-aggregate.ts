// Twin of the pure aggregation math in lib/bookkeeping/reports.ts
// (perBookSummary, incomeByServiceLine, topCounterparties, SERVICE_LINE_LABELS)
// plus the normalizeCounterparty helper from lib/bookkeeping/insight-types.ts.
// functions/ cannot import lib/ (tsconfig rootDir "src") — hand-maintained twin.
// MUST import nothing: __tests__/lib/bookkeeping/chat-tools-parity.test.ts
// relative-imports this file under the ROOT vitest config (the
// statement-schema-parity precedent), which only works while it is
// dependency-free. Keep in lockstep with the lib originals — the parity test
// pins identical fixtures to deep-equal outputs.

export type LedgerDirection = "income" | "expense"

/** Slim ledger row — the columns the aggregators read. Wider fetch rows are
 *  structurally assignable. amount_cents is a magnitude; direction carries sign. */
export interface AggEntry {
  book_id: string
  account_id: string | null
  direction: LedgerDirection
  amount_cents: number
  counterparty: string | null
}

export interface AggAccount {
  id: string
  service_line: string | null
}

export interface AggBook {
  id: string
  name: string
  book_kind: string
}

export interface ServiceLineRow {
  service_line: string | null
  label: string
  total_cents: number
  entry_count: number
}

export interface IncomeByServiceLine {
  rows: ServiceLineRow[]
  total_cents: number
}

export interface BookSummaryRow {
  book_id: string
  name: string
  book_kind: string
  income_cents: number
  expense_cents: number
  net_cents: number
  entry_count: number
}

export interface CounterpartyRow {
  counterparty: string | null
  total_cents: number
  entry_count: number
}

// Twin of lib/bookkeeping/reports.ts SERVICE_LINE_LABELS — parity-pinned.
export const SERVICE_LINE_LABELS: Record<string, string> = {
  performance_training: "Performance Training",
  session_packs: "Session Packs",
  camps: "Camps & Clinics",
  teams_center: "Teams / Center Work",
  memberships: "Memberships",
  shop: "Shop",
  other: "Other",
}

/** Twin of lib/bookkeeping/insight-types.ts normalizeCounterparty. */
function normalizeCounterparty(raw: string | null): string | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ")
  return normalized === "" ? null : normalized
}

/** Twin of lib/bookkeeping/reports.ts perBookSummary. net = income − expense
 *  is the only subtraction; entries for unlisted books are skipped. */
export function perBookSummary(entries: AggEntry[], books: AggBook[]): BookSummaryRow[] {
  const rows: BookSummaryRow[] = books.map((b) => ({
    book_id: b.id, name: b.name, book_kind: b.book_kind,
    income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0,
  }))
  const byId = new Map(rows.map((r) => [r.book_id, r]))
  for (const e of entries) {
    const s = byId.get(e.book_id)
    if (!s) continue
    if (e.direction === "income") s.income_cents += e.amount_cents
    else s.expense_cents += e.amount_cents
    s.entry_count += 1
  }
  for (const s of rows) s.net_cents = s.income_cents - s.expense_cents
  return rows
}

/** Twin of lib/bookkeeping/reports.ts incomeByServiceLine. Account without a
 *  service line folds into "other"; no/unknown account is the null
 *  Uncategorized bucket. Sort total desc, tie label asc. */
export function incomeByServiceLine(entries: AggEntry[], accounts: AggAccount[]): IncomeByServiceLine {
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const buckets = new Map<string | null, ServiceLineRow>()
  let total = 0
  for (const e of entries) {
    if (e.direction !== "income") continue
    const account = e.account_id ? accountById.get(e.account_id) : undefined
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
  return {
    rows: [...buckets.values()].sort(
      (a, b) => b.total_cents - a.total_cents || a.label.localeCompare(b.label),
    ),
    total_cents: total,
  }
}

/** Twin of lib/bookkeeping/reports.ts topCounterparties (Task 1) — same
 *  normalize/sort/tie/clamp rules; see the lib docstring. */
export function topCounterparties(
  entries: AggEntry[],
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
