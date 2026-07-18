# AI Bookkeeper Phase 6b — Missing-Receipt Watchdog + Rolling Tax Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two low-risk intelligence surfaces on top of the Phase-5 insight stack: (a) a pure missing-receipt watchdog (14-day-aged expense entries on watched accounts missing a document and/or business purpose) surfaced as an unflagged insights card AND a weekly flag-OFF cron email to the coach; (b) a rolling tax forecast (flat CPA-entered rate × calendar-YTD net per business book, home-office proposal subtracted on the primary book) with an audited tax-rate PATCH and an insights ForecastCard. ZERO migrations (6a's 00188 already seeded both flags), one new Firebase cron, no ledger writes anywhere.

**Architecture:** Pure zero-IO modules in `lib/bookkeeping/` (`receipt-watchdog.ts`, `tax-forecast.ts`) consuming the existing `InsightEntry`/`InsightAccount` projections; the Phase-5 substantiation-blank predicate is EXTRACTED to a shared `isBlankPurpose` export in `insight-types.ts` (deduction-finder behavior byte-identical, its tests untouched). The existing insights GET route gains `forecast` + `watchdog` response sections (one dedicated YTD DAL read, D-9). The tax rate is a no-seed `system_settings` number behind a PATCH cloned from the home-office route. The cron follows the quarterly-pack template exactly: functions-side pure fetch-delegator → internal Next route that is the SINGLE `cron_runs` owner.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Zod, Supabase service-role DAL, Firebase functions v2 `onSchedule`, Resend, Vitest, shadcn/ui, Tailwind v4 semantic classes.

**Spec:** `docs/superpowers/specs/2026-07-18-ai-bookkeeper-phase-6-design.md` §4 (D-8, D-9, D-10) — pinned numbers below are copied from it verbatim.

## Global Constraints

- Branch `feat/ai-bookkeeper-phase-6` (already checked out; 6a's tasks land on it first). Commit per task. NEVER push. Never stage the pre-existing dirty files (`render-worker/*`, `docs/superpowers/2026-07-18-*-kickoff-prompt.md`, `docs/superpowers/plans/2026-06-04-reel-no-audio-support.md`, `exercise-library-match.csv`, `step-up-for-students.html`, `JOURNAL.md`).
- **NO migration in 6b.** Migration `00188` (written and applied live in 6a via `mcp__supabase__apply_migration` by the orchestrator) already seeded `cron_bookkeeping_receipt_watchdog_enabled` (`'false'::jsonb`). The tax rate key `bookkeeping_tax_rate_percent` is deliberately NO-SEED (absent row → `null`, the `bookkeeping_home_office_percent` pattern verbatim, D-8). Nothing in this sub-phase's tests touches the live DB (route tests mock `isCronSkipped`/`getSetting`).
- **THE THREE-WAY BYTE-IDENTICAL STRING CONTRACT (repeat in every task that touches one of the three files):** the functions cron POSTs to path `/api/admin/internal/bookkeeping-receipt-watchdog` ↔ the route lives at `app/api/admin/internal/bookkeeping-receipt-watchdog/route.ts` ↔ the cron_runs name logged by the route AND the `EXPECTED_CRONS` entry AND the functions export are all `bookkeepingReceiptWatchdogCron`. One byte of drift = a silently dead cron or a false "silent cron" alert.
- **cron_runs single-owner:** the internal ROUTE calls `logCronStart`/`logCronEnd`; the functions-side delegator NEVER logs cron_runs (double rows otherwise — the quarterly-pack header comment states this).
- Integer cents everywhere; `amount_cents` is a positive magnitude, `direction` carries sign. `Math.round` ONLY at the spec's defined points: (a) `taxForecast`'s single tax computation, (b) the tax-rate PATCH's 2-dp store rounding. `formatCents` from `@/lib/bookkeeping/money` at display edges ONLY (cards + email html).
- Pure modules: zero IO, no `new Date()` inside (inject `today`), deterministic sorts with pinned tie-breaks.
- No new code writes `bookkeeping_ledger_entries` — the watchdog is a chore list, the forecast is an estimate; any ledger write in this sub-phase is a defect.
- Routes self-gate: `const session = await auth(); if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })` — single 403, never `requireAdmin()`. Internal cron route uses the Bearer `INTERNAL_CRON_TOKEN` triple-clause instead (`if (!expected || !bearer || bearer !== expected) → 401`). No new feature flags beyond the 6a-seeded cron flag.
- Audit: inline `void recordAudit({...})`, never `withAudit`. New slugs registered in `lib/audit/actions.ts` in the SAME task that first records them: `bookkeeping.tax_rate_percent_set` (Task 3), `bookkeeping.receipt_watchdog_emailed` (Task 6), both `category: "commerce"`.
- Tests: pure modules in `__tests__/lib/bookkeeping/` with ZERO mocks, file-local `entry(over: Partial<T>)` factories, RFC-4122 mnemonic UUIDs (`b…/a…/e…/d…` with version nibble 4, variant 8). Admin route tests in `__tests__/app/api/admin/bookkeeping/`; the internal cron route test in `__tests__/api/admin/internal/` (beside `bookkeeping-quarterly-pack.test.ts`, the shape it clones). `vi.mock` factories before imports, `;(fn as ReturnType<typeof vi.fn>).mockResolvedValue(...)` cast idiom. NEVER `__tests__/db/`.
- Every pinned number/order/branch gets a mutation-discriminating fixture (named per task): 13-vs-14-day boundary, doc-null-but-purpose-present reason discrimination, `12.555 → 12.56` (round-vs-trunc at 2 dp — `33.333` does NOT discriminate), odd-cents × 12.34% (round-vs-trunc on tax), negative-net $0 floor with net preserved, Apr-15-boundary → Jun 15, YTD-read-vs-page-window source discrimination.
- UI: semantic classes only (`text-primary`, `text-success`, `text-error`, `bg-warning/10`, `bg-accent/10`, `text-muted-foreground`), `font-heading` headings, no hex, no inline fontFamily in app UI (email HTML uses inline styles per the `email-pack.ts` precedent). Honesty copy verbatim from spec §4.4.
- Verification: scoped vitest globs; `npm run build` as its OWN command, NEVER chained behind `npm run test:run` with `&&` (known-red baseline exits non-zero and silently skips the build). Known-red family: uploads/shop, import-excel-route, admin-nav, webhook-external, events. 6b touches `functions/**` → `cd functions && npm run build` (+ `npm test` in functions/) must also pass.
- Before writing code that calls an existing helper, READ the helper's real signature in source — do not trust this plan's memory of it (standing lesson: plans have shipped wrong shapes 4 phases running). Verified signatures used below: `getSetting<T>(key, fallback)` / `setSetting(key, value, updatedBy)` / `isCronSkipped({enabledKey, defaultEnabled})` (`lib/db/system-settings.ts:13/21/49`), `logCronStart(supabase, cron_name)` / `logCronEnd(supabase, id, status, detail?)` (`lib/db/cron-runs.ts`), `listEntriesForInsights(from, to)` (`lib/db/bookkeeping.ts:384`), `listAccountsForInsights()` (`:401`), `recordAudit(input)` with `actor?: { id?: string | null; email?: string | null; role?: ... }` (`lib/audit/record.ts:42`), `formatCents(cents, currency = "usd")` (`lib/bookkeeping/money.ts`), `homeOfficeCandidate(entries, accounts, books, percent)` (`lib/bookkeeping/deduction-finder.ts:194`), `resend`/`FROM_EMAIL` (`lib/resend.ts`).

---

### Task 1: Shared `isBlankPurpose` extraction + receipt-watchdog pure finder

**Files:**
- Modify: `lib/bookkeeping/insight-types.ts` (add `isBlankPurpose`)
- Modify: `lib/bookkeeping/deduction-finder.ts` (delete local `isBlank`, import the shared export — behavior byte-identical)
- Create: `lib/bookkeeping/receipt-watchdog.ts`
- Test: `__tests__/lib/bookkeeping/receipt-watchdog.test.ts`; append one describe to `__tests__/lib/bookkeeping/insight-types.test.ts`
- **UNTOUCHED (and must stay green):** `__tests__/lib/bookkeeping/deduction-finder.test.ts`

**Interfaces:**
- Consumes: `InsightEntry`, `InsightAccount` from `@/lib/bookkeeping/insight-types` (existing).
- Produces (later tasks import these EXACT names): `isBlankPurpose(value: string | null): boolean` (from `insight-types.ts`); `MIN_AGE_DAYS` (const `14`), `WatchdogReason` (`"no_document" | "no_purpose"`), `WatchdogFinding`, `receiptWatchdogFindings(entries: InsightEntry[], accounts: InsightAccount[], opts: { today: string; minAgeDays: number }): WatchdogFinding[]` (from `receipt-watchdog.ts`).

**Pinned semantics (spec §4.1, D-10):** expense-direction entries on WATCHED accounts (`is_deductible_candidate || requires_business_purpose`; archived accounts stay watched — the Phase-5 watchlist precedent: historical money is still a chore), aged ≥ `minAgeDays` (day-number math via `Date.UTC`, the vendor-sweep idiom; exactly-14-days-old is IN). Reasons, in pinned order: `no_document` iff the ACCOUNT is deductible-candidate AND `document_id === null`; `no_purpose` iff the ACCOUNT requires purpose AND `isBlankPurpose(business_purpose)`. An entry with zero reasons is excluded. `account_id === null` entries excluded (no account to watch — the uncategorized sweep already owns them). Sort `amount_cents` desc, tie `occurred_on` desc, tie `entry_id` asc. `MIN_AGE_DAYS = 14` pinned.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/bookkeeping/receipt-watchdog.test.ts
import { describe, expect, it } from "vitest"
import type { InsightAccount, InsightEntry } from "@/lib/bookkeeping/insight-types"
import { MIN_AGE_DAYS, receiptWatchdogFindings } from "@/lib/bookkeeping/receipt-watchdog"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_DOC = "a0000000-0000-4000-8000-000000000001"     // deductible-candidate ONLY
const ACC_PURPOSE = "a0000000-0000-4000-8000-000000000002" // purpose-required ONLY
const ACC_BOTH = "a0000000-0000-4000-8000-000000000003"    // both flags
const ACC_NEITHER = "a0000000-0000-4000-8000-000000000004" // unwatched

const TODAY = "2026-07-18"
const OLD = "2026-01-15" // comfortably aged relative to TODAY

function account(over: Partial<InsightAccount>): InsightAccount {
  return {
    id: ACC_DOC, book_id: BOOK, name: "Equipment", account_type: "expense",
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
    book_id: BOOK, account_id: ACC_DOC, direction: "expense", amount_cents: 1000,
    occurred_on: OLD, counterparty: null, memo: null, source: "manual",
    business_purpose: null, document_id: null,
    ...over,
  }
}
const accounts: InsightAccount[] = [
  account({}),
  account({ id: ACC_PURPOSE, name: "Meals", is_deductible_candidate: false, requires_business_purpose: true, sort_order: 1 }),
  account({ id: ACC_BOTH, name: "Travel", is_deductible_candidate: true, requires_business_purpose: true, sort_order: 2 }),
  account({ id: ACC_NEITHER, name: "Rent", is_deductible_candidate: false, requires_business_purpose: false, sort_order: 3 }),
]
const opts = { today: TODAY, minAgeDays: MIN_AGE_DAYS }

describe("receiptWatchdogFindings — reason discrimination (pinned)", () => {
  it("doc-null-but-purpose-PRESENT on a deductible-only account → no_document ONLY", () => {
    // a wrong impl that checks the purpose regardless of the account flag adds no_purpose here
    const r = receiptWatchdogFindings([entry({ business_purpose: "client demo day" })], accounts, opts)
    expect(r).toHaveLength(1)
    expect(r[0].reasons).toEqual(["no_document"])
    expect(r[0]).toMatchObject({ book_id: BOOK, account_id: ACC_DOC, account_name: "Equipment", amount_cents: 1000 })
  })
  it("doc-null with BLANK purpose on a purpose-only account → no_purpose ONLY (doc plays no role there)", () => {
    // a wrong impl that fires no_document off document_id alone fails here (account is NOT deductible-candidate)
    const r = receiptWatchdogFindings([entry({ account_id: ACC_PURPOSE, business_purpose: "  " })], accounts, opts)
    expect(r).toHaveLength(1)
    expect(r[0].reasons).toEqual(["no_purpose"])
  })
  it("purpose-only account with a filled purpose is clean even with no document", () => {
    expect(
      receiptWatchdogFindings([entry({ account_id: ACC_PURPOSE, business_purpose: "team meal" })], accounts, opts),
    ).toEqual([])
  })
  it("both-flags account missing both → both reasons in pinned order", () => {
    const r = receiptWatchdogFindings([entry({ account_id: ACC_BOTH })], accounts, opts)
    expect(r[0].reasons).toEqual(["no_document", "no_purpose"])
  })
  it("a documented, purposed entry on a watched account is clean", () => {
    expect(
      receiptWatchdogFindings(
        [entry({ account_id: ACC_BOTH, document_id: "d0000000-0000-4000-8000-000000000001", business_purpose: "cert course" })],
        accounts, opts,
      ),
    ).toEqual([])
  })
})

describe("receiptWatchdogFindings — exclusions (pinned)", () => {
  it("income entries excluded even on watched accounts with no document", () => {
    expect(receiptWatchdogFindings([entry({ direction: "income" })], accounts, opts)).toEqual([])
  })
  it("unwatched accounts and uncategorized (account null) entries excluded", () => {
    expect(
      receiptWatchdogFindings([entry({ account_id: ACC_NEITHER }), entry({ account_id: null })], accounts, opts),
    ).toEqual([])
  })
  it("archived watched accounts are still watched (watchlist precedent)", () => {
    const archived = accounts.map((a) => (a.id === ACC_DOC ? { ...a, archived_at: "2026-01-01T00:00:00Z" } : a))
    expect(receiptWatchdogFindings([entry({})], archived, opts)).toHaveLength(1)
  })
})

describe("receiptWatchdogFindings — age boundary + sort (pinned)", () => {
  it("MIN_AGE_DAYS is pinned at 14", () => {
    expect(MIN_AGE_DAYS).toBe(14)
  })
  it("exactly 14 days old is IN; 13 days old is OUT (>= vs > discriminator)", () => {
    const r = receiptWatchdogFindings(
      [
        entry({ occurred_on: "2026-07-04" }), // 14 days before 2026-07-18
        entry({ occurred_on: "2026-07-05" }), // 13 days
      ],
      accounts, opts,
    )
    expect(r).toHaveLength(1)
    expect(r[0].occurred_on).toBe("2026-07-04")
  })
  it("sorts amount desc (an inverted sort fails)", () => {
    const r = receiptWatchdogFindings(
      [entry({ amount_cents: 500 }), entry({ amount_cents: 9000 }), entry({ amount_cents: 1200 })],
      accounts, opts,
    )
    expect(r.map((f) => f.amount_cents)).toEqual([9000, 1200, 500])
  })
  it("tie-breaks: equal amount sorts by occurred_on desc, then entry_id asc (id pinned against call order)", () => {
    // Three entries share amount_cents=4000 so the amount sort alone can't separate them.
    // A is the odd one out on date (older). B and C share BOTH amount and date, so only the
    // entry_id tie-break can order them — and C's explicit id is lexicographically FIRST
    // despite being constructed LAST, inverting call/array order. A dropped or inverted
    // occurred_on tie-break, or a dropped/inverted entry_id tie-break, each produce a
    // different (wrong) order than asserted below.
    const A = entry({ amount_cents: 4000, occurred_on: "2026-01-10" })
    const B = entry({ amount_cents: 4000, occurred_on: "2026-02-20" })
    const C = entry({
      amount_cents: 4000,
      occurred_on: "2026-02-20",
      id: "e0000000-0000-4000-8000-000000000000", // smallest possible id, created last
    })
    const r = receiptWatchdogFindings([A, B, C], accounts, opts)
    expect(r.map((f) => f.occurred_on)).toEqual(["2026-02-20", "2026-02-20", "2026-01-10"])
    expect(r[0].entry_id).toBe("e0000000-0000-4000-8000-000000000000")
    expect(r[1].entry_id).toBe(B.id)
    expect(r[2].entry_id).toBe(A.id)
  })
})
```

Append to `__tests__/lib/bookkeeping/insight-types.test.ts` (add `isBlankPurpose` to the existing import from `@/lib/bookkeeping/insight-types`):

```ts
describe("isBlankPurpose (shared by deduction finder + receipt watchdog)", () => {
  it("null, empty, and whitespace-only are blank; real text is not", () => {
    expect(isBlankPurpose(null)).toBe(true)
    expect(isBlankPurpose("")).toBe(true)
    expect(isBlankPurpose("   ")).toBe(true)
    expect(isBlankPurpose("client lunch")).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-watchdog.test.ts __tests__/lib/bookkeeping/insight-types.test.ts`
Expected: FAIL — cannot resolve `@/lib/bookkeeping/receipt-watchdog`; `isBlankPurpose` not exported.

- [ ] **Step 3: Extract `isBlankPurpose` (behavior byte-identical)**

Append to `lib/bookkeeping/insight-types.ts`:

```ts
/** Blank-business-purpose predicate. Extracted (Phase 6b) from the Phase-5 deduction
 *  finder so the receipt watchdog shares ONE definition of "blank" — null / empty /
 *  whitespace-only. Behavior is byte-identical to the finder's old local isBlank. */
export function isBlankPurpose(value: string | null): boolean {
  return value === null || value.trim() === ""
}
```

In `lib/bookkeeping/deduction-finder.ts`:
1. Change the value-import line `import { normalizeCounterparty } from "./insight-types"` to `import { isBlankPurpose, normalizeCounterparty } from "./insight-types"`.
2. DELETE the local function (lines 59-61):
```ts
function isBlank(value: string | null): boolean {
  return value === null || value.trim() === ""
}
```
3. At the single call site (line 124), change `!isBlank(e.business_purpose)` → `!isBlankPurpose(e.business_purpose)`.

Nothing else in the file changes.

- [ ] **Step 4: Write the watchdog implementation**

```ts
// lib/bookkeeping/receipt-watchdog.ts
// Pure missing-receipt watchdog (Phase 6b, D-10). Zero IO; integer cents; today injected.
// A CHORE LIST for the coach — never tax advice, never a ledger write. Superset of the
// Phase-5 substantiation-gap predicate: adds document ageing on deductible accounts.
import type { InsightAccount, InsightEntry } from "./insight-types"
import { isBlankPurpose } from "./insight-types"

/** Entries younger than this many days are not nagged about yet (spec §4.1, pinned). */
export const MIN_AGE_DAYS = 14

export type WatchdogReason = "no_document" | "no_purpose"

export interface WatchdogFinding {
  entry_id: string
  book_id: string
  account_id: string
  account_name: string
  occurred_on: string
  amount_cents: number
  counterparty: string | null
  reasons: WatchdogReason[]
}

const DAY_MS = 86_400_000

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

/** Expense entries on watched accounts (deductible-candidate OR purpose-required —
 *  archived accounts stay watched, the watchlist precedent), aged >= minAgeDays,
 *  missing a document (deductible accounts) and/or a business purpose (purpose-required
 *  accounts). Sorted amount desc, tie occurred_on desc, tie entry_id asc. */
export function receiptWatchdogFindings(
  entries: InsightEntry[],
  accounts: InsightAccount[],
  opts: { today: string; minAgeDays: number },
): WatchdogFinding[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const todayNum = dayNumber(opts.today)
  const findings: WatchdogFinding[] = []
  for (const e of entries) {
    if (e.direction !== "expense") continue
    if (e.account_id === null) continue
    const account = accountById.get(e.account_id)
    if (!account) continue
    if (!account.is_deductible_candidate && !account.requires_business_purpose) continue
    if (todayNum - dayNumber(e.occurred_on) < opts.minAgeDays) continue
    const reasons: WatchdogReason[] = []
    if (account.is_deductible_candidate && e.document_id === null) reasons.push("no_document")
    if (account.requires_business_purpose && isBlankPurpose(e.business_purpose)) reasons.push("no_purpose")
    if (reasons.length === 0) continue
    findings.push({
      entry_id: e.id,
      book_id: e.book_id,
      account_id: account.id,
      account_name: account.name,
      occurred_on: e.occurred_on,
      amount_cents: e.amount_cents,
      counterparty: e.counterparty,
      reasons,
    })
  }
  findings.sort(
    (a, b) =>
      b.amount_cents - a.amount_cents ||
      b.occurred_on.localeCompare(a.occurred_on) ||
      a.entry_id.localeCompare(b.entry_id),
  )
  return findings
}
```

- [ ] **Step 5: Run tests to verify they pass — INCLUDING the untouched Phase-5 suite**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-watchdog.test.ts __tests__/lib/bookkeeping/insight-types.test.ts __tests__/lib/bookkeeping/deduction-finder.test.ts`
Expected: PASS. Then run `git diff --stat __tests__/lib/bookkeeping/deduction-finder.test.ts` — expected: NO output (the Phase-5 test file is untouched; only its module's internals moved).

- [ ] **Step 6: Commit**

```bash
git add lib/bookkeeping/insight-types.ts lib/bookkeeping/deduction-finder.ts lib/bookkeeping/receipt-watchdog.ts __tests__/lib/bookkeeping/receipt-watchdog.test.ts __tests__/lib/bookkeeping/insight-types.test.ts
git commit -m "feat(bookkeeper): receipt-watchdog pure finder + shared isBlankPurpose extraction"
```

---

### Task 2: Rolling tax forecast pure fn

**Files:**
- Create: `lib/bookkeeping/tax-forecast.ts`
- Test: `__tests__/lib/bookkeeping/tax-forecast.test.ts`

**Interfaces:**
- Consumes: `InsightEntry` from `@/lib/bookkeeping/insight-types` (for `bookYtdTotals` only).
- Produces (Task 4 imports these EXACT names): `TaxForecastInput`, `SafeHarborDate`, `TaxForecast`, `taxForecast(input: TaxForecastInput): TaxForecast`, `nextSafeHarbor(today: string): SafeHarborDate`, `bookYtdTotals(entries: InsightEntry[], bookId: string): { ytd_income_cents: number; ytd_expense_cents: number }`.

**Pinned semantics (spec §4.3, D-8):** `estimated_net_cents = ytd_income − ytd_expense − (home_office ?? 0)` (integer arithmetic, no rounding). `rate_percent === null` → `estimated_tax_cents: null` (NEVER 0 — the card must show the prompt, not a dollar figure). Else `estimated_tax_cents = Math.round(Math.max(0, net) * rate / 100)` — the ONLY rounding point in the module. Negative net floors the TAX at 0 but the net itself is preserved (still shown). `next_safe_harbor` = the first date from the fixed generic list (Jan 15 / Apr 15 / Jun 15 / Sep 15, this year then next year) STRICTLY after `today`; Jan rolls the year. No brackets, no SE/QBI — anything cleverer is fake precision the honesty guardrails forbid.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/tax-forecast.test.ts
import { describe, expect, it } from "vitest"
import type { InsightEntry } from "@/lib/bookkeeping/insight-types"
import { bookYtdTotals, nextSafeHarbor, taxForecast, type TaxForecastInput } from "@/lib/bookkeeping/tax-forecast"

const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_OTHER = "b0000000-0000-4000-8000-000000000002"

let seq = 0
function entry(over: Partial<InsightEntry>): InsightEntry {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: BOOK_BIZ, account_id: null, direction: "income", amount_cents: 1000,
    occurred_on: "2026-03-01", counterparty: null, memo: null, source: "manual",
    business_purpose: null, document_id: null,
    ...over,
  }
}

function input(over: Partial<TaxForecastInput>): TaxForecastInput {
  return {
    ytd_income_cents: 0, ytd_expense_cents: 0, home_office_deduction_cents: null,
    rate_percent: null, today: "2026-07-18",
    ...over,
  }
}

describe("taxForecast", () => {
  it("null rate → NULL estimated tax (never 0 — the card shows a prompt, no dollar figure)", () => {
    const r = taxForecast(input({ ytd_income_cents: 100000, ytd_expense_cents: 40000 }))
    expect(r.estimated_net_cents).toBe(60000)
    expect(r.estimated_tax_cents).toBeNull()
    expect(r.rate_percent).toBeNull()
    // safe-harbor wiring: today 2026-07-18 → Sep 15 2026
    expect(r.next_safe_harbor).toEqual({ label: "Sep 15, 2026", date: "2026-09-15" })
  })
  it("Math.round at the single defined point: odd cents × 12.34% (trunc gives 152345)", () => {
    // 1234567 × 12.34% = 152345.5678 → Math.round 152346; Math.trunc/floor 152345
    const r = taxForecast(input({ ytd_income_cents: 1234567, rate_percent: 12.34 }))
    expect(r.estimated_tax_cents).toBe(152346)
  })
  it("negative net floors the TAX at 0 but preserves the negative net (dropped-guard discriminator)", () => {
    const r = taxForecast(input({ ytd_income_cents: 1000, ytd_expense_cents: 5000, rate_percent: 20 }))
    expect(r.estimated_net_cents).toBe(-4000) // still shown on the card
    expect(r.estimated_tax_cents).toBe(0)     // NOT -800
  })
  it("home-office deduction subtracts when present and is inert when null", () => {
    const withHo = taxForecast(
      input({ ytd_income_cents: 100000, ytd_expense_cents: 40000, home_office_deduction_cents: 12000, rate_percent: 10 }),
    )
    expect(withHo.estimated_net_cents).toBe(48000)
    expect(withHo.estimated_tax_cents).toBe(4800)
    const withoutHo = taxForecast(input({ ytd_income_cents: 100000, ytd_expense_cents: 40000, rate_percent: 10 }))
    expect(withoutHo.estimated_net_cents).toBe(60000)
    expect(withoutHo.estimated_tax_cents).toBe(6000)
  })
})

describe("nextSafeHarbor (pinned generic calendar)", () => {
  it("strictly-after: Apr 14 → Apr 15; Apr 15 itself → Jun 15 (> vs >= discriminator)", () => {
    expect(nextSafeHarbor("2026-04-14")).toEqual({ label: "Apr 15, 2026", date: "2026-04-15" })
    expect(nextSafeHarbor("2026-04-15")).toEqual({ label: "Jun 15, 2026", date: "2026-06-15" })
  })
  it("Jan rolls the year: Sep 16 and Dec 31 → Jan 15 of NEXT year", () => {
    expect(nextSafeHarbor("2026-09-16")).toEqual({ label: "Jan 15, 2027", date: "2027-01-15" })
    expect(nextSafeHarbor("2026-12-31")).toEqual({ label: "Jan 15, 2027", date: "2027-01-15" })
  })
  it("early January still hits THIS year's Jan 15", () => {
    expect(nextSafeHarbor("2026-01-10")).toEqual({ label: "Jan 15, 2026", date: "2026-01-15" })
  })
})

describe("bookYtdTotals", () => {
  it("splits by direction and never leaks another book's money", () => {
    const totals = bookYtdTotals(
      [
        entry({ amount_cents: 5000 }),
        entry({ amount_cents: 2000, direction: "expense" }),
        entry({ amount_cents: 99999, book_id: BOOK_OTHER }),
      ],
      BOOK_BIZ,
    )
    expect(totals).toEqual({ ytd_income_cents: 5000, ytd_expense_cents: 2000 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/tax-forecast.test.ts`
Expected: FAIL — cannot resolve `@/lib/bookkeeping/tax-forecast`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/bookkeeping/tax-forecast.ts
// Pure rolling tax forecast (Phase 6b, D-8/D-9). Flat coach/CPA-entered effective
// rate × calendar-YTD net. Deliberately dumb: brackets / SE / QBI would be fake
// precision the honesty guardrails forbid. Estimate only — the CPA files.
import type { InsightEntry } from "./insight-types"

export interface TaxForecastInput {
  ytd_income_cents: number
  ytd_expense_cents: number
  home_office_deduction_cents: number | null
  rate_percent: number | null
  today: string
}

export interface SafeHarborDate {
  label: string
  date: string
}

export interface TaxForecast {
  ytd_income_cents: number
  ytd_expense_cents: number
  home_office_deduction_cents: number | null
  estimated_net_cents: number
  rate_percent: number | null
  estimated_tax_cents: number | null
  next_safe_harbor: SafeHarborDate
}

// Generic US quarterly estimated-tax calendar. Fixed list, never computed from
// entity type — the CPA confirms the coach's actual dates.
const SAFE_HARBOR_MONTH_DAYS = [
  { md: "01-15", month: "Jan" },
  { md: "04-15", month: "Apr" },
  { md: "06-15", month: "Jun" },
  { md: "09-15", month: "Sep" },
] as const

/** First generic safe-harbor date STRICTLY after today; Jan rolls into next year. */
export function nextSafeHarbor(today: string): SafeHarborDate {
  const year = Number(today.slice(0, 4))
  for (const y of [year, year + 1]) {
    for (const { md, month } of SAFE_HARBOR_MONTH_DAYS) {
      const date = `${y}-${md}`
      if (date > today) return { label: `${month} 15, ${y}`, date }
    }
  }
  // Unreachable: next year's Jan 15 is always strictly after any date in `year`.
  throw new Error(`nextSafeHarbor: no candidate after ${today}`)
}

/** Per-book YTD income/expense sums (integer cents, no rounding, book-scoped). */
export function bookYtdTotals(
  entries: InsightEntry[],
  bookId: string,
): { ytd_income_cents: number; ytd_expense_cents: number } {
  let income = 0
  let expense = 0
  for (const e of entries) {
    if (e.book_id !== bookId) continue
    if (e.direction === "income") income += e.amount_cents
    else expense += e.amount_cents
  }
  return { ytd_income_cents: income, ytd_expense_cents: expense }
}

export function taxForecast(input: TaxForecastInput): TaxForecast {
  const net =
    input.ytd_income_cents - input.ytd_expense_cents - (input.home_office_deduction_cents ?? 0)
  const estimatedTax =
    input.rate_percent === null
      ? null
      : Math.round((Math.max(0, net) * input.rate_percent) / 100) // the ONLY rounding point
  return {
    ytd_income_cents: input.ytd_income_cents,
    ytd_expense_cents: input.ytd_expense_cents,
    home_office_deduction_cents: input.home_office_deduction_cents,
    estimated_net_cents: net,
    rate_percent: input.rate_percent,
    estimated_tax_cents: estimatedTax,
    next_safe_harbor: nextSafeHarbor(input.today),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/tax-forecast.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/tax-forecast.ts __tests__/lib/bookkeeping/tax-forecast.test.ts
git commit -m "feat(bookkeeper): rolling tax forecast pure fn — pinned rounding, \$0 floor, safe-harbor calendar"
```

---

### Task 3: Tax-rate setting — coerce helper, validator, audited PATCH route

**Files:**
- Modify: `lib/bookkeeping/insight-types.ts` (add `coerceTaxRatePercent`)
- Modify: `lib/validators/bookkeeping.ts` (append `taxRatePercentSchema` after `homeOfficePercentSchema`, currently the last export at lines 141-143)
- Modify: `lib/audit/actions.ts` (append one row to the end of the `// bookkeeping` block — after `bookkeeping.home_office_percent_set` at line 251 plus whatever 6a appended below it)
- Create: `app/api/admin/bookkeeping/insights/tax-rate/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/insights-tax-rate.test.ts`; append cases to `__tests__/lib/bookkeeping/report-validators.test.ts` and `__tests__/lib/bookkeeping/insight-types.test.ts`

**Interfaces:**
- Consumes: `getSetting`/`setSetting` from `@/lib/db/system-settings` (`setSetting(key: string, value: unknown, updatedBy: string | null = null)` — verified), `recordAudit` from `@/lib/audit/record`, `auth` from `@/lib/auth`.
- Produces: `coerceTaxRatePercent(value: unknown): number | null`; `taxRatePercentSchema`; audit slug `bookkeeping.tax_rate_percent_set`; `PATCH` handler returning `{ percent: number | null }`.

**Contracts:** this is the home-office PATCH cloned verbatim (`app/api/admin/bookkeeping/insights/home-office/route.ts`) with the key swapped. Settings key is EXACTLY `bookkeeping_tax_rate_percent` in three places (this route, Task 4's route, spec D-8) — byte-identical. NO seed row anywhere (absent → null). Value rounded to 2 decimals BEFORE storing — pinned by the `12.555 → 12.56` fixture (`33.333 → 33.33` does NOT discriminate round from trunc; the journal lesson). Audit inline `void recordAudit`, category `commerce`, metadata `{ previous_value, new_value }`. `setSetting` NOT called on 400/403.

- [ ] **Step 1: Add the coerce helper + validator + their tests**

Append to `lib/bookkeeping/insight-types.ts`:

```ts
/** Same junk-defense as coerceHomeOfficePercent, for the flat effective tax rate
 *  (bookkeeping_tax_rate_percent). Kept as its own function so the two settings can
 *  diverge without cross-contamination. */
export function coerceTaxRatePercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100
    ? value
    : null
}
```

Append to `lib/validators/bookkeeping.ts` (after `homeOfficePercentSchema`):

```ts
export const taxRatePercentSchema = z.object({
  percent: z.number().min(0.01).max(100).nullable(),
})
```

Append to `__tests__/lib/bookkeeping/insight-types.test.ts` (add `coerceTaxRatePercent` to the import):

```ts
describe("coerceTaxRatePercent", () => {
  it("passes a valid number through", () => {
    expect(coerceTaxRatePercent(22.5)).toBe(22.5)
    expect(coerceTaxRatePercent(100)).toBe(100)
  })
  it("rejects junk: null, strings, NaN, Infinity, 0, negatives, >100", () => {
    for (const v of [null, undefined, "22.5", Number.NaN, Number.POSITIVE_INFINITY, 0, -5, 100.01, {}, true]) {
      expect(coerceTaxRatePercent(v)).toBeNull()
    }
  })
})
```

Append to `__tests__/lib/bookkeeping/report-validators.test.ts` (add `taxRatePercentSchema` to the import from `@/lib/validators/bookkeeping`):

```ts
describe("taxRatePercentSchema", () => {
  it("accepts in-range numbers and null", () => {
    expect(taxRatePercentSchema.safeParse({ percent: 22.5 }).success).toBe(true)
    expect(taxRatePercentSchema.safeParse({ percent: 100 }).success).toBe(true)
    expect(taxRatePercentSchema.safeParse({ percent: 12.555 }).success).toBe(true) // route rounds to 2dp
    expect(taxRatePercentSchema.safeParse({ percent: null }).success).toBe(true)
  })
  it("rejects 0, negatives, >100, strings, missing key", () => {
    for (const percent of [0, -1, 100.01, "25"]) {
      expect(taxRatePercentSchema.safeParse({ percent }).success).toBe(false)
    }
    expect(taxRatePercentSchema.safeParse({}).success).toBe(false)
  })
})
```

Run: `npx vitest run __tests__/lib/bookkeeping/insight-types.test.ts __tests__/lib/bookkeeping/report-validators.test.ts`
Expected: PASS.

- [ ] **Step 2: Add the audit slug**

In `lib/audit/actions.ts`, append at the END of the `// bookkeeping` block (after `bookkeeping.home_office_percent_set` and any rows 6a added):

```ts
  { slug: "bookkeeping.tax_rate_percent_set", category: "commerce", description: "Flat effective tax rate set for the rolling forecast" },
```

- [ ] **Step 3: Write the failing route test**

```ts
// __tests__/app/api/admin/bookkeeping/insights-tax-rate.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { PATCH } from "@/app/api/admin/bookkeeping/insights/tax-rate/route"
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

describe("PATCH /api/admin/bookkeeping/insights/tax-rate", () => {
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
  it("stores under the exact key with the admin id and audits with previous/new", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(10)
    const res = await PATCH(body({ percent: 22.5 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ percent: 22.5 })
    expect(setSetting).toHaveBeenCalledWith("bookkeeping_tax_rate_percent", 22.5, ADMIN.user.id)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.tax_rate_percent_set",
        category: "commerce",
        metadata: expect.objectContaining({ previous_value: 10, new_value: 22.5 }),
      }),
    )
  })
  it("uses Math.round (not trunc) to round halves up: 12.555 -> 12.56", async () => {
    const res = await PATCH(body({ percent: 12.555 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ percent: 12.56 })
    expect(setSetting).toHaveBeenCalledWith("bookkeeping_tax_rate_percent", 12.56, ADMIN.user.id)
  })
  it("null clears the setting", async () => {
    const res = await PATCH(body({ percent: null }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ percent: null })
    expect(setSetting).toHaveBeenCalledWith("bookkeeping_tax_rate_percent", null, ADMIN.user.id)
  })
  it("500 when the write fails", async () => {
    ;(setSetting as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"))
    expect((await PATCH(body({ percent: 25 }))).status).toBe(500)
  })
})
```

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/insights-tax-rate.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 4: Write the route (the home-office PATCH cloned verbatim, key swapped)**

```ts
// app/api/admin/bookkeeping/insights/tax-rate/route.ts
// The coach/CPA-entered flat effective rate for the rolling forecast (Phase 6b, D-8).
// The product never derives the rate — "ask your CPA for a safe-harbor rate".
// Clone of the home-office percent PATCH: same gate, same 2dp rounding, same audit shape.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { taxRatePercentSchema } from "@/lib/validators/bookkeeping"

const SETTING_KEY = "bookkeeping_tax_rate_percent"

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const parsed = taxRatePercentSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const value = parsed.data.percent === null ? null : Math.round(parsed.data.percent * 100) / 100
    const previous = await getSetting<number | null>(SETTING_KEY, null)
    await setSetting(SETTING_KEY, value, session.user.id)
    void recordAudit({
      action: "bookkeeping.tax_rate_percent_set",
      category: "commerce",
      target: { type: "system_setting", id: SETTING_KEY },
      metadata: { previous_value: previous, new_value: value },
      request,
    })
    return NextResponse.json({ percent: value })
  } catch (error) {
    console.error("bookkeeping tax rate percent:", error)
    return NextResponse.json({ error: "Failed to save the tax rate" }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/insights-tax-rate.test.ts __tests__/lib/bookkeeping/report-validators.test.ts __tests__/lib/bookkeeping/insight-types.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/bookkeeping/insight-types.ts lib/validators/bookkeeping.ts lib/audit/actions.ts app/api/admin/bookkeeping/insights/tax-rate/route.ts __tests__/app/api/admin/bookkeeping/insights-tax-rate.test.ts __tests__/lib/bookkeeping/report-validators.test.ts __tests__/lib/bookkeeping/insight-types.test.ts
git commit -m "feat(bookkeeper): audited tax-rate percent PATCH + junk-defense coercion"
```

---

### Task 4: Insights route — `forecast` + `watchdog` response sections

**Files:**
- Modify: `app/api/admin/bookkeeping/insights/route.ts` (full rewrite shown below)
- Modify: `__tests__/app/api/admin/bookkeeping/insights.test.ts` (full rewrite shown below — the existing five tests are PRESERVED, mocks extended, four tests added)

**Interfaces:**
- Consumes: everything the route already imports, PLUS `coerceTaxRatePercent` (Task 3), `MIN_AGE_DAYS`/`receiptWatchdogFindings` (Task 1), `bookYtdTotals`/`taxForecast` (Task 2), `listEntriesForInsights` from `@/lib/db/bookkeeping` (existing DAL reader at `lib/db/bookkeeping.ts:384` — the D-9 dedicated YTD read).
- Produces: response gains `forecast: { ytd_from, ytd_to, rate_percent, books: Array<{ book_id, book_name, forecast: TaxForecast }> }` (BUSINESS books only) and `watchdog: WatchdogFinding[]` (page-window, all books, sorted by the finder). Everything already in the response is UNCHANGED (additive). Task 5's client types against this exactly.

**Contracts (D-9 pinned):** the forecast window is calendar YTD — `ytd_from = "<today's year>-01-01"`, `ytd_to = today` — loaded by ONE dedicated `listEntriesForInsights(ytdFrom, today)` call, INDEPENDENT of the page's `from`/`to`. Per business book: `bookYtdTotals` + `taxForecast`; the home-office deduction is `homeOfficeCandidate(ytdEntries, …)` (recomputed on the YTD window, NOT the page-window `home_office` section) and applies ONLY to its `target_book_id` (the primary business book); every other business book gets `home_office_deduction_cents: null`. Household books get NO forecast row. The watchdog section IS the page window: `receiptWatchdogFindings(bundle.entries, bundle.accounts, { today, minAgeDays: MIN_AGE_DAYS })`. The route stays UNAUDITED (JSON screen-read precedent) and unflagged. NEW route-level import of `@/lib/db/bookkeeping` requires this route's own test file to mock that module (done below); no other test file imports this route.

- [ ] **Step 1: Rewrite the test file (failing on the new sections)**

Replace `__tests__/app/api/admin/bookkeeping/insights.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/bookkeeping/insight-data", () => ({ loadInsightsBundle: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({ listEntriesForInsights: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { GET } from "@/app/api/admin/bookkeeping/insights/route"
import { auth } from "@/lib/auth"
import { loadInsightsBundle } from "@/lib/bookkeeping/insight-data"
import { recordAudit } from "@/lib/audit/record"
import { listEntriesForInsights } from "@/lib/db/bookkeeping"
import { getSetting } from "@/lib/db/system-settings"

const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const BOOK_BIZ = "b0000000-0000-4000-8000-000000000001"
const BOOK_HH = "b0000000-0000-4000-8000-000000000003"
const ACC_MEALS = "a0000000-0000-4000-8000-000000000002"
const ACC_RENT = "a0000000-0000-4000-8000-000000000010"
const ACC_HH_SENSITIVE = "a0000000-0000-4000-8000-000000000011"

const books = [
  { id: BOOK_BIZ, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, currency: "usd", owner_label: null, sort_order: 0, archived_at: null, created_at: "", updated_at: "" },
  { id: BOOK_HH, name: "Household & Personal", book_kind: "household", is_primary: false, currency: "usd", owner_label: null, sort_order: 2, archived_at: null, created_at: "", updated_at: "" },
]
const accounts = [
  { id: ACC_MEALS, book_id: BOOK_BIZ, name: "Meals (business purpose)", account_type: "expense", service_line: null, tax_category: null, sort_order: 0, is_deductible_candidate: true, requires_business_purpose: true, archived_at: null },
  { id: ACC_RENT, book_id: BOOK_HH, name: "Rent", account_type: "expense", service_line: null, tax_category: null, sort_order: 0, is_deductible_candidate: false, requires_business_purpose: false, archived_at: null },
  { id: ACC_HH_SENSITIVE, book_id: BOOK_HH, name: "HH Sensitive", account_type: "expense", service_line: null, tax_category: null, sort_order: 1, is_deductible_candidate: true, requires_business_purpose: true, archived_at: null },
]
// Page-window bundle entries. Dates are past-fixed → always ≥14 days aged at run time.
const entries = [
  { id: "e0000000-0000-4000-8000-000000000001", book_id: BOOK_BIZ, account_id: ACC_MEALS, direction: "expense", amount_cents: 2500, occurred_on: "2026-03-05", counterparty: "Chipotle", memo: null, source: "manual", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000002", book_id: BOOK_HH, account_id: ACC_RENT, direction: "expense", amount_cents: 200000, occurred_on: "2026-03-01", counterparty: "Landlord", memo: null, source: "manual", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000003", book_id: BOOK_HH, account_id: ACC_HH_SENSITIVE, direction: "expense", amount_cents: 5000, occurred_on: "2026-04-15", counterparty: "Privacy Vendor", memo: null, source: "manual", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000004", book_id: BOOK_HH, account_id: null, direction: "expense", amount_cents: 1500, occurred_on: "2026-05-20", counterparty: "Unknown", memo: null, source: "manual", business_purpose: null, document_id: null },
]
// Dedicated YTD read (D-9). DIFFERENT from the bundle so wrong-source implementations fail.
const ytdEntries = [
  { id: "e0000000-0000-4000-8000-000000000101", book_id: BOOK_BIZ, account_id: null, direction: "income", amount_cents: 100000, occurred_on: "2026-02-01", counterparty: "Stripe", memo: null, source: "platform_import", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000102", book_id: BOOK_BIZ, account_id: ACC_MEALS, direction: "expense", amount_cents: 40000, occurred_on: "2026-02-10", counterparty: "Chipotle", memo: null, source: "manual", business_purpose: null, document_id: null },
  { id: "e0000000-0000-4000-8000-000000000103", book_id: BOOK_HH, account_id: ACC_RENT, direction: "expense", amount_cents: 200000, occurred_on: "2026-02-01", counterparty: "Landlord", memo: null, source: "manual", business_purpose: null, document_id: null },
]

const req = (qs: string) => new Request(`http://x/api/admin/bookkeeping/insights?${qs}`)

function settings(homeOffice: unknown, taxRate: unknown) {
  ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) =>
    key === "bookkeeping_home_office_percent" ? homeOffice : key === "bookkeeping_tax_rate_percent" ? taxRate : null,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(loadInsightsBundle as ReturnType<typeof vi.fn>).mockResolvedValue({ books, accounts, entries })
  ;(listEntriesForInsights as ReturnType<typeof vi.fn>).mockResolvedValue(ytdEntries)
  settings(25, 25)
})

describe("GET /api/admin/bookkeeping/insights", () => {
  it("403 when unauthenticated or non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(403)
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "x", role: "client" } })
    expect((await GET(req("from=2026-01-01&to=2026-12-31"))).status).toBe(403)
    expect(loadInsightsBundle).not.toHaveBeenCalled()
    expect(listEntriesForInsights).not.toHaveBeenCalled()
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
    const hh = body.books.find((b: { book: { id: string } }) => b.book.id === BOOK_HH)
    expect(biz.deductions.substantiation_gaps).toHaveLength(1)
    expect(biz.row_count).toBe(1)
    // cross-book regression: household rent never in the business watchlist
    expect(biz.deductions.watchlist_total_cents).toBe(2500)
    expect(body.home_office.input_total_cents).toBe(200000)
    expect(body.home_office.proposed_total_cents).toBe(50000)
    expect(body.home_office.target_book_id).toBe(BOOK_BIZ)
    // year_end_flags must exclude household pollution: substantiation_gaps flag counts only business gaps (1, not 2)
    const gapsFlag = body.year_end_flags.find((f: { id: string }) => f.id === "substantiation_gaps")
    expect(gapsFlag).toBeDefined()
    expect(gapsFlag.title).toContain("1")
    // uncategorized_expenses should not be in flags (only household entry is uncategorized, filtered out)
    expect(body.year_end_flags.map((f: { id: string }) => f.id)).not.toContain("uncategorized_expenses")
    // but household book's own payload still reports its gap (fixture is live)
    expect(hh.deductions.substantiation_gaps).toHaveLength(1)
  })
  it("junk stored percent is coerced to null (no proposal)", async () => {
    settings("25", 25)
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

  // ─── Phase 6b: forecast + watchdog sections ────────────────────────────────
  it("forecast: dedicated YTD read (Jan-1 window, independent of the page window), business books only, home-office subtracted on the primary book", async () => {
    const res = await GET(req("from=2026-06-01&to=2026-06-30"))
    expect(res.status).toBe(200)
    const body = await res.json()
    // ONE dedicated YTD read with a Jan-1 window — NOT the page's from/to (D-9)
    expect(listEntriesForInsights).toHaveBeenCalledTimes(1)
    const [ytdFrom, ytdTo] = (listEntriesForInsights as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(ytdFrom).toMatch(/^\d{4}-01-01$/)
    expect(ytdTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.forecast.ytd_from).toBe(ytdFrom)
    expect(body.forecast.ytd_to).toBe(ytdTo)
    expect(body.forecast.rate_percent).toBe(25)
    // household book gets NO forecast row
    expect(body.forecast.books).toHaveLength(1)
    const biz = body.forecast.books[0]
    expect(biz.book_id).toBe(BOOK_BIZ)
    expect(biz.book_name).toBe("Darren — DJP Athlete")
    // 100000 − 40000 − (200000 × 25% = 50000 home-office, primary book only) = 10000 net → × 25% = 2500 tax.
    // Computed from the PAGE bundle instead, net would be −2500−50000 → tax 0 — this pins the YTD source.
    expect(biz.forecast.ytd_income_cents).toBe(100000)
    expect(biz.forecast.ytd_expense_cents).toBe(40000)
    expect(biz.forecast.home_office_deduction_cents).toBe(50000)
    expect(biz.forecast.estimated_net_cents).toBe(10000)
    expect(biz.forecast.estimated_tax_cents).toBe(2500)
    expect(biz.forecast.next_safe_harbor.date > ytdTo).toBe(true)
  })
  it("no tax rate → NULL estimated tax (the card shows a prompt, never a dollar figure)", async () => {
    settings(25, null)
    const body = await (await GET(req("from=2026-01-01&to=2026-12-31"))).json()
    expect(body.forecast.rate_percent).toBeNull()
    expect(body.forecast.books[0].forecast.estimated_tax_cents).toBeNull()
  })
  it("junk stored tax rate is coerced to null", async () => {
    settings(25, "25")
    const body = await (await GET(req("from=2026-01-01&to=2026-12-31"))).json()
    expect(body.forecast.rate_percent).toBeNull()
  })
  it("watchdog: computed from the PAGE window's entries (not the YTD read); unwatched + uncategorized excluded", async () => {
    const body = await (await GET(req("from=2026-01-01&to=2026-12-31"))).json()
    // Bundle has two watched aged gaps (5000 HH-Sensitive, 2500 Meals); Rent (unwatched)
    // and the account-null entry are excluded. From ytdEntries this would be ONE finding
    // (40000) — the amounts pin the source AND the amount-desc sort.
    expect(body.watchdog.map((f: { amount_cents: number }) => f.amount_cents)).toEqual([5000, 2500])
    expect(body.watchdog[0].reasons).toEqual(["no_document", "no_purpose"])
    expect(body.watchdog[0].book_id).toBe(BOOK_HH)
  })
})
```

- [ ] **Step 2: Run test to verify the new tests fail**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/insights.test.ts`
Expected: FAIL — the four Phase-6b tests fail (`body.forecast`/`body.watchdog` undefined); the five preserved tests still pass.

- [ ] **Step 3: Rewrite the route**

Replace `app/api/admin/bookkeeping/insights/route.ts` with:

```ts
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
import { listEntriesForInsights } from "@/lib/db/bookkeeping"
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/insights.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookkeeping/insights/route.ts __tests__/app/api/admin/bookkeeping/insights.test.ts
git commit -m "feat(bookkeeper): insights route — YTD tax forecast + watchdog sections"
```

---

### Task 5: Insights page — ForecastCard + WatchdogCard

**Files:**
- Modify: `components/admin/bookkeeping/InsightsClient.tsx` (the ONLY file; `app/(admin)/admin/books/insights/page.tsx` is untouched — the rate editor initializes from the fetch response, not a server prop)

**Interfaces:**
- Consumes: Task 4's response shape; `import type { TaxForecast } from "@/lib/bookkeeping/tax-forecast"`; `import type { WatchdogFinding } from "@/lib/bookkeeping/receipt-watchdog"`; existing `formatCents`, `Button`, etc.
- Produces: two new cards inside the per-book tab body. No unit test (no component tests exist house-wide for these clients); verification is tsc-filter + scoped suites + the Task 7 checks.

**Contracts:** honesty copy VERBATIM from spec §4.4: *"Estimate only — gross, cash-basis, flat rate you/your CPA entered; no entity/SE/QBI nuance. Your CPA files."* No rate → the prompt (*"No tax rate set — ask your CPA for a safe-harbor rate, then enter it below."*) and NO estimated-tax dollar figure (YTD net still shows, per D-8's "net still shown"). ForecastCard renders ONLY on business-book tabs; WatchdogCard on every tab (findings filtered to the active book). Inline rate editor is the home-office editor cloned (number input 0.01–100 step 0.01 + Save + Clear, PATCH `/api/admin/bookkeeping/insights/tax-rate`, refetch on success, toast on failure). All money through `formatCents(cents, active.book.currency)`. Card order inside a tab: …vendors card → **WatchdogCard** → **ForecastCard** (business only) → home-office card.

- [ ] **Step 1: Add imports + types + state + handlers**

In `components/admin/bookkeeping/InsightsClient.tsx`:

(a) Add to the import block:

```tsx
import type { WatchdogFinding } from "@/lib/bookkeeping/receipt-watchdog"
import type { TaxForecast } from "@/lib/bookkeeping/tax-forecast"
```

(b) Extend the local response types (after `BookInsights`):

```tsx
interface ForecastBookRow {
  book_id: string
  book_name: string
  forecast: TaxForecast
}
```

and add to `InsightsData`:

```tsx
  forecast: { ytd_from: string; ytd_to: string; rate_percent: number | null; books: ForecastBookRow[] }
  watchdog: WatchdogFinding[]
```

(c) Add state (beside `savingPercent`, line ~64):

```tsx
  const [rateInput, setRateInput] = useState("")
  const [savingRate, setSavingRate] = useState(false)
```

(d) In `fetchInsights`, inside the `if (requestId === fetchRequestIdRef.current)` success block, after `setPercentInput(...)`:

```tsx
        setRateInput(body.forecast.rate_percent?.toString() ?? "")
```

(e) Add the save handlers (directly after `handleSavePercent`, mirroring `savePercent`/`handleSavePercent`):

```tsx
  const saveRate = useCallback(
    async (value: number | null) => {
      setSavingRate(true)
      try {
        const res = await fetch("/api/admin/bookkeeping/insights/tax-rate", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ percent: value }),
        })
        if (!res.ok) throw new Error("failed")
        toast.success(value === null ? "Tax rate cleared" : "Tax rate saved")
        void fetchInsights()
      } catch {
        toast.error("Failed to save the tax rate")
      } finally {
        setSavingRate(false)
      }
    },
    [fetchInsights],
  )

  const handleSaveRate = () => {
    const parsed = Number(rateInput)
    if (!Number.isFinite(parsed) || parsed < 0.01 || parsed > 100) {
      toast.error("Enter a percent between 0.01 and 100")
      return
    }
    void saveRate(Math.round(parsed * 100) / 100)
  }
```

(f) Add derived values (after the existing `const targetCurrency = ...`, line ~145):

```tsx
  const watchdogRows = data && active ? data.watchdog.filter((f) => f.book_id === active.book.id) : []
  const forecastForBook =
    data && active ? (data.forecast.books.find((f) => f.book_id === active.book.id) ?? null) : null
```

NOTE: `active` is declared AFTER `targetCurrency` in the current file (line 143-145 order is `active` → `targetBook` → `targetCurrency`) — place these two consts after `targetCurrency` so `active` is in scope.

- [ ] **Step 2: Insert the two cards**

Insertion point: inside the per-book tab body, between the closing `</div>` of the "Vendors & subscriptions" card (line ~544) and the existing `{data && bookId === data.home_office.target_book_id ? homeOfficeCard : null}` line (~546):

```tsx
                {/* Missing receipts & purposes (Phase 6b watchdog, D-10 — a chore list, no flag) */}
                <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                  <h2 className="text-sm font-heading text-primary mb-3">Missing receipts &amp; purposes</h2>
                  <p
                    className={`text-sm font-medium mb-3 inline-block rounded-md px-3 py-2 ${
                      watchdogRows.length > 0 ? "bg-warning/10 text-warning" : "text-muted-foreground"
                    }`}
                  >
                    {watchdogRows.length} entries ·{" "}
                    {formatCents(
                      watchdogRows.reduce((sum, f) => sum + f.amount_cents, 0),
                      active.book.currency,
                    )}
                  </p>
                  {watchdogRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing is missing a receipt or business purpose (entries 14+ days old).
                    </p>
                  ) : (
                    <>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                            <th className="py-1 pr-4 font-medium">Date</th>
                            <th className="py-1 pr-4 font-medium">Amount</th>
                            <th className="py-1 pr-4 font-medium">Counterparty</th>
                            <th className="py-1 pr-4 font-medium">Category</th>
                            <th className="py-1 pr-4 font-medium">Missing</th>
                          </tr>
                        </thead>
                        <tbody>
                          {watchdogRows.slice(0, VISIBLE_ROW_CAP).map((f) => (
                            <tr key={f.entry_id} className="border-b last:border-0">
                              <td className="py-1.5 pr-4">{f.occurred_on}</td>
                              <td className="py-1.5 pr-4">{formatCents(f.amount_cents, active.book.currency)}</td>
                              <td className="py-1.5 pr-4">{f.counterparty ?? "—"}</td>
                              <td className="py-1.5 pr-4">{f.account_name}</td>
                              <td className="py-1.5 pr-4">
                                <span className="flex flex-wrap gap-1">
                                  {f.reasons.map((r) => (
                                    <span
                                      key={r}
                                      className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
                                    >
                                      {r === "no_document" ? "no receipt" : "no purpose"}
                                    </span>
                                  ))}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {watchdogRows.length > VISIBLE_ROW_CAP ? (
                        <p className="text-xs text-muted-foreground mt-2">
                          and {watchdogRows.length - VISIBLE_ROW_CAP} more
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                {/* Rolling tax forecast (Phase 6b, D-8/D-9 — business books only) */}
                {data && forecastForBook && active.book.book_kind === "business" ? (
                  <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-sm font-heading text-primary">Rolling tax forecast</h2>
                      <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                        ESTIMATE
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Estimate only — gross, cash-basis, flat rate you/your CPA entered; no entity/SE/QBI nuance. Your
                      CPA files.
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Year-to-date {data.forecast.ytd_from} → {data.forecast.ytd_to} — independent of the period
                      selected above.
                    </p>
                    <div className="space-y-1 text-sm">
                      <p>
                        YTD income{" "}
                        <span className="font-semibold text-success">
                          {formatCents(forecastForBook.forecast.ytd_income_cents, active.book.currency)}
                        </span>
                      </p>
                      <p>
                        YTD expenses{" "}
                        <span className="font-semibold text-error">
                          {formatCents(forecastForBook.forecast.ytd_expense_cents, active.book.currency)}
                        </span>
                      </p>
                      {forecastForBook.forecast.home_office_deduction_cents !== null ? (
                        <p>
                          Home-office proposal{" "}
                          <span className="font-semibold">
                            −{formatCents(forecastForBook.forecast.home_office_deduction_cents, active.book.currency)}
                          </span>
                        </p>
                      ) : null}
                      <p>
                        YTD net{" "}
                        <span
                          className={`font-semibold ${
                            forecastForBook.forecast.estimated_net_cents >= 0 ? "text-success" : "text-error"
                          }`}
                        >
                          {formatCents(forecastForBook.forecast.estimated_net_cents, active.book.currency)}
                        </span>
                      </p>
                      {forecastForBook.forecast.estimated_tax_cents === null ? (
                        <p className="text-muted-foreground">
                          No tax rate set — ask your CPA for a safe-harbor rate, then enter it below.
                        </p>
                      ) : (
                        <p>
                          Estimated tax at {forecastForBook.forecast.rate_percent}%{" "}
                          <span className="font-semibold">
                            {formatCents(forecastForBook.forecast.estimated_tax_cents, active.book.currency)}
                          </span>
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Next quarterly safe-harbor date: {forecastForBook.forecast.next_safe_harbor.label} (generic IRS
                        calendar — your CPA confirms your dates).
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                      <input
                        type="number"
                        min={0.01}
                        max={100}
                        step={0.01}
                        value={rateInput}
                        onChange={(e) => setRateInput(e.currentTarget.value)}
                        disabled={savingRate}
                        className="border-border rounded-md border px-3 py-2 text-sm w-28"
                        aria-label="Effective tax rate percent"
                      />
                      <Button size="sm" disabled={savingRate} onClick={handleSaveRate}>
                        Save
                      </Button>
                      <Button size="sm" variant="outline" disabled={savingRate} onClick={() => void saveRate(null)}>
                        Clear
                      </Button>
                    </div>
                  </div>
                ) : null}
```

- [ ] **Step 3: Typecheck + scoped suites still green**

Run: `npx tsc --noEmit | Select-String "InsightsClient|receipt-watchdog|tax-forecast|insights"`
Expected: no output (the repo's ~155 pre-existing tsc errors are test/.next noise — only OUR files must be absent). (tsc writes diagnostics to stdout; redirecting stderr with `2>&1` is unnecessary and, in PowerShell 5.1, wraps native-command stderr lines in ErrorRecords that flip `$?` to false even on a clean run.)
Run: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/admin/bookkeeping/InsightsClient.tsx
git commit -m "feat(bookkeeper): insights page — watchdog + rolling-forecast cards with inline rate editor"
```

---

### Task 6: Weekly watchdog cron — email builder, internal route, functions delegator, EXPECTED_CRONS

**THE THREE-WAY BYTE-IDENTICAL STRING CONTRACT (this task touches ALL THREE files):** the functions delegator POSTs to `/api/admin/internal/bookkeeping-receipt-watchdog` ↔ the route directory is `app/api/admin/internal/bookkeeping-receipt-watchdog/` ↔ the name `bookkeepingReceiptWatchdogCron` is used identically in (a) the functions export, (b) the route's `logCronStart`, (c) the `EXPECTED_CRONS` entry. Copy-paste the strings — never retype them.

**Files:**
- Create: `lib/bookkeeping/email-watchdog.ts`
- Create: `app/api/admin/internal/bookkeeping-receipt-watchdog/route.ts`
- Modify: `functions/src/index.ts` (append the cron after `bookkeepingQuarterlyPackCron`, which ends at line ~1946)
- Modify: `lib/automation/automation-health-scanner.ts` (append one `EXPECTED_CRONS` row, line ~32)
- Modify: `lib/audit/actions.ts` (append the `bookkeeping.receipt_watchdog_emailed` slug)
- Test: `__tests__/lib/bookkeeping/email-watchdog.test.ts`; `__tests__/api/admin/internal/bookkeeping-receipt-watchdog.test.ts` (clone of `bookkeeping-quarterly-pack.test.ts` in the same directory)

**Interfaces:**
- Consumes: `resend`, `FROM_EMAIL` from `@/lib/resend`; `formatCents` from `@/lib/bookkeeping/money`; `WatchdogFinding`, `MIN_AGE_DAYS`, `receiptWatchdogFindings` (Task 1); `isCronSkipped` (`lib/db/system-settings.ts:49`); `createServiceRoleClient` from `@/lib/supabase`; `logCronStart`/`logCronEnd` (`lib/db/cron-runs.ts` — route is the SINGLE cron_runs owner; the functions side NEVER logs); `listEntriesForInsights`/`listAccountsForInsights` (`lib/db/bookkeeping.ts:384/:401`); `recordAudit`.
- Produces: `WATCHDOG_EMAIL_ROW_CAP` (const `25`), `receiptWatchdogEmailHtml(findings: WatchdogFinding[]): string`, `sendReceiptWatchdogEmail(input: { findings: WatchdogFinding[] }): Promise<{ error: string | null }>`; the internal `POST` route; the `bookkeepingReceiptWatchdogCron` functions export; audit slug `bookkeeping.receipt_watchdog_emailed`.

**Pinned semantics (spec §4.2, D-10):** cron fires Tue 07:00 UTC (`"0 7 * * 2"` — clear of the Mon inbox-SLA/revenue and daily 03/04/05/08 crons). Functions config declares `secrets: [internalCronToken, appUrl]` ONLY — the quarterly-pack over-declares `supabaseUrl`/`supabaseServiceRoleKey` it never uses; do NOT copy that. Route flow: Bearer triple-clause 401 → `isCronSkipped({ enabledKey: "cron_bookkeeping_receipt_watchdog_enabled", defaultEnabled: false })` → 200 `{skipped}` success-skip (NO logCronStart) → `logCronStart` → trailing-365-day window reads → findings → empty ⇒ `logCronEnd success {findings: 0}`, NO email → else email the COACH (top 25 by amount + total count + total cents + link to `/admin/books/insights`), audit `bookkeeping.receipt_watchdog_emailed` (commerce, system-actor override, fire-and-forget) → `logCronEnd success {findings, emailed}`. Failure: `logCronEnd failed` + 500. Email recipient is the COACH only (a chore list, not a filing artifact — no accountant, no cc). `EXPECTED_CRONS` append `{ name: "bookkeepingReceiptWatchdogCron", sla_hours: 204 }` (weekly 168h + slack; the scanner test derives from the array — append-safe).

- [ ] **Step 1: Write the failing email-builder test**

```ts
// __tests__/lib/bookkeeping/email-watchdog.test.ts
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

vi.mock("@/lib/resend", () => ({
  resend: { emails: { send: vi.fn() } },
  FROM_EMAIL: "DJP <no-reply@darrenjpaul.com>",
}))

import { resend } from "@/lib/resend"
import {
  WATCHDOG_EMAIL_ROW_CAP,
  receiptWatchdogEmailHtml,
  sendReceiptWatchdogEmail,
} from "@/lib/bookkeeping/email-watchdog"
import type { WatchdogFinding } from "@/lib/bookkeeping/receipt-watchdog"

const send = resend.emails.send as ReturnType<typeof vi.fn>

let seq = 0
function finding(over: Partial<WatchdogFinding>): WatchdogFinding {
  seq += 1
  return {
    entry_id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: "b0000000-0000-4000-8000-000000000001",
    account_id: "a0000000-0000-4000-8000-000000000001",
    account_name: "Equipment",
    occurred_on: "2026-06-01",
    amount_cents: 5000,
    counterparty: "Rogue",
    reasons: ["no_document"],
    ...over,
  }
}

let origResendKey: string | undefined
let origCoachEmail: string | undefined

beforeEach(() => {
  vi.clearAllMocks()
  origResendKey = process.env.RESEND_API_KEY
  origCoachEmail = process.env.COACH_EMAIL
  process.env.RESEND_API_KEY = "re_test"
  process.env.COACH_EMAIL = "darren@darrenjpaul.com"
})

afterAll(() => {
  if (origResendKey !== undefined) process.env.RESEND_API_KEY = origResendKey
  else delete process.env.RESEND_API_KEY
  if (origCoachEmail !== undefined) process.env.COACH_EMAIL = origCoachEmail
  else delete process.env.COACH_EMAIL
})

describe("receiptWatchdogEmailHtml", () => {
  it("pins the row cap at 25", () => {
    expect(WATCHDOG_EMAIL_ROW_CAP).toBe(25)
  })
  it("carries count, total, reason labels, the insights link, and the honesty line", () => {
    const html = receiptWatchdogEmailHtml([
      finding({ amount_cents: 5000 }),
      finding({ amount_cents: 2500, reasons: ["no_purpose"], account_name: "Meals" }),
    ])
    expect(html).toContain("<strong>2</strong>") // count, discriminated (not just any "2" substring — every date in the fixture contains one)
    expect(html).toContain("$75.00") // 5000 + 2500 cents
    expect(html).toContain("no receipt")
    expect(html).toContain("no purpose")
    expect(html).toContain("https://www.darrenjpaul.com/admin/books/insights")
    expect(html).toContain("CPA")
  })
  it("caps at 25 rows and says how many more (26th finding never rendered)", () => {
    const findings = Array.from({ length: 26 }, (_, i) =>
      finding({ amount_cents: 10000 - i, counterparty: `Vendor ${i}` }),
    )
    const html = receiptWatchdogEmailHtml(findings)
    expect(html).toContain("Vendor 24")
    expect(html).not.toContain("Vendor 25") // the 26th (index 25) is beyond the cap
    expect(html).toContain("and 1 more")
  })
  it("escapes HTML in user-entered strings", () => {
    const html = receiptWatchdogEmailHtml([finding({ counterparty: "<b>Rogue</b>" })])
    expect(html).not.toContain("<b>Rogue</b>")
    expect(html).toContain("&lt;b&gt;Rogue&lt;/b&gt;")
  })
})

describe("sendReceiptWatchdogEmail", () => {
  it("sends to the coach with count + total in the subject", async () => {
    send.mockResolvedValue({ data: { id: "email_1" }, error: null })
    const res = await sendReceiptWatchdogEmail({ findings: [finding({}), finding({ amount_cents: 2500 })] })
    expect(res.error).toBeNull()
    const arg = send.mock.calls[0][0]
    expect(arg.to).toBe("darren@darrenjpaul.com")
    expect(arg.subject).toContain("2 entries") // count, discriminated (matches the implementation's own pluralized string)
    expect(arg.subject).toContain("$75.00")
  })
  it("fails fast when RESEND_API_KEY is unset (outbound must never silently no-op)", async () => {
    delete process.env.RESEND_API_KEY
    const res = await sendReceiptWatchdogEmail({ findings: [finding({})] })
    expect(res.error).toMatch(/RESEND_API_KEY/)
    expect(send).not.toHaveBeenCalled()
  })
  it("fails fast when COACH_EMAIL is unset (coach is the ONLY recipient)", async () => {
    delete process.env.COACH_EMAIL
    const res = await sendReceiptWatchdogEmail({ findings: [finding({})] })
    expect(res.error).toMatch(/COACH_EMAIL/)
    expect(send).not.toHaveBeenCalled()
  })
  it("returns the resend error message on failure", async () => {
    send.mockResolvedValue({ data: null, error: { message: "boom" } })
    const res = await sendReceiptWatchdogEmail({ findings: [finding({})] })
    expect(res.error).toBe("boom")
  })
})
```

Run: `npx vitest run __tests__/lib/bookkeeping/email-watchdog.test.ts`
Expected: FAIL — cannot resolve `@/lib/bookkeeping/email-watchdog`.

- [ ] **Step 2: Write the email builder**

```ts
// lib/bookkeeping/email-watchdog.ts
// Phase-6b outbound: the weekly missing-receipt chore list, emailed to the COACH only
// (D-10 — a chore list, not a filing artifact; no accountant recipient, no cc).
// Fails LOUD when Resend/coach aren't configured — outbound must never silently no-op.
import { resend, FROM_EMAIL } from "@/lib/resend"
import { formatCents } from "./money"
import type { WatchdogFinding } from "./receipt-watchdog"

/** Top-N rows rendered in the email (spec §4.2, pinned). */
export const WATCHDOG_EMAIL_ROW_CAP = 25

// Hardcoded prod origin — the accountant-pack DOWNLOAD_BASE precedent.
const INSIGHTS_URL = "https://www.darrenjpaul.com/admin/books/insights"

const REASON_LABELS: Record<string, string> = {
  no_document: "no receipt",
  no_purpose: "no purpose",
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function receiptWatchdogEmailHtml(findings: WatchdogFinding[]): string {
  const totalCents = findings.reduce((sum, f) => sum + f.amount_cents, 0)
  const rows = findings
    .slice(0, WATCHDOG_EMAIL_ROW_CAP)
    .map(
      (f) => `
      <tr>
        <td style="padding:2px 8px;">${f.occurred_on}</td>
        <td style="padding:2px 8px;">${formatCents(f.amount_cents)}</td>
        <td style="padding:2px 8px;">${escapeHtml(f.counterparty ?? "—")}</td>
        <td style="padding:2px 8px;">${escapeHtml(f.account_name)}</td>
        <td style="padding:2px 8px;">${f.reasons.map((r) => REASON_LABELS[r] ?? r).join(", ")}</td>
      </tr>`,
    )
    .join("")
  return `
  <div style="font-family: sans-serif; max-width: 640px;">
    <h2>DJP Athlete — Missing receipts &amp; purposes</h2>
    <p><strong>${findings.length}</strong> expense ${findings.length === 1 ? "entry" : "entries"} totaling <strong>${formatCents(totalCents)}</strong> ${findings.length === 1 ? "is" : "are"} missing a receipt or business purpose (14+ days old, trailing year).</p>
    <table style="font-size: 13px; border-collapse: collapse;">
      <tr style="text-align: left; color: #444;">
        <th style="padding:2px 8px;">Date</th><th style="padding:2px 8px;">Amount</th><th style="padding:2px 8px;">Counterparty</th><th style="padding:2px 8px;">Category</th><th style="padding:2px 8px;">Missing</th>
      </tr>
      ${rows}
    </table>
    ${
      findings.length > WATCHDOG_EMAIL_ROW_CAP
        ? `<p style="font-size:12px;color:#888;">…and ${findings.length - WATCHDOG_EMAIL_ROW_CAP} more.</p>`
        : ""
    }
    <p><a href="${INSIGHTS_URL}">Open the insights page</a> to work through the list.</p>
    <p style="font-size: 12px; color: #888;">A chore list for record-keeping — not tax advice; your CPA files.</p>
  </div>`
}

export async function sendReceiptWatchdogEmail(input: {
  findings: WatchdogFinding[]
}): Promise<{ error: string | null }> {
  if (!process.env.RESEND_API_KEY) return { error: "RESEND_API_KEY not configured" }
  const coach = process.env.COACH_EMAIL
  if (!coach) return { error: "COACH_EMAIL not configured" }
  const totalCents = input.findings.reduce((sum, f) => sum + f.amount_cents, 0)
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: coach,
    subject: `Missing receipts — ${input.findings.length} ${input.findings.length === 1 ? "entry" : "entries"}, ${formatCents(totalCents)}`,
    html: receiptWatchdogEmailHtml(input.findings),
  })
  if (error) return { error: error.message ?? "Resend send failed" }
  return { error: null }
}
```

Run: `npx vitest run __tests__/lib/bookkeeping/email-watchdog.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing internal-route test**

(Bookkeeping fixture logic runs REAL here — only IO seams are mocked; the finder is pure, so feeding it fixture rows is a stronger test than mocking it.)

```ts
// __tests__/api/admin/internal/bookkeeping-receipt-watchdog.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({ listEntriesForInsights: vi.fn(), listAccountsForInsights: vi.fn() }))
vi.mock("@/lib/bookkeeping/email-watchdog", () => ({
  sendReceiptWatchdogEmail: vi.fn(),
  WATCHDOG_EMAIL_ROW_CAP: 25,
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { isCronSkipped } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listAccountsForInsights, listEntriesForInsights } from "@/lib/db/bookkeeping"
import { sendReceiptWatchdogEmail } from "@/lib/bookkeeping/email-watchdog"
import { recordAudit } from "@/lib/audit/record"
import { POST } from "@/app/api/admin/internal/bookkeeping-receipt-watchdog/route"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`
const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_WATCHED = "a0000000-0000-4000-8000-000000000001"

const accounts = [
  { id: ACC_WATCHED, book_id: BOOK, name: "Equipment", account_type: "expense", service_line: null, tax_category: null, sort_order: 0, is_deductible_candidate: true, requires_business_purpose: false, archived_at: null },
]
// Far-past date → aged no matter when the suite runs; document missing → a REAL finding
// through the REAL (unmocked) pure finder.
const agedEntry = {
  id: "e0000000-0000-4000-8000-000000000001", book_id: BOOK, account_id: ACC_WATCHED,
  direction: "expense", amount_cents: 5000, occurred_on: "2020-06-01", counterparty: "Rogue",
  memo: null, source: "manual", business_purpose: null, document_id: null,
}

function makeRequest(authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/bookkeeping-receipt-watchdog", {
    method: "POST",
    headers: { authorization: authHeader },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
  ;(logCronStart as ReturnType<typeof vi.fn>).mockResolvedValue("run-1")
  ;(logCronEnd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(listEntriesForInsights as ReturnType<typeof vi.fn>).mockResolvedValue([agedEntry])
  ;(listAccountsForInsights as ReturnType<typeof vi.fn>).mockResolvedValue(accounts)
  ;(sendReceiptWatchdogEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
})

describe("POST /api/admin/internal/bookkeeping-receipt-watchdog", () => {
  it("401 with a missing bearer token", async () => {
    const res = await POST(makeRequest(""))
    expect(res.status).toBe(401)
    expect(isCronSkipped).not.toHaveBeenCalled()
  })

  it("401 with a wrong bearer token", async () => {
    const res = await POST(makeRequest("Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("200 {skipped} with no logCronStart when the flag is off (success-skip)", async () => {
    ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).skipped).toBe("disabled")
    expect(logCronStart).not.toHaveBeenCalled()
    expect(sendReceiptWatchdogEmail).not.toHaveBeenCalled()
  })

  it("empty findings → success-skip, NO email, logCronEnd success {findings: 0}", async () => {
    ;(listEntriesForInsights as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).findings).toBe(0)
    expect(sendReceiptWatchdogEmail).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ findings: 0 }),
    )
  })

  it("happy path: trailing window read, email sent, system-actor audit, single-owner cron name", async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, findings: 1, emailed: true })
    // THE byte-identical cron name — the same string EXPECTED_CRONS and functions/ must use
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "bookkeepingReceiptWatchdogCron")
    const [from, to] = (listEntriesForInsights as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(from < to).toBe(true) // trailing window, not a single day
    expect(sendReceiptWatchdogEmail).toHaveBeenCalledWith({
      findings: [expect.objectContaining({ entry_id: agedEntry.id, reasons: ["no_document"], amount_cents: 5000 })],
    })
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.receipt_watchdog_emailed",
        category: "commerce",
        outcome: "success",
        actor: expect.objectContaining({ role: "system" }),
        metadata: expect.objectContaining({ findings: 1, total_cents: 5000 }),
      }),
    )
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ findings: 1, emailed: true }),
    )
  })

  it("500 + logCronEnd failed when the send errors", async () => {
    ;(sendReceiptWatchdogEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "resend boom" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "failed",
      expect.objectContaining({ message: expect.stringContaining("resend boom") }),
    )
  })
})
```

Run: `npx vitest run __tests__/api/admin/internal/bookkeeping-receipt-watchdog.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 4: Write the internal route (quarterly-pack template; route = SINGLE cron_runs owner)**

```ts
// app/api/admin/internal/bookkeeping-receipt-watchdog/route.ts
// POST /api/admin/internal/bookkeeping-receipt-watchdog
// Called by functions bookkeepingReceiptWatchdogCron (Tue 07:00 UTC).
// Scans the trailing 365 days for aged expense entries missing a receipt and/or a
// business purpose and emails the COACH the chore list. This route is the SINGLE
// cron_runs owner under "bookkeepingReceiptWatchdogCron" — functions/ must not log.
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listAccountsForInsights, listEntriesForInsights } from "@/lib/db/bookkeeping"
import { MIN_AGE_DAYS, receiptWatchdogFindings } from "@/lib/bookkeeping/receipt-watchdog"
import { WATCHDOG_EMAIL_ROW_CAP, sendReceiptWatchdogEmail } from "@/lib/bookkeeping/email-watchdog"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 120

const TRAILING_DAYS = 365

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_bookkeeping_receipt_watchdog_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingReceiptWatchdogCron")
  try {
    const today = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - TRAILING_DAYS * 86_400_000).toISOString().slice(0, 10)
    const [entries, accounts] = await Promise.all([
      listEntriesForInsights(from, today),
      listAccountsForInsights(),
    ])
    const findings = receiptWatchdogFindings(entries, accounts, { today, minAgeDays: MIN_AGE_DAYS })
    if (findings.length === 0) {
      await logCronEnd(supabase, runId, "success", { findings: 0 })
      return NextResponse.json({ ok: true, findings: 0 })
    }
    const totalCents = findings.reduce((sum, f) => sum + f.amount_cents, 0)
    const { error } = await sendReceiptWatchdogEmail({ findings })
    if (error) throw new Error(error)

    void recordAudit({
      action: "bookkeeping.receipt_watchdog_emailed",
      category: "commerce",
      outcome: "success",
      actor: { id: null, email: "bookkeepingReceiptWatchdogCron", role: "system" },
      metadata: {
        findings: findings.length,
        total_cents: totalCents,
        emailed_rows: Math.min(findings.length, WATCHDOG_EMAIL_ROW_CAP),
        window_from: from,
        window_to: today,
        trigger: "weekly_cron",
      },
    })
    await logCronEnd(supabase, runId, "success", { findings: findings.length, emailed: true })
    return NextResponse.json({ ok: true, findings: findings.length, emailed: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[bookkeeping-receipt-watchdog] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

Run: `npx vitest run __tests__/api/admin/internal/bookkeeping-receipt-watchdog.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the audit slug**

In `lib/audit/actions.ts`, append at the END of the `// bookkeeping` block (below the Task-3 row):

```ts
  { slug: "bookkeeping.receipt_watchdog_emailed", category: "commerce", description: "Weekly missing-receipt watchdog email sent to the coach" },
```

- [ ] **Step 6: Append the functions delegator**

In `functions/src/index.ts`, append AFTER the `bookkeepingQuarterlyPackCron` block (ends ~line 1946). Secrets are `[internalCronToken, appUrl]` ONLY — both already defined at the top of the file (lines 17/19); do NOT copy the quarterly-pack's over-declared supabase secrets. The POST path below is byte-identical to the Task-4… route directory (three-way contract):

```ts
// ─── Bookkeeping Receipt Watchdog (weekly Tue 07:00 UTC) ─────────────────────
// AI Bookkeeper Phase 6b. POSTs to /api/admin/internal/bookkeeping-receipt-watchdog,
// which scans the trailing 365 days for aged expense entries missing receipts /
// business purposes and emails the coach the chore list. Gated by
// system_settings.cron_bookkeeping_receipt_watchdog_enabled (default false, seeded
// by migration 00188). The route owns logCronStart/logCronEnd under
// "bookkeepingReceiptWatchdogCron" — this function must NOT log cron_runs itself
// (single-owner rule; the quarterly-pack precedent). Pure fetch-delegator: only
// internalCronToken + appUrl are used, so only those secrets are declared.
export const bookkeepingReceiptWatchdogCron = onSchedule(
  {
    schedule: "0 7 * * 2",
    timeZone: "Etc/UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[bookkeepingReceiptWatchdogCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/bookkeeping-receipt-watchdog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[bookkeepingReceiptWatchdogCron]", res.status, body)
        return
      }
      console.log("[bookkeepingReceiptWatchdogCron]", res.status, body)
    } catch (err) {
      console.error("[bookkeepingReceiptWatchdogCron] failed:", err)
    }
  },
)
```

- [ ] **Step 7: Append the EXPECTED_CRONS entry**

In `lib/automation/automation-health-scanner.ts`, append inside the `EXPECTED_CRONS` array (after the `bookkeepingQuarterlyPackCron` row at line 32) — the NAME is the byte-identical three-way string:

```ts
  { name: "bookkeepingReceiptWatchdogCron", sla_hours: 204 }, // weekly Tue 07:00 (+ slack)
```

Then run the scanner suite (it derives from the array — append-safe, but verify):
Run: `npx vitest run __tests__/lib/automation/automation-health-scanner.test.ts`
Expected: PASS.

- [ ] **Step 8: functions build + string-contract grep**

Run (Bash): `cd functions && npm run build`
Expected: clean tsc.
Run: `npx vitest run __tests__/api/admin/internal/bookkeeping-receipt-watchdog.test.ts __tests__/lib/bookkeeping/email-watchdog.test.ts`
Expected: PASS.
Three-way contract proof (PowerShell `Select-String`, not `rg` — this box has no reliable ripgrep on PATH and `npx rg` does not resolve to ripgrep):
Run: `Select-String -Path functions/src/index.ts,app/api/admin/internal/bookkeeping-receipt-watchdog/route.ts -Pattern "bookkeeping-receipt-watchdog"`
Expected: at least one match line from EACH of the two files (check the `Path`/filename column on each returned match).
Run: `Select-String -Path functions/src/index.ts,app/api/admin/internal/bookkeeping-receipt-watchdog/route.ts,lib/automation/automation-health-scanner.ts -Pattern "bookkeepingReceiptWatchdogCron"`
Expected: at least one match line from EACH of the three files.

- [ ] **Step 9: Commit**

```bash
git add lib/bookkeeping/email-watchdog.ts app/api/admin/internal/bookkeeping-receipt-watchdog/route.ts functions/src/index.ts lib/automation/automation-health-scanner.ts lib/audit/actions.ts __tests__/lib/bookkeeping/email-watchdog.test.ts __tests__/api/admin/internal/bookkeeping-receipt-watchdog.test.ts
git commit -m "feat(bookkeeper): weekly receipt-watchdog cron — coach email, internal route, health-scanner entry"
```

---

### Task 7: Full verification

**Files:**
- Create (scratchpad only, never committed): an optional `tsx` proof script in the session scratchpad dir.

- [ ] **Step 1: Scoped suites (all bookkeeping roots, old and new)**

Run: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/api/admin/bookkeeping __tests__/api/admin/internal __tests__/lib/automation/automation-health-scanner.test.ts`
Expected: PASS — including the UNTOUCHED `deduction-finder.test.ts` (the extraction proof) and the pre-existing `bookkeeping-quarterly-pack.test.ts`.

- [ ] **Step 2: Full suite vs the known-red baseline**

Run: `npm run test:run` (capture output). Compare failures against the known-red family (uploads/shop, import-excel-route, admin-nav, webhook-external, events). Any OTHER red: `git stash` the sub-phase's diff, re-run that file, unstash — only chase it if it's ours.

- [ ] **Step 3: Builds (each its OWN command — NEVER `&&` after tests)**

Run: `npm run build`
Expected: GREEN. (Silent exit-4 at "Running TypeScript" with no diagnostic = memory flake → re-run once before diagnosing.)
Run (Bash): `cd functions && npm run build`
Expected: clean.
Run (Bash): `cd functions && npm test`
Expected: PASS (6b adds no functions tests; the suite must simply not regress).

- [ ] **Step 4: No-ledger-write + boundary grep proofs**

All three checks use PowerShell `Select-String` (not `rg`/`npx rg` — this box has no reliable ripgrep on PATH and `npx rg` does not resolve to ripgrep; keep this consistent with Task 6 Step 8's mechanism).
Run: `Get-ChildItem -Recurse -File lib/bookkeeping/receipt-watchdog.ts, lib/bookkeeping/tax-forecast.ts, lib/bookkeeping/email-watchdog.ts, app/api/admin/bookkeeping/insights, app/api/admin/internal/bookkeeping-receipt-watchdog | Select-String -Pattern "insertReceiptEntry|createEntry|insertImportedEntries|insertAmazonEntries|updateEntry|deleteEntry"`
Expected: zero matches (nothing in 6b writes the ledger).
Run: `Select-String -Path lib/bookkeeping/receipt-watchdog.ts, lib/bookkeeping/tax-forecast.ts, lib/bookkeeping/email-watchdog.ts -Pattern "payments|client_packages|event_signups|shop_orders|client_memberships"`
Expected: zero matches (ledger-bundle-only rule).
Run: `Select-String -Path functions/src/index.ts -Pattern "logCronStart|logCronEnd|cron_runs" | Select-String -Pattern "watchdog"`
Expected: zero matches (functions side never logs cron_runs — single-owner proof).

- [ ] **Step 5: Live forecast exact-cents proof (optional here; REQUIRED at the whole-phase §9 gate)**

If run now: insert sentinel rows via `mcp__supabase__execute_sql` (ids prefixed `f6b00000-`, occurred_on inside the CURRENT year so the YTD window catches them): one business income entry $1,000.00 and one business expense $300.00. Set the tax rate to 20 via the live PATCH or SQL (`bookkeeping_tax_rate_percent = 20`). Run a scratchpad `tsx` script calling the REAL `listEntriesForInsights(<Jan 1>, <today>)` + `bookYtdTotals` + `taxForecast` and print: net 70000¢ → tax 14000¢ exactly. Then DELETE all `f6b00000-%` rows AND the rate setting if it wasn't previously set; SQL-verify 0 sentinel rows remain. NEVER touch non-sentinel rows. (The watchdog cron's live proof waits for the flag flip — it is OFF by design on arrival.)

- [ ] **Step 6: Hand off**

No push (6b touches `functions/**` — the eventual push deploys via GHA; state this in the final report). The Opus whole-branch review must trace: (a) the extracted `isBlankPurpose` — Phase-5 behavior unchanged, its test file untouched; (b) one watchdog finding from fixture row → reasons → sort → email row cap; (c) one forecast dollar: YTD entry → `bookYtdTotals` → home-office subtraction (primary book only) → `Math.round` single point → the card; (d) the three-way byte-identical string contract.

---

## Self-Review (done at plan time)

1. **Spec coverage:** §4.1 → T1; §4.3 → T2; D-8 setting + PATCH → T3; §4.4 route (D-9 YTD read, forecast + watchdog sections) → T4; §4.4 cards (honesty copy verbatim, inline rate editor, no-rate → no dollar figure) → T5; §4.2 cron (schedule, minimal secrets, triple-clause, success-skip, single-owner cron_runs, top-25 coach email, EXPECTED_CRONS 204h) → T6; §4.5 tests distributed per task; verification gates → T7. 6b writes NO migration (6a's 00188 seeded the flag; the tax rate is no-seed by design).
2. **Placeholders:** none — every file is complete code; T5's JSX is full insertion blocks with exact anchors into the one modified component.
3. **Signature fidelity:** every existing name written into this plan was read from source this session — `listEntriesForInsights(from, to)` / `listAccountsForInsights()` (`lib/db/bookkeeping.ts:384/:401`), `isCronSkipped`/`getSetting`/`setSetting`, `logCronStart(supabase, name)`/`logCronEnd(supabase, id, status, detail)`, `recordAudit` actor shape (`{ id?, email?, role? }` — the quarterly-pack system-actor clone), `homeOfficeCandidate(entries, accounts, books, percent)`, `resend`/`FROM_EMAIL`, `formatCents(cents, currency)`. The insights route/test rewrites preserve the CURRENT repo file contents (including the `ACC_HH_SENSITIVE` fixture added after the Phase-5 plan), not the plan-era versions.
4. **Mutation-discrimination:** 13-vs-14 boundary; doc-null-but-purpose-present per account type (two reasons discriminated both directions); income/unwatched/uncategorized exclusions; amount-desc sort; `1234567 × 12.34% → 152346` (round-vs-trunc); `−4000` net → tax 0 with net preserved (dropped-guard); null rate → null (never 0); Apr-14/Apr-15 pair (`>` vs `>=`); Jan year-roll; `12.555 → 12.56` (2-dp round-vs-trunc — NOT 33.333); YTD-vs-page-window source discrimination in both the forecast (10000¢ net impossible from the page bundle) and the watchdog (2 findings impossible from the YTD read); email row cap 26→25+"and 1 more"; HTML-escape fixture.
5. **Contract discipline:** the three-way byte-identical string contract is stated in Global Constraints and in Task 6 (the only task touching the three files), with a grep proof in T6 Step 8 and T7; `cron_runs` single-owner asserted in the route test (no functions-side logging to assert — grep-proved in T7 Step 4).
