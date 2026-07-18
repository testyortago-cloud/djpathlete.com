# AI Bookkeeper Phase 4 — Reports & Accountant Pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only reporting over the posted bookkeeping ledger — three pure aggregators, a Reports page under /admin/books, a QuickBooks-importable CSV export, an exceljs accountant-pack workbook, and a browser Save-as-PDF print page — plus two folded-in Phase-3 minors.

**Architecture:** Pure zero-IO aggregators (`lib/bookkeeping/reports.ts`) consume slim ledger rows + accounts fetched by new paginated DAL readers; three self-gated API routes (JSON report, CSV download, xlsx download) and two pages (Reports UI, print view) sit on top. No migration, no flags, nothing outbound (emailed pack + quarterly cron are Phase-4b, spec §13 — NOT in this plan).

**Tech Stack:** Next.js 16 App Router, Supabase (service-role DAL), exceljs (existing dep, server-only), `lib/csv/serialize.ts` (injection-defended), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-18-ai-bookkeeper-phase-4-design.md` (read it first — §2 anchors, §3 decisions).

## Global Constraints

- **Reports read ONLY `bookkeeping_ledger_entries` (+ books/accounts/documents)** — NEVER `payments` or other money-of-record tables (mirror double-count trap).
- **Integer cents everywhere; `formatCents` for display; zero float.** Sums are magnitude-per-direction; `net = income − expense` is the only subtraction.
- **Every ledger/documents read paginates via `fetchAllRows`** (`lib/db/paginate.ts`). Accounts/books are small coach-managed tables → single select is the existing convention.
- **CSV via `lib/csv/serialize.ts` only** (`csvCell/csvRow/csvDocument` — injection defense `'`-prefixes leading `= + - @ \t \r` on strings; numbers bypass; CRLF; no BOM). Never hand-roll; never touch `lib/csv-parser.ts`.
- **exceljs is server-only** — imported by `lib/bookkeeping/accountant-pack.ts` and routes only, never client components.
- **No PDF library.** Print = global `.print-document` CSS + `PrintToolbar` + browser `window.print()`.
- **Routes self-gate**: `const session = await auth(); if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })` — never `requireAdmin()`. Bookkeeping audit = inline `void recordAudit(...)`, never `withAudit`.
- **All reports labeled GROSS + estimate** (spec §16 wording, verbatim in Tasks 7–10).
- **No migration, no feature flags, no functions/ changes in this phase.**
- Test fixtures use RFC-4122 UUIDs (`xxxxxxxx-xxxx-4xxx-8xxx-…`). Route tests mock the DAL module and import the handler AFTER mocks. Never create `__tests__/db/`.
- Commit after each task; stage ONLY your own files (the working tree has pre-existing dirty files — pr-detection, render-worker, promo — never stage them).

---

### Task 1: Pure period helpers — `lib/bookkeeping/period.ts`

**Files:**
- Create: `lib/bookkeeping/period.ts`
- Test: `__tests__/lib/bookkeeping/period.test.ts`

**Interfaces:**
- Produces: `type PeriodPreset = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_year" | "last_year"`; `presetRange(preset: PeriodPreset, today: string): { from: string; to: string }`; `PERIOD_PRESET_LABELS: Record<PeriodPreset, string>`. Consumed by Task 9 (ReportsClient) and Task 10 (print page default).

- [ ] **Step 1: Write the failing test** — `__tests__/lib/bookkeeping/period.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { presetRange, PERIOD_PRESET_LABELS, type PeriodPreset } from "@/lib/bookkeeping/period"

describe("presetRange", () => {
  it("this_month spans the calendar month of `today`", () => {
    expect(presetRange("this_month", "2026-07-18")).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("this_month handles February in a leap year", () => {
    expect(presetRange("this_month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" })
  })
  it("this_month handles February in a non-leap year", () => {
    expect(presetRange("this_month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })
  it("last_month rolls back over a year boundary", () => {
    expect(presetRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" })
  })
  it("this_quarter for a mid-quarter month", () => {
    expect(presetRange("this_quarter", "2026-07-18")).toEqual({ from: "2026-07-01", to: "2026-09-30" })
  })
  it("this_quarter at a quarter edge (Mar 31)", () => {
    expect(presetRange("this_quarter", "2026-03-31")).toEqual({ from: "2026-01-01", to: "2026-03-31" })
  })
  it("last_quarter rolls back over a year boundary", () => {
    expect(presetRange("last_quarter", "2026-02-01")).toEqual({ from: "2025-10-01", to: "2025-12-31" })
  })
  it("this_year / last_year are full calendar years", () => {
    expect(presetRange("this_year", "2026-07-18")).toEqual({ from: "2026-01-01", to: "2026-12-31" })
    expect(presetRange("last_year", "2026-07-18")).toEqual({ from: "2025-01-01", to: "2025-12-31" })
  })
  it("labels exist for every preset", () => {
    const presets: PeriodPreset[] = ["this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year"]
    for (const p of presets) expect(PERIOD_PRESET_LABELS[p]).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**
Run: `npx vitest run __tests__/lib/bookkeeping/period.test.ts`
Expected: FAIL — cannot resolve `@/lib/bookkeeping/period`.

- [ ] **Step 3: Implement** — `lib/bookkeeping/period.ts`:

```ts
/** Pure period-preset math for bookkeeping reports. All inputs/outputs are
 *  YYYY-MM-DD strings; `today` is injected (never `new Date()` here) so the
 *  logic is deterministic and testable. Windows are inclusive occurred_on
 *  ranges (D4: recompute-able, no close). */

export type PeriodPreset = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_year" | "last_year"

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  last_quarter: "Last quarter",
  this_year: "This year",
  last_year: "Last year",
}

const fmt = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
/** Day count of month m (1-12) in year y — Date.UTC day-0 trick, no local tz. */
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function presetRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  switch (preset) {
    case "this_month":
      return { from: fmt(y, m, 1), to: fmt(y, m, lastDay(y, m)) }
    case "last_month": {
      const yy = m === 1 ? y - 1 : y
      const mm = m === 1 ? 12 : m - 1
      return { from: fmt(yy, mm, 1), to: fmt(yy, mm, lastDay(yy, mm)) }
    }
    case "this_quarter": {
      const startM = Math.floor((m - 1) / 3) * 3 + 1
      return { from: fmt(y, startM, 1), to: fmt(y, startM + 2, lastDay(y, startM + 2)) }
    }
    case "last_quarter": {
      const q = Math.floor((m - 1) / 3) - 1
      const yy = q < 0 ? y - 1 : y
      const startM = ((q + 4) % 4) * 3 + 1
      return { from: fmt(yy, startM, 1), to: fmt(yy, startM + 2, lastDay(yy, startM + 2)) }
    }
    case "this_year":
      return { from: fmt(y, 1, 1), to: fmt(y, 12, 31) }
    case "last_year":
      return { from: fmt(y - 1, 1, 1), to: fmt(y - 1, 12, 31) }
  }
}
```

- [ ] **Step 4: Run to verify pass** — same command, expected all green.
- [ ] **Step 5: Commit** — `git add lib/bookkeeping/period.ts __tests__/lib/bookkeeping/period.test.ts && git commit -m "feat(bookkeeper): pure period-preset helpers for reports"`

---

### Task 2: Pure aggregators — `lib/bookkeeping/reports.ts`

**Files:**
- Create: `lib/bookkeeping/reports.ts`
- Test: `__tests__/lib/bookkeeping/reports.test.ts`

**Interfaces:**
- Consumes: types `LedgerDirection`, `LedgerAccountType`, `LedgerSource`, `BookkeepingBook` from `@/types/database` (type-only).
- Produces (exact — Tasks 3–10 import these):

```ts
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
export interface ProfitAndLoss { income: CategoryRow[]; expense: CategoryRow[]; income_total_cents: number; expense_total_cents: number; net_cents: number }
export interface BookSummaryRow { book_id: string; name: string; book_kind: BookKind; income_cents: number; expense_cents: number; net_cents: number; entry_count: number }
export const SERVICE_LINE_LABELS: Record<string, string>
export function incomeByServiceLine(entries: ReportEntry[], accounts: ReportAccount[]): IncomeByServiceLine
export function profitAndLossByCategory(entries: ReportEntry[], accounts: ReportAccount[]): ProfitAndLoss
export function perBookSummary(entries: ReportEntry[], books: BookkeepingBook[]): BookSummaryRow[]
```

- [ ] **Step 1: Write the failing test** — `__tests__/lib/bookkeeping/reports.test.ts` (zero mocks; helpers keep fixtures short):

```ts
import { describe, it, expect } from "vitest"
import {
  incomeByServiceLine, profitAndLossByCategory, perBookSummary,
  type ReportEntry, type ReportAccount,
} from "@/lib/bookkeeping/reports"
import type { BookkeepingBook } from "@/types/database"

const BOOK_A = "b0000000-0000-4000-8000-000000000001"
const BOOK_B = "b0000000-0000-4000-8000-000000000002"
const ACC_PT = "a0000000-0000-4000-8000-000000000001" // income, performance_training
const ACC_NOLINE = "a0000000-0000-4000-8000-000000000002" // income, service_line null
const ACC_EQUIP = "a0000000-0000-4000-8000-000000000003" // expense, Equipment, tax hint

const accounts: ReportAccount[] = [
  { id: ACC_PT, book_id: BOOK_A, name: "Performance Training — Sports", account_type: "income", service_line: "performance_training", tax_category: null, sort_order: 0 },
  { id: ACC_NOLINE, book_id: BOOK_A, name: "Legacy Income", account_type: "income", service_line: null, tax_category: null, sort_order: 1 },
  { id: ACC_EQUIP, book_id: BOOK_A, name: "Equipment", account_type: "expense", service_line: null, tax_category: "Schedule C Line 22", sort_order: 2 },
]

function entry(over: Partial<ReportEntry>): ReportEntry {
  return {
    book_id: BOOK_A, account_id: ACC_PT, direction: "income", amount_cents: 1000,
    occurred_on: "2026-07-01", counterparty: null, memo: null, source: "manual", ...over,
  }
}

const books = [
  { id: BOOK_A, name: "Darren — DJP Athlete", book_kind: "business", sort_order: 0 },
  { id: BOOK_B, name: "Spouse — Business", book_kind: "business", sort_order: 1 },
] as BookkeepingBook[]

describe("incomeByServiceLine", () => {
  it("sums income per service line and ignores expenses", () => {
    const r = incomeByServiceLine([
      entry({ amount_cents: 1000 }),
      entry({ amount_cents: 500 }),
      entry({ direction: "expense", account_id: ACC_EQUIP, amount_cents: 99999 }),
    ], accounts)
    expect(r.total_cents).toBe(1500)
    expect(r.rows).toEqual([
      { service_line: "performance_training", label: "Performance Training", total_cents: 1500, entry_count: 2 },
    ])
  })
  it("folds an account without a service line into 'other'", () => {
    const r = incomeByServiceLine([entry({ account_id: ACC_NOLINE })], accounts)
    expect(r.rows[0].service_line).toBe("other")
  })
  it("buckets entries with no account (or unknown account) as Uncategorized", () => {
    const r = incomeByServiceLine([
      entry({ account_id: null }),
      entry({ account_id: "a0000000-0000-4000-8000-00000000dead" }),
    ], accounts)
    expect(r.rows).toEqual([
      { service_line: null, label: "Uncategorized", total_cents: 2000, entry_count: 2 },
    ])
  })
  it("empty period → zero rows, zero total", () => {
    expect(incomeByServiceLine([], accounts)).toEqual({ rows: [], total_cents: 0 })
  })
})

describe("profitAndLossByCategory", () => {
  it("splits sides by entry.direction and computes net", () => {
    const r = profitAndLossByCategory([
      entry({ amount_cents: 5000 }),
      entry({ direction: "expense", account_id: ACC_EQUIP, amount_cents: 2000 }),
      entry({ direction: "expense", account_id: null, amount_cents: 100 }),
    ], accounts)
    expect(r.income_total_cents).toBe(5000)
    expect(r.expense_total_cents).toBe(2100)
    expect(r.net_cents).toBe(2900)
    expect(r.expense).toEqual([
      { account_id: ACC_EQUIP, name: "Equipment", tax_category: "Schedule C Line 22", total_cents: 2000, entry_count: 1 },
      { account_id: null, name: "Uncategorized", tax_category: null, total_cents: 100, entry_count: 1 },
    ])
  })
  it("net can go negative", () => {
    const r = profitAndLossByCategory([entry({ direction: "expense", account_id: ACC_EQUIP, amount_cents: 700 })], accounts)
    expect(r.net_cents).toBe(-700)
  })
  it("an entry whose direction disagrees with its account's type lands on the ENTRY's side (direction is sign truth)", () => {
    const r = profitAndLossByCategory([entry({ direction: "income", account_id: ACC_EQUIP, amount_cents: 300 })], accounts)
    expect(r.income).toEqual([
      { account_id: ACC_EQUIP, name: "Equipment", tax_category: "Schedule C Line 22", total_cents: 300, entry_count: 1 },
    ])
    expect(r.expense).toEqual([])
  })
  it("zero-amount entries count toward entry_count without moving totals", () => {
    const r = profitAndLossByCategory([entry({ amount_cents: 0 })], accounts)
    expect(r.income[0]).toMatchObject({ total_cents: 0, entry_count: 1 })
  })
  it("empty period → empty sides, zero net", () => {
    expect(profitAndLossByCategory([], accounts)).toEqual({
      income: [], expense: [], income_total_cents: 0, expense_total_cents: 0, net_cents: 0,
    })
  })
})

describe("perBookSummary", () => {
  it("every book appears even with zero entries (spouse empty-state contract)", () => {
    const r = perBookSummary([entry({ amount_cents: 800 })], books)
    expect(r).toEqual([
      { book_id: BOOK_A, name: "Darren — DJP Athlete", book_kind: "business", income_cents: 800, expense_cents: 0, net_cents: 800, entry_count: 1 },
      { book_id: BOOK_B, name: "Spouse — Business", book_kind: "business", income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0 },
    ])
  })
  it("entries for a book not in the list are ignored (archived-book edge, no archive UI exists)", () => {
    const r = perBookSummary([entry({ book_id: "b0000000-0000-4000-8000-00000000dead" })], books)
    expect(r.every((s) => s.entry_count === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run __tests__/lib/bookkeeping/reports.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `lib/bookkeeping/reports.ts`:

```ts
/** Pure report aggregators over posted ledger rows. Zero IO — callers fetch
 *  windowed entries via the DAL (fetchAllRows) and pass plain arrays.
 *  Sign discipline: amount_cents is a magnitude; `direction` carries sign.
 *  Sums are per-direction; net = income − expense is the only subtraction. */
import type { BookkeepingBook, BookKind, LedgerAccountType, LedgerDirection, LedgerSource } from "@/types/database"

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
```

Note: if `BookKind` is not exported from `@/types/database`, use `BookkeepingBook["book_kind"]` instead — check the actual export first.

- [ ] **Step 4: Run to verify pass** — all green.
- [ ] **Step 5: Commit** — `git add lib/bookkeeping/reports.ts __tests__/lib/bookkeeping/reports.test.ts && git commit -m "feat(bookkeeper): pure report aggregators (income-by-service, P&L, per-book)"`

---

### Task 3: Pure QuickBooks CSV builder — `lib/bookkeeping/quickbooks-csv.ts`

**Files:**
- Create: `lib/bookkeeping/quickbooks-csv.ts`
- Test: `__tests__/lib/bookkeeping/quickbooks-csv.test.ts`

**Interfaces:**
- Consumes: `ReportEntry`, `ReportAccount` from Task 2; `csvDocument` from `@/lib/csv/serialize`.
- Produces: `centsToDecimalString(cents: number): string`; `toQuickBooksDate(occurredOn: string): string`; `buildQuickBooksCsv(entries: ReportEntry[], accounts: ReportAccount[]): string`. Consumed by Task 6 route.

- [ ] **Step 1: Write the failing test**:

```ts
import { describe, it, expect } from "vitest"
import { centsToDecimalString, toQuickBooksDate, buildQuickBooksCsv } from "@/lib/bookkeeping/quickbooks-csv"
import type { ReportEntry, ReportAccount } from "@/lib/bookkeeping/reports"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC = "a0000000-0000-4000-8000-000000000001"
const accounts: ReportAccount[] = [
  { id: ACC, book_id: BOOK, name: "Equipment", account_type: "expense", service_line: null, tax_category: null, sort_order: 0 },
]
function entry(over: Partial<ReportEntry>): ReportEntry {
  return {
    book_id: BOOK, account_id: ACC, direction: "expense", amount_cents: 150000,
    occurred_on: "2026-07-05", counterparty: "Rogue Fitness", memo: "squat rack", source: "receipt", ...over,
  }
}

describe("centsToDecimalString", () => {
  it.each([[0, "0.00"], [1, "0.01"], [99, "0.99"], [100, "1.00"], [123456, "1234.56"], [150200, "1502.00"]])(
    "%i → %s", (cents, s) => expect(centsToDecimalString(cents)).toBe(s))
  it("throws on negatives and non-integers (defensive — DB CHECK enforces ≥ 0)", () => {
    expect(() => centsToDecimalString(-1)).toThrow()
    expect(() => centsToDecimalString(1.5)).toThrow()
  })
})

describe("toQuickBooksDate", () => {
  it("YYYY-MM-DD → MM/DD/YYYY", () => expect(toQuickBooksDate("2026-07-05")).toBe("07/05/2026"))
})

describe("buildQuickBooksCsv", () => {
  it("emits the 4-column header and routes amounts by direction (blank, not 0, in the unused column)", () => {
    const csv = buildQuickBooksCsv([
      entry({}),
      entry({ direction: "income", amount_cents: 5000, counterparty: "Client A", memo: null, occurred_on: "2026-07-06" }),
    ], accounts)
    const lines = csv.split("\r\n")
    expect(lines[0]).toBe("Date,Description,Credit,Debit")
    expect(lines[1]).toBe("07/05/2026,Rogue Fitness — squat rack,,1500.00")
    expect(lines[2]).toBe("07/06/2026,Client A,50.00,")
    expect(lines).toHaveLength(3) // no trailing newline
  })
  it("orders rows by occurred_on ascending", () => {
    const csv = buildQuickBooksCsv([entry({ occurred_on: "2026-07-09" }), entry({ occurred_on: "2026-07-01" })], accounts)
    const lines = csv.split("\r\n")
    expect(lines[1].startsWith("07/01/2026")).toBe(true)
    expect(lines[2].startsWith("07/09/2026")).toBe(true)
  })
  it("description falls back counterparty+memo → account name → 'Ledger entry'", () => {
    const csv = buildQuickBooksCsv([
      entry({ counterparty: null, memo: null }),                       // → account name
      entry({ counterparty: null, memo: null, account_id: null }),     // → Ledger entry
    ], accounts)
    const lines = csv.split("\r\n")
    expect(lines[1]).toContain("Equipment")
    expect(lines[2]).toContain("Ledger entry")
  })
  it("CSV-injection: leading = + - @ in text fields are apostrophe-prefixed; amounts stay clean", () => {
    const csv = buildQuickBooksCsv([
      entry({ counterparty: "=cmd()", memo: null }),
      entry({ counterparty: "+1 555 0100", memo: null }),
      entry({ counterparty: "-lead", memo: null }),
      entry({ counterparty: "@handle", memo: null }),
    ], accounts)
    const lines = csv.split("\r\n")
    expect(lines[1]).toContain("'=cmd()")
    expect(lines[2]).toContain("'+1 555 0100")
    expect(lines[3]).toContain("'-lead")
    expect(lines[4]).toContain("'@handle")
    for (const l of lines.slice(1)) expect(l.endsWith("1500.00")).toBe(true) // Debit column unprefixed
  })
  it("empty entry list → header only", () => {
    expect(buildQuickBooksCsv([], accounts)).toBe("Date,Description,Credit,Debit")
  })
})
```

- [ ] **Step 2: Run to verify failure** — module missing.
- [ ] **Step 3: Implement** — `lib/bookkeeping/quickbooks-csv.ts`:

```ts
/** QuickBooks Online 4-column bank-transaction CSV (D8, spec §3.2):
 *  header Date,Description,Credit,Debit — Credit = money in (income),
 *  Debit = money out (expense), amounts positive two-decimal, dates
 *  MM/DD/YYYY, blank (not 0) in the unused column. The 4-column shape is
 *  deliberate: the 3-column shape needs signed amounts, and csvCell's
 *  injection defense would corrupt a leading "-" string. Full export
 *  always — QBO's 1,000-line upload cap is a UI hint, never a truncation. */
import { csvDocument } from "@/lib/csv/serialize"
import type { ReportAccount, ReportEntry } from "@/lib/bookkeeping/reports"

export function centsToDecimalString(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`centsToDecimalString expects a non-negative integer, got ${cents}`)
  }
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`
}

export function toQuickBooksDate(occurredOn: string): string {
  return `${occurredOn.slice(5, 7)}/${occurredOn.slice(8, 10)}/${occurredOn.slice(0, 4)}`
}

export function buildQuickBooksCsv(entries: ReportEntry[], accounts: ReportAccount[]): string {
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const rows: Array<Array<string | null>> = [["Date", "Description", "Credit", "Debit"]]
  const sorted = [...entries].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on))
  for (const e of sorted) {
    const account = e.account_id ? accountById.get(e.account_id) : undefined
    const description = [e.counterparty, e.memo].filter(Boolean).join(" — ") || account?.name || "Ledger entry"
    const amount = centsToDecimalString(e.amount_cents)
    rows.push([
      toQuickBooksDate(e.occurred_on),
      description,
      e.direction === "income" ? amount : null,
      e.direction === "expense" ? amount : null,
    ])
  }
  return csvDocument(rows)
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(bookkeeper): QuickBooks 4-column CSV builder (injection-defended)"`

---

### Task 4: DAL report readers + validators + audit slug + server bundle

**Files:**
- Modify: `lib/db/bookkeeping.ts` (append new readers at the end)
- Modify: `lib/validators/bookkeeping.ts` (append schemas)
- Modify: `lib/audit/actions.ts` (add one row to the `// bookkeeping` block, after `bookkeeping.receipt_imported`)
- Create: `lib/bookkeeping/report-data.ts` (server-side fetch bundle shared by 3 routes + print page)
- Test: `__tests__/lib/bookkeeping/report-validators.test.ts`

**Interfaces:**
- Consumes: `fetchAllRows` from `@/lib/db/paginate`; `ReportEntry`/`ReportAccount` types from Task 2.
- Produces:
  - `listEntriesForReports(from: string, to: string, bookId?: string): Promise<ReportEntry[]>`
  - `listAccountsForReports(): Promise<ReportAccount[]>` — **includes archived accounts** (entries keep `account_id` after archival; filtering would re-bucket real money as Uncategorized)
  - `listAllDocuments(): Promise<BookkeepingDocument[]>`
  - `reportQuerySchema` (`{ from, to }`), `quickbooksQuerySchema` (`{ from, to, book_id }`) — both refine `from <= to` and ≤ 5-year window
  - audit slug `bookkeeping.report_exported` (category `admin_read_sensitive`)
  - `loadReportBundle(from: string, to: string): Promise<{ books: BookkeepingBook[]; accounts: ReportAccount[]; entries: ReportEntry[] }>`

- [ ] **Step 1: Write the failing validator test** — `__tests__/lib/bookkeeping/report-validators.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { reportQuerySchema, quickbooksQuerySchema } from "@/lib/validators/bookkeeping"

describe("reportQuerySchema", () => {
  it("accepts a sane window", () => {
    expect(reportQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true)
  })
  it("rejects from > to", () => {
    expect(reportQuerySchema.safeParse({ from: "2026-02-01", to: "2026-01-01" }).success).toBe(false)
  })
  it("rejects a window over 5 years", () => {
    expect(reportQuerySchema.safeParse({ from: "2020-01-01", to: "2026-01-02" }).success).toBe(false)
  })
  it("rejects malformed dates", () => {
    expect(reportQuerySchema.safeParse({ from: "01/01/2026", to: "2026-12-31" }).success).toBe(false)
  })
})

describe("quickbooksQuerySchema", () => {
  it("requires a UUID book_id", () => {
    expect(quickbooksQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(false)
    expect(quickbooksQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31", book_id: "nope" }).success).toBe(false)
    expect(quickbooksQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31", book_id: "b0000000-0000-4000-8000-000000000001" }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure** — schemas not exported.
- [ ] **Step 3: Implement.**

Append to `lib/validators/bookkeeping.ts`:

```ts
const withinFiveYears = (v: { from: string; to: string }) =>
  Number(v.to.slice(0, 4)) - Number(v.from.slice(0, 4)) <= 5

export const reportQuerySchema = z.object({ from: DATE, to: DATE })
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" })
  .refine(withinFiveYears, { message: "window too large (max 5 years)" })

export const quickbooksQuerySchema = z.object({ from: DATE, to: DATE, book_id: z.string().uuid() })
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" })
  .refine(withinFiveYears, { message: "window too large (max 5 years)" })
```

Append to `lib/db/bookkeeping.ts` (imports at top: add `type ReportEntry, type ReportAccount` from `@/lib/bookkeeping/reports` — type-only, no runtime cycle):

```ts
/** Slim windowed ledger read for reports. fetchAllRows-paginated (a year can
 *  exceed the ~1000-row PostgREST cap); deterministic order for stable pages. */
export async function listEntriesForReports(from: string, to: string, bookId?: string): Promise<ReportEntry[]> {
  return fetchAllRows<ReportEntry>((f, t) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db()
      .from("bookkeeping_ledger_entries")
      .select("book_id,account_id,direction,amount_cents,occurred_on,counterparty,memo,source")
      .gte("occurred_on", from)
      .lte("occurred_on", to)
    if (bookId) q = q.eq("book_id", bookId)
    return q.order("occurred_on", { ascending: true }).order("id", { ascending: true }).range(f, t) as never
  })
}

/** ALL accounts across books, INCLUDING archived — report grouping must keep
 *  archived accounts joinable or their historical entries re-bucket as
 *  Uncategorized (a wrong report). Small coach-managed table (~25 rows). */
export async function listAccountsForReports(): Promise<ReportAccount[]> {
  const { data, error } = await db()
    .from("bookkeeping_accounts")
    .select("id,book_id,name,account_type,service_line,tax_category,sort_order")
    .order("book_id", { ascending: true })
    .order("sort_order", { ascending: true })
  if (error) throw error
  return (data ?? []) as ReportAccount[]
}

/** Every document across books for the pack's Document Index (paginated — grows). */
export async function listAllDocuments(): Promise<BookkeepingDocument[]> {
  return fetchAllRows<BookkeepingDocument>((f, t) =>
    db()
      .from("bookkeeping_documents")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(f, t) as never
  )
}
```

Create `lib/bookkeeping/report-data.ts`:

```ts
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
```

Add to `lib/audit/actions.ts` in the `// bookkeeping` block (after the `bookkeeping.receipt_imported` row):

```ts
  { slug: "bookkeeping.report_exported", category: "admin_read_sensitive", description: "Bookkeeping report exported" },
```

- [ ] **Step 4: Run** `npx vitest run __tests__/lib/bookkeeping/report-validators.test.ts` → PASS, and `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "lib/(db|bookkeeping|validators|audit)"` → no NEW errors in touched files.
- [ ] **Step 5: Commit** — `git commit -m "feat(bookkeeper): report DAL readers, query validators, export audit slug, report bundle"`

---

### Task 5: Reports JSON API — `app/api/admin/bookkeeping/reports/route.ts`

**Files:**
- Create: `app/api/admin/bookkeeping/reports/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/reports.test.ts`

**Interfaces:**
- Consumes: `loadReportBundle` (Task 4), aggregators (Task 2), `reportQuerySchema` (Task 4).
- Produces (Task 9's ReportsClient consumes this JSON):

```ts
{ from, to, books: Array<{
    book: { id: string; name: string; book_kind: BookKind; is_primary: boolean; currency: string }
    summary: BookSummaryRow
    income_by_service: IncomeByServiceLine
    pnl: ProfitAndLoss
    row_count: number
}> }
```

- [ ] **Step 1: Write the failing test**:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/bookkeeping/report-data", () => ({ loadReportBundle: vi.fn() }))

import { auth } from "@/lib/auth"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { GET } from "@/app/api/admin/bookkeeping/reports/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const BOOK = "b0000000-0000-4000-8000-000000000001"
const admin = { user: { id: UUID, role: "admin" } }
const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/reports?${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue({
    books: [{ id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, currency: "usd", sort_order: 0 }],
    accounts: [],
    entries: [
      { book_id: BOOK, account_id: null, direction: "income", amount_cents: 1500, occurred_on: "2026-07-02", counterparty: null, memo: null, source: "manual" },
      { book_id: BOOK, account_id: null, direction: "expense", amount_cents: 400, occurred_on: "2026-07-03", counterparty: null, memo: null, source: "manual" },
    ],
  })
})

describe("GET /api/admin/bookkeeping/reports", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "client" } })
    const res = await GET(req("from=2026-07-01&to=2026-07-31"))
    expect(res.status).toBe(403)
  })
  it("400 on a bad window", async () => {
    expect((await GET(req("from=2026-08-01&to=2026-07-01"))).status).toBe(400)
    expect((await GET(req("to=2026-07-31"))).status).toBe(400)
  })
  it("aggregates per book and reports row_count", async () => {
    const res = await GET(req("from=2026-07-01&to=2026-07-31"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.books).toHaveLength(1)
    expect(body.books[0].summary).toMatchObject({ income_cents: 1500, expense_cents: 400, net_cents: 1100, entry_count: 2 })
    expect(body.books[0].row_count).toBe(2)
    expect(body.books[0].pnl.net_cents).toBe(1100)
    expect(loadReportBundle).toHaveBeenCalledWith("2026-07-01", "2026-07-31")
  })
})
```

- [ ] **Step 2: Run to verify failure** — route module missing.
- [ ] **Step 3: Implement**:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { reportQuerySchema } from "@/lib/validators/bookkeeping"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { incomeByServiceLine, profitAndLossByCategory, perBookSummary } from "@/lib/bookkeeping/reports"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const sp = new URL(request.url).searchParams
    const parsed = reportQuerySchema.safeParse({ from: sp.get("from"), to: sp.get("to") })
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { from, to } = parsed.data

    const { books, accounts, entries } = await loadReportBundle(from, to)
    const summaries = perBookSummary(entries, books)
    const payload = books.map((book) => {
      const bookEntries = entries.filter((e) => e.book_id === book.id)
      return {
        book: { id: book.id, name: book.name, book_kind: book.book_kind, is_primary: book.is_primary, currency: book.currency },
        summary: summaries.find((s) => s.book_id === book.id)!,
        income_by_service: incomeByServiceLine(bookEntries, accounts),
        pnl: profitAndLossByCategory(bookEntries, accounts),
        row_count: bookEntries.length,
      }
    })
    return NextResponse.json({ from, to, books: payload })
  } catch (error) {
    console.error("Bookkeeping reports error:", error)
    return NextResponse.json({ error: "Failed to build report" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(bookkeeper): reports JSON API (per-book aggregates over one windowed read)"`

---

### Task 6: QuickBooks CSV route — `app/api/admin/bookkeeping/reports/quickbooks-csv/route.ts`

**Files:**
- Create: `app/api/admin/bookkeeping/reports/quickbooks-csv/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/reports-quickbooks-csv.test.ts`

**Interfaces:**
- Consumes: `quickbooksQuerySchema`, DAL `getBook`/`listEntriesForReports`/`listAccountsForReports`, `buildQuickBooksCsv` (Task 3), `recordAudit`.

- [ ] **Step 1: Write the failing test**:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  getBook: vi.fn(), listEntriesForReports: vi.fn(), listAccountsForReports: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { getBook, listEntriesForReports, listAccountsForReports } from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import { GET } from "@/app/api/admin/bookkeeping/reports/quickbooks-csv/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const BOOK = "b0000000-0000-4000-8000-000000000001"
const admin = { user: { id: UUID, role: "admin" } }
const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/reports/quickbooks-csv?${qs}`)
const okQs = `book_id=${BOOK}&from=2026-07-01&to=2026-07-31`

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BOOK, name: "Darren — DJP Athlete" })
  ;(listAccountsForReports as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(listEntriesForReports as ReturnType<typeof vi.fn>).mockResolvedValue([
    { book_id: BOOK, account_id: null, direction: "income", amount_cents: 5000, occurred_on: "2026-07-02", counterparty: "Client A", memo: null, source: "manual" },
  ])
})

describe("GET /api/admin/bookkeeping/reports/quickbooks-csv", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req(okQs))).status).toBe(403)
  })
  it("400 without book_id", async () => {
    expect((await GET(req("from=2026-07-01&to=2026-07-31"))).status).toBe(400)
  })
  it("404 on unknown book", async () => {
    ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req(okQs))).status).toBe(404)
  })
  it("streams a CSV attachment with the 4-column header, scoped to the book", async () => {
    const res = await GET(req(okQs))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="quickbooks-')
    expect(res.headers.get("cache-control")).toBe("no-store")
    const text = await res.text()
    expect(text.split("\r\n")[0]).toBe("Date,Description,Credit,Debit")
    expect(text).toContain("07/02/2026,Client A,50.00,")
    expect(listEntriesForReports).toHaveBeenCalledWith("2026-07-01", "2026-07-31", BOOK)
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.report_exported",
      category: "admin_read_sensitive",
      metadata: expect.objectContaining({ format: "quickbooks_csv", row_count: 1 }),
    }))
  })
})
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { quickbooksQuerySchema } from "@/lib/validators/bookkeeping"
import { getBook, listEntriesForReports, listAccountsForReports } from "@/lib/db/bookkeeping"
import { buildQuickBooksCsv } from "@/lib/bookkeeping/quickbooks-csv"
import { recordAudit } from "@/lib/audit/record"

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "book"
}

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const sp = new URL(request.url).searchParams
    const parsed = quickbooksQuerySchema.safeParse({ from: sp.get("from"), to: sp.get("to"), book_id: sp.get("book_id") })
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { from, to, book_id } = parsed.data

    const book = await getBook(book_id)
    if (!book) return NextResponse.json({ error: "book not found" }, { status: 404 })

    const [entries, accounts] = await Promise.all([
      listEntriesForReports(from, to, book_id),
      listAccountsForReports(),
    ])
    const csv = buildQuickBooksCsv(entries, accounts)

    void recordAudit({
      action: "bookkeeping.report_exported", category: "admin_read_sensitive", outcome: "success",
      target: { type: "bookkeeping_book", id: book_id, label: book.name },
      metadata: { format: "quickbooks_csv", book_id, from, to, row_count: entries.length }, request,
    })
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="quickbooks-${slugify(book.name)}-${from}-${to}.csv"`,
        "cache-control": "no-store",
      },
    })
  } catch (error) {
    console.error("QuickBooks CSV export error:", error)
    return NextResponse.json({ error: "Failed to build export" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(bookkeeper): QuickBooks CSV download route (audited, no flag — D10 self-download)"`

---

### Task 7: Accountant pack builder — `lib/bookkeeping/accountant-pack.ts`

**Files:**
- Create: `lib/bookkeeping/accountant-pack.ts`
- Test: `__tests__/lib/bookkeeping/accountant-pack.test.ts`

**Interfaces:**
- Consumes: aggregators + types (Task 2), `formatCents`, exceljs, `BookkeepingBook`/`BookkeepingDocument`.
- Produces: `sanitizeSheetName(name: string): string`; `buildAccountantPack(input: AccountantPackInput): Promise<Buffer>` with

```ts
export interface AccountantPackInput {
  from: string
  to: string
  books: BookkeepingBook[]
  accounts: ReportAccount[]
  entries: ReportEntry[]
  documents: BookkeepingDocument[]
}
```

- [ ] **Step 1: Write the failing test** (build → load back with exceljs → assert):

```ts
import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { buildAccountantPack, sanitizeSheetName } from "@/lib/bookkeeping/accountant-pack"
import type { ReportEntry, ReportAccount } from "@/lib/bookkeeping/reports"
import type { BookkeepingBook, BookkeepingDocument } from "@/types/database"

const B1 = "b0000000-0000-4000-8000-000000000001"
const B2 = "b0000000-0000-4000-8000-000000000002"
const B3 = "b0000000-0000-4000-8000-000000000003"
const ACC = "a0000000-0000-4000-8000-000000000001"

const books = [
  { id: B1, name: "Darren — DJP Athlete", book_kind: "business", owner_label: "Darren", is_primary: true, currency: "usd", sort_order: 0 },
  { id: B2, name: "Spouse — Business", book_kind: "business", owner_label: "Spouse", is_primary: false, currency: "usd", sort_order: 1 },
  { id: B3, name: "Household & Personal", book_kind: "household", owner_label: "Household", is_primary: false, currency: "usd", sort_order: 2 },
] as BookkeepingBook[]

const accounts: ReportAccount[] = [
  { id: ACC, book_id: B1, name: "Session Packs", account_type: "income", service_line: "session_packs", tax_category: null, sort_order: 0 },
]

const entries: ReportEntry[] = [
  { book_id: B1, account_id: ACC, direction: "income", amount_cents: 150200, occurred_on: "2026-07-02", counterparty: "Client A", memo: null, source: "platform_import" },
  { book_id: B3, account_id: null, direction: "expense", amount_cents: 120000, occurred_on: "2026-07-03", counterparty: "Landlord", memo: "July rent", source: "statement_import" },
]

const documents = [
  { id: "d0000000-0000-4000-8000-000000000001", book_id: B1, kind: "receipt", original_filename: "hd-receipt.jpg", storage_path: "x", mime_type: "image/jpeg", file_size_bytes: 1, sha256: null, retain_until: "2033-12-31", uploaded_by: null, import_batch_id: null, row_count: null, posted_count: 1, period_start: null, period_end: null, created_at: "2026-07-03T00:00:00Z", updated_at: "2026-07-03T00:00:00Z" },
] as BookkeepingDocument[]

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as never)
  return wb
}

describe("sanitizeSheetName", () => {
  it("strips Excel-forbidden chars and caps at 31", () => {
    expect(sanitizeSheetName("P&L: a/very[long]name?*that\\keeps//going and going")).toHaveLength(31)
    expect(sanitizeSheetName("a:b")).not.toContain(":")
    expect(sanitizeSheetName("   ")).toBe("Sheet")
  })
})

describe("buildAccountantPack", () => {
  it("builds the expected tabs with formatCents money and the honesty sheet", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents })
    const wb = await load(buf)
    const names = wb.worksheets.map((w) => w.name)
    expect(names).toEqual([
      "Read Me", "Summary", "Income by Service",
      "P&L — Darren", "P&L — Spouse", "P&L — Household", "Documents",
    ])
    const summary = wb.getWorksheet("Summary")!
    // header + 3 book rows
    expect(summary.actualRowCount).toBe(4)
    expect(String(summary.getRow(2).getCell(3).value)).toBe("$1,502.00") // Darren income
    const readme = wb.getWorksheet("Read Me")!
    const readmeText = JSON.stringify(readme.getSheetValues())
    expect(readmeText).toContain("GROSS")
    expect(readmeText).toContain("CPA")
  })
  it("spouse sheet carries the explicit empty note when the book has no entries", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents })
    const wb = await load(buf)
    const spouse = wb.getWorksheet("P&L — Spouse")!
    expect(JSON.stringify(spouse.getSheetValues())).toContain("No entries recorded for this period")
  })
  it("document index lists every document with a download ref", async () => {
    const buf = await buildAccountantPack({ from: "2026-07-01", to: "2026-07-31", books, accounts, entries, documents })
    const wb = await load(buf)
    const docs = wb.getWorksheet("Documents")!
    const text = JSON.stringify(docs.getSheetValues())
    expect(text).toContain("hd-receipt.jpg")
    expect(text).toContain("/api/admin/bookkeeping/documents/d0000000-0000-4000-8000-000000000001/download")
  })
})
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — `lib/bookkeeping/accountant-pack.ts` (server-only; exceljs):

```ts
/** Accountant pack workbook (D9): one .xlsx, a tab per question the
 *  accountant asks. Zero IO — the route fetches and passes plain arrays.
 *  All money renders as formatCents strings (spec §3.7 — no float cells).
 *  Styling follows the lib/excel-templates.ts ARGB conventions. */
import ExcelJS from "exceljs"
import { formatCents } from "@/lib/bookkeeping/money"
import {
  incomeByServiceLine, profitAndLossByCategory, perBookSummary,
  type ReportAccount, type ReportEntry,
} from "@/lib/bookkeeping/reports"
import type { BookkeepingBook, BookkeepingDocument } from "@/types/database"

export interface AccountantPackInput {
  from: string
  to: string
  books: BookkeepingBook[]
  accounts: ReportAccount[]
  entries: ReportEntry[]
  documents: BookkeepingDocument[]
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E3F50" } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }
const THIN = { style: "thin" as const, color: { argb: "FFE5E7EB" } }
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const TAB_PRIMARY = "FF0E3F50"
const TAB_ACCENT = "FFC49B7A"
const TAB_GRAY = "FF6B7280"
const DOWNLOAD_BASE = "https://www.darrenjpaul.com"

export function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*\[\]]/g, " ").replace(/\s+/g, " ").trim()
  return (cleaned || "Sheet").slice(0, 31)
}

function addSheet(wb: ExcelJS.Workbook, name: string, tabColor: string, used: Set<string>): ExcelJS.Worksheet {
  let candidate = sanitizeSheetName(name)
  let n = 2
  while (used.has(candidate.toLowerCase())) candidate = sanitizeSheetName(`${candidate.slice(0, 27)} (${n++})`)
  used.add(candidate.toLowerCase())
  return wb.addWorksheet(candidate, { properties: { tabColor: { argb: tabColor } } })
}

function headerRow(sheet: ExcelJS.Worksheet, headers: string[], widths: number[]) {
  sheet.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: widths[i] }))
  const row = sheet.getRow(1)
  row.height = 24
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: "middle", horizontal: "left" }
    cell.border = BORDER
  })
  sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }]
}

function noteRow(sheet: ExcelJS.Worksheet, text: string) {
  const row = sheet.addRow([text])
  row.getCell(1).font = { italic: true, color: { argb: "FF6B7280" }, size: 10 }
}

/** P&L tab for one book. Renders the §3.4 empty note when the book has no entries. */
function addPnlSheet(wb: ExcelJS.Workbook, used: Set<string>, book: BookkeepingBook, entries: ReportEntry[], accounts: ReportAccount[]) {
  const sheet = addSheet(wb, `P&L — ${book.owner_label ?? book.name}`, book.is_primary ? TAB_PRIMARY : TAB_ACCENT, used)
  headerRow(sheet, ["Category", "Tax hint", "Entries", "Total"], [36, 24, 10, 16])
  if (entries.length === 0) {
    noteRow(sheet, "No entries recorded for this period. This book exists to keep its finances separate — if it has no activity, it stays empty by design.")
    return
  }
  const pnl = profitAndLossByCategory(entries, accounts)
  const section = (title: string, rows: typeof pnl.income, totalLabel: string, totalCents: number) => {
    const t = sheet.addRow([title])
    t.getCell(1).font = { bold: true, size: 11 }
    for (const r of rows) sheet.addRow([r.name, r.tax_category ?? "", r.entry_count, formatCents(r.total_cents)])
    const tot = sheet.addRow([totalLabel, "", "", formatCents(totalCents)])
    tot.eachCell((c) => { c.font = { bold: true } })
  }
  section("INCOME", pnl.income, "Total income", pnl.income_total_cents)
  sheet.addRow([])
  section("EXPENSES", pnl.expense, "Total expenses", pnl.expense_total_cents)
  sheet.addRow([])
  const net = sheet.addRow(["NET (gross income − expenses)", "", "", formatCents(pnl.net_cents)])
  net.eachCell((c) => { c.font = { bold: true, size: 12 } })
}

export async function buildAccountantPack(input: AccountantPackInput): Promise<Buffer> {
  const { from, to, books, accounts, entries, documents } = input
  const wb = new ExcelJS.Workbook()
  wb.creator = "DJP Athlete"
  const used = new Set<string>()

  // 1. Read Me — the honesty sheet
  const readme = addSheet(wb, "Read Me", TAB_GRAY, used)
  readme.columns = [{ header: "", key: "c0", width: 110 }]
  const lines = [
    `DJP Athlete — Accountant Pack`,
    `Period: ${from} to ${to} (occurred-on dates, inclusive)`,
    ``,
    `ALL FIGURES ARE GROSS — Stripe fees and payouts are not netted (they arrive in a later phase).`,
    `Every number here is an ESTIMATE for planning. The CPA files; nothing in this workbook is a filed return.`,
    `This pack is a CANDIDATE for the accountant's review — categories were coach-confirmed but not accountant-confirmed.`,
    `Business and personal finances live in SEPARATE books; no sheet mixes them into one total.`,
    `Tax hints are the coach's free-text notes per category (e.g. "Schedule C Line 22") — the product never invents a tax line.`,
  ]
  for (const l of lines) readme.addRow([l])
  readme.getRow(1).font = { bold: true, size: 14 }

  // 2. Summary — one row per book, NO cross-book grand total (separation principle)
  const summary = addSheet(wb, "Summary", TAB_PRIMARY, used)
  headerRow(summary, ["Book", "Kind", "Income", "Expenses", "Net", "Entries"], [30, 12, 16, 16, 16, 10])
  for (const s of perBookSummary(entries, books)) {
    summary.addRow([s.name, s.book_kind, formatCents(s.income_cents), formatCents(s.expense_cents), formatCents(s.net_cents), s.entry_count])
  }

  // 3. Income by Service — primary book
  const primary = books.find((b) => b.is_primary) ?? books[0]
  const svc = addSheet(wb, "Income by Service", TAB_PRIMARY, used)
  headerRow(svc, ["Service line", "Entries", "Total"], [32, 10, 16])
  if (primary) {
    const ibs = incomeByServiceLine(entries.filter((e) => e.book_id === primary.id), accounts)
    for (const r of ibs.rows) svc.addRow([r.label, r.entry_count, formatCents(r.total_cents)])
    const tot = svc.addRow(["Total gross income", "", formatCents(ibs.total_cents)])
    tot.eachCell((c) => { c.font = { bold: true } })
  }

  // 4-6. P&L per book (primary, spouse, household — driven by the books list)
  for (const book of books) {
    addPnlSheet(wb, used, book, entries.filter((e) => e.book_id === book.id), accounts)
  }

  // 7. Document Index
  const docs = addSheet(wb, "Documents", TAB_GRAY, used)
  headerRow(docs, ["Book", "Kind", "Filename", "Period", "Uploaded", "Posted entries", "Download (admin login required)"], [26, 10, 32, 22, 12, 14, 70])
  const bookName = new Map(books.map((b) => [b.id, b.name]))
  for (const d of documents) {
    const period = d.period_start && d.period_end ? `${d.period_start} – ${d.period_end}` : ""
    docs.addRow([
      bookName.get(d.book_id) ?? d.book_id, d.kind, d.original_filename ?? "", period,
      (d.created_at ?? "").slice(0, 10), d.posted_count ?? 0,
      `${DOWNLOAD_BASE}/api/admin/bookkeeping/documents/${d.id}/download`,
    ])
  }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run __tests__/lib/bookkeeping/accountant-pack.test.ts`.
- [ ] **Step 5: Commit** — `git commit -m "feat(bookkeeper): accountant pack workbook builder (exceljs, tab-per-question)"`

---

### Task 8: Accountant pack route — `app/api/admin/bookkeeping/reports/accountant-pack/route.ts`

**Files:**
- Create: `app/api/admin/bookkeeping/reports/accountant-pack/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/reports-accountant-pack.test.ts`

**Interfaces:**
- Consumes: `reportQuerySchema`, `loadReportBundle`, `listAllDocuments`, `buildAccountantPack`, `recordAudit`.

- [ ] **Step 1: Write the failing test**:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/bookkeeping/report-data", () => ({ loadReportBundle: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({ listAllDocuments: vi.fn() }))
vi.mock("@/lib/bookkeeping/accountant-pack", () => ({ buildAccountantPack: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { recordAudit } from "@/lib/audit/record"
import { GET } from "@/app/api/admin/bookkeeping/reports/accountant-pack/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const admin = { user: { id: UUID, role: "admin" } }
const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/reports/accountant-pack?${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue({ books: [], accounts: [], entries: [] })
  ;(listAllDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(buildAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("xlsx-bytes"))
})

describe("GET /api/admin/bookkeeping/reports/accountant-pack", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(403)
  })
  it("400 on a bad window", async () => {
    expect((await GET(req("from=2026-12-31&to=2026-01-01"))).status).toBe(400)
  })
  it("streams the xlsx with attachment headers and audits the export", async () => {
    const res = await GET(req("from=2026-01-01&to=2026-12-31"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="djp-accountant-pack-2026-01-01-2026-12-31.xlsx"')
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(buildAccountantPack).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-01-01", to: "2026-12-31" }))
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.report_exported",
      metadata: expect.objectContaining({ format: "accountant_pack_xlsx" }),
    }))
  })
})
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { reportQuerySchema } from "@/lib/validators/bookkeeping"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { recordAudit } from "@/lib/audit/record"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const sp = new URL(request.url).searchParams
    const parsed = reportQuerySchema.safeParse({ from: sp.get("from"), to: sp.get("to") })
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { from, to } = parsed.data

    const [{ books, accounts, entries }, documents] = await Promise.all([loadReportBundle(from, to), listAllDocuments()])
    const buf = await buildAccountantPack({ from, to, books, accounts, entries, documents })

    void recordAudit({
      action: "bookkeeping.report_exported", category: "admin_read_sensitive", outcome: "success",
      metadata: { format: "accountant_pack_xlsx", from, to, entry_count: entries.length, document_count: documents.length }, request,
    })
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="djp-accountant-pack-${from}-${to}.xlsx"`,
        "cache-control": "no-store",
      },
    })
  } catch (error) {
    console.error("Accountant pack export error:", error)
    return NextResponse.json({ error: "Failed to build accountant pack" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(bookkeeper): accountant pack xlsx download route"`

---

### Task 9: Reports UI — page + `ReportsClient` + BooksClient link

**Files:**
- Create: `app/(admin)/admin/books/reports/page.tsx`
- Create: `components/admin/bookkeeping/ReportsClient.tsx`
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (toolbar — ONE link added directly before the "Manage categories" Link, lines ~245-250)

**Interfaces:**
- Consumes: Task 5's JSON shape, `presetRange`/`PERIOD_PRESET_LABELS` (Task 1), `formatCents`, `EmptyState`, shadcn `Tabs`, `Button`.

- [ ] **Step 1: Server page** — `app/(admin)/admin/books/reports/page.tsx` (accounts-page precedent; no client fetch needed for books):

```tsx
import { listBooks } from "@/lib/db/bookkeeping"
import { ReportsClient } from "@/components/admin/bookkeeping/ReportsClient"

export const metadata = { title: "Reports — Books — Admin" }

export default async function BooksReportsPage() {
  const books = await listBooks()
  return <ReportsClient books={books} />
}
```

- [ ] **Step 2: ReportsClient** — `components/admin/bookkeeping/ReportsClient.tsx`. Follow BooksClient idioms exactly: native selects/date inputs with the same classNames, `fetchRequestIdRef` stale guard, `toast.error`, shadcn Tabs one-trigger-per-book, `formatCents`. Full component:

```tsx
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { BarChart3, Download, FileSpreadsheet, Printer } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCents } from "@/lib/bookkeeping/money"
import { presetRange, PERIOD_PRESET_LABELS, type PeriodPreset } from "@/lib/bookkeeping/period"
import type { BookkeepingBook } from "@/types/database"
import type { IncomeByServiceLine, ProfitAndLoss, BookSummaryRow } from "@/lib/bookkeeping/reports"

interface BookReport {
  book: { id: string; name: string; book_kind: string; is_primary: boolean; currency: string }
  summary: BookSummaryRow
  income_by_service: IncomeByServiceLine
  pnl: ProfitAndLoss
  row_count: number
}
interface ReportData { from: string; to: string; books: BookReport[] }

const QBO_LINE_CAP = 1000

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ReportsClient({ books }: { books: BookkeepingBook[] }) {
  const initial = presetRange("this_year", todayIso())
  const [preset, setPreset] = useState<PeriodPreset | "custom">("this_year")
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [bookId, setBookId] = useState(books.find((b) => b.is_primary)?.id ?? books[0]?.id ?? "")
  const fetchRequestIdRef = useRef(0)

  const fetchReport = useCallback(async () => {
    const requestId = ++fetchRequestIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetch(`/api/admin/bookkeeping/reports?${params.toString()}`)
      if (!res.ok) throw new Error("failed")
      const body = (await res.json()) as ReportData
      if (requestId === fetchRequestIdRef.current) setData(body)
    } catch {
      if (requestId === fetchRequestIdRef.current) toast.error("Failed to load the report")
    } finally {
      if (requestId === fetchRequestIdRef.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void fetchReport()
  }, [fetchReport])

  const applyPreset = (value: string) => {
    if (value === "custom") { setPreset("custom"); return }
    const p = value as PeriodPreset
    const range = presetRange(p, todayIso())
    setPreset(p)
    setFrom(range.from)
    setTo(range.to)
  }

  if (books.length === 0) {
    return <EmptyState icon={BarChart3} heading="No books configured" description="No bookkeeping books exist yet. Seed the business book to get started." />
  }

  const totalEntries = data?.books.reduce((n, b) => n + b.row_count, 0) ?? 0
  const active = data?.books.find((b) => b.book.id === bookId)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading text-primary">Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gross figures from the posted ledger — Stripe fees &amp; payouts land in a later phase. Estimates for planning; your CPA files.
          </p>
        </div>
        <Link href="/admin/books" className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline">
          Back to ledger
        </Link>
      </div>

      {/* Period bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={preset}
          onChange={(e) => applyPreset(e.currentTarget.value)}
          className="border-border rounded-md border px-3 py-2 text-sm"
          aria-label="Period preset"
        >
          {Object.entries(PERIOD_PRESET_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
          <option value="custom">Custom range</option>
        </select>
        <input
          type="date" value={from}
          onChange={(e) => { setPreset("custom"); setFrom(e.currentTarget.value) }}
          className="border-border rounded-md border px-3 py-2 text-sm" aria-label="From date"
        />
        <input
          type="date" value={to}
          onChange={(e) => { setPreset("custom"); setTo(e.currentTarget.value) }}
          className="border-border rounded-md border px-3 py-2 text-sm" aria-label="To date"
        />
      </div>

      {!loading && data && totalEntries === 0 ? (
        <EmptyState
          icon={BarChart3}
          heading="No posted entries in this period"
          description="Reports read the posted ledger. Post platform income, statements, or receipts first — or widen the period."
        />
      ) : (
        <>
          {/* All-books summary */}
          <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
            <h2 className="text-sm font-heading text-primary mb-3">Per-book summary</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="py-1 pr-4 font-medium">Book</th>
                  <th className="py-1 pr-4 font-medium">Income</th>
                  <th className="py-1 pr-4 font-medium">Expenses</th>
                  <th className="py-1 pr-4 font-medium">Net</th>
                  <th className="py-1 pr-4 font-medium">Entries</th>
                </tr>
              </thead>
              <tbody>
                {(data?.books ?? []).map(({ book, summary }) => (
                  <tr key={book.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4">{book.name}</td>
                    <td className="py-1.5 pr-4 text-success">{formatCents(summary.income_cents)}</td>
                    <td className="py-1.5 pr-4 text-error">{formatCents(summary.expense_cents)}</td>
                    <td className={`py-1.5 pr-4 ${summary.net_cents >= 0 ? "text-success" : "text-error"}`}>{formatCents(summary.net_cents)}</td>
                    <td className="py-1.5 pr-4">{summary.entry_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Export row */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" asChild disabled={!active || active.row_count === 0}>
              <a href={`/api/admin/bookkeeping/reports/quickbooks-csv?book_id=${bookId}&from=${from}&to=${to}`}>
                <Download className="size-4" />
                QuickBooks CSV
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/admin/bookkeeping/reports/accountant-pack?from=${from}&to=${to}`}>
                <FileSpreadsheet className="size-4" />
                Accountant pack (.xlsx)
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`/admin/books/reports/print?from=${from}&to=${to}`} target="_blank">
                <Printer className="size-4" />
                Print view
              </a>
            </Button>
            {active && active.row_count > QBO_LINE_CAP ? (
              <p className="text-xs text-warning">
                QuickBooks caps CSV imports at {QBO_LINE_CAP.toLocaleString()} rows — this period has {active.row_count.toLocaleString()}. Consider exporting a shorter period.
              </p>
            ) : null}
          </div>

          {/* Per-book detail */}
          <Tabs value={bookId} onValueChange={setBookId}>
            <TabsList>
              {books.map((book) => (
                <TabsTrigger key={book.id} value={book.id}>{book.name}</TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={bookId} className="space-y-6 mt-4">
              {loading || !active ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  {/* Income by service */}
                  <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                    <h2 className="text-sm font-heading text-primary mb-3">Income by service line</h2>
                    {active.income_by_service.rows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No income in this period.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                            <th className="py-1 pr-4 font-medium">Service line</th>
                            <th className="py-1 pr-4 font-medium">Entries</th>
                            <th className="py-1 pr-4 font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {active.income_by_service.rows.map((r) => (
                            <tr key={r.service_line ?? "uncategorized"} className={`border-b last:border-0 ${r.service_line === null ? "bg-warning/10" : ""}`}>
                              <td className="py-1.5 pr-4">{r.label}</td>
                              <td className="py-1.5 pr-4">{r.entry_count}</td>
                              <td className="py-1.5 pr-4">{formatCents(r.total_cents)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td className="py-1.5 pr-4 font-semibold">Total gross income</td>
                            <td />
                            <td className="py-1.5 pr-4 font-semibold">{formatCents(active.income_by_service.total_cents)}</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* P&L */}
                  <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                    <h2 className="text-sm font-heading text-primary mb-3">Profit &amp; loss by category (gross)</h2>
                    {(["income", "expense"] as const).map((side) => (
                      <div key={side} className="mb-4">
                        <h3 className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{side === "income" ? "Income" : "Expenses"}</h3>
                        {active.pnl[side].length === 0 ? (
                          <p className="text-sm text-muted-foreground">None in this period.</p>
                        ) : (
                          <table className="w-full text-sm">
                            <tbody>
                              {active.pnl[side].map((r) => (
                                <tr key={r.account_id ?? "uncategorized"} className={`border-b last:border-0 ${r.account_id === null ? "bg-warning/10" : ""}`}>
                                  <td className="py-1.5 pr-4">{r.name}</td>
                                  <td className="py-1.5 pr-4 text-xs text-muted-foreground">{r.tax_category ?? ""}</td>
                                  <td className="py-1.5 pr-4 text-right">{r.entry_count}</td>
                                  <td className="py-1.5 pr-4 text-right">{formatCents(r.total_cents)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-6 border-t pt-3">
                      <p className="text-sm">Income <span className="font-semibold text-success">{formatCents(active.pnl.income_total_cents)}</span></p>
                      <p className="text-sm">Expenses <span className="font-semibold text-error">{formatCents(active.pnl.expense_total_cents)}</span></p>
                      <p className="text-sm">Net <span className={`font-semibold ${active.pnl.net_cents >= 0 ? "text-success" : "text-error"}`}>{formatCents(active.pnl.net_cents)}</span></p>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: BooksClient link** — in `components/admin/bookkeeping/BooksClient.tsx`, directly BEFORE the existing "Manage categories" `<Link>` (which has `className="ml-auto …"`), insert:

```tsx
            <Link
              href="/admin/books/reports"
              className="ml-auto text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline"
            >
              Reports
            </Link>
```

and REMOVE `ml-auto ` from the "Manage categories" Link's className (so "Reports" takes the auto-margin and the two links sit together on the right).

- [ ] **Step 4: Verify** — `npx tsc --noEmit 2>&1 | grep -E "ReportsClient|books/reports|BooksClient"` → no errors in these files (repo has known unrelated tsc noise; check only touched files).
- [ ] **Step 5: Commit** — `git commit -m "feat(bookkeeper): Reports page — period picker, per-book views, export row"`

---

### Task 10: Print page — `app/(admin)/admin/books/reports/print/page.tsx`

**Files:**
- Create: `app/(admin)/admin/books/reports/print/page.tsx`

**Interfaces:**
- Consumes: `loadReportBundle` + `listAllDocuments`, aggregators, `formatCents`, `formatOccurredOn`, `presetRange`, `PrintToolbar` (existing: `components/admin/performance/print-toolbar.tsx`), global `.print-document` CSS.

- [ ] **Step 1: Implement** (server component; performance-print precedent):

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments } from "@/lib/db/bookkeeping"
import {
  incomeByServiceLine, profitAndLossByCategory, perBookSummary,
  type ProfitAndLoss,
} from "@/lib/bookkeeping/reports"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import { presetRange } from "@/lib/bookkeeping/period"
import { PrintToolbar } from "@/components/admin/performance/print-toolbar"

export const metadata = { title: "Accountant pack | DJP Athlete" }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function PnlBlock({ pnl }: { pnl: ProfitAndLoss }) {
  return (
    <>
      {(["income", "expense"] as const).map((side) => (
        <table key={side} className="w-full border-collapse text-sm mb-3">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-4 font-medium">{side === "income" ? "Income" : "Expenses"}</th>
              <th className="py-1 pr-4 font-medium">Tax hint</th>
              <th className="py-1 pr-4 font-medium text-right">Entries</th>
              <th className="py-1 pr-4 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {pnl[side].length === 0 ? (
              <tr><td colSpan={4} className="py-1 text-sm">—</td></tr>
            ) : pnl[side].map((r) => (
              <tr key={r.account_id ?? "uncategorized"} className="border-b">
                <td className="py-1 pr-4">{r.name}</td>
                <td className="py-1 pr-4">{r.tax_category ?? "—"}</td>
                <td className="py-1 pr-4 text-right">{r.entry_count}</td>
                <td className="py-1 pr-4 text-right">{formatCents(r.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <p className="text-sm font-semibold">
        Net (gross income − expenses): {formatCents(pnl.net_cents)}
      </p>
    </>
  )
}

export default async function AccountantPackPrintPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")

  const sp = await searchParams
  const today = new Date().toISOString().slice(0, 10)
  const fallback = presetRange("this_year", today)
  // A print surface should always render — invalid/missing dates fall back to this-year.
  const valid = sp.from && sp.to && DATE_RE.test(sp.from) && DATE_RE.test(sp.to) && sp.from <= sp.to
  const from = valid ? sp.from! : fallback.from
  const to = valid ? sp.to! : fallback.to

  const [{ books, accounts, entries }, documents] = await Promise.all([loadReportBundle(from, to), listAllDocuments()])
  const summaries = perBookSummary(entries, books)
  const primary = books.find((b) => b.is_primary) ?? books[0]
  const bookName = new Map(books.map((b) => [b.id, b.name]))

  return (
    <div>
      <PrintToolbar />
      <div className="print-document mx-auto max-w-3xl bg-white text-black">
        <header className="mb-8 border-b pb-4">
          <p className="font-heading text-primary text-sm font-bold uppercase tracking-[0.2em]">DJP Athlete</p>
          <h1 className="font-heading mt-1 text-3xl font-bold">Accountant Pack</h1>
          <p className="mt-1 text-sm">
            Period {formatOccurredOn(from)} – {formatOccurredOn(to)} · Generated {formatOccurredOn(today)}
          </p>
          <p className="mt-2 text-xs">
            GROSS figures from the posted ledger (Stripe fees &amp; payouts not netted). Estimates for planning — the CPA files.
            A candidate for the accountant&apos;s review, never a filed return. Business and personal stay in separate books.
          </p>
        </header>

        <section className="mb-8">
          <h2 className="font-heading mb-3 text-lg font-semibold">Per-book summary</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1 pr-4 font-medium">Book</th>
                <th className="py-1 pr-4 font-medium">Kind</th>
                <th className="py-1 pr-4 font-medium text-right">Income</th>
                <th className="py-1 pr-4 font-medium text-right">Expenses</th>
                <th className="py-1 pr-4 font-medium text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.book_id} className="border-b">
                  <td className="py-1 pr-4">{s.name}</td>
                  <td className="py-1 pr-4">{s.book_kind}</td>
                  <td className="py-1 pr-4 text-right">{formatCents(s.income_cents)}</td>
                  <td className="py-1 pr-4 text-right">{formatCents(s.expense_cents)}</td>
                  <td className="py-1 pr-4 text-right">{formatCents(s.net_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {primary ? (
          <section className="mb-8">
            <h2 className="font-heading mb-3 text-lg font-semibold">Income by service — {primary.name}</h2>
            {(() => {
              const ibs = incomeByServiceLine(entries.filter((e) => e.book_id === primary.id), accounts)
              return ibs.rows.length === 0 ? (
                <p className="text-sm">No income recorded in this period.</p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {ibs.rows.map((r) => (
                      <tr key={r.service_line ?? "uncategorized"} className="border-b">
                        <td className="py-1 pr-4">{r.label}</td>
                        <td className="py-1 pr-4 text-right">{r.entry_count}</td>
                        <td className="py-1 pr-4 text-right">{formatCents(r.total_cents)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1 pr-4 font-semibold">Total gross income</td>
                      <td />
                      <td className="py-1 pr-4 text-right font-semibold">{formatCents(ibs.total_cents)}</td>
                    </tr>
                  </tbody>
                </table>
              )
            })()}
          </section>
        ) : null}

        {books.map((book) => {
          const bookEntries = entries.filter((e) => e.book_id === book.id)
          return (
            <section key={book.id} className="mb-8">
              <h2 className="font-heading mb-3 text-lg font-semibold">P&amp;L — {book.name}</h2>
              {bookEntries.length === 0 ? (
                <p className="text-sm">
                  No entries recorded for this period. This book exists to keep its finances separate — if it has no activity, it stays empty by design.
                </p>
              ) : (
                <PnlBlock pnl={profitAndLossByCategory(bookEntries, accounts)} />
              )}
            </section>
          )
        })}

        <section className="mb-8">
          <h2 className="font-heading mb-3 text-lg font-semibold">Document index</h2>
          {documents.length === 0 ? (
            <p className="text-sm">No statements or receipts on file.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-4 font-medium">Book</th>
                  <th className="py-1 pr-4 font-medium">Kind</th>
                  <th className="py-1 pr-4 font-medium">Filename</th>
                  <th className="py-1 pr-4 font-medium">Period</th>
                  <th className="py-1 pr-4 font-medium text-right">Posted</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id} className="border-b">
                    <td className="py-1 pr-4">{bookName.get(d.book_id) ?? "—"}</td>
                    <td className="py-1 pr-4">{d.kind}</td>
                    <td className="py-1 pr-4">{d.original_filename ?? "—"}</td>
                    <td className="py-1 pr-4">{d.period_start && d.period_end ? `${formatOccurredOn(d.period_start)} – ${formatOccurredOn(d.period_end)}` : "—"}</td>
                    <td className="py-1 pr-4 text-right">{d.posted_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit 2>&1 | grep "reports/print"` → clean for this file.
- [ ] **Step 3: Commit** — `git commit -m "feat(bookkeeper): accountant pack print page (browser Save-as-PDF, D9)"`

---

### Task 11: Phase-3 minor — delete the dead `AccountScopeError` catches

**Files:**
- Modify: `app/api/admin/bookkeeping/receipts/cash/route.ts` (lines 4, 37-42)
- Modify: `app/api/admin/bookkeeping/receipts/commit/route.ts` (lines 6-13, 68-73)

Verified (spec §3.6): neither route calls `assertAccountInBook` — their inline `getAccount` checks (which ALSO feed `businessPurposeMissing`) return early, so the catch's `AccountScopeError` mapping is unreachable. Deleting it is a zero-behavior change; existing tests must pass UNMODIFIED.

- [ ] **Step 1: cash route** — change the import line 4 from
`import { getAccount, createEntry, type AccountScopeError } from "@/lib/db/bookkeeping"` to
`import { getAccount, createEntry } from "@/lib/db/bookkeeping"`, and the catch from:

```ts
  } catch (error) {
    const code = (error as AccountScopeError)?.code
    if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
    if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: "account scope" }, { status: 409 })
    console.error("receipt cash error:", error)
    return NextResponse.json({ error: "Failed to record receipt" }, { status: 500 })
  }
```

to:

```ts
  } catch (error) {
    console.error("receipt cash error:", error)
    return NextResponse.json({ error: "Failed to record receipt" }, { status: 500 })
  }
```

- [ ] **Step 2: commit route** — remove `type AccountScopeError,` from the import block (lines 6-13) and apply the same catch simplification (keep `console.error("receipt commit error:", error)` and the 500 response).
- [ ] **Step 3: Run the routes' tests UNMODIFIED** — `npx vitest run __tests__/app/api/admin/bookkeeping/receipts-cash.test.ts __tests__/app/api/admin/bookkeeping/receipts-commit.test.ts`
Expected: ALL PASS with zero test edits (this is the zero-behavior-change proof).
- [ ] **Step 4: Commit** — `git commit -m "refactor(bookkeeper): delete dead AccountScopeError catches in cash/commit receipt routes"`

---

### Task 12: Phase-3 minor — Amazon ROW_CAP truncation regression test

**Files:**
- Modify: `__tests__/app/api/admin/bookkeeping/receipts-amazon.test.ts` (append one test to the existing upload `describe`)

The route truncates at `ROW_CAP = 500` BEFORE emitting `refs` and `input.rows` from the same array — today refs↔rows stay index-aligned on truncated uploads and a warning is pushed. No test locks this; a future edit could desync the money-critical zip. Read the existing test file first and reuse its established mocks/helpers (it already builds multipart uploads and inspects the enqueued job input).

- [ ] **Step 1: Append the regression test** (adapt helper names to the file's existing ones — the file already has a happy-path upload test to copy from):

```ts
  it("caps at 500 rows, keeps refs index-aligned with input.rows, and surfaces a truncation warning", async () => {
    // 501 order lines → ROW_CAP truncation
    const header = "Order Date,Order ID,Title,Category,ASIN/ISBN,UNSPSC Code,Website,Release Date,Condition,Seller,Seller Credentials,List Price Per Unit,Purchase Price Per Unit,Quantity,Payment Instrument Type,Purchase Order Number,PO Line Number,Ordering Customer Email,Shipment Date,Shipping Address Name,Shipping Address Street 1,Shipping Address Street 2,Shipping Address City,Shipping Address State,Shipping Address Zip,Order Status,Carrier Name & Tracking Number,Item Subtotal,Item Subtotal Tax,Item Total,Tax Exemption Applied,Tax Exemption Type,Exemption Opt-Out,Buyer Name,Currency,Group Name"
    const line = (i: number) => `07/01/26,ORDER-${i},Item ${i},CATEGORY,,,,New,,Amazon.com,,\$10.00,\$10.00,1,Visa,,,x@y.com,,,,,,,,Shipped,,\$10.00,\$0.00,\$10.00,,,,Buyer,USD,`
    const csv = [header, ...Array.from({ length: 501 }, (_, i) => line(i))].join("\n")
    // build the request exactly like the existing happy-path test does, then:
    const res = await POST(reqWithFile(csv))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.refs).toHaveLength(500)
    const jobInput = enqueuedJobInput() // however the existing test reads the ai_jobs doc mock
    expect(jobInput.rows).toHaveLength(500)
    for (const i of [0, 250, 499]) expect(body.refs[i]).toBe(jobInput.rows[i].ref)
    expect(jobInput.upload_warnings ?? jobInput.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("first 500")])
    )
  })
```

**IMPORTANT for the implementer:** the snippet above is a TEMPLATE for intent — the Amazon CSV column layout and the mock helpers MUST be copied from the existing tests in this file (e.g. its happy-path builds a real `parseAmazonCsv`-compatible CSV and a `FormData` request; the job-input assertion must use whatever mock the file already uses for the Firestore enqueue). If `parseAmazonCsv` rejects the synthetic rows, reuse the file's existing fixture row and repeat it 501 times with distinct Order IDs. The three assertions that MUST survive verbatim: refs length 500, `refs[i] === input.rows[i].ref` for sampled i, and a truncation warning mentioning the cap.

- [ ] **Step 2: Run** — `npx vitest run __tests__/app/api/admin/bookkeeping/receipts-amazon.test.ts` → all green (9 existing + 1 new).
- [ ] **Step 3: Sanity-check the test catches regressions** — temporarily change the route's `rows = allRows.slice(0, ROW_CAP)` to `rows = allRows` locally, re-run, confirm the new test FAILS, revert. (Stash-proof, Phase-3 lesson.)
- [ ] **Step 4: Commit** — `git commit -m "test(bookkeeper): lock Amazon ROW_CAP truncation refs↔rows index-zip"`

---

### Task 13: Verification — live-DB read-only proof + full suite + build

- [ ] **Step 1: Bookkeeping-scoped suite** — `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/api/admin/bookkeeping __tests__/lib/csv` → all green.
- [ ] **Step 2: Live-DB read-only proof** (controller does this via `mcp__supabase__execute_sql` + a throwaway script; NEVER committed): pick a real window (e.g. 2026-01-01..2026-12-31), run `SELECT book_id, direction, SUM(amount_cents), COUNT(*) FROM bookkeeping_ledger_entries WHERE occurred_on BETWEEN '2026-01-01' AND '2026-12-31' GROUP BY 1,2` live, then run the real `loadReportBundle` + `perBookSummary` against prod env vars and assert the totals match exactly. Read-only — zero writes, zero cleanup. Delete the throwaway script after.
- [ ] **Step 3: Full suite** — `npm run test:run` → compare against the baseline (2786 pass / 11 fail / 5 files: uploads-shop, webhook-external, import-excel-route, admin-nav, events). ZERO new failing files; any suspicious red gets a stash-test to prove pre-existence.
- [ ] **Step 4: Build gate** — `npm run build` → GREEN (this, not tsc, is the deploy gate).
- [ ] **Step 5: Final commit if anything moved; do NOT push** (owner holds the push).
