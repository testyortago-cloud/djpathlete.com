# AI Bookkeeper Phase 5 — Intelligence Suite (finder-core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four pure heuristic finders (deduction watchlist + substantiation gaps + uncategorized sweep + home-office candidate; profit-by-service-line; vendor/subscription sweep; year-end flags) surfaced on a new `/admin/books/insights` page, with one JSON GET route and one audited home-office-% PATCH — zero migrations, zero flags, app-only.

**Architecture:** Pure zero-IO finder modules in `lib/bookkeeping/` (siblings of `reports.ts`) consume widened `InsightEntry`/`InsightAccount` projections loaded by new paginated DAL readers + an `insight-data.ts` bundle loader (mirror of `report-data.ts`). One GET route computes everything per request (D4: no persistence); the ReportsClient pattern renders it client-side with per-book Tabs. The home-office % lives in `system_settings` (jsonb number, absent → null) behind a dedicated audited PATCH.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Zod, Supabase service-role DAL, Vitest, shadcn/ui, Tailwind v4 semantic classes.

**Spec:** `docs/superpowers/specs/2026-07-18-ai-bookkeeper-phase-5-design.md` (the five resolved decisions + pinned thresholds live there — the numbers below are copied from it verbatim).

## Global Constraints

- Branch `feat/ai-bookkeeper-phase-5`. Commit per task. NEVER push. Never stage the pre-existing dirty files (`render-worker/*`, `docs/superpowers/2026-07-18-*-kickoff-prompt.md`, `exercise-library-match.csv`, `step-up-for-students.html`, `JOURNAL.md`).
- Integer cents everywhere; `amount_cents` is a positive magnitude, `direction` carries sign; net is the only subtraction. `formatCents` from `@/lib/bookkeeping/money` at display edges ONLY (never the analytics one).
- Pure finders: zero IO, no `new Date()` inside (inject `today`), deterministic sorts with pinned tie-breaks.
- Finders read the ledger bundle ONLY — any reference to `payments`, `client_packages`, `event_signups`, `shop_orders`, `client_memberships` in new code is a defect. No new code writes `bookkeeping_ledger_entries` (D1: the home-office output is a proposal, never an entry).
- Every ledger read paginates via `fetchAllRows` (`lib/db/paginate.ts`), ordered `occurred_on asc, id asc`.
- Routes self-gate: `const session = await auth(); if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })` — single 403, never `requireAdmin()`. No feature flag anywhere (D10). JSON GET gets NO audit; the PATCH gets inline `void recordAudit`.
- Tests: pure finders in `__tests__/lib/bookkeeping/` with ZERO mocks, file-local `entry(over: Partial<T>)` factories, RFC-4122 mnemonic UUIDs (`b…/a…/e…` with version nibble 4, variant 8). Route tests in `__tests__/app/api/admin/bookkeeping/` (the Phase-3/4 root — NOT `__tests__/api/...`), `vi.mock` factories before imports, `;(fn as ReturnType<typeof vi.fn>).mockResolvedValue(...)` cast idiom, duck-typed Request. NEVER `__tests__/db/`.
- UI: semantic classes only (`text-primary`, `text-success`, `text-error`, `bg-warning/10`, `text-muted-foreground`), no hex, no inline fontFamily; Lucide icons; `EmptyState` from `@/components/ui/empty-state`.
- Verification: scoped vitest globs; `npm run build` as its OWN command, NEVER chained behind `npm run test:run` with `&&` (known-red baseline exits non-zero and silently skips the build). Known-red family: uploads/shop, import-excel-route, admin-nav, webhook-external, events.
- Before writing code that calls an existing helper, READ the helper's real signature in source — do not trust this plan's memory of it (standing lesson: plans have shipped wrong shapes 4 phases running).

---

### Task 1: Insight input types + counterparty normalization

**Files:**
- Create: `lib/bookkeeping/insight-types.ts`
- Test: `__tests__/lib/bookkeeping/insight-types.test.ts`

**Interfaces:**
- Consumes: `ReportEntry`, `ReportAccount` from `lib/bookkeeping/reports.ts` (existing).
- Produces (later tasks import these EXACT names): `InsightEntry` (ReportEntry + `id: string; business_purpose: string | null; document_id: string | null`), `InsightAccount` (ReportAccount + `is_deductible_candidate: boolean; requires_business_purpose: boolean; archived_at: string | null`), `normalizeCounterparty(raw: string | null): string | null`, `coerceHomeOfficePercent(value: unknown): number | null`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/insight-types.test.ts
import { describe, expect, it } from "vitest"
import { coerceHomeOfficePercent, normalizeCounterparty } from "@/lib/bookkeeping/insight-types"

describe("normalizeCounterparty", () => {
  it("trims, lowercases, collapses internal whitespace", () => {
    expect(normalizeCounterparty("  Trainerize   App ")).toBe("trainerize app")
  })
  it("returns null for null, empty, and whitespace-only", () => {
    expect(normalizeCounterparty(null)).toBeNull()
    expect(normalizeCounterparty("")).toBeNull()
    expect(normalizeCounterparty("   ")).toBeNull()
  })
  it("preserves punctuation (only whitespace/case normalized)", () => {
    expect(normalizeCounterparty("Renter's  Insurance")).toBe("renter's insurance")
  })
})

describe("coerceHomeOfficePercent", () => {
  it("passes a valid number through", () => {
    expect(coerceHomeOfficePercent(12.5)).toBe(12.5)
    expect(coerceHomeOfficePercent(100)).toBe(100)
  })
  it("rejects junk: null, strings, NaN, Infinity, 0, negatives, >100", () => {
    for (const v of [null, undefined, "12.5", Number.NaN, Number.POSITIVE_INFINITY, 0, -5, 100.01, {}, true]) {
      expect(coerceHomeOfficePercent(v)).toBeNull()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/insight-types.test.ts`
Expected: FAIL — cannot resolve `@/lib/bookkeeping/insight-types`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/bookkeeping/insight-types.ts
// Pure input types + tiny pure helpers for the Phase-5 insight finders.
// InsightEntry/InsightAccount widen the slim Phase-4 report projections with the
// columns the finders need; widening ReportEntry itself would churn Phase-4 fixtures.
import type { ReportAccount, ReportEntry } from "./reports"

export interface InsightEntry extends ReportEntry {
  id: string
  business_purpose: string | null
  document_id: string | null
}

export interface InsightAccount extends ReportAccount {
  is_deductible_candidate: boolean
  requires_business_purpose: boolean
  archived_at: string | null
}

/** trim + lowercase + collapse whitespace runs; empty/null → null (ungroupable). */
export function normalizeCounterparty(raw: string | null): string | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ")
  return normalized === "" ? null : normalized
}

/** system_settings stores jsonb — defend against hand-edited junk on every read. */
export function coerceHomeOfficePercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100
    ? value
    : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/insight-types.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/insight-types.ts __tests__/lib/bookkeeping/insight-types.test.ts
git commit -m "feat(bookkeeper): insight input types + counterparty normalization"
```

---

### Task 2: Deduction finder core (watchlist, substantiation gaps, uncategorized sweep)

**Files:**
- Create: `lib/bookkeeping/deduction-finder.ts`
- Test: `__tests__/lib/bookkeeping/deduction-finder.test.ts`

**Interfaces:**
- Consumes: `InsightEntry`, `InsightAccount`, `normalizeCounterparty` from Task 1; `LedgerDirection`, `LedgerSource` types from `@/types/database`.
- Produces: `deductionFindings(bookId: string, entries: InsightEntry[], accounts: InsightAccount[]): DeductionFindings` plus exported interfaces `WatchlistCounterparty`, `WatchlistRow`, `SubstantiationGap`, `UncategorizedEntry`, `UncategorizedSweep`, `DeductionFindings` — field names EXACTLY as in the code below (Task 8's route and Task 10's client import these).

**Pinned semantics (from spec §5.1):** watchlist = one row per `is_deductible_candidate` account of `bookId` (including archived, including zero-entry accounts); income-direction entries SUBTRACT (net can go negative). Gaps = ANY-direction entries on `requires_business_purpose` accounts where `business_purpose` is null or whitespace-only. Uncategorized = expense entries with `account_id === null`. `deductionFindings` re-filters entries to `bookId` defensively. Top counterparties: top 3 by total desc, tie-break name asc, the null bucket tie-breaks last.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/deduction-finder.test.ts
import { describe, expect, it } from "vitest"
import { deductionFindings } from "@/lib/bookkeeping/deduction-finder"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"

const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_OTHER = "b0000000-0000-4000-8000-000000000002"
const ACC_EQUIP = "a0000000-0000-4000-8000-000000000001" // deductible watch
const ACC_MEALS = "a0000000-0000-4000-8000-000000000002" // watch + requires purpose
const ACC_RENT = "a0000000-0000-4000-8000-000000000003" // not deductible
const ACC_ARCHIVED = "a0000000-0000-4000-8000-000000000004" // archived watch

function account(over: Partial<InsightAccount>): InsightAccount {
  return {
    id: ACC_EQUIP, book_id: BOOK_BIZ, name: "Equipment", account_type: "expense",
    service_line: null, tax_category: null, sort_order: 0,
    is_deductible_candidate: true, requires_business_purpose: false, archived_at: null,
    ...over,
  }
}

let seq = 0
function entry(over: Partial<InsightEntry>): InsightEntry {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: BOOK_BIZ, account_id: ACC_EQUIP, direction: "expense", amount_cents: 1000,
    occurred_on: "2026-03-01", counterparty: null, memo: null, source: "manual",
    business_purpose: null, document_id: null,
    ...over,
  }
}

const accounts: InsightAccount[] = [
  account({}),
  account({ id: ACC_MEALS, name: "Meals (business purpose)", is_deductible_candidate: true, requires_business_purpose: true, sort_order: 1 }),
  account({ id: ACC_RENT, name: "Rent", is_deductible_candidate: false, sort_order: 2 }),
  account({ id: ACC_ARCHIVED, name: "Old Gear", archived_at: "2026-01-01T00:00:00Z", sort_order: 3 }),
]

describe("deductionFindings — watchlist", () => {
  it("nets income against expense per watch account and lists zero-entry watch accounts", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ amount_cents: 5000, counterparty: "Rogue" }),
      entry({ amount_cents: 2000, direction: "income", counterparty: "Rogue" }), // refund subtracts
    ], accounts)
    const equip = r.watchlist.find((w) => w.account_id === ACC_EQUIP)
    expect(equip).toMatchObject({ total_cents: 3000, entry_count: 2 })
    // zero-entry watch accounts still listed
    expect(r.watchlist.map((w) => w.account_id)).toEqual(
      expect.arrayContaining([ACC_MEALS, ACC_ARCHIVED]),
    )
    expect(r.watchlist.find((w) => w.account_id === ACC_ARCHIVED)).toMatchObject({ archived: true, total_cents: 0 })
    // non-deductible account never appears
    expect(r.watchlist.find((w) => w.account_id === ACC_RENT)).toBeUndefined()
    expect(r.watchlist_total_cents).toBe(3000)
  })

  it("top counterparties: top 3 by total, normalized grouping, null bucket ties last", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ amount_cents: 500, counterparty: " Rogue  Fitness " }),
      entry({ amount_cents: 400, counterparty: "rogue fitness" }),
      entry({ amount_cents: 800, counterparty: "Amazon" }),
      entry({ amount_cents: 700, counterparty: "Titan" }),
      entry({ amount_cents: 100, counterparty: null }),
    ], accounts)
    const equip = r.watchlist.find((w) => w.account_id === ACC_EQUIP)!
    expect(equip.top_counterparties).toEqual([
      { counterparty: "rogue fitness", total_cents: 900, entry_count: 2 },
      { counterparty: "amazon", total_cents: 800, entry_count: 1 },
      { counterparty: "titan", total_cents: 700, entry_count: 1 },
    ])
  })

  it("cross-book isolation: book B money never leaks into book A findings", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ amount_cents: 99999, book_id: BOOK_OTHER }),
      entry({ amount_cents: 100 }),
    ], accounts)
    expect(r.watchlist_total_cents).toBe(100)
  })
})

describe("deductionFindings — substantiation gaps", () => {
  it("flags null, empty, and whitespace-only purposes; filled purposes pass", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ account_id: ACC_MEALS, business_purpose: null, amount_cents: 100 }),
      entry({ account_id: ACC_MEALS, business_purpose: "", amount_cents: 200 }),
      entry({ account_id: ACC_MEALS, business_purpose: "   ", amount_cents: 300 }),
      entry({ account_id: ACC_MEALS, business_purpose: "client lunch", amount_cents: 400 }),
      entry({ account_id: ACC_EQUIP, business_purpose: null, amount_cents: 500 }), // account doesn't require purpose
    ], accounts)
    expect(r.substantiation_gaps).toHaveLength(3)
    expect(r.gap_total_cents).toBe(600)
    expect(r.substantiation_gaps[0]).toMatchObject({ account_name: "Meals (business purpose)", has_document: false })
  })

  it("includes any-direction entries and reports has_document", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ account_id: ACC_MEALS, direction: "income", business_purpose: null, amount_cents: 150, document_id: "d0000000-0000-4000-8000-000000000001" }),
    ], accounts)
    expect(r.substantiation_gaps).toHaveLength(1)
    expect(r.substantiation_gaps[0]).toMatchObject({ direction: "income", has_document: true })
  })
})

describe("deductionFindings — uncategorized sweep", () => {
  it("collects expense entries with no account, newest first; income excluded", () => {
    const r = deductionFindings(BOOK_BIZ, [
      entry({ account_id: null, amount_cents: 700, occurred_on: "2026-01-05" }),
      entry({ account_id: null, amount_cents: 300, occurred_on: "2026-02-01" }),
      entry({ account_id: null, direction: "income", amount_cents: 900 }),
    ], accounts)
    expect(r.uncategorized).toMatchObject({ total_cents: 1000, entry_count: 2 })
    expect(r.uncategorized.entries.map((e) => e.amount_cents)).toEqual([300, 700])
  })

  it("empty input → well-shaped empty result", () => {
    const r = deductionFindings(BOOK_BIZ, [], accounts)
    expect(r.substantiation_gaps).toEqual([])
    expect(r.uncategorized).toEqual({ total_cents: 0, entry_count: 0, entries: [] })
    expect(r.watchlist.every((w) => w.total_cents === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/deduction-finder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/bookkeeping/deduction-finder.ts
// Pure deduction finders (Phase 5). Zero IO; integer cents; direction carries sign.
// Every output is a CANDIDATE the accountant confirms — never a filed decision.
import type { LedgerDirection, LedgerSource } from "@/types/database"
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/deduction-finder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/deduction-finder.ts __tests__/lib/bookkeeping/deduction-finder.test.ts
git commit -m "feat(bookkeeper): deduction finder core — watchlist, substantiation gaps, uncategorized sweep"
```

---

### Task 3: Home-office allocation candidate

**Files:**
- Modify: `lib/bookkeeping/deduction-finder.ts` (append — same module, it IS part of the deduction finder)
- Test: `__tests__/lib/bookkeeping/deduction-finder.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: Task 1 types + `normalizeCounterparty`; `BookkeepingBook` from `@/types/database`.
- Produces: `HOME_OFFICE_ACCOUNT_NAMES` (const array), `HomeOfficeInput`, `HomeOfficeCandidate`, `homeOfficeCandidate(entries: InsightEntry[], accounts: InsightAccount[], books: BookkeepingBook[], percent: number | null): HomeOfficeCandidate` — Task 8's route calls this with the FULL (unfiltered) entry set.

**Pinned semantics (spec §4.2–§4.3, §5.2):** reads ONLY `book_kind === "household"` books; allowlist match on normalized account name; per-account net = expense − income; per-input `proposed_cents = Math.round(total_cents * percent / 100)`; `proposed_total_cents` = SUM of rounded inputs (never separately rounded); `excluded_household_expense_cents` = household EXPENSE money on non-matched accounts (incl. account_id null); `target_book_id` = primary business book ?? first business ?? null. WRITES NOTHING — pure function, no ledger touch.

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
// append to __tests__/lib/bookkeeping/deduction-finder.test.ts
import { homeOfficeCandidate, HOME_OFFICE_ACCOUNT_NAMES } from "@/lib/bookkeeping/deduction-finder"
import type { BookkeepingBook } from "@/types/database"

const BOOK_HH = "b0000000-0000-4000-8000-000000000003"
const ACC_HH_RENT = "a0000000-0000-4000-8000-000000000010"
const ACC_HH_UTIL = "a0000000-0000-4000-8000-000000000011"
const ACC_HH_INS = "a0000000-0000-4000-8000-000000000012"
const ACC_HH_GROC = "a0000000-0000-4000-8000-000000000013"

const books = [
  { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true },
  { id: BOOK_OTHER, name: "Spouse — Business", book_kind: "business", is_primary: false },
  { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false },
] as BookkeepingBook[]

const hhAccounts: InsightAccount[] = [
  account({ id: ACC_HH_RENT, book_id: BOOK_HH, name: "Rent", is_deductible_candidate: false }),
  account({ id: ACC_HH_UTIL, book_id: BOOK_HH, name: "  utilities ", is_deductible_candidate: false }),
  account({ id: ACC_HH_INS, book_id: BOOK_HH, name: "Renter's Insurance", is_deductible_candidate: false }),
  account({ id: ACC_HH_GROC, book_id: BOOK_HH, name: "Groceries", is_deductible_candidate: false }),
]

describe("homeOfficeCandidate", () => {
  it("matches allowlist names case/whitespace-insensitively, nets income, excludes the rest", () => {
    const r = homeOfficeCandidate([
      entry({ book_id: BOOK_HH, account_id: ACC_HH_RENT, amount_cents: 200000 }),
      entry({ book_id: BOOK_HH, account_id: ACC_HH_UTIL, amount_cents: 15000 }),
      entry({ book_id: BOOK_HH, account_id: ACC_HH_UTIL, direction: "income", amount_cents: 3000 }), // utility credit
      entry({ book_id: BOOK_HH, account_id: ACC_HH_GROC, amount_cents: 40000 }), // excluded
      entry({ book_id: BOOK_HH, account_id: null, amount_cents: 500 }),          // excluded (uncategorized)
      entry({ book_id: BOOK_BIZ, amount_cents: 77777 }),                          // business book — ignored entirely
    ], [...accounts, ...hhAccounts], books, 25)
    expect(r.target_book_id).toBe(BOOK_BIZ)
    expect(r.household_books).toEqual([{ id: BOOK_HH, name: "Household & Personal" }])
    expect(r.input_total_cents).toBe(212000)
    expect(r.inputs.find((i) => i.account_id === ACC_HH_RENT)).toMatchObject({ total_cents: 200000, proposed_cents: 50000 })
    expect(r.inputs.find((i) => i.account_id === ACC_HH_UTIL)).toMatchObject({ total_cents: 12000, proposed_cents: 3000 })
    expect(r.proposed_total_cents).toBe(53000)
    expect(r.excluded_household_expense_cents).toBe(40500)
    // matched-but-empty allowlist accounts still itemized (Renter's Insurance)
    expect(r.inputs.find((i) => i.account_id === ACC_HH_INS)).toMatchObject({ total_cents: 0, entry_count: 0, proposed_cents: 0 })
    // non-matched Groceries never becomes an input
    expect(r.inputs.find((i) => i.account_id === ACC_HH_GROC)).toBeUndefined()
  })

  it("percent null → itemized inputs with null proposals", () => {
    const r = homeOfficeCandidate([entry({ book_id: BOOK_HH, account_id: ACC_HH_RENT, amount_cents: 100000 })], [...accounts, ...hhAccounts], books, null)
    expect(r.percent).toBeNull()
    expect(r.proposed_total_cents).toBeNull()
    expect(r.inputs.find((i) => i.account_id === ACC_HH_RENT)?.proposed_cents).toBeNull()
  })

  it("pins Math.round at awkward boundaries: 33.33% of odd cents; negative half-cent rounds toward +∞", () => {
    const r = homeOfficeCandidate([
      entry({ book_id: BOOK_HH, account_id: ACC_HH_RENT, amount_cents: 10001 }),
      entry({ book_id: BOOK_HH, account_id: ACC_HH_UTIL, direction: "income", amount_cents: 99 }), // net −99
    ], [...accounts, ...hhAccounts], books, 33.33)
    expect(r.inputs.find((i) => i.account_id === ACC_HH_RENT)?.proposed_cents).toBe(3333) // 3333.3333 → 3333
    // −99 × 50% would be −49.5 → −49; here −99 × 33.33% = −32.9967 → −33
    expect(r.inputs.find((i) => i.account_id === ACC_HH_UTIL)?.proposed_cents).toBe(-33)
    expect(r.proposed_total_cents).toBe(3300) // sum of rounded inputs, NOT round of sum
  })

  it("Math.round(−49.5) rounds toward +∞ (pinned)", () => {
    const r = homeOfficeCandidate([
      entry({ book_id: BOOK_HH, account_id: ACC_HH_UTIL, direction: "income", amount_cents: 99 }),
    ], [...accounts, ...hhAccounts], books, 50)
    expect(r.inputs.find((i) => i.account_id === ACC_HH_UTIL)?.proposed_cents).toBe(-49)
  })

  it("no business book → target null; household 'Vehicles' never matches business 'Vehicle' semantics", () => {
    const hhOnly = [{ id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false }] as BookkeepingBook[]
    const r = homeOfficeCandidate([], hhAccounts, hhOnly, 20)
    expect(r.target_book_id).toBeNull()
    expect(HOME_OFFICE_ACCOUNT_NAMES).not.toContain("vehicles")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/deduction-finder.test.ts`
Expected: FAIL — `homeOfficeCandidate` not exported.

- [ ] **Step 3: Append the implementation to `lib/bookkeeping/deduction-finder.ts`**

```ts
// --- Home-office allocation candidate (D1: reads Household, WRITES NOTHING — a labeled proposal) ---
import type { BookkeepingBook } from "@/types/database" // hoist to the file's import block

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
```

(Hoist the `BookkeepingBook` import into the existing import block at the top of the file — no mid-file imports.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/deduction-finder.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/deduction-finder.ts __tests__/lib/bookkeeping/deduction-finder.test.ts
git commit -m "feat(bookkeeper): home-office allocation candidate — household inputs, pinned rounding, proposal-only"
```

---

### Task 4: Profit by service line (after direct costs)

**Files:**
- Create: `lib/bookkeeping/service-line-profit.ts`
- Test: `__tests__/lib/bookkeeping/service-line-profit.test.ts`

**Interfaces:**
- Consumes: `incomeByServiceLine`, `SERVICE_LINE_LABELS` from `lib/bookkeeping/reports.ts`; Task 1 types.
- Produces: `ServiceLineProfitRow`, `ServiceLineProfit`, `serviceLineProfit(entries: InsightEntry[], accounts: InsightAccount[]): ServiceLineProfit`. Caller passes entries PRE-FILTERED to one book.

**Pinned semantics (spec §5.3):** income side delegates to `incomeByServiceLine` (identical bucketing). Expense entries: account has `service_line` → that line's direct cost; account without → `shared_cost_cents`; no/unknown account → `uncategorized_expense_cents` (separate from shared). Rows = union of income lines and direct-cost lines (costs-without-income still get a row, `net = −cost`); sorted `income_cents` desc, tie label asc.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/service-line-profit.test.ts
import { describe, expect, it } from "vitest"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"
import { serviceLineProfit } from "@/lib/bookkeeping/service-line-profit"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_PT_INCOME = "a0000000-0000-4000-8000-000000000001"
const ACC_EQUIP_PT = "a0000000-0000-4000-8000-000000000002"  // expense tagged performance_training
const ACC_SOFTWARE = "a0000000-0000-4000-8000-000000000003"  // expense, no service line → shared
const ACC_CAMP_COST = "a0000000-0000-4000-8000-000000000004" // expense tagged camps, no camp income

function account(over: Partial<InsightAccount>): InsightAccount {
  return {
    id: ACC_PT_INCOME, book_id: BOOK, name: "Performance Training", account_type: "income",
    service_line: "performance_training", tax_category: null, sort_order: 0,
    is_deductible_candidate: false, requires_business_purpose: false, archived_at: null,
    ...over,
  }
}
let seq = 0
function entry(over: Partial<InsightEntry>): InsightEntry {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: BOOK, account_id: ACC_PT_INCOME, direction: "income", amount_cents: 10000,
    occurred_on: "2026-03-01", counterparty: null, memo: null, source: "manual",
    business_purpose: null, document_id: null,
    ...over,
  }
}

const accounts: InsightAccount[] = [
  account({}),
  account({ id: ACC_EQUIP_PT, name: "Equipment", account_type: "expense", service_line: "performance_training" }),
  account({ id: ACC_SOFTWARE, name: "Software & Subscriptions", account_type: "expense", service_line: null }),
  account({ id: ACC_CAMP_COST, name: "Camp Supplies", account_type: "expense", service_line: "camps" }),
]

describe("serviceLineProfit", () => {
  it("nets direct costs per line; shared and uncategorized stay separate buckets", () => {
    const r = serviceLineProfit([
      entry({ amount_cents: 10000 }),                                              // PT income
      entry({ account_id: ACC_EQUIP_PT, direction: "expense", amount_cents: 2000 }), // PT direct cost
      entry({ account_id: ACC_SOFTWARE, direction: "expense", amount_cents: 500 }),  // shared
      entry({ account_id: null, direction: "expense", amount_cents: 300 }),          // uncategorized
    ], accounts)
    const pt = r.rows.find((row) => row.service_line === "performance_training")
    expect(pt).toMatchObject({ income_cents: 10000, direct_cost_cents: 2000, net_estimate_cents: 8000, label: "Performance Training" })
    expect(r.shared_cost_cents).toBe(500)
    expect(r.uncategorized_expense_cents).toBe(300)
    expect(r.income_total_cents).toBe(10000)
    expect(r.direct_cost_total_cents).toBe(2000)
  })

  it("a line with costs but no income still gets a row with negative net", () => {
    const r = serviceLineProfit([
      entry({ account_id: ACC_CAMP_COST, direction: "expense", amount_cents: 400 }),
    ], accounts)
    expect(r.rows.find((row) => row.service_line === "camps")).toMatchObject({
      income_cents: 0, direct_cost_cents: 400, net_estimate_cents: -400, label: "Camps & Clinics",
    })
  })

  it("income on an unknown account lands in the null 'Uncategorized' row (parity with incomeByServiceLine)", () => {
    const r = serviceLineProfit([entry({ account_id: "a0000000-0000-4000-8000-00000000dead", amount_cents: 700 })], accounts)
    expect(r.rows.find((row) => row.service_line === null)).toMatchObject({ label: "Uncategorized", income_cents: 700 })
  })

  it("expense on an unknown account counts as uncategorized expense, not shared", () => {
    const r = serviceLineProfit([entry({ account_id: "a0000000-0000-4000-8000-00000000dead", direction: "expense", amount_cents: 900 })], accounts)
    expect(r.uncategorized_expense_cents).toBe(900)
    expect(r.shared_cost_cents).toBe(0)
  })

  it("rows sort by income desc then label; empty input → empty shape", () => {
    expect(serviceLineProfit([], accounts)).toEqual({
      rows: [], income_total_cents: 0, direct_cost_total_cents: 0, shared_cost_cents: 0, uncategorized_expense_cents: 0,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/service-line-profit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/bookkeeping/service-line-profit.ts
// Pure profit-by-service-line ESTIMATE (Phase 5): income per line minus DIRECT-assigned
// costs; untagged expense accounts stay an honest "shared / overhead" bucket.
import type { InsightAccount, InsightEntry } from "./insight-types"
import { SERVICE_LINE_LABELS, incomeByServiceLine } from "./reports"

export interface ServiceLineProfitRow {
  service_line: string | null
  label: string
  income_cents: number
  direct_cost_cents: number
  net_estimate_cents: number
}

export interface ServiceLineProfit {
  rows: ServiceLineProfitRow[]
  income_total_cents: number
  direct_cost_total_cents: number
  shared_cost_cents: number
  uncategorized_expense_cents: number
}

/** entries must be pre-filtered to ONE book by the caller. */
export function serviceLineProfit(entries: InsightEntry[], accounts: InsightAccount[]): ServiceLineProfit {
  const income = incomeByServiceLine(entries, accounts)
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const directByLine = new Map<string, number>()
  let shared = 0
  let uncategorized = 0
  for (const e of entries) {
    if (e.direction !== "expense") continue
    const account = e.account_id === null ? undefined : accountById.get(e.account_id)
    if (!account) {
      uncategorized += e.amount_cents
    } else if (account.service_line === null) {
      shared += e.amount_cents
    } else {
      directByLine.set(account.service_line, (directByLine.get(account.service_line) ?? 0) + e.amount_cents)
    }
  }

  const rowByLine = new Map<string | null, ServiceLineProfitRow>()
  for (const r of income.rows) {
    rowByLine.set(r.service_line, {
      service_line: r.service_line,
      label: r.label,
      income_cents: r.total_cents,
      direct_cost_cents: 0,
      net_estimate_cents: r.total_cents,
    })
  }
  for (const [line, cost] of directByLine) {
    const existing = rowByLine.get(line)
    if (existing) {
      existing.direct_cost_cents = cost
      existing.net_estimate_cents = existing.income_cents - cost
    } else {
      rowByLine.set(line, {
        service_line: line,
        label: SERVICE_LINE_LABELS[line] ?? line,
        income_cents: 0,
        direct_cost_cents: cost,
        net_estimate_cents: -cost,
      })
    }
  }

  return {
    rows: [...rowByLine.values()].sort(
      (a, b) => b.income_cents - a.income_cents || a.label.localeCompare(b.label),
    ),
    income_total_cents: income.total_cents,
    direct_cost_total_cents: [...directByLine.values()].reduce((sum, v) => sum + v, 0),
    shared_cost_cents: shared,
    uncategorized_expense_cents: uncategorized,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/service-line-profit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/service-line-profit.ts __tests__/lib/bookkeeping/service-line-profit.test.ts
git commit -m "feat(bookkeeper): profit-by-service-line estimate — direct costs + shared/uncategorized buckets"
```

---

### Task 5: Vendor / subscription sweep

**Files:**
- Create: `lib/bookkeeping/vendor-sweep.ts`
- Test: `__tests__/lib/bookkeeping/vendor-sweep.test.ts`

**Interfaces:**
- Consumes: Task 1 types + `normalizeCounterparty`.
- Produces: `VendorCadence`, `RecurringVendor`, `VendorSweep`, `vendorSweep(entries: InsightEntry[], accounts: InsightAccount[]): VendorSweep`. Caller passes entries pre-filtered to one book.

**Pinned thresholds (spec §3.5 — tests assert these EXACT numbers):** expense-direction only. Group by normalized counterparty (null → unattributed counters). Same-day charges collapse into one event (amounts summed). Monthly = ≥3 events AND median gap ∈ [25,35] days; annual = ≥2 events AND median gap ∈ [330,400]; both require EVERY event amount within ±20% of the median amount; median amount 0 → skip. Median: odd n → middle, even n → `Math.round((a+b)/2)`. `typical_amount_cents` = median amount; `annualized_cents` = median×12 (monthly) / median (annual). Dominant account = largest expense total, tie account name asc; unknown/null account displays "(uncategorized)". Duplicate flag: ≥2 MONTHLY vendors sharing a non-null dominant account → each gets `duplicate_group = account_id`. Sort annualized desc, tie display_name asc. Gap math via `Date.UTC` day numbers.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/vendor-sweep.test.ts
import { describe, expect, it } from "vitest"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"
import { vendorSweep } from "@/lib/bookkeeping/vendor-sweep"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_SOFT = "a0000000-0000-4000-8000-000000000001"
const ACC_PHONE = "a0000000-0000-4000-8000-000000000002"

function account(over: Partial<InsightAccount>): InsightAccount {
  return {
    id: ACC_SOFT, book_id: BOOK, name: "Software & Subscriptions", account_type: "expense",
    service_line: null, tax_category: null, sort_order: 0,
    is_deductible_candidate: true, requires_business_purpose: false, archived_at: null,
    ...over,
  }
}
let seq = 0
function entry(over: Partial<InsightEntry>): InsightEntry {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: BOOK, account_id: ACC_SOFT, direction: "expense", amount_cents: 1000,
    occurred_on: "2026-01-01", counterparty: "Trainerize", memo: null, source: "manual",
    business_purpose: null, document_id: null,
    ...over,
  }
}
const accounts = [account({}), account({ id: ACC_PHONE, name: "Phone & Internet" })]

function charges(vendor: string, days: string[], cents: number | number[], accountId = ACC_SOFT): InsightEntry[] {
  return days.map((d, i) =>
    entry({ counterparty: vendor, occurred_on: d, amount_cents: Array.isArray(cents) ? cents[i] : cents, account_id: accountId }),
  )
}

describe("vendorSweep — monthly detection", () => {
  it("detects a monthly subscription (28–31d gaps, amounts within ±20% of median)", () => {
    const r = vendorSweep(charges("Trainerize", ["2026-01-03", "2026-02-02", "2026-03-04"], [999, 1001, 1000]), accounts)
    expect(r.recurring).toHaveLength(1)
    expect(r.recurring[0]).toMatchObject({
      key: "trainerize", cadence: "monthly", charge_count: 3,
      typical_amount_cents: 1000, annualized_cents: 12000, total_cents: 3000,
      first_seen: "2026-01-03", last_seen: "2026-03-04",
      account_id: ACC_SOFT, account_name: "Software & Subscriptions",
    })
  })
  it("gap boundaries: 25 and 35 pass; 24 and 36 fail", () => {
    expect(vendorSweep(charges("A", ["2026-01-01", "2026-01-26", "2026-02-20"], 1000), accounts).recurring).toHaveLength(1) // gaps 25,25
    expect(vendorSweep(charges("B", ["2026-01-01", "2026-02-05", "2026-03-12"], 1000), accounts).recurring).toHaveLength(1) // gaps 35,35
    expect(vendorSweep(charges("C", ["2026-01-01", "2026-01-25", "2026-02-18"], 1000), accounts).recurring).toHaveLength(0) // gaps 24,24
    expect(vendorSweep(charges("D", ["2026-01-01", "2026-02-06", "2026-03-14"], 1000), accounts).recurring).toHaveLength(0) // gaps 36,36
  })
  it("one skipped month tolerated via median with 4 events (gaps 30,30,60 → median 30)", () => {
    const r = vendorSweep(charges("E", ["2026-01-01", "2026-01-31", "2026-03-02", "2026-05-01"], 1000), accounts)
    expect(r.recurring).toHaveLength(1)
  })
  it("amount tolerance boundary: exactly +20% of median passes, +20%+1¢ fails", () => {
    expect(vendorSweep(charges("F", ["2026-01-01", "2026-01-31", "2026-03-02"], [1000, 1000, 1200]), accounts).recurring).toHaveLength(1)
    expect(vendorSweep(charges("G", ["2026-01-01", "2026-01-31", "2026-03-02"], [1000, 1000, 1201]), accounts).recurring).toHaveLength(0)
  })
  it("same-day charges collapse into one event before cadence math", () => {
    const r = vendorSweep([
      ...charges("H", ["2026-01-01"], 500), ...charges("H", ["2026-01-01"], 500), // one 1000¢ event
      ...charges("H", ["2026-01-31"], 1000), ...charges("H", ["2026-03-02"], 1000),
    ], accounts)
    expect(r.recurring).toHaveLength(1)
    expect(r.recurring[0].charge_count).toBe(3)
  })
  it("2 events are never monthly; zero-median vendors are skipped", () => {
    expect(vendorSweep(charges("I", ["2026-01-01", "2026-01-31"], 1000), accounts).recurring).toHaveLength(0)
    expect(vendorSweep(charges("J", ["2026-01-01", "2026-01-31", "2026-03-02"], 0), accounts).recurring).toHaveLength(0)
  })
  it("income-direction entries are ignored", () => {
    const rows = charges("K", ["2026-01-01", "2026-01-31", "2026-03-02"], 1000).map((e) => ({ ...e, direction: "income" as const }))
    expect(vendorSweep(rows, accounts).recurring).toHaveLength(0)
  })
})

describe("vendorSweep — annual, duplicates, unattributed, sorting", () => {
  it("detects annual with 2 events in [330,400]; 329/401 fail", () => {
    expect(vendorSweep(charges("Y1", ["2025-01-01", "2026-01-01"], 9900), accounts).recurring[0]).toMatchObject({ cadence: "annual", annualized_cents: 9900 }) // 365
    expect(vendorSweep(charges("Y2", ["2025-01-01", "2025-11-26"], 9900), accounts).recurring).toHaveLength(0) // 329
    expect(vendorSweep(charges("Y3", ["2025-01-01", "2026-02-06"], 9900), accounts).recurring).toHaveLength(0) // 401
  })
  it("flags duplicate tools: two monthly vendors sharing a dominant account", () => {
    const r = vendorSweep([
      ...charges("Zoom", ["2026-01-01", "2026-01-31", "2026-03-02"], 1500),
      ...charges("Meet", ["2026-01-05", "2026-02-04", "2026-03-06"], 1200),
      ...charges("Verizon", ["2026-01-02", "2026-02-01", "2026-03-03"], 8000, ACC_PHONE),
    ], accounts)
    const zoom = r.recurring.find((v) => v.key === "zoom")
    const meet = r.recurring.find((v) => v.key === "meet")
    const verizon = r.recurring.find((v) => v.key === "verizon")
    expect(zoom?.duplicate_group).toBe(ACC_SOFT)
    expect(meet?.duplicate_group).toBe(ACC_SOFT)
    expect(verizon?.duplicate_group).toBeNull()
  })
  it("counts unattributed (blank counterparty) expenses; sorts recurring by annualized desc", () => {
    const r = vendorSweep([
      entry({ counterparty: null, amount_cents: 700 }),
      entry({ counterparty: "  ", amount_cents: 300 }),
      ...charges("Big", ["2026-01-01", "2026-01-31", "2026-03-02"], 5000),
      ...charges("Small", ["2026-01-01", "2026-01-31", "2026-03-02"], 1000),
    ], accounts)
    expect(r.unattributed_expense_count).toBe(2)
    expect(r.unattributed_expense_cents).toBe(1000)
    expect(r.recurring.map((v) => v.key)).toEqual(["big", "small"])
    expect(r.vendor_count).toBe(2)
  })
  it("empty input → well-shaped empty", () => {
    expect(vendorSweep([], accounts)).toEqual({
      recurring: [], vendor_count: 0, unattributed_expense_count: 0, unattributed_expense_cents: 0,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/vendor-sweep.test.ts`
Expected: FAIL — module not found. (Sanity-check the fixture dates' gap math while here: 2026-01-03→2026-02-02 = 30d, 2026-02-02→2026-03-04 = 30d.)

- [ ] **Step 3: Write the implementation**

```ts
// lib/bookkeeping/vendor-sweep.ts
// Pure recurring-vendor detection (Phase 5). Thresholds pinned in the design spec §3.5;
// tests assert the exact numbers. Expense direction only; integer cents.
import type { InsightAccount, InsightEntry } from "./insight-types"
import { normalizeCounterparty } from "./insight-types"

export type VendorCadence = "monthly" | "annual"

export interface RecurringVendor {
  key: string
  display_name: string
  account_id: string | null
  account_name: string
  cadence: VendorCadence
  charge_count: number
  typical_amount_cents: number
  annualized_cents: number
  total_cents: number
  first_seen: string
  last_seen: string
  duplicate_group: string | null
}

export interface VendorSweep {
  recurring: RecurringVendor[]
  vendor_count: number
  unattributed_expense_count: number
  unattributed_expense_cents: number
}

const DAY_MS = 86_400_000

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

/** odd n → middle; even n → Math.round(avg of two middle). Input must be sorted asc. */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** entries must be pre-filtered to ONE book by the caller. */
export function vendorSweep(entries: InsightEntry[], accounts: InsightAccount[]): VendorSweep {
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  let unattributedCount = 0
  let unattributedCents = 0
  const byVendor = new Map<string, { display: string; rows: InsightEntry[] }>()
  for (const e of entries) {
    if (e.direction !== "expense") continue
    const key = normalizeCounterparty(e.counterparty)
    if (key === null) {
      unattributedCount += 1
      unattributedCents += e.amount_cents
      continue
    }
    const vendor = byVendor.get(key)
    if (vendor) vendor.rows.push(e)
    else byVendor.set(key, { display: (e.counterparty ?? "").trim(), rows: [e] })
  }

  const recurring: RecurringVendor[] = []
  for (const [key, vendor] of byVendor) {
    // Collapse same-day charges into one event (a multi-line order is one purchase).
    const byDay = new Map<string, number>()
    let total = 0
    for (const row of vendor.rows) {
      byDay.set(row.occurred_on, (byDay.get(row.occurred_on) ?? 0) + row.amount_cents)
      total += row.amount_cents
    }
    const events = [...byDay.entries()]
      .map(([day, amount]) => ({ day, amount }))
      .sort((a, b) => a.day.localeCompare(b.day))
    if (events.length < 2) continue

    const amountsSorted = events.map((ev) => ev.amount).sort((a, b) => a - b)
    const medAmount = median(amountsSorted)
    if (medAmount === 0) continue
    if (!events.every((ev) => Math.abs(ev.amount - medAmount) <= 0.2 * medAmount)) continue

    const gaps: number[] = []
    for (let i = 1; i < events.length; i++) gaps.push(dayNumber(events[i].day) - dayNumber(events[i - 1].day))
    const medGap = median([...gaps].sort((a, b) => a - b))

    let cadence: VendorCadence | null = null
    if (events.length >= 3 && medGap >= 25 && medGap <= 35) cadence = "monthly"
    else if (medGap >= 330 && medGap <= 400) cadence = "annual"
    if (cadence === null) continue

    const totals = new Map<string | null, number>()
    for (const row of vendor.rows) {
      const id = row.account_id !== null && accountById.has(row.account_id) ? row.account_id : null
      totals.set(id, (totals.get(id) ?? 0) + row.amount_cents)
    }
    const nameOf = (id: string | null) => (id === null ? "(uncategorized)" : accountById.get(id)?.name ?? "(uncategorized)")
    const dominant = [...totals.entries()].sort(
      (a, b) => b[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(b[0])),
    )[0][0]

    recurring.push({
      key,
      display_name: vendor.display,
      account_id: dominant,
      account_name: nameOf(dominant),
      cadence,
      charge_count: events.length,
      typical_amount_cents: medAmount,
      annualized_cents: cadence === "monthly" ? medAmount * 12 : medAmount,
      total_cents: total,
      first_seen: events[0].day,
      last_seen: events[events.length - 1].day,
      duplicate_group: null,
    })
  }

  const monthlyByAccount = new Map<string, RecurringVendor[]>()
  for (const v of recurring) {
    if (v.cadence !== "monthly" || v.account_id === null) continue
    const group = monthlyByAccount.get(v.account_id)
    if (group) group.push(v)
    else monthlyByAccount.set(v.account_id, [v])
  }
  for (const [accountId, group] of monthlyByAccount) {
    if (group.length >= 2) for (const v of group) v.duplicate_group = accountId
  }

  recurring.sort((a, b) => b.annualized_cents - a.annualized_cents || a.display_name.localeCompare(b.display_name))

  return {
    recurring,
    vendor_count: byVendor.size,
    unattributed_expense_count: unattributedCount,
    unattributed_expense_cents: unattributedCents,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/vendor-sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/vendor-sweep.ts __tests__/lib/bookkeeping/vendor-sweep.test.ts
git commit -m "feat(bookkeeper): vendor/subscription sweep — pinned cadence thresholds + duplicate-tool flags"
```

---

### Task 6: Year-end timing flags

**Files:**
- Create: `lib/bookkeeping/year-end-flags.ts`
- Test: `__tests__/lib/bookkeeping/year-end-flags.test.ts`

**Interfaces:**
- Consumes: nothing beyond TS.
- Produces: `YearEndFlag { id: "q4_timing" | "substantiation_gaps" | "uncategorized_expenses" | "home_office_unset"; title: string; detail: string }`, `YearEndInputs`, `yearEndFlags(input: YearEndInputs): YearEndFlag[]`. Task 8's route builds `YearEndInputs` from business-book sums.

**Pinned semantics (spec §5.5):** exactly four possible flags. `q4_timing` fires iff today's month ∈ {10,11,12} AND `to`'s year === today's year. The others fire on `gap_count > 0`, `uncategorized_expense_count > 0`, and `!home_office_percent_set && home_office_input_total_cents > 0`. `today` is injected — no `new Date()` in this module. Copy must stay generic timing consideration, never tax advice.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/year-end-flags.test.ts
import { describe, expect, it } from "vitest"
import { yearEndFlags, type YearEndInputs } from "@/lib/bookkeeping/year-end-flags"

function input(over: Partial<YearEndInputs>): YearEndInputs {
  return {
    today: "2026-06-15", from: "2026-01-01", to: "2026-12-31",
    gap_count: 0, uncategorized_expense_count: 0,
    home_office_percent_set: true, home_office_input_total_cents: 0,
    ...over,
  }
}

describe("yearEndFlags", () => {
  it("q4_timing boundary: Sep 30 off, Oct 1 on (same year)", () => {
    expect(yearEndFlags(input({ today: "2026-09-30" })).map((f) => f.id)).not.toContain("q4_timing")
    expect(yearEndFlags(input({ today: "2026-10-01" })).map((f) => f.id)).toContain("q4_timing")
    expect(yearEndFlags(input({ today: "2026-12-31" })).map((f) => f.id)).toContain("q4_timing")
  })
  it("q4_timing suppressed when the window ends in a different year", () => {
    expect(yearEndFlags(input({ today: "2026-11-01", to: "2025-12-31" })).map((f) => f.id)).not.toContain("q4_timing")
  })
  it("substantiation and uncategorized flags fire on counts > 0 with the count in the title", () => {
    const flags = yearEndFlags(input({ gap_count: 3, uncategorized_expense_count: 1 }))
    expect(flags.find((f) => f.id === "substantiation_gaps")?.title).toContain("3")
    expect(flags.find((f) => f.id === "uncategorized_expenses")?.title).toContain("1")
  })
  it("home_office_unset fires only when percent unset AND household tenancy spend exists", () => {
    expect(yearEndFlags(input({ home_office_percent_set: false, home_office_input_total_cents: 5000 })).map((f) => f.id)).toContain("home_office_unset")
    expect(yearEndFlags(input({ home_office_percent_set: false, home_office_input_total_cents: 0 })).map((f) => f.id)).not.toContain("home_office_unset")
    expect(yearEndFlags(input({ home_office_percent_set: true, home_office_input_total_cents: 5000 })).map((f) => f.id)).not.toContain("home_office_unset")
  })
  it("quiet period → zero flags", () => {
    expect(yearEndFlags(input({}))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/year-end-flags.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/bookkeeping/year-end-flags.ts
// Pure, date-driven, generic timing considerations (Phase 5) — never tax advice.
export interface YearEndFlag {
  id: "q4_timing" | "substantiation_gaps" | "uncategorized_expenses" | "home_office_unset"
  title: string
  detail: string
}

export interface YearEndInputs {
  today: string
  from: string
  to: string
  gap_count: number
  uncategorized_expense_count: number
  home_office_percent_set: boolean
  home_office_input_total_cents: number
}

export function yearEndFlags(input: YearEndInputs): YearEndFlag[] {
  const flags: YearEndFlag[] = []
  const todayMonth = Number(input.today.slice(5, 7))
  if (todayMonth >= 10 && input.to.slice(0, 4) === input.today.slice(0, 4)) {
    flags.push({
      id: "q4_timing",
      title: "Year-end is approaching",
      detail:
        "If you're planning deductible purchases (equipment, software), buying before Dec 31 may place the deduction in this tax year. Your CPA confirms what applies.",
    })
  }
  if (input.gap_count > 0) {
    flags.push({
      id: "substantiation_gaps",
      title: `${input.gap_count} ${input.gap_count === 1 ? "entry is" : "entries are"} missing a business purpose`,
      detail:
        "Each entry on a purpose-required category without a stated business purpose is a deduction the IRS could disallow. Fill them in before filing.",
    })
  }
  if (input.uncategorized_expense_count > 0) {
    flags.push({
      id: "uncategorized_expenses",
      title: `${input.uncategorized_expense_count} expense ${input.uncategorized_expense_count === 1 ? "entry has" : "entries have"} no category`,
      detail: "Uncategorized money can't be matched to a deduction. Assign categories in the ledger.",
    })
  }
  if (!input.home_office_percent_set && input.home_office_input_total_cents > 0) {
    flags.push({
      id: "home_office_unset",
      title: "Household rent/utility spending is recorded, but no office share % is set",
      detail:
        "Enter your office share on the home-office card to see the proposal estimate. Your CPA confirms the method and the final percentage.",
    })
  }
  return flags
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/year-end-flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/year-end-flags.ts __tests__/lib/bookkeeping/year-end-flags.test.ts
git commit -m "feat(bookkeeper): year-end timing flags — four generic, data-driven, honest"
```

---

### Task 7: DAL insight readers + bundle loader

**Files:**
- Modify: `lib/db/bookkeeping.ts` (append two readers near `listEntriesForReports`/`listAccountsForReports`, ~line 338–362)
- Create: `lib/bookkeeping/insight-data.ts`

**Interfaces:**
- Consumes: `fetchAllRows` from `@/lib/db/paginate`; existing `listBooks`; Task 1 types.
- Produces: `listEntriesForInsights(from: string, to: string): Promise<InsightEntry[]>`, `listAccountsForInsights(): Promise<InsightAccount[]>`, `InsightsBundle { books: BookkeepingBook[]; accounts: InsightAccount[]; entries: InsightEntry[] }`, `loadInsightsBundle(from: string, to: string): Promise<InsightsBundle>`. Task 8's route calls ONLY `loadInsightsBundle`; route tests mock `@/lib/bookkeeping/insight-data`.

**No unit test** (precedent: `report-data.ts` and the ForReports DAL readers have none — route tests mock this seam; the live sentinel proof exercises it for real). The reviewer gate checks: pagination discipline, exact column lists, archived-account inclusion, ordering.

- [ ] **Step 1: Read the existing readers first**

Open `lib/db/bookkeeping.ts:338-362` and copy the EXACT idiom of `listEntriesForReports` (client creation, `fetchAllRows` invocation shape, any casts) and `listAccountsForReports` (single-query shape, error handling). Mirror them exactly — this plan's code below is the intent; the file's local idiom wins on style.

- [ ] **Step 2: Append the two readers to `lib/db/bookkeeping.ts`**

```ts
// ---- Phase-5 insight readers (mirror the ForReports discipline exactly) ----

/**
 * Windowed ledger entries widened for the insight finders (entry id, business_purpose,
 * document_id on top of the report columns). Paginated: a year of ledger can exceed the
 * ~1000-row PostgREST cap. Deterministic order for stable pages.
 */
export async function listEntriesForInsights(from: string, to: string): Promise<InsightEntry[]> {
  // copy listEntriesForReports' exact fetchAllRows call shape, with this select:
  // "id,book_id,account_id,direction,amount_cents,occurred_on,counterparty,memo,source,business_purpose,document_id"
  // .gte("occurred_on", from).lte("occurred_on", to)
  // .order("occurred_on", { ascending: true }).order("id", { ascending: true })
}

/**
 * All accounts across all books INCLUDING archived (same re-bucketing hazard as
 * listAccountsForReports: filtering archived would re-bucket historical money).
 */
export async function listAccountsForInsights(): Promise<InsightAccount[]> {
  // copy listAccountsForReports' exact shape, with this select:
  // "id,book_id,name,account_type,service_line,tax_category,sort_order,is_deductible_candidate,requires_business_purpose,archived_at"
  // .order("book_id", { ascending: true }).order("sort_order", { ascending: true })
}
```

(Import `InsightEntry`/`InsightAccount` types from `@/lib/bookkeeping/insight-types` alongside the existing `ReportEntry`/`ReportAccount` type imports.)

- [ ] **Step 3: Create the bundle loader**

```ts
// lib/bookkeeping/insight-data.ts
// Server-only bundle loader for the insights surfaces (mirrors report-data.ts).
// DAL readers use the service-role client — never import from client components.
import { listAccountsForInsights, listBooks, listEntriesForInsights } from "@/lib/db/bookkeeping"
import type { BookkeepingBook } from "@/types/database"
import type { InsightAccount, InsightEntry } from "./insight-types"

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
```

- [ ] **Step 4: Typecheck the touched surface**

Run: `npx tsc --noEmit 2>&1 | Select-String "lib/db/bookkeeping|insight-data|insight-types"`
Expected: no output (the repo's ~155 pre-existing tsc errors are test/.next noise — only OUR files must be absent from the output).

- [ ] **Step 5: Commit**

```bash
git add lib/db/bookkeeping.ts lib/bookkeeping/insight-data.ts
git commit -m "feat(bookkeeper): paginated insight DAL readers + loadInsightsBundle"
```

---

### Task 8: GET /api/admin/bookkeeping/insights route

**Files:**
- Create: `app/api/admin/bookkeeping/insights/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/insights.test.ts`

**Interfaces:**
- Consumes: `loadInsightsBundle` (Task 7), all finders (Tasks 2–6), `coerceHomeOfficePercent` (Task 1), `reportQuerySchema` from `@/lib/validators/bookkeeping` (existing — REUSED, no new query schema), `getSetting` from `@/lib/db/system-settings`, `auth` from `@/lib/auth`.
- Produces: response shape `{ from, to, home_office_percent, books: [{ book: { id, name, book_kind, is_primary, currency }, deductions, profit, vendors, row_count }], home_office, year_end_flags }` — Task 10's client types against this EXACTLY.

**Contracts:** single 403 guard; `reportQuerySchema` → 400 `{ error: "Invalid input", issues }`; NO `recordAudit` anywhere in this file (JSON screen-read precedent); NO flag; try/catch → 500 `{ error: "Failed to build insights" }`. Year-end sums come from BUSINESS books only. `today` = `new Date().toISOString().slice(0, 10)` (route level — never inside pure fns).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/app/api/admin/bookkeeping/insights.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/bookkeeping/insight-data", () => ({ loadInsightsBundle: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { GET } from "@/app/api/admin/bookkeeping/insights/route"
import { auth } from "@/lib/auth"
import { loadInsightsBundle } from "@/lib/bookkeeping/insight-data"
import { recordAudit } from "@/lib/audit/record"
import { getSetting } from "@/lib/db/system-settings"

const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_HH = "b0000000-0000-4000-8000-000000000003"
const ACC_MEALS = "a0000000-0000-4000-8000-000000000002"
const ACC_RENT = "a0000000-0000-4000-8000-000000000010"

const books = [
  { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, currency: "usd", owner_label: null, sort_order: 0, archived_at: null, created_at: "", updated_at: "" },
  { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false, currency: "usd", owner_label: null, sort_order: 2, archived_at: null, created_at: "", updated_at: "" },
]
const accounts = [
  { id: ACC_MEALS, book_id: BOOK_BIZ, name: "Meals (business purpose)", account_type: "expense", service_line: null, tax_category: null, sort_order: 0, is_deductible_candidate: true, requires_business_purpose: true, archived_at: null },
  { id: ACC_RENT, book_id: BOOK_HH, name: "Rent", account_type: "expense", service_line: null, tax_category: null, sort_order: 0, is_deductible_candidate: false, requires_business_purpose: false, archived_at: null },
]
const entries = [
  { id: "e0000000-0000-4000-8000-000000000001", book_id: BOOK_BIZ, account_id: ACC_MEALS, direction: "expense", amount_cents: 2500, occurred_on: "2026-03-05", counterparty: "Chipotle", memo: null, source: "manual", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000002", book_id: BOOK_HH, account_id: ACC_RENT, direction: "expense", amount_cents: 200000, occurred_on: "2026-03-01", counterparty: "Landlord", memo: null, source: "manual", business_purpose: null, document_id: null },
]

const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/insights?${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(loadInsightsBundle as ReturnType<typeof vi.fn>).mockResolvedValue({ books, accounts, entries })
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(25)
})

describe("GET /api/admin/bookkeeping/insights", () => {
  it("403 when unauthenticated or non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(403)
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "x", role: "client" } })
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(403)
    expect(loadInsightsBundle).not.toHaveBeenCalled()
  })
  it("400 on a bad window", async () => {
    expect((await GET(req("from=2026-12-31&to=2026-01-01"))).status).toBe(400)
    expect((await GET(req("from=nope&to=2026-01-01"))).status).toBe(400)
  })
  it("200: per-book findings, home_office at top level, percent passthrough", async () => {
    const res = await GET(req("from=2026-01-01&to=2026-12-31"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(loadInsightsBundle).toHaveBeenCalledWith("2026-01-01", "2026-12-31")
    expect(body.home_office_percent).toBe(25)
    expect(body.books).toHaveLength(2)
    const biz = body.books.find((b: { book: { id: string } }) => b.book.id === BOOK_BIZ)
    expect(biz.deductions.substantiation_gaps).toHaveLength(1)
    expect(biz.row_count).toBe(1)
    // cross-book regression: household rent never in the business watchlist
    expect(biz.deductions.watchlist_total_cents).toBe(2500)
    expect(body.home_office.input_total_cents).toBe(200000)
    expect(body.home_office.proposed_total_cents).toBe(50000)
    expect(body.home_office.target_book_id).toBe(BOOK_BIZ)
    // gaps flag derives from BUSINESS books
    expect(body.year_end_flags.map((f: { id: string }) => f.id)).toContain("substantiation_gaps")
  })
  it("junk stored percent is coerced to null (no proposal)", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue("25")
    const body = await (await GET(req("from=2026-01-01&to=2026-12-31"))).json()
    expect(body.home_office_percent).toBeNull()
    expect(body.home_office.proposed_total_cents).toBeNull()
  })
  it("never audits (JSON screen-read precedent) and 500s on loader failure", async () => {
    await GET(req("from=2026-01-01&to=2026-12-31"))
    expect(recordAudit).not.toHaveBeenCalled()
    ;(loadInsightsBundle as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"))
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(500)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/insights.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write the route**

```ts
// app/api/admin/bookkeeping/insights/route.ts
// JSON screen-read: self-gated, unflagged (D10), UNAUDITED (reports-route precedent).
// Everything recomputes per request (D4) — no persistence, no cache.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deductionFindings, homeOfficeCandidate } from "@/lib/bookkeeping/deduction-finder"
import { loadInsightsBundle } from "@/lib/bookkeeping/insight-data"
import { coerceHomeOfficePercent } from "@/lib/bookkeeping/insight-types"
import { serviceLineProfit } from "@/lib/bookkeeping/service-line-profit"
import { vendorSweep } from "@/lib/bookkeeping/vendor-sweep"
import { yearEndFlags } from "@/lib/bookkeeping/year-end-flags"
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

    const [bundle, storedPercent] = await Promise.all([
      loadInsightsBundle(from, to),
      getSetting<number | null>("bookkeeping_home_office_percent", null),
    ])
    const percent = coerceHomeOfficePercent(storedPercent)
    const homeOffice = homeOfficeCandidate(bundle.entries, bundle.accounts, bundle.books, percent)

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
      today: new Date().toISOString().slice(0, 10),
      from,
      to,
      gap_count: gapCount,
      uncategorized_expense_count: uncategorizedCount,
      home_office_percent_set: percent !== null,
      home_office_input_total_cents: homeOffice.input_total_cents,
    })

    return NextResponse.json({
      from,
      to,
      home_office_percent: percent,
      books: bookPayloads,
      home_office: homeOffice,
      year_end_flags: flags,
    })
  } catch (error) {
    console.error("bookkeeping insights:", error)
    return NextResponse.json({ error: "Failed to build insights" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/insights.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookkeeping/insights/route.ts __tests__/app/api/admin/bookkeeping/insights.test.ts
git commit -m "feat(bookkeeper): insights JSON route — per-book finders, top-level home-office, year-end flags"
```

---

### Task 9: Home-office % PATCH route + validator + audit slug

**Files:**
- Modify: `lib/validators/bookkeeping.ts` (append `homeOfficePercentSchema` after `emailPackSchema`, ~line 139)
- Modify: `lib/audit/actions.ts` (append one row to the `// bookkeeping` block, lines ~235-250)
- Create: `app/api/admin/bookkeeping/insights/home-office/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/insights-home-office.test.ts`; append schema cases to `__tests__/lib/bookkeeping/report-validators.test.ts`

**Interfaces:**
- Consumes: `getSetting`/`setSetting` from `@/lib/db/system-settings` (signature: `setSetting(key: string, value: unknown, updatedBy: string | null)` — VERIFY in source), `recordAudit` from `@/lib/audit/record`.
- Produces: `homeOfficePercentSchema` (exported from `lib/validators/bookkeeping.ts`); audit slug `bookkeeping.home_office_percent_set`; `PATCH` handler returning `{ percent: number | null }`.

**Contracts:** settings key is EXACTLY `bookkeeping_home_office_percent` in three places (this route, Task 8's route, Task 10's page) — byte-identical. Value rounded to 2 decimals BEFORE storing. Audit inline `void recordAudit`, category `commerce`, metadata `{ previous_value, new_value }`. No flag. `setSetting` NOT called on 400/403.

- [ ] **Step 1: Add the validator + its tests**

Append to `lib/validators/bookkeeping.ts`:

```ts
export const homeOfficePercentSchema = z.object({
  percent: z.number().min(0.01).max(100).nullable(),
})
```

Append to `__tests__/lib/bookkeeping/report-validators.test.ts`:

```ts
import { homeOfficePercentSchema } from "@/lib/validators/bookkeeping"

describe("homeOfficePercentSchema", () => {
  it("accepts in-range numbers and null", () => {
    expect(homeOfficePercentSchema.safeParse({ percent: 12.5 }).success).toBe(true)
    expect(homeOfficePercentSchema.safeParse({ percent: 100 }).success).toBe(true)
    expect(homeOfficePercentSchema.safeParse({ percent: 12.345 }).success).toBe(true) // route rounds to 2dp
    expect(homeOfficePercentSchema.safeParse({ percent: null }).success).toBe(true)
  })
  it("rejects 0, negatives, >100, strings, missing key", () => {
    for (const percent of [0, -1, 100.01, "25"]) {
      expect(homeOfficePercentSchema.safeParse({ percent }).success).toBe(false)
    }
    expect(homeOfficePercentSchema.safeParse({}).success).toBe(false)
  })
})
```

Run: `npx vitest run __tests__/lib/bookkeeping/report-validators.test.ts` → PASS.

- [ ] **Step 2: Add the audit slug**

In `lib/audit/actions.ts`, append inside the `// bookkeeping` block (keep the block's ordering style):

```ts
  { slug: "bookkeeping.home_office_percent_set", category: "commerce", description: "Home-office share percentage set for the deduction proposal" },
```

- [ ] **Step 3: Write the failing route test**

```ts
// __tests__/app/api/admin/bookkeeping/insights-home-office.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { PATCH } from "@/app/api/admin/bookkeeping/insights/home-office/route"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { getSetting, setSetting } from "@/lib/db/system-settings"

const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const body = (b: unknown) => ({ json: async () => b }) as never

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(setSetting as ReturnType<typeof vi.fn>).mockResolvedValue({})
})

describe("PATCH /api/admin/bookkeeping/insights/home-office", () => {
  it("403 when not admin; setSetting never called", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await PATCH(body({ percent: 25 }))).status).toBe(403)
    expect(setSetting).not.toHaveBeenCalled()
  })
  it("400 on invalid bodies; setSetting never called", async () => {
    for (const b of [{ percent: 0 }, { percent: 101 }, { percent: "25" }, {}, null]) {
      expect((await PATCH(body(b))).status).toBe(400)
    }
    expect(setSetting).not.toHaveBeenCalled()
  })
  it("rounds to 2 decimals, stores under the exact key with the admin id, audits with previous/new", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(10)
    const res = await PATCH(body({ percent: 33.333 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ percent: 33.33 })
    expect(setSetting).toHaveBeenCalledWith("bookkeeping_home_office_percent", 33.33, ADMIN.user.id)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.home_office_percent_set",
        category: "commerce",
        metadata: expect.objectContaining({ previous_value: 10, new_value: 33.33 }),
      }),
    )
  })
  it("null clears the setting", async () => {
    const res = await PATCH(body({ percent: null }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ percent: null })
    expect(setSetting).toHaveBeenCalledWith("bookkeeping_home_office_percent", null, ADMIN.user.id)
  })
  it("500 when the write fails", async () => {
    ;(setSetting as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"))
    expect((await PATCH(body({ percent: 25 }))).status).toBe(500)
  })
})
```

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/insights-home-office.test.ts` → FAIL (route missing).

- [ ] **Step 4: Write the route**

```ts
// app/api/admin/bookkeeping/insights/home-office/route.ts
// The phase's ONLY write: a coach-entered %, stored in system_settings, audited.
// The product never derives the % — the CPA validates it (spec §3.2).
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { homeOfficePercentSchema } from "@/lib/validators/bookkeeping"

const SETTING_KEY = "bookkeeping_home_office_percent"

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const parsed = homeOfficePercentSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const value = parsed.data.percent === null ? null : Math.round(parsed.data.percent * 100) / 100
    const previous = await getSetting<number | null>(SETTING_KEY, null)
    await setSetting(SETTING_KEY, value, session.user.id)
    void recordAudit({
      action: "bookkeeping.home_office_percent_set",
      category: "commerce",
      target: { type: "system_setting", id: SETTING_KEY },
      metadata: { previous_value: previous, new_value: value },
      request,
    })
    return NextResponse.json({ percent: value })
  } catch (error) {
    console.error("bookkeeping home-office percent:", error)
    return NextResponse.json({ error: "Failed to save the office share" }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/insights-home-office.test.ts __tests__/lib/bookkeeping/report-validators.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/validators/bookkeeping.ts lib/audit/actions.ts app/api/admin/bookkeeping/insights/home-office/route.ts __tests__/app/api/admin/bookkeeping/insights-home-office.test.ts __tests__/lib/bookkeeping/report-validators.test.ts
git commit -m "feat(bookkeeper): audited home-office percent PATCH — the phase's only write"
```

---

### Task 10: Insights page + client + toolbar links

**Files:**
- Create: `app/(admin)/admin/books/insights/page.tsx`
- Create: `components/admin/bookkeeping/InsightsClient.tsx`
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (toolbar right-group, after the "Reports" link at ~line 245-250)
- Modify: `components/admin/bookkeeping/ReportsClient.tsx` (header link row, beside "Back to ledger" at ~line 96-98)

**Interfaces:**
- Consumes: the Task 8 response shape (type it locally like ReportsClient does); finder result types imported `import type` from the finder modules; `presetRange`, `PERIOD_PRESET_LABELS`, `PeriodPreset` from `@/lib/bookkeeping/period`; `formatCents` from `@/lib/bookkeeping/money`; `EmptyState` from `@/components/ui/empty-state`; `coerceHomeOfficePercent` from `@/lib/bookkeeping/insight-types`; `listBooks`, `getSetting` server-side.
- Produces: the `/admin/books/insights` page; `Insights` links in BooksClient + ReportsClient.

**Contracts:** BEFORE writing, read `components/admin/bookkeeping/ReportsClient.tsx` in full and mirror its skeleton (export style, Tabs usage, period bar, `fetchRequestIdRef` POSITIVE-check variant, `todayIso()` local helper, toast on failure). BooksClient link: same classes as "Manage categories", NO `ml-auto` (only the right-group's first link carries it). Honesty copy verbatim from spec §7: page strip = "Every finding on this page is a candidate for your accountant to confirm — never a filed decision. Dollar figures are estimates; your CPA files."; home-office card = "This is a proposal on the business book's screen, not an entry — business and household books stay separate. Your CPA sets the method (simplified vs actual) and the final percentage." Home-office card ONLY on the tab where `bookId === home_office.target_book_id`; when the ledger is empty (all `row_count` 0) show EmptyState AND still render the home-office card below it. Substantiation/uncategorized lists cap at 25 visible rows with an explicit "and N more" line. ESTIMATE badge on the profit card. Percent editor: number input (min 0.01, max 100, step 0.01) + Save (PATCH then refetch) + Clear (PATCH null then refetch); toast on failure.

- [ ] **Step 1: Server page**

```tsx
// app/(admin)/admin/books/insights/page.tsx
import { InsightsClient } from "@/components/admin/bookkeeping/InsightsClient"
import { coerceHomeOfficePercent } from "@/lib/bookkeeping/insight-types"
import { listBooks } from "@/lib/db/bookkeeping"
import { getSetting } from "@/lib/db/system-settings"

export const metadata = { title: "Insights — Books — Admin" }

export default async function InsightsPage() {
  const [books, storedPercent] = await Promise.all([
    listBooks(),
    getSetting<number | null>("bookkeeping_home_office_percent", null),
  ])
  return <InsightsClient books={books} initialHomeOfficePercent={coerceHomeOfficePercent(storedPercent)} />
}
```

(Match ReportsClient's actual export style — if it's a default export, import accordingly.)

- [ ] **Step 2: InsightsClient**

Skeleton (complete the card JSX following ReportsClient's table/card idioms — `rounded-lg border border-border p-4`, `text-sm`, `font-heading` headings, `text-success`/`text-error` money):

```tsx
// components/admin/bookkeeping/InsightsClient.tsx
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Lightbulb } from "lucide-react"
import { toast } from "sonner"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import type { DeductionFindings, HomeOfficeCandidate } from "@/lib/bookkeeping/deduction-finder"
import { formatCents } from "@/lib/bookkeeping/money"
import { PERIOD_PRESET_LABELS, presetRange, type PeriodPreset } from "@/lib/bookkeeping/period"
import type { ServiceLineProfit } from "@/lib/bookkeeping/service-line-profit"
import type { VendorSweep } from "@/lib/bookkeeping/vendor-sweep"
import type { YearEndFlag } from "@/lib/bookkeeping/year-end-flags"
import type { BookkeepingBook } from "@/types/database"

interface BookInsights {
  book: { id: string; name: string; book_kind: string; is_primary: boolean; currency: string }
  deductions: DeductionFindings
  profit: ServiceLineProfit
  vendors: VendorSweep
  row_count: number
}
interface InsightsData {
  from: string
  to: string
  home_office_percent: number | null
  books: BookInsights[]
  home_office: HomeOfficeCandidate
  year_end_flags: YearEndFlag[]
}

const VISIBLE_ROW_CAP = 25

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function InsightsClient({ books, initialHomeOfficePercent }: {
  books: BookkeepingBook[]
  initialHomeOfficePercent: number | null
}) {
  const [preset, setPreset] = useState<PeriodPreset | "custom">("this_year")
  const initial = presetRange("this_year", todayIso())
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [bookId, setBookId] = useState(books.find((b) => b.is_primary)?.id ?? books[0]?.id ?? "")
  const [percentInput, setPercentInput] = useState(initialHomeOfficePercent?.toString() ?? "")
  const [savingPercent, setSavingPercent] = useState(false)
  const fetchRequestIdRef = useRef(0)

  const fetchInsights = useCallback(async () => {
    const requestId = ++fetchRequestIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetch(`/api/admin/bookkeeping/insights?${params.toString()}`)
      if (!res.ok) throw new Error("failed")
      const body = (await res.json()) as InsightsData
      if (requestId === fetchRequestIdRef.current) {
        setData(body)
        setPercentInput(body.home_office_percent?.toString() ?? "")
      }
    } catch {
      if (requestId === fetchRequestIdRef.current) toast.error("Failed to load insights")
    } finally {
      if (requestId === fetchRequestIdRef.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void fetchInsights() }, [fetchInsights])

  const savePercent = useCallback(async (value: number | null) => {
    setSavingPercent(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/insights/home-office", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percent: value }),
      })
      if (!res.ok) throw new Error("failed")
      toast.success(value === null ? "Office share cleared" : "Office share saved")
      void fetchInsights()
    } catch {
      toast.error("Failed to save the office share")
    } finally {
      setSavingPercent(false)
    }
  }, [fetchInsights])

  // …period bar (copy ReportsClient's applyPreset + selects/inputs verbatim)…
  // …header with "Reports" + "Back to ledger" links…
  // …honesty strip…
  // …year-end flags strip: data.year_end_flags.map(flag => row with flag.title / flag.detail)…
  // …EmptyState branches (no books; totalEntries === 0 → EmptyState + HomeOfficeCard)…
  // …Tabs per book with the five cards; HomeOfficeCard rendered when bookId === data.home_office.target_book_id…
}
```

Card requirements (each a bordered section, all money via `formatCents(cents, book.currency)`):
1. **Deduction watchlist** — table rows from `deductions.watchlist`: name (+"archived" badge when `archived`), `total_cents`, `entry_count`, top counterparties as "rogue fitness $900 · amazon $800"; footer `watchlist_total_cents`. Card subtitle: "Candidate deductions — your accountant confirms."
2. **Substantiation gaps** — headline `${gaps.length} entries · ${formatCents(gap_total_cents)}` with `bg-warning/10` when > 0; rows (cap `VISIBLE_ROW_CAP`, then `and {n − 25} more`): occurred_on, amount, counterparty ?? "—", account_name, memo, a dot when `has_document`; link "Open ledger" → `/admin/books`. Zero state: "Every purpose-required entry has a business purpose."
3. **Uncategorized expenses** — same shape from `deductions.uncategorized`.
4. **Profit by service line** — "ESTIMATE" badge (accent); rows label / income / direct costs / net (`text-success`/`text-error` by sign); beneath: "Shared / overhead {formatCents(shared_cost_cents)}" and "Uncategorized {formatCents(uncategorized_expense_cents)}"; hint when `shared_cost_cents > 0 && rows.every(r => r.direct_cost_cents === 0)`: "Tag expense categories with a service line (Manage categories) to attribute costs."
5. **Vendors & subscriptions** — rows from `vendors.recurring`: `display_name — ~{formatCents(typical_amount_cents)}/mo (≈{formatCents(annualized_cents)}/yr)` for monthly, `{formatCents(annualized_cents)}/yr` for annual; account_name muted; badge "possible overlap" when `duplicate_group`; footer: `${vendor_count} vendors seen · ${unattributed_expense_count} entries without a vendor name`. Zero state: "No recurring charges detected in this period."
6. **Home-office card** (target tab only) — inputs table (name / total / proposed share per account), `input_total_cents` + `proposed_total_cents` rows, the % editor, `excluded_household_expense_cents` note ("Other household spending excluded from this proposal: …"), the spec's honesty copy verbatim, and when `percent === null` the prompt "Enter your office share % — your CPA confirms the method."

- [ ] **Step 3: Toolbar links**

BooksClient (after the Reports link, same classes WITHOUT `ml-auto`):

```tsx
<Link
  href="/admin/books/insights"
  className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline"
>
  Insights
</Link>
```

ReportsClient header (beside "Back to ledger", same classes):

```tsx
<Link
  href="/admin/books/insights"
  className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline"
>
  Insights
</Link>
```

- [ ] **Step 4: Typecheck + scoped suites still green**

Run: `npx tsc --noEmit 2>&1 | Select-String "InsightsClient|books/insights|BooksClient|ReportsClient"`
Expected: no output.
Run: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/"(admin)"/admin/books/insights/page.tsx components/admin/bookkeeping/InsightsClient.tsx components/admin/bookkeeping/BooksClient.tsx components/admin/bookkeeping/ReportsClient.tsx
git commit -m "feat(bookkeeper): /admin/books/insights page — per-book finder cards + home-office proposal + toolbar links"
```

---

### Task 11: Full verification + live sentinel proof

**Files:**
- Create (scratchpad only, never committed): a `tsx` proof script in the session scratchpad dir.

- [ ] **Step 1: Scoped suites**

Run: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/api/admin/bookkeeping`
Expected: PASS (all bookkeeping roots, old and new).

- [ ] **Step 2: Full suite vs the known-red baseline**

Run: `npm run test:run` (capture output). Compare failures against the known-red family (uploads/shop, import-excel-route, admin-nav, webhook-external, events). Any OTHER red: `git stash` the phase's diff, re-run that file, unstash — only chase it if it's ours.

- [ ] **Step 3: Production build (its own command — NEVER `&&` after tests)**

Run: `npm run build`
Expected: GREEN. (Silent exit-4 at "Running TypeScript" with no diagnostic = memory flake → re-run once before diagnosing.)

- [ ] **Step 4: Live sentinel proof (prod ledger may be empty)**

Insert sentinel rows via `mcp__supabase__execute_sql` in the far-future window `2031-02-01..2031-02-28`, ids prefixed `f5000000-`: (a) Household Rent expense $2,000.00; (b) business Meals expense $25.00 with NULL `business_purpose`; (c) 3× business "Trainerize" expenses $10.00 on 2031-02-01/(then +30d/+60d — use 2031-03 and 2031-04 dates and widen the window to `2031-01-01..2031-12-31`); (d) an uncategorized business expense $3.00. Then run a scratchpad `tsx` script that calls the REAL `loadInsightsBundle("2031-01-01","2031-12-31")` + the real finders and prints: home-office input 200000¢ → at 25% proposal 50000¢ (trace the Household dollar end-to-end), the Meals gap row, the monthly Trainerize vendor (typical 1000¢ → 12000¢/yr), the uncategorized 300¢. Finally DELETE all `f5000000-%` rows and SQL-verify `count = 0` leftovers. NEVER touch non-sentinel rows.

- [ ] **Step 5: D1 + money-of-record grep proof**

Run: `npx rg -n "payments|client_packages|event_signups|shop_orders|client_memberships" lib/bookkeeping/insight-types.ts lib/bookkeeping/deduction-finder.ts lib/bookkeeping/service-line-profit.ts lib/bookkeeping/vendor-sweep.ts lib/bookkeeping/year-end-flags.ts lib/bookkeeping/insight-data.ts app/api/admin/bookkeeping/insights`
Expected: zero matches.
Run: `npx rg -n "insertReceiptEntry|createEntry|insertImportedEntries|insertAmazonEntries|bookkeeping_ledger_entries" app/api/admin/bookkeeping/insights components/admin/bookkeeping/InsightsClient.tsx`
Expected: zero matches (nothing in the phase writes the ledger).

- [ ] **Step 6: Commit any fixes, then hand off to the final review**

No push. The Opus whole-branch review (dispatched next by the controller) must trace one Household dollar: sentinel/POSTed Rent entry → `listEntriesForInsights` → `homeOfficeCandidate` input → ×% → `proposed_cents` → the card — verifying no write-path exists anywhere along it.

---

## Self-Review (done at plan time)

1. **Spec coverage:** §5.1→T2, §5.2→T3, §5.3→T4, §5.4→T5, §5.5→T6, §4.1→T1+T7, §6.1→T8, §6.2/§3.2→T9, §7→T10, §9→T11. Toolbar links §7→T10 Step 3. No gaps.
2. **Placeholders:** T7 readers are deliberate mirror-the-idiom stubs with exact column lists (the local cast idiom must be copied from source, not invented here); T10's card JSX is specified by contract + skeleton (ReportsClient is the canonical template in-repo). Everything else is complete code.
3. **Type consistency:** `deductionFindings(bookId, entries, accounts)` matches spec §5.1 (amended); `homeOfficeCandidate(entries, accounts, books, percent)` consistent across T3/T8; response field names identical in T8 route and T10 client types; `coerceHomeOfficePercent` used in T1/T8/T10; setting key byte-identical in T8/T9/T10.
