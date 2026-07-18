# AI Bookkeeper Phase 6a — Monthly Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-book-per-month close: a `bookkeeping_period_closes` snapshot table (migration 00188), a DAL-internal write guard on all 6 ledger writers (`PeriodClosedError` → 409 in single-row routes, `rejected_closed` partition in batch routes), close/reopen routes + a `CloseMonthCard` on `/admin/books`, `adjusts_period` adjustment linkage, and a flag-OFF books-closed email.

**Architecture:** Pure zero-IO period math in `lib/bookkeeping/period-close.ts` (siblings of `reports.ts`); the guard lives INSIDE the 6 writer functions in `lib/db/bookkeeping.ts` (D-2: invisible to every existing route-test mock factory — routes gain NO new `@/lib/db/bookkeeping` imports and duck-type the error via `.code === "PERIOD_CLOSED"`, the `AccountScopeError` precedent). Batch writers partition BEFORE the upsert so closed-period rejects never ride the silent duplicate-skip (D-4). Close routes are new files with their own tests. Email mimics `email-pack.ts` (Resend, fail-loud, coach-cc), fire-and-forget AFTER the close row persists (D-15).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Zod, Supabase service-role DAL, Vitest, shadcn/ui, Tailwind v4 semantic classes.

**Spec:** `docs/superpowers/specs/2026-07-18-ai-bookkeeper-phase-6-design.md` §3 (decisions D-1..D-7, D-15, test gates §9). Pinned numbers/messages below are copied from it verbatim.

## Global Constraints

- Branch `feat/ai-bookkeeper-phase-6`. **Pre-flight (do this before Task 1's own Step 1):** run `git rev-parse --abbrev-ref HEAD`; if it does not print `feat/ai-bookkeeper-phase-6`, run `git checkout -b feat/ai-bookkeeper-phase-6` (or, if the branch already exists from a prior session, `git checkout feat/ai-bookkeeper-phase-6`) before writing any file. Do not trust "already checked out" — verify it live. Commit per task. NEVER push. Never stage the pre-existing dirty files (`render-worker/*`, `docs/superpowers/2026-07-18-*-kickoff-prompt.md`, `docs/superpowers/plans/2026-06-04-reel-no-audio-support.md`, `exercise-library-match.csv`, `step-up-for-students.html`, `render-worker/src/remotion/client-promo/`, `JOURNAL.md`).
- Integer cents everywhere; `amount_cents` is a positive magnitude, `direction` carries sign; `net = income − expense` is the only subtraction. No `Math.round` anywhere in this sub-phase (snapshots sum integers). `formatCents` from `@/lib/bookkeeping/money` at display edges ONLY.
- Pure module (`lib/bookkeeping/period-close.ts`): zero IO, no `new Date()` inside (inject `todayIso`); routes/components supply `new Date().toISOString().slice(0, 10)` (UTC — D-7 pins "current UTC month") at the edge.
- Routes self-gate with the exact house gate (copied from `app/api/admin/bookkeeping/receipts/cash/route.ts:10-11`): `const session = await auth(); if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })`. Never `requireAdmin()`, never `withAudit()`.
- Audit is inline `void recordAudit({...})`. New slugs land in `lib/audit/actions.ts` in the SAME task that first records them. `RecordAuditInput` verified at `lib/audit/record.ts:11-21` (actor optional; resolved from `auth()` when omitted).
- **D-2 hard rule:** the existing 8 write routes gain NO new import from `@/lib/db/bookkeeping` (their `vi.mock` factories enumerate only current exports — a new import would `undefined`-crash those suites). Error mapping duck-types `.code`; the shared user message imports from `@/lib/bookkeeping/period-close` (pure, never mocked). Batch responses are ADDITIVE (`rejected_closed` coalesced with `?? 0` so old mocks returning `{ inserted }` still produce a well-formed response).
- Migration task WRITES the .sql file only — the orchestrator applies it live via `mcp__supabase__apply_migration` before the Task 9 live sentinel proof runs (subagents cannot apply migrations). All route tests mock the DAL, so they don't need the live table.
- Tests: pure logic in `__tests__/lib/bookkeeping/` with ZERO mocks, file-local `entry(over: Partial<T>)` factories, RFC-4122 mnemonic UUIDs (version nibble 4, variant 8: `b…-4000-8000-…`). Route tests in `__tests__/app/api/admin/bookkeeping/` (`vi.mock` factories before route imports, `;(fn as ReturnType<typeof vi.fn>).mockResolvedValue(...)` cast idiom, `{ params: Promise.resolve({ id }) }` for dynamic routes, `new Request(...) as never`). NEVER `__tests__/db/`. Do not touch the legacy `__tests__/api/admin/bookkeeping/` files.
- UI: semantic classes only (`text-primary`, `text-success`, `text-error`, `bg-warning/10`, `text-muted-foreground`), no hex, no inline fontFamily; Lucide icons; `formatCents` for money.
- Verification: scoped vitest via `npx vitest run <path>`; `npm run build` as its OWN command, NEVER chained behind `npm run test:run` with `&&` (known-red baseline exits non-zero and silently skips the build). Known-red family: uploads/shop, import-excel-route, admin-nav, webhook-external, events.
- Before writing code that calls an existing helper, READ the helper's real signature in source — do not trust this plan's memory of it (standing lesson: plans have shipped wrong shapes 4 phases running). Every signature in this plan was verified against the working tree at `9c98a299`.

---

### Task 1: Migration 00188 — period closes + adjusts_period + flag seeds

**Files:**
- Create: `supabase/migrations/00188_bookkeeping_period_closes.sql`

**Interfaces:**
- Produces the `bookkeeping_period_closes` table (PLAIN `UNIQUE (book_id, period)` — the 00184 lesson: upsert/backstop keys must be plain unique), the nullable `adjusts_period` column on `bookkeeping_ledger_entries`, and 2 flag seeds (both `false` — dark on arrival). RLS ceremony copied from 00183's admin-policy style (`supabase/migrations/00183_bookkeeping_foundation.sql:61-70`).
- 00188 confirmed next (00187 is the repo max; no 00188+ exists).

- [ ] **Step 1: Write the migration file**

```sql
-- 00188_bookkeeping_period_closes.sql
-- AI Bookkeeper Phase 6a: monthly close. Per-book-per-month totals snapshot
-- (D-1: reopen = DELETE the row, audit metadata preserves the snapshot) plus
-- the adjustment-entry linkage column (D-3) and two dark flags. Additive,
-- reversible, inert without code. RLS is ceremony only — the DAL uses the
-- service-role client (00183 precedent).

CREATE TABLE IF NOT EXISTS bookkeeping_period_closes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id        UUID NOT NULL REFERENCES bookkeeping_books(id) ON DELETE CASCADE,
  period         TEXT NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  income_cents   INTEGER NOT NULL,
  expense_cents  INTEGER NOT NULL,
  net_cents      INTEGER NOT NULL,
  entry_count    INTEGER NOT NULL,
  email_sent_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, period)  -- PLAIN unique (00184 lesson); doubles as the (book_id, period) index
);

ALTER TABLE bookkeeping_period_closes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage period closes" ON bookkeeping_period_closes FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- D-3: adjustment entries reference the closed month they correct. Nullable;
-- never part of any unique key (source_ref stays the dedupe key).
ALTER TABLE bookkeeping_ledger_entries
  ADD COLUMN IF NOT EXISTS adjusts_period TEXT
  CHECK (adjusts_period IS NULL OR adjusts_period ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- Flags (both dark). The watchdog flag rides 00188 because 6a+6b build
-- back-to-back this session (spec §3.1 note); 6a code never reads it.
INSERT INTO system_settings (key, value, description) VALUES
  ('bookkeeping_close_email_enabled', 'false'::jsonb, 'Send the books-closed email when a month is closed'),
  ('cron_bookkeeping_receipt_watchdog_enabled', 'false'::jsonb, 'Enable the weekly missing-receipt watchdog email cron')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Sanity-check the regex against the CHECK in 00183 style**

Use the Grep tool (pattern `period ~`, path `supabase/migrations/00188_bookkeeping_period_closes.sql`) — NOT `npx rg`: ripgrep is not the npm package `rg`, and `npx rg` in a non-interactive shell invokes an unrelated registry package instead of the PATH binary (verified: it wrote/prompted about `README.md`). If running a shell `rg` directly instead of the Grep tool, note `rg` exits 1 on zero matches, so "zero matches expected" proofs should treat exit 1 + empty output as PASS.
Expected: 2 matches (table CHECK + column CHECK), both `^\d{4}-(0[1-9]|1[0-2])$`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00188_bookkeeping_period_closes.sql
git commit -m "feat(bookkeeper): migration 00188 — period closes table, adjusts_period column, close-email + watchdog flags"
```

**NOTE for the orchestrator:** apply this live via `mcp__supabase__apply_migration` (name `00188_bookkeeping_period_closes`) any time before Task 9's live sentinel proof. All unit/route tests in Tasks 2–8 mock the DAL and do not need the live table.

---

### Task 2: Pure period math — `lib/bookkeeping/period-close.ts`

**Files:**
- Create: `lib/bookkeeping/period-close.ts`
- Test: `__tests__/lib/bookkeeping/period-close.test.ts`

**Interfaces:**
- Consumes: `LedgerDirection` from `@/types/database` (verified `types/database.ts:527`).
- Produces (later tasks import these EXACT names): `PERIOD_RE`, `periodOf`, `monthBounds`, `isClosablePeriod`, `formatPeriodLabel`, `closableMonthOptions`, `SnapshotTotals`, `snapshotTotals`, `PERIOD_CLOSED_MESSAGE`.

**Pinned semantics (spec §3.2, D-7):** `periodOf("2026-03-15") → "2026-03"` (slice; inputs are regex-validated at every boundary). `monthBounds` returns real-calendar first/last day (leap-safe). `isClosablePeriod` = strictly before the current UTC month (string compare works because both sides are zero-padded `YYYY-MM`). `snapshotTotals` sums integer cents per direction; `net = income − expense` is the only subtraction. Closing an empty month is allowed (0-totals snapshot) — `snapshotTotals([])` must be well-shaped zeros.

**Name-collision note:** `lib/bookkeeping/period.ts` (+ `__tests__/lib/bookkeeping/period.test.ts`) already exists — preset-based month math (`presetRange`, `PeriodPreset`) shared with client-facing report pickers, with its own internal `fmt`/`lastDay` helpers (no exported `monthBounds`). It does NOT collide with this file's `monthBounds`/`periodOf` and must NOT be touched or "deduplicated into" — the two modules serve different callers (`period.ts` = UI preset ranges; `period-close.ts` = closable-month enforcement) and both stay.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/period-close.test.ts
import { describe, expect, it } from "vitest"
import {
  PERIOD_CLOSED_MESSAGE,
  PERIOD_RE,
  closableMonthOptions,
  formatPeriodLabel,
  isClosablePeriod,
  monthBounds,
  periodOf,
  snapshotTotals,
} from "@/lib/bookkeeping/period-close"

describe("periodOf", () => {
  it("slices YYYY-MM-DD to YYYY-MM", () => {
    expect(periodOf("2026-03-15")).toBe("2026-03")
  })
  it("Dec→Jan boundary: last day of Dec stays Dec, first day of Jan is Jan", () => {
    // discriminates any month-arithmetic implementation from the slice
    expect(periodOf("2026-12-31")).toBe("2026-12")
    expect(periodOf("2027-01-01")).toBe("2027-01")
  })
})

describe("PERIOD_RE", () => {
  it("accepts 01-12, rejects 00/13 and date strings", () => {
    expect(PERIOD_RE.test("2026-01")).toBe(true)
    expect(PERIOD_RE.test("2026-12")).toBe(true)
    expect(PERIOD_RE.test("2026-00")).toBe(false)
    expect(PERIOD_RE.test("2026-13")).toBe(false)
    expect(PERIOD_RE.test("2026-03-15")).toBe(false)
  })
})

describe("monthBounds", () => {
  it("leap February: 2024-02 ends on the 29th, 2026-02 on the 28th", () => {
    expect(monthBounds("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" })
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })
  it("December year-rollover in the last-day math", () => {
    // discriminates Date.UTC(y, 12, 0) handling (naive m+1 without rollover breaks here)
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" })
  })
  it("30-day month", () => {
    expect(monthBounds("2026-04")).toEqual({ from: "2026-04-01", to: "2026-04-30" })
  })
})

describe("isClosablePeriod — strictly before the current UTC month", () => {
  it("past month closable; current month not; future month not", () => {
    expect(isClosablePeriod("2026-06", "2026-07-01")).toBe(true)
    expect(isClosablePeriod("2026-07", "2026-07-15")).toBe(false) // equal month — strict
    expect(isClosablePeriod("2026-08", "2026-07-31")).toBe(false)
  })
  it("Dec→Jan boundary: December closable on Jan 1", () => {
    expect(isClosablePeriod("2025-12", "2026-01-01")).toBe(true)
  })
  it("malformed period is never closable", () => {
    expect(isClosablePeriod("2026-13", "2026-07-01")).toBe(false)
    expect(isClosablePeriod("2026-06-15", "2026-07-01")).toBe(false)
  })
})

describe("formatPeriodLabel", () => {
  it("month-index discriminator: 2026-03 is March, 2026-12 is December", () => {
    expect(formatPeriodLabel("2026-03")).toBe("March 2026")
    expect(formatPeriodLabel("2026-12")).toBe("December 2026")
  })
})

describe("closableMonthOptions", () => {
  it("starts at the previous month with Dec→Jan rollover; never includes the current month", () => {
    const opts = closableMonthOptions("2026-01-15", new Set())
    expect(opts[0]).toBe("2025-12")
    expect(opts[1]).toBe("2025-11")
    expect(opts).not.toContain("2026-01")
  })
  it("skips already-closed months and still returns the requested count", () => {
    const opts = closableMonthOptions("2026-07-18", new Set(["2026-06"]), 3)
    expect(opts).toEqual(["2026-05", "2026-04", "2026-03"])
  })
})

describe("snapshotTotals", () => {
  it("mixed directions: net is income − expense (sign-flip discriminator)", () => {
    const r = snapshotTotals([
      { direction: "income", amount_cents: 5000 },
      { direction: "expense", amount_cents: 2000 },
      { direction: "expense", amount_cents: 1000 },
    ])
    // an inverted subtraction yields −2000; a signed-sum-without-split loses the per-direction totals
    expect(r).toEqual({ income_cents: 5000, expense_cents: 3000, net_cents: 2000, entry_count: 3 })
  })
  it("expense-heavy month: net goes negative, magnitudes stay positive", () => {
    const r = snapshotTotals([
      { direction: "income", amount_cents: 100 },
      { direction: "expense", amount_cents: 900 },
    ])
    expect(r).toEqual({ income_cents: 100, expense_cents: 900, net_cents: -800, entry_count: 2 })
  })
  it("empty month closes to a well-shaped zero snapshot (D-7)", () => {
    expect(snapshotTotals([])).toEqual({ income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0 })
  })
})

describe("PERIOD_CLOSED_MESSAGE", () => {
  it("is the spec's exact user sentence", () => {
    expect(PERIOD_CLOSED_MESSAGE).toBe(
      "That month is closed for this book. Post an adjustment entry in the current open month instead (it can reference the closed month).",
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/period-close.test.ts`
Expected: FAIL — cannot resolve `@/lib/bookkeeping/period-close`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/bookkeeping/period-close.ts
// Pure period math for the Phase-6a monthly close. Zero IO; no new Date() —
// callers inject todayIso at the edge. Integer cents; net = income − expense
// is the only subtraction (house sign discipline, see reports.ts header).
import type { LedgerDirection } from "@/types/database"

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** The one user-facing sentence for a closed-period write rejection (spec §3.3). */
export const PERIOD_CLOSED_MESSAGE =
  "That month is closed for this book. Post an adjustment entry in the current open month instead (it can reference the closed month)."

/** "2026-03-15" → "2026-03". Inputs are DATE-regex-validated at every boundary. */
export function periodOf(dateStr: string): string {
  return dateStr.slice(0, 7)
}

/** First/last calendar day of a YYYY-MM period. Date.UTC(y, m, 0) is the last
 *  day of month m (1-based) — leap-safe and Dec-rollover-safe. */
export function monthBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, "0")}` }
}

/** D-7: any month strictly before the current UTC calendar month. Zero-padded
 *  YYYY-MM strings compare correctly lexicographically. */
export function isClosablePeriod(period: string, todayIso: string): boolean {
  return PERIOD_RE.test(period) && period < periodOf(todayIso)
}

/** "2026-03" → "March 2026" (UTC-pinned so the label never rolls a month). */
export function formatPeriodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Closable-month choices for the UI: up to `count` months strictly before the
 *  current UTC month, newest first, minus already-closed periods. */
export function closableMonthOptions(todayIso: string, closed: ReadonlySet<string>, count = 24): string[] {
  const [y, m] = periodOf(todayIso).split("-").map(Number)
  const out: string[] = []
  for (let i = 1; out.length < count && i <= count + closed.size; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    if (!closed.has(period)) out.push(period)
  }
  return out
}

export interface SnapshotTotals {
  income_cents: number
  expense_cents: number
  net_cents: number
  entry_count: number
}

/** Totals frozen by a close. Integer cents; the ONLY subtraction is the net. */
export function snapshotTotals(entries: Array<{ direction: LedgerDirection; amount_cents: number }>): SnapshotTotals {
  let income = 0
  let expense = 0
  for (const e of entries) {
    if (e.direction === "income") income += e.amount_cents
    else expense += e.amount_cents
  }
  return { income_cents: income, expense_cents: expense, net_cents: income - expense, entry_count: entries.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/period-close.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/period-close.ts __tests__/lib/bookkeeping/period-close.test.ts
git commit -m "feat(bookkeeper): pure period-close math — periodOf, leap-safe monthBounds, strict-past closable check, snapshot totals"
```

---

### Task 3: Guard primitives + the DAL write choke point (D-2/D-4 heart)

**Files:**
- Modify: `lib/bookkeeping/period-close.ts` (append guard primitives — pure)
- Modify: `lib/db/bookkeeping.ts` (wire the guard into all 6 writers; additive return fields)
- Test: `__tests__/lib/bookkeeping/period-close.test.ts` (append)

**Interfaces:**
- Produces (pure, in `period-close.ts`): `PeriodClosedError` (class, `code = "PERIOD_CLOSED"`, carries `book_id` + `period`), `assertPeriodOpen(closed, bookId, occurredOn)`, `REJECTED_ROW_CAP = 50`, `RejectedClosedRow`, `ClosedPartition<T>`, `partitionByClosedPeriods(drafts, closed)`.
- Produces (DAL, in `lib/db/bookkeeping.ts`): `listClosedPeriods(bookId): Promise<string[]>`; re-export of `PeriodClosedError`; guarded writers. Existing writer signatures verified: `createEntry` (:109), `updateEntry` (:115), `deleteEntry` (:121), `insertImportedEntries` (:126), `insertReceiptEntry` (:248), `insertAmazonEntries` (:268), `getEntry` (:184).

**Pinned semantics (spec §3.3 table):**
| Writer | Guard behavior |
|---|---|
| `createEntry` | throw if `periodOf(input.occurred_on)` closed for `input.book_id` |
| `updateEntry` | **UNCONDITIONAL old-row fetch** (the route's `getEntry` runs only when `account_id` is in the payload — `entries/[id]/route.ts:15` — so the DAL must fetch itself); throw if the OLD row's period is closed, OR if `updates.occurred_on` is present and the NEW period is closed. Book re-derived from the row, never from input (`book_id` is Zod-stripped at the route) |
| `deleteEntry` | fetch the row first (today it never fetches); throw if its period is closed; missing row keeps today's silent no-op delete |
| `insertImportedEntries` | fetch closed periods ONCE for the batch book; partition BEFORE the upsert; upsert only open-period drafts; return `{ inserted, rejected_closed, rejected_closed_rows }` — rejects are never conflated with the silent duplicate-skip |
| `insertReceiptEntry` | throw (single-row) |
| `insertAmazonEntries` | partition + additive fields like `insertImportedEntries` |

Guard no-ops when no closes exist (empty set → membership always false — pinned by test). `PeriodClosedError` lives in the PURE module (not the DAL) so nothing pure imports the supabase client; the DAL re-exports it to honor the spec's "exported from lib/db/bookkeeping.ts" surface. Route tests never import it — they duck-type (Step notes in Task 5).

- [ ] **Step 1: Write the failing test (append to `__tests__/lib/bookkeeping/period-close.test.ts`)**

```ts
// append to __tests__/lib/bookkeeping/period-close.test.ts
import {
  PeriodClosedError,
  REJECTED_ROW_CAP,
  assertPeriodOpen,
  partitionByClosedPeriods,
} from "@/lib/bookkeeping/period-close"

const BOOK = "b0000000-0000-4000-8000-000000000001"

describe("assertPeriodOpen", () => {
  it("no closes exist → no-op for any date (the whole-suite invariant)", () => {
    expect(() => assertPeriodOpen(new Set(), BOOK, "2019-01-15")).not.toThrow()
  })
  it("throws a coded error carrying book_id + period for a closed month", () => {
    try {
      assertPeriodOpen(new Set(["2019-01"]), BOOK, "2019-01-15")
      expect.unreachable("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(PeriodClosedError)
      expect((e as PeriodClosedError).code).toBe("PERIOD_CLOSED")
      expect((e as PeriodClosedError).book_id).toBe(BOOK)
      expect((e as PeriodClosedError).period).toBe("2019-01")
    }
  })
  it("inclusive month bounds: first and last day rejected, adjacent months pass", () => {
    const closed = new Set(["2019-01"])
    expect(() => assertPeriodOpen(closed, BOOK, "2019-01-01")).toThrow(PeriodClosedError)
    expect(() => assertPeriodOpen(closed, BOOK, "2019-01-31")).toThrow(PeriodClosedError)
    expect(() => assertPeriodOpen(closed, BOOK, "2018-12-31")).not.toThrow()
    expect(() => assertPeriodOpen(closed, BOOK, "2019-02-01")).not.toThrow()
  })
})

describe("partitionByClosedPeriods", () => {
  const draft = (occurred_on: string, amount_cents = 1000) => ({
    occurred_on,
    amount_cents,
    memo: `m-${occurred_on}`,
    counterparty: null as string | null,
    source_ref: `ref-${occurred_on}-${amount_cents}`,
  })

  it("empty closed set → everything open, zero rejects (guard no-op)", () => {
    const r = partitionByClosedPeriods([draft("2019-01-15")], new Set<string>())
    expect(r.open).toHaveLength(1)
    expect(r.rejected_closed).toBe(0)
    expect(r.rejected_closed_rows).toEqual([])
  })
  it("splits on month membership, preserving input order in BOTH halves", () => {
    const input = [draft("2019-01-02"), draft("2019-02-01"), draft("2019-01-31"), draft("2019-03-01")]
    const r = partitionByClosedPeriods(input, new Set(["2019-01"]))
    expect(r.open.map((d) => d.occurred_on)).toEqual(["2019-02-01", "2019-03-01"])
    expect(r.rejected_closed).toBe(2)
    expect(r.rejected_closed_rows.map((d) => d.occurred_on)).toEqual(["2019-01-02", "2019-01-31"])
  })
  it("rejected rows carry the review fields", () => {
    const r = partitionByClosedPeriods([draft("2019-01-15", 4200)], new Set(["2019-01"]))
    expect(r.rejected_closed_rows[0]).toEqual({
      occurred_on: "2019-01-15",
      amount_cents: 4200,
      memo: "m-2019-01-15",
      counterparty: null,
      source_ref: "ref-2019-01-15-4200",
    })
  })
  it("caps rejected_closed_rows at 50 while the COUNT stays honest", () => {
    const input = Array.from({ length: 60 }, (_, i) =>
      draft(`2019-01-${String((i % 28) + 1).padStart(2, "0")}`, i + 1),
    )
    const r = partitionByClosedPeriods(input, new Set(["2019-01"]))
    expect(r.rejected_closed).toBe(60) // count is NOT the capped list length
    expect(r.rejected_closed_rows).toHaveLength(REJECTED_ROW_CAP)
    expect(REJECTED_ROW_CAP).toBe(50)
  })
  it("missing memo/counterparty/source_ref coalesce to null in rejected rows", () => {
    const r = partitionByClosedPeriods(
      [{ occurred_on: "2019-01-15", amount_cents: 100 }],
      new Set(["2019-01"]),
    )
    expect(r.rejected_closed_rows[0]).toEqual({
      occurred_on: "2019-01-15",
      amount_cents: 100,
      memo: null,
      counterparty: null,
      source_ref: null,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/period-close.test.ts`
Expected: FAIL — `PeriodClosedError` etc. not exported.

- [ ] **Step 3: Append the pure guard primitives to `lib/bookkeeping/period-close.ts`**

```ts
// --- Closed-period guard primitives (D-2: consumed inside lib/db/bookkeeping.ts) ---

/** Coded error the DAL throws for closed-period writes; routes duck-type
 *  `.code === "PERIOD_CLOSED"` (the AccountScopeError precedent) and never
 *  import this class. */
export class PeriodClosedError extends Error {
  readonly code = "PERIOD_CLOSED" as const
  constructor(
    public readonly book_id: string,
    public readonly period: string,
  ) {
    super(`Period ${period} is closed for book ${book_id}`)
    this.name = "PeriodClosedError"
  }
}

/** Single-row guard: no-op when the closed set is empty. */
export function assertPeriodOpen(closed: ReadonlySet<string>, bookId: string, occurredOn: string): void {
  const period = periodOf(occurredOn)
  if (closed.has(period)) throw new PeriodClosedError(bookId, period)
}

export const REJECTED_ROW_CAP = 50

export interface RejectedClosedRow {
  occurred_on: string
  amount_cents: number
  memo: string | null
  counterparty: string | null
  source_ref: string | null
}

export interface ClosedPartition<T> {
  open: T[]
  rejected_closed: number
  rejected_closed_rows: RejectedClosedRow[]
}

/** D-4: batch rejects happen BEFORE the upsert so they are never conflated
 *  with the silent duplicate-skip. Order preserved in both halves; the row
 *  list caps at REJECTED_ROW_CAP while the count stays exact. */
export function partitionByClosedPeriods<
  T extends {
    occurred_on: string
    amount_cents: number
    memo?: string | null
    counterparty?: string | null
    source_ref?: string | null
  },
>(drafts: T[], closed: ReadonlySet<string>): ClosedPartition<T> {
  if (closed.size === 0) return { open: drafts, rejected_closed: 0, rejected_closed_rows: [] }
  const open: T[] = []
  const rejected: T[] = []
  for (const d of drafts) {
    if (closed.has(periodOf(d.occurred_on))) rejected.push(d)
    else open.push(d)
  }
  return {
    open,
    rejected_closed: rejected.length,
    rejected_closed_rows: rejected.slice(0, REJECTED_ROW_CAP).map((d) => ({
      occurred_on: d.occurred_on,
      amount_cents: d.amount_cents,
      memo: d.memo ?? null,
      counterparty: d.counterparty ?? null,
      source_ref: d.source_ref ?? null,
    })),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/period-close.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the guard into `lib/db/bookkeeping.ts`**

Add to the file's import block (top of file):

```ts
import {
  PeriodClosedError,
  assertPeriodOpen,
  partitionByClosedPeriods,
  type RejectedClosedRow,
} from "@/lib/bookkeeping/period-close"
```

Add near the other Phase helpers (after `pruneExpiredDocuments`, before the Reports section):

```ts
// ── Phase 6a: closed-period write guard (D-2 choke point) ───────────────────
// The spec's "exported from the DAL" surface — the class itself lives in the
// pure module so period-close.ts stays zero-IO.
export { PeriodClosedError }

/** All closed YYYY-MM periods for one book. One indexed select (the plain
 *  UNIQUE (book_id, period) doubles as the index). Empty ledger → [] → every
 *  guard below no-ops. */
export async function listClosedPeriods(bookId: string): Promise<string[]> {
  const { data, error } = await db().from("bookkeeping_period_closes").select("period").eq("book_id", bookId)
  if (error) throw error
  return (data ?? []).map((r) => (r as { period: string }).period)
}
```

Then edit the 6 writers IN PLACE (full replacement bodies — current bodies verified at the cited lines):

`createEntry` (:109) becomes:

```ts
export async function createEntry(input: Omit<BookkeepingLedgerEntry, "id" | "created_at" | "updated_at">): Promise<BookkeepingLedgerEntry> {
  const closed = new Set(await listClosedPeriods(input.book_id))
  assertPeriodOpen(closed, input.book_id, input.occurred_on)
  const { data, error } = await db().from("bookkeeping_ledger_entries").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingLedgerEntry
}
```

`updateEntry` (:115) becomes:

```ts
export async function updateEntry(id: string, updates: Partial<Omit<BookkeepingLedgerEntry, "id" | "created_at">>): Promise<BookkeepingLedgerEntry> {
  // UNCONDITIONAL old-row fetch (spec §3.3 row 2): the route only fetches when
  // account_id is in the payload, so an occurred_on-only edit would otherwise
  // bypass the guard. Book comes from the row — book_id can't change by route.
  const existing = await getEntry(id)
  if (existing) {
    const closed = new Set(await listClosedPeriods(existing.book_id))
    assertPeriodOpen(closed, existing.book_id, existing.occurred_on)
    if (updates.occurred_on) assertPeriodOpen(closed, existing.book_id, updates.occurred_on)
  }
  const { data, error } = await db().from("bookkeeping_ledger_entries").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as BookkeepingLedgerEntry
}
```

`deleteEntry` (:121) becomes:

```ts
export async function deleteEntry(id: string): Promise<void> {
  // Fetch-first (today it never fetches): a closed-period row must not vanish.
  // A missing row keeps today's silent no-op delete behavior.
  const existing = await getEntry(id)
  if (existing) {
    const closed = new Set(await listClosedPeriods(existing.book_id))
    assertPeriodOpen(closed, existing.book_id, existing.occurred_on)
  }
  const { error } = await db().from("bookkeeping_ledger_entries").delete().eq("id", id)
  if (error) throw error
}
```

(`getEntry` is declared at :184, AFTER these writers — function declarations hoist, so calling it above is fine; do not move it.)

`insertImportedEntries` (:126) becomes:

```ts
export async function insertImportedEntries(
  bookId: string, importBatchId: string, drafts: Array<LedgerEntryDraft & { account_id?: string | null }>,
): Promise<{ inserted: number; rejected_closed: number; rejected_closed_rows: RejectedClosedRow[] }> {
  if (drafts.length === 0) return { inserted: 0, rejected_closed: 0, rejected_closed_rows: [] }
  // Partition BEFORE the upsert (D-4): closed-period rows must never ride the
  // silent duplicate-skip, or the dialogs' "already imported" arithmetic lies.
  const closed = new Set(await listClosedPeriods(bookId))
  const { open, rejected_closed, rejected_closed_rows } = partitionByClosedPeriods(drafts, closed)
  if (open.length === 0) return { inserted: 0, rejected_closed, rejected_closed_rows }
  const rows = open.map((d) => ({
    book_id: bookId, account_id: d.account_id ?? null, direction: d.direction,
    amount_cents: d.amount_cents, occurred_on: d.occurred_on, memo: d.memo,
    counterparty: d.counterparty, source: d.source, source_ref: d.source_ref,
    import_batch_id: importBatchId,
  }))
  const { data, error } = await db()
    .from("bookkeeping_ledger_entries")
    .upsert(rows, { onConflict: "book_id,source,source_ref", ignoreDuplicates: true })
    .select("id")
  if (error) throw error
  return { inserted: (data ?? []).length, rejected_closed, rejected_closed_rows }
}
```

`insertReceiptEntry` (:248): add two lines at the top of the body (before `const row = {`):

```ts
  const closed = new Set(await listClosedPeriods(input.book_id))
  assertPeriodOpen(closed, input.book_id, input.occurred_on)
```

`insertAmazonEntries` (:268) becomes:

```ts
export async function insertAmazonEntries(
  bookId: string, importBatchId: string,
  drafts: Array<{ direction: LedgerDirection; amount_cents: number; occurred_on: string; memo: string | null; counterparty: string | null; business_purpose?: string | null; source_ref: string; account_id?: string | null }>,
): Promise<{ inserted: number; rejected_closed: number; rejected_closed_rows: RejectedClosedRow[] }> {
  if (drafts.length === 0) return { inserted: 0, rejected_closed: 0, rejected_closed_rows: [] }
  const closed = new Set(await listClosedPeriods(bookId))
  const { open, rejected_closed, rejected_closed_rows } = partitionByClosedPeriods(drafts, closed)
  if (open.length === 0) return { inserted: 0, rejected_closed, rejected_closed_rows }
  const rows = open.map((d) => ({
    book_id: bookId, account_id: d.account_id ?? null, direction: d.direction,
    amount_cents: d.amount_cents, occurred_on: d.occurred_on, memo: d.memo,
    counterparty: d.counterparty, business_purpose: d.business_purpose ?? null,
    source: "receipt" as const, source_ref: d.source_ref, import_batch_id: importBatchId,
  }))
  const { data, error } = await db()
    .from("bookkeeping_ledger_entries")
    .upsert(rows, { onConflict: "book_id,source,source_ref", ignoreDuplicates: true })
    .select("id")
  if (error) throw error
  return { inserted: (data ?? []).length, rejected_closed, rejected_closed_rows }
}
```

- [ ] **Step 6: Existing suites stay green (the D-2 payoff) + typecheck**

Run: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/api/admin/bookkeeping`
Expected: PASS — the DAL-internal guard is invisible to every route-test mock; batch return widening is additive (existing callers destructure `{ inserted }`).
Run: `npx tsc --noEmit 2>&1 | Select-String "lib/db/bookkeeping|period-close"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/bookkeeping/period-close.ts lib/db/bookkeeping.ts __tests__/lib/bookkeeping/period-close.test.ts
git commit -m "feat(bookkeeper): closed-period write guard inside all 6 DAL writers — PeriodClosedError, partition-before-upsert"
```

---

### Task 4: Close DAL + closes routes + audit slugs

**Files:**
- Modify: `types/database.ts` (add `BookkeepingPeriodClose` after `BookkeepingLedgerEntry`, ~:577)
- Modify: `lib/db/bookkeeping.ts` (append close CRUD)
- Modify: `lib/validators/bookkeeping.ts` (append `closePeriodSchema`)
- Modify: `lib/audit/actions.ts` (3 slugs after :251)
- Create: `app/api/admin/bookkeeping/closes/route.ts` (GET, POST)
- Create: `app/api/admin/bookkeeping/closes/[id]/route.ts` (DELETE)
- Test: `__tests__/lib/bookkeeping/close-validators.test.ts`, `__tests__/app/api/admin/bookkeeping/closes.test.ts`

**Interfaces:**
- Consumes: `isClosablePeriod`, `monthBounds`, `snapshotTotals`, `PERIOD_RE` (Task 2); `listEntriesForReports(from, to, bookId?)` (verified `lib/db/bookkeeping.ts:339`); `getBook(id)` (:25); `recordAudit` (`lib/audit/record.ts:42`, input shape :11-21).
- Produces: `BookkeepingPeriodClose`; DAL `listCloses(bookId?)`, `getClose(bookId, period)`, `getCloseById(id)`, `insertClose(input)`, `deleteClose(id)`, `stampCloseEmailSent(id)` (the last two beyond the spec's four: DELETE-route 404 needs a by-id fetch; the Task-6 email stamp needs a setter — both additive); `closePeriodSchema`; slugs `bookkeeping.period_closed` / `bookkeeping.period_reopened` / `bookkeeping.close_emailed` (all `commerce`).

**Pinned route semantics (spec §3.4):** GET list = unaudited JSON read, standard gate, optional `book_id` filter. POST: Zod → 400; `getBook` → 404; `isClosablePeriod(period, todayUTC)` → **422** `{ error: "Only complete past months can be closed." }`; `getClose` → **409** `{ error: "That month is already closed for this book." }` (DB plain-unique as race backstop — a lost race surfaces as 500, acceptable single-admin); totals via `listEntriesForReports(monthBounds(period), book_id)` + `snapshotTotals` (REAL pure fn in route tests — mocked entries discriminate the computation); insert; audit `bookkeeping.period_closed` with the totals; **201** `{ close }`. DELETE reopen: `getCloseById` → 404; `deleteClose`; audit `bookkeeping.period_reopened` with the FULL snapshot in metadata (D-1: the audit row preserves history); 200 `{ reopened: true }`. Email wiring arrives in Task 6 — this task's POST has no email code.

- [ ] **Step 1: Write the failing validator test**

```ts
// __tests__/lib/bookkeeping/close-validators.test.ts
import { describe, expect, it } from "vitest"
import { closePeriodSchema } from "@/lib/validators/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"

describe("closePeriodSchema", () => {
  it("accepts a uuid book + YYYY-MM period", () => {
    expect(closePeriodSchema.safeParse({ book_id: BOOK, period: "2026-01" }).success).toBe(true)
    expect(closePeriodSchema.safeParse({ book_id: BOOK, period: "2019-12" }).success).toBe(true)
  })
  it("rejects month 00/13, date strings, missing keys, non-uuid book", () => {
    for (const period of ["2026-00", "2026-13", "2026-1", "2026-03-15", ""]) {
      expect(closePeriodSchema.safeParse({ book_id: BOOK, period }).success).toBe(false)
    }
    expect(closePeriodSchema.safeParse({ period: "2026-01" }).success).toBe(false)
    expect(closePeriodSchema.safeParse({ book_id: "not-a-uuid", period: "2026-01" }).success).toBe(false)
  })
})
```

Run: `npx vitest run __tests__/lib/bookkeeping/close-validators.test.ts` → FAIL (`closePeriodSchema` not exported).

- [ ] **Step 2: Schema + types + audit slugs**

Append to `lib/validators/bookkeeping.ts`:

```ts
export const closePeriodSchema = z.object({
  book_id: z.string().uuid(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM"),
})
```

Append to `types/database.ts` directly after the `BookkeepingLedgerEntry` interface (ends :576):

```ts
export interface BookkeepingPeriodClose {
  id: string
  book_id: string
  period: string
  closed_at: string
  closed_by: string | null
  income_cents: number
  expense_cents: number
  net_cents: number
  entry_count: number
  email_sent_at: string | null
  created_at: string
  updated_at: string
}
```

Append inside the `// bookkeeping` block of `lib/audit/actions.ts` (after :251, `home_office_percent_set`):

```ts
  { slug: "bookkeeping.period_closed", category: "commerce", description: "Bookkeeping month closed — totals snapshot frozen" },
  { slug: "bookkeeping.period_reopened", category: "commerce", description: "Closed bookkeeping month reopened (snapshot preserved in this audit row)" },
  { slug: "bookkeeping.close_emailed", category: "commerce", description: "Books-closed statement emailed" },
```

Run: `npx vitest run __tests__/lib/bookkeeping/close-validators.test.ts` → PASS.

- [ ] **Step 3: Close DAL (append to `lib/db/bookkeeping.ts`)**

Add `BookkeepingPeriodClose` to the existing `@/types/database` type-import block, then append:

```ts
// ── Phase 6a: close CRUD ────────────────────────────────────────────────────
export async function listCloses(bookId?: string): Promise<BookkeepingPeriodClose[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see listEntries: Supabase builder generics fight conditional chaining
  let q: any = db().from("bookkeeping_period_closes").select("*")
  if (bookId) q = q.eq("book_id", bookId)
  const { data, error } = await q.order("period", { ascending: false })
  if (error) throw error
  return (data ?? []) as BookkeepingPeriodClose[]
}

export async function getClose(bookId: string, period: string): Promise<BookkeepingPeriodClose | null> {
  const { data, error } = await db()
    .from("bookkeeping_period_closes").select("*").eq("book_id", bookId).eq("period", period).maybeSingle()
  if (error) throw error
  return (data as BookkeepingPeriodClose) ?? null
}

export async function getCloseById(id: string): Promise<BookkeepingPeriodClose | null> {
  const { data, error } = await db().from("bookkeeping_period_closes").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingPeriodClose) ?? null
}

export async function insertClose(input: {
  book_id: string; period: string; closed_by: string | null
  income_cents: number; expense_cents: number; net_cents: number; entry_count: number
}): Promise<BookkeepingPeriodClose> {
  const { data, error } = await db().from("bookkeeping_period_closes").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingPeriodClose
}

export async function deleteClose(id: string): Promise<void> {
  const { error } = await db().from("bookkeeping_period_closes").delete().eq("id", id)
  if (error) throw error
}

export async function stampCloseEmailSent(id: string): Promise<void> {
  const { error } = await db()
    .from("bookkeeping_period_closes")
    .update({ email_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 4: Write the failing route tests**

```ts
// __tests__/app/api/admin/bookkeeping/closes.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  getBook: vi.fn(),
  getClose: vi.fn(),
  getCloseById: vi.fn(),
  insertClose: vi.fn(),
  deleteClose: vi.fn(),
  listCloses: vi.fn(),
  listEntriesForReports: vi.fn(),
  stampCloseEmailSent: vi.fn(),
}))

import { GET, POST } from "@/app/api/admin/bookkeeping/closes/route"
import { DELETE } from "@/app/api/admin/bookkeeping/closes/[id]/route"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import {
  deleteClose,
  getBook,
  getClose,
  getCloseById,
  insertClose,
  listCloses,
  listEntriesForReports,
} from "@/lib/db/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const CLOSE = "c0000000-0000-4000-8000-000000000001"
const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const body = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) }) as never

const closeRow = {
  id: CLOSE, book_id: BOOK, period: "2019-01",
  closed_at: "2026-07-18T10:00:00Z", closed_by: ADMIN.user.id,
  income_cents: 5000, expense_cents: 3000, net_cents: 2000, entry_count: 3,
  email_sent_at: null, created_at: "2026-07-18T10:00:00Z", updated_at: "2026-07-18T10:00:00Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BOOK, name: "Darren — DJP Athlete" })
  ;(getClose as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(insertClose as ReturnType<typeof vi.fn>).mockResolvedValue(closeRow)
  ;(listEntriesForReports as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(listCloses as ReturnType<typeof vi.fn>).mockResolvedValue([closeRow])
  ;(getCloseById as ReturnType<typeof vi.fn>).mockResolvedValue(closeRow)
})

describe("GET /api/admin/bookkeeping/closes", () => {
  it("403 non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET(new Request(`http://x/api?book_id=${BOOK}`) as never)).status).toBe(403)
  })
  it("lists closes for a book, unaudited", async () => {
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}`) as never)
    expect(res.status).toBe(200)
    expect((await res.json()).closes).toHaveLength(1)
    expect(listCloses).toHaveBeenCalledWith(BOOK)
    expect(recordAudit).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/bookkeeping/closes", () => {
  it("403 non-admin; insertClose never called", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await POST(body({ book_id: BOOK, period: "2019-01" }))).status).toBe(403)
    expect(insertClose).not.toHaveBeenCalled()
  })
  it("400 invalid period", async () => {
    expect((await POST(body({ book_id: BOOK, period: "2019-13" }))).status).toBe(400)
  })
  it("404 unknown book", async () => {
    ;(getBook as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(body({ book_id: BOOK, period: "2019-01" }))).status).toBe(404)
  })
  it("422 for a non-past month (real isClosablePeriod, future-proof fixture)", async () => {
    const res = await POST(body({ book_id: BOOK, period: "2999-01" }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe("Only complete past months can be closed.")
    expect(insertClose).not.toHaveBeenCalled()
  })
  it("409 double-close", async () => {
    ;(getClose as ReturnType<typeof vi.fn>).mockResolvedValue(closeRow)
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("That month is already closed for this book.")
    expect(insertClose).not.toHaveBeenCalled()
  })
  it("happy path: month-bounded read, REAL snapshotTotals over mocked entries, audit fires", async () => {
    ;(listEntriesForReports as ReturnType<typeof vi.fn>).mockResolvedValue([
      { direction: "income", amount_cents: 5000 },
      { direction: "expense", amount_cents: 2000 },
      { direction: "expense", amount_cents: 1000 },
    ])
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(201)
    expect(listEntriesForReports).toHaveBeenCalledWith("2019-01-01", "2019-01-31", BOOK)
    // sign-flip / trunc discriminator: net must be +2000 from 5000 − 3000
    expect(insertClose).toHaveBeenCalledWith({
      book_id: BOOK, period: "2019-01", closed_by: ADMIN.user.id,
      income_cents: 5000, expense_cents: 3000, net_cents: 2000, entry_count: 3,
    })
    expect((await res.json()).close).toEqual(closeRow)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.period_closed",
        category: "commerce",
        outcome: "success",
        metadata: expect.objectContaining({ book_id: BOOK, period: "2019-01", net_cents: 2000 }),
      }),
    )
  })
  it("empty month closes with a zero snapshot (D-7)", async () => {
    const res = await POST(body({ book_id: BOOK, period: "2019-02" }))
    expect(res.status).toBe(201)
    expect(listEntriesForReports).toHaveBeenCalledWith("2019-02-01", "2019-02-28", BOOK)
    expect(insertClose).toHaveBeenCalledWith(
      expect.objectContaining({ income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0 }),
    )
  })
})

describe("DELETE /api/admin/bookkeeping/closes/[id] — reopen", () => {
  const del = () =>
    DELETE(new Request("http://x/api", { method: "DELETE" }) as never, { params: Promise.resolve({ id: CLOSE }) })

  it("403 non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await del()).status).toBe(403)
    expect(deleteClose).not.toHaveBeenCalled()
  })
  it("404 when the close row is gone", async () => {
    ;(getCloseById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await del()).status).toBe(404)
    expect(deleteClose).not.toHaveBeenCalled()
  })
  it("deletes and audits the FULL snapshot (D-1: audit preserves history)", async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reopened: true })
    expect(deleteClose).toHaveBeenCalledWith(CLOSE)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.period_reopened",
        category: "commerce",
        outcome: "success",
        metadata: expect.objectContaining({
          book_id: BOOK, period: "2019-01",
          income_cents: 5000, expense_cents: 3000, net_cents: 2000, entry_count: 3,
          closed_at: closeRow.closed_at, closed_by: closeRow.closed_by, email_sent_at: null,
        }),
      }),
    )
  })
})
```

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/closes.test.ts` → FAIL (routes missing).

- [ ] **Step 5: Write the routes**

```ts
// app/api/admin/bookkeeping/closes/route.ts
// Phase 6a: list + create period closes. The close is a TOTALS freeze, not a
// document freeze (D-5) — document links may still be pruned by retention.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBook, getClose, insertClose, listCloses, listEntriesForReports } from "@/lib/db/bookkeeping"
import { isClosablePeriod, monthBounds, snapshotTotals } from "@/lib/bookkeeping/period-close"
import { closePeriodSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const bookId = new URL(request.url).searchParams.get("book_id") ?? undefined
    const closes = await listCloses(bookId)
    return NextResponse.json({ closes })
  } catch (error) {
    console.error("List period closes error:", error)
    return NextResponse.json({ error: "Failed to load closes" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const parsed = closePeriodSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { book_id, period } = parsed.data

    const book = await getBook(book_id)
    if (!book) return NextResponse.json({ error: "book not found" }, { status: 404 })

    // D-7: any month strictly before the current UTC calendar month.
    if (!isClosablePeriod(period, new Date().toISOString().slice(0, 10))) {
      return NextResponse.json({ error: "Only complete past months can be closed." }, { status: 422 })
    }
    const existing = await getClose(book_id, period)
    if (existing) return NextResponse.json({ error: "That month is already closed for this book." }, { status: 409 })
    // (DB plain UNIQUE (book_id, period) is the race backstop.)

    const { from, to } = monthBounds(period)
    const entries = await listEntriesForReports(from, to, book_id)
    const totals = snapshotTotals(entries)
    const close = await insertClose({ book_id, period, closed_by: session.user.id, ...totals })

    void recordAudit({
      action: "bookkeeping.period_closed", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_period_close", id: close.id },
      metadata: { book_id, period, ...totals }, request,
    })
    return NextResponse.json({ close }, { status: 201 })
  } catch (error) {
    console.error("Close period error:", error)
    return NextResponse.json({ error: "Failed to close the month" }, { status: 500 })
  }
}
```

```ts
// app/api/admin/bookkeeping/closes/[id]/route.ts
// Reopen = DELETE the close row (D-1). The audit metadata carries the full
// snapshot, so append-only history loses nothing; re-closing re-snapshots.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deleteClose, getCloseById } from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const { id } = await ctx.params
    const close = await getCloseById(id)
    if (!close) return NextResponse.json({ error: "close not found" }, { status: 404 })
    await deleteClose(id)
    void recordAudit({
      action: "bookkeeping.period_reopened", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_period_close", id },
      metadata: {
        book_id: close.book_id, period: close.period,
        income_cents: close.income_cents, expense_cents: close.expense_cents,
        net_cents: close.net_cents, entry_count: close.entry_count,
        closed_at: close.closed_at, closed_by: close.closed_by, email_sent_at: close.email_sent_at,
      },
      request,
    })
    return NextResponse.json({ reopened: true })
  } catch (error) {
    console.error("Reopen period error:", error)
    return NextResponse.json({ error: "Failed to reopen the month" }, { status: 500 })
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/closes.test.ts __tests__/lib/bookkeeping/close-validators.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add types/database.ts lib/db/bookkeeping.ts lib/validators/bookkeeping.ts lib/audit/actions.ts app/api/admin/bookkeeping/closes __tests__/app/api/admin/bookkeeping/closes.test.ts __tests__/lib/bookkeeping/close-validators.test.ts
git commit -m "feat(bookkeeper): close/reopen routes + close DAL + period_closed/period_reopened/close_emailed audit slugs"
```

---

### Task 5: 409 mapping + batch passthrough across the 8 write paths

**Files:**
- Modify: `app/api/admin/bookkeeping/entries/route.ts` (POST catch)
- Modify: `app/api/admin/bookkeeping/entries/[id]/route.ts` (PATCH + DELETE catch)
- Modify: `app/api/admin/bookkeeping/receipts/cash/route.ts` (catch)
- Modify: `app/api/admin/bookkeeping/receipts/commit/route.ts` (catch)
- Modify: `app/api/admin/bookkeeping/statement-import/commit/route.ts` (passthrough)
- Modify: `app/api/admin/bookkeeping/import-platform/commit/route.ts` (passthrough)
- Modify: `app/api/admin/bookkeeping/receipts/amazon/commit/route.ts` (passthrough)
- Test: `__tests__/app/api/admin/bookkeeping/closed-period-writes.test.ts`

**Interfaces:**
- Consumes: `PERIOD_CLOSED_MESSAGE` from `@/lib/bookkeeping/period-close` (pure module — importing it does NOT touch any `vi.mock("@/lib/db/bookkeeping")` factory; this is the only new import any of these routes gains). Routes duck-type `(error as { code?: string }).code === "PERIOD_CLOSED"` — the `AccountScopeError` mapping precedent at `entries/[id]/route.ts:22-24`.
- Produces: 409 `{ error: PERIOD_CLOSED_MESSAGE }` on the 5 single-row pairs; additive `rejected_closed` + `rejected_closed_rows` on the 3 batch pairs (coalesced `?? 0` / `?? []` so legacy mocks returning `{ inserted }` still shape a valid response — the invariant that keeps `__tests__/api/admin/bookkeeping/statement-import-commit.test.ts` and friends green).

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/app/api/admin/bookkeeping/closed-period-writes.test.ts
// One test per method+path pair (8 pairs, spec §3.3): the DAL mock throws a
// duck-typed PERIOD_CLOSED error (never the real class — this module is fully
// mocked, so the class import would be undefined) → single-row routes 409 with
// the exact message; batch routes pass rejected_closed through additively.
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntries: vi.fn(),
  entryTotals: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  getEntry: vi.fn(),
  assertAccountInBook: vi.fn(),
  getAccount: vi.fn(),
  getDocument: vi.fn(),
  insertReceiptEntry: vi.fn(),
  updateDocumentRetainUntil: vi.fn(),
  linkDocumentBatch: vi.fn(),
  insertImportedEntries: vi.fn(),
  insertAmazonEntries: vi.fn(),
  assertAccountsInBook: vi.fn(),
}))

import { POST as ENTRIES_POST } from "@/app/api/admin/bookkeeping/entries/route"
import { DELETE as ENTRY_DELETE, PATCH as ENTRY_PATCH } from "@/app/api/admin/bookkeeping/entries/[id]/route"
import { POST as CASH_POST } from "@/app/api/admin/bookkeeping/receipts/cash/route"
import { POST as RECEIPT_COMMIT } from "@/app/api/admin/bookkeeping/receipts/commit/route"
import { POST as STATEMENT_COMMIT } from "@/app/api/admin/bookkeeping/statement-import/commit/route"
import { POST as PLATFORM_COMMIT } from "@/app/api/admin/bookkeeping/import-platform/commit/route"
import { POST as AMAZON_COMMIT } from "@/app/api/admin/bookkeeping/receipts/amazon/commit/route"
import { auth } from "@/lib/auth"
import {
  createEntry,
  deleteEntry,
  getAccount,
  getDocument,
  insertAmazonEntries,
  insertImportedEntries,
  insertReceiptEntry,
  linkDocumentBatch,
  updateEntry,
} from "@/lib/db/bookkeeping"
import { PERIOD_CLOSED_MESSAGE } from "@/lib/bookkeeping/period-close"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ENTRY = "e0000000-0000-4000-8000-000000000001"
const ACCOUNT = "a0000000-0000-4000-8000-000000000001"
const DOC = "d0000000-0000-4000-8000-000000000001"
const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }

const periodClosed = () =>
  Object.assign(new Error("Period 2019-01 is closed"), { code: "PERIOD_CLOSED", book_id: BOOK, period: "2019-01" })

const post = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) }) as never
const REJECTED_ROW = { occurred_on: "2019-01-15", amount_cents: 4200, memo: "m", counterparty: null, source_ref: "r" }

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
})

describe("single-row paths → 409 with the exact spec message", () => {
  it("POST /entries (pair 1)", async () => {
    ;(createEntry as ReturnType<typeof vi.fn>).mockRejectedValue(periodClosed())
    const res = await ENTRIES_POST(post({
      book_id: BOOK, direction: "expense", amount_cents: 100, occurred_on: "2019-01-15",
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PERIOD_CLOSED_MESSAGE)
  })

  it("PATCH /entries/[id] — occurred_on-only edit, no account_id (pair 2)", async () => {
    ;(updateEntry as ReturnType<typeof vi.fn>).mockRejectedValue(periodClosed())
    const res = await ENTRY_PATCH(
      new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ occurred_on: "2019-01-15" }) }) as never,
      { params: Promise.resolve({ id: ENTRY }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PERIOD_CLOSED_MESSAGE)
  })

  it("DELETE /entries/[id] (pair 3)", async () => {
    ;(deleteEntry as ReturnType<typeof vi.fn>).mockRejectedValue(periodClosed())
    const res = await ENTRY_DELETE(
      new Request("http://x/api", { method: "DELETE" }) as never,
      { params: Promise.resolve({ id: ENTRY }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PERIOD_CLOSED_MESSAGE)
  })

  it("POST /receipts/cash (pair 4)", async () => {
    ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: ACCOUNT, book_id: BOOK, account_type: "expense", requires_business_purpose: false,
    })
    ;(createEntry as ReturnType<typeof vi.fn>).mockRejectedValue(periodClosed())
    const res = await CASH_POST(post({
      book_id: BOOK, account_id: ACCOUNT, amount_cents: 100, occurred_on: "2019-01-15",
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PERIOD_CLOSED_MESSAGE)
  })

  it("POST /receipts/commit (pair 5)", async () => {
    ;(getDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC, book_id: BOOK })
    ;(insertReceiptEntry as ReturnType<typeof vi.fn>).mockRejectedValue(periodClosed())
    const res = await RECEIPT_COMMIT(post({
      book_id: BOOK, document_id: DOC, amount_cents: 100, occurred_on: "2019-01-15",
      source_ref: `receipt:${DOC}`,
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PERIOD_CLOSED_MESSAGE)
  })
})

describe("batch paths → additive rejected_closed passthrough", () => {
  const batchResult = { inserted: 1, rejected_closed: 2, rejected_closed_rows: [REJECTED_ROW] }

  it("POST /statement-import/commit (pair 6) — linkDocumentBatch still uses inserted, not requested", async () => {
    ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue(batchResult)
    const res = await STATEMENT_COMMIT(post({
      book_id: BOOK,
      document_id: DOC,
      entries: [{
        direction: "income", amount_cents: 5000, occurred_on: "2019-02-02", memo: "x",
        counterparty: null, service_line: null, source: "statement_import",
        source_ref: `statement:${"a".repeat(40)}`,
      }],
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.inserted).toBe(1)
    expect(json.rejected_closed).toBe(2)
    expect(json.rejected_closed_rows).toEqual([REJECTED_ROW])
    // linkDocumentBatch's postedCount comes from the DAL's `inserted` (1), not
    // the 1 requested entry that happens to match here by coincidence — the
    // batch-result mock is the source of truth for this assertion.
    expect(linkDocumentBatch).toHaveBeenCalledWith(DOC, BOOK, expect.any(String), 1)
  })

  it("POST /import-platform/commit (pair 7)", async () => {
    ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue(batchResult)
    const res = await PLATFORM_COMMIT(post({
      book_id: BOOK,
      entries: [{
        direction: "income", amount_cents: 5000, occurred_on: "2019-02-02", memo: "x",
        counterparty: null, service_line: null, source: "platform_import", source_ref: "payments:1",
      }],
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rejected_closed).toBe(2)
    expect(json.rejected_closed_rows).toHaveLength(1)
  })

  it("POST /receipts/amazon/commit (pair 8)", async () => {
    ;(insertAmazonEntries as ReturnType<typeof vi.fn>).mockResolvedValue(batchResult)
    const res = await AMAZON_COMMIT(post({
      book_id: BOOK,
      entries: [{
        direction: "expense", amount_cents: 2499, occurred_on: "2019-02-02", memo: "Bands",
        counterparty: "Amazon", service_line: null, source: "receipt", source_ref: "amazon:112-1:0",
      }],
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rejected_closed).toBe(2)
    expect(json.rejected_closed_rows).toEqual([REJECTED_ROW])
  })

  it("legacy DAL shape ({ inserted } only) coalesces to 0/[] — the old-mock invariant", async () => {
    ;(insertImportedEntries as ReturnType<typeof vi.fn>).mockResolvedValue({ inserted: 1 })
    const res = await PLATFORM_COMMIT(post({
      book_id: BOOK,
      entries: [{
        direction: "income", amount_cents: 5000, occurred_on: "2019-02-02", memo: "x",
        counterparty: null, service_line: null, source: "platform_import", source_ref: "payments:2",
      }],
    }))
    const json = await res.json()
    expect(json.rejected_closed).toBe(0)
    expect(json.rejected_closed_rows).toEqual([])
  })
})
```

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/closed-period-writes.test.ts` → FAIL (single-row routes 500; batch responses lack the fields).

- [ ] **Step 2: Route edits (each is a surgical diff — do not restructure)**

In **all 5 single-row route files**, add the import `import { PERIOD_CLOSED_MESSAGE } from "@/lib/bookkeeping/period-close"` and insert this as the FIRST line inside the existing `catch (error) {` block (before the `console.error`):

```ts
    if ((error as { code?: string }).code === "PERIOD_CLOSED") {
      return NextResponse.json({ error: PERIOD_CLOSED_MESSAGE }, { status: 409 })
    }
```

Files/handlers: `entries/route.ts` POST; `entries/[id]/route.ts` PATCH **and** DELETE (both catches); `receipts/cash/route.ts` POST; `receipts/commit/route.ts` POST.

In **`statement-import/commit/route.ts`** replace lines 30-35 (destructure → audit → response) with:

```ts
    const { inserted, rejected_closed, rejected_closed_rows } = await insertImportedEntries(book_id, batchId, entries)
    if (document_id) await linkDocumentBatch(document_id, book_id, batchId, inserted)
    void recordAudit({ action: "bookkeeping.statement_imported", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_book", id: book_id },
      metadata: { requested: entries.length, inserted, rejected_closed: rejected_closed ?? 0, import_batch_id: batchId, document_id }, request })
    return NextResponse.json({ inserted, batchId, rejected_closed: rejected_closed ?? 0, rejected_closed_rows: rejected_closed_rows ?? [] })
```

In **`import-platform/commit/route.ts`** replace lines 15-19 with:

```ts
    const { inserted, rejected_closed, rejected_closed_rows } = await insertImportedEntries(parsed.data.book_id, batchId, parsed.data.entries)
    void recordAudit({ action: "bookkeeping.platform_income_imported", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_book", id: parsed.data.book_id },
      metadata: { requested: parsed.data.entries.length, inserted, rejected_closed: rejected_closed ?? 0, import_batch_id: batchId }, request })
    return NextResponse.json({ inserted, batchId, rejected_closed: rejected_closed ?? 0, rejected_closed_rows: rejected_closed_rows ?? [] })
```

In **`receipts/amazon/commit/route.ts`**: change the `insertAmazonEntries` destructure at :57 to `const { inserted, rejected_closed, rejected_closed_rows } = await insertAmazonEntries(`, add `rejected_closed: rejected_closed ?? 0,` into the audit metadata object (:81), and replace the response at :85 with:

```ts
    return NextResponse.json({ inserted, batchId, rejected_closed: rejected_closed ?? 0, rejected_closed_rows: rejected_closed_rows ?? [] })
```

- [ ] **Step 3: New tests pass AND every pre-existing bookkeeping suite stays green**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/closed-period-writes.test.ts`
Expected: PASS (9 tests).
Run: `npx vitest run __tests__/app/api/admin/bookkeeping __tests__/api/admin/bookkeeping`
Expected: PASS — no mock factory was invalidated (only `@/lib/bookkeeping/period-close` was newly imported, and it is never mocked; batch fields coalesce for legacy `{ inserted }` mocks).

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/bookkeeping/entries app/api/admin/bookkeeping/receipts app/api/admin/bookkeeping/statement-import/commit/route.ts app/api/admin/bookkeeping/import-platform/commit/route.ts __tests__/app/api/admin/bookkeeping/closed-period-writes.test.ts
git commit -m "feat(bookkeeper): PERIOD_CLOSED → 409 on all single-row writes + additive rejected_closed passthrough on batch commits"
```

---

### Task 6: Books-closed email — `lib/bookkeeping/email-close.ts` + POST-close wiring

**Files:**
- Create: `lib/bookkeeping/email-close.ts`
- Modify: `app/api/admin/bookkeeping/closes/route.ts` (POST gains the flag-gated fire-and-forget block)
- Test: `__tests__/lib/bookkeeping/email-close.test.ts`, `__tests__/app/api/admin/bookkeeping/closes.test.ts` (append)

**Interfaces:**
- Consumes: `resend`, `FROM_EMAIL` from `@/lib/resend` (verified `lib/resend.ts:3-4`); `formatPeriodLabel` (Task 2); `formatCents` (`lib/bookkeeping/money.ts:4`); `getSetting` (`lib/db/system-settings.ts:13`); `stampCloseEmailSent` (Task 4). **Correction:** `vitest.config.ts:14` *sets* `process.env.RESEND_API_KEY = "re_test_global"` globally (a deliberate non-empty placeholder, per its own comment, so truthiness guards don't short-circuit) and `__tests__/setup.tsx:6-16` globally mocks the `resend` package to resolve success — so the fail-loud branch is NOT the default env and must be driven explicitly by deleting the env var inside the test, exactly like the in-repo precedent `__tests__/lib/bookkeeping/email-pack.test.ts:13-35` (save the original value in `beforeEach`, restore in `afterAll`, `delete process.env.RESEND_API_KEY` inside the one test that needs the guard to fire).
- Produces: `sendBooksClosedEmail(input): Promise<{ error: string | null }>`, `booksClosedEmailHtml(input): string` — the `email-pack.ts` shape verbatim (fail-LOUD without `RESEND_API_KEY` at :31, coach-cc-unless-recipient at :36).

**Pinned semantics (spec §3.5, D-15):** subject `Books closed — {book} {Month YYYY}`; body = snapshot table (income/expense/net, entry count, closed at) + the honesty line *"This confirms the month's record-keeping is closed in DJP Athlete's books. It is not a filing; your CPA files."* Recipient: stored `bookkeeping_accountant_email` when non-empty (cc coach), else coach alone. Flag `bookkeeping_close_email_enabled` default `false`. Send is fire-and-forget AFTER the close row persists — email failure NEVER fails the close (201 regardless); success stamps `email_sent_at` and audits `bookkeeping.close_emailed` success; any failure audits it as failure.

- [ ] **Step 1: Write the failing pure test**

```ts
// __tests__/lib/bookkeeping/email-close.test.ts
// vitest.config.ts:14 sets a global non-empty RESEND_API_KEY placeholder and
// __tests__/setup.tsx:6-16 globally mocks "resend" to resolve success, so the
// fail-loud branch is NOT the default env — it must be driven explicitly by
// deleting the key, mirroring __tests__/lib/bookkeeping/email-pack.test.ts:13-35.
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { booksClosedEmailHtml, sendBooksClosedEmail } from "@/lib/bookkeeping/email-close"

const INPUT = {
  recipient: "cpa@example.com",
  bookName: "Darren — DJP Athlete",
  period: "2026-03",
  income_cents: 512345,
  expense_cents: 123400,
  net_cents: 388945,
  entry_count: 42,
  closed_at: "2026-07-18T10:00:00Z",
}

let origResendKey: string | undefined

beforeEach(() => {
  origResendKey = process.env.RESEND_API_KEY
})

afterAll(() => {
  if (origResendKey !== undefined) {
    process.env.RESEND_API_KEY = origResendKey
  } else {
    delete process.env.RESEND_API_KEY
  }
})

describe("booksClosedEmailHtml", () => {
  it("carries the book, the Month YYYY label, exact formatted totals, and the honesty line", () => {
    const html = booksClosedEmailHtml(INPUT)
    expect(html).toContain("Darren — DJP Athlete")
    expect(html).toContain("March 2026")
    expect(html).toContain("$5,123.45")
    expect(html).toContain("$1,234.00")
    expect(html).toContain("$3,889.45")
    expect(html).toContain("42")
    expect(html).toContain("It is not a filing; your CPA files.")
  })
})

describe("sendBooksClosedEmail", () => {
  it("fails LOUD when RESEND_API_KEY is unset (never a silent no-op)", async () => {
    delete process.env.RESEND_API_KEY
    const r = await sendBooksClosedEmail(INPUT)
    expect(r.error).toBe("RESEND_API_KEY not configured")
  })
})
```

Run: `npx vitest run __tests__/lib/bookkeeping/email-close.test.ts` → FAIL (module missing).

- [ ] **Step 2: Write the module**

```ts
// lib/bookkeeping/email-close.ts
// Phase-6a outbound: the books-closed statement (spec §3.5). Sibling of
// email-pack.ts — same Resend init, fail-LOUD without RESEND_API_KEY, coach-cc.
// A statement of record-keeping, never a filing (honesty guardrail §7).
import { resend, FROM_EMAIL } from "@/lib/resend"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatPeriodLabel } from "@/lib/bookkeeping/period-close"

export interface SendBooksClosedEmailInput {
  recipient: string
  bookName: string
  period: string // YYYY-MM
  income_cents: number
  expense_cents: number
  net_cents: number
  entry_count: number
  closed_at: string
}

export function booksClosedEmailHtml(input: SendBooksClosedEmailInput): string {
  return `
  <div style="font-family: sans-serif; max-width: 560px;">
    <h2>Books closed — ${input.bookName}, ${formatPeriodLabel(input.period)}</h2>
    <table style="font-size: 14px; border-collapse: collapse;">
      <tr><td style="padding: 4px 12px 4px 0;">Income</td><td><strong>${formatCents(input.income_cents)}</strong></td></tr>
      <tr><td style="padding: 4px 12px 4px 0;">Expenses</td><td><strong>${formatCents(input.expense_cents)}</strong></td></tr>
      <tr><td style="padding: 4px 12px 4px 0;">Net</td><td><strong>${formatCents(input.net_cents)}</strong></td></tr>
      <tr><td style="padding: 4px 12px 4px 0;">Entries</td><td>${input.entry_count}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0;">Closed at</td><td>${input.closed_at}</td></tr>
    </table>
    <p style="font-size: 13px; color: #444;">
      This confirms the month's record-keeping is closed in DJP Athlete's books. It is not a filing; your CPA files.
    </p>
    <p style="font-size: 12px; color: #888;">Sent from the DJP Athlete bookkeeping system.</p>
  </div>`
}

export async function sendBooksClosedEmail(input: SendBooksClosedEmailInput): Promise<{ error: string | null }> {
  if (!process.env.RESEND_API_KEY) return { error: "RESEND_API_KEY not configured" }
  const coach = process.env.COACH_EMAIL
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: input.recipient,
    ...(coach && coach !== input.recipient ? { cc: coach } : {}),
    subject: `Books closed — ${input.bookName} ${formatPeriodLabel(input.period)}`,
    html: booksClosedEmailHtml(input),
  })
  if (error) return { error: error.message ?? "Resend send failed" }
  return { error: null }
}
```

Run: `npx vitest run __tests__/lib/bookkeeping/email-close.test.ts` → PASS.

- [ ] **Step 3: Append the failing route tests**

Append to `__tests__/app/api/admin/bookkeeping/closes.test.ts` — two new `vi.mock` lines at the top of the file, WITH the existing mock block (hoisting keeps them together):

```ts
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/bookkeeping/email-close", () => ({ sendBooksClosedEmail: vi.fn() }))
```

new imports:

```ts
import { getSetting } from "@/lib/db/system-settings"
import { sendBooksClosedEmail } from "@/lib/bookkeeping/email-close"
import { stampCloseEmailSent } from "@/lib/db/bookkeeping"
```

add to the existing `beforeEach` (default = flag OFF, no accountant):

```ts
  ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (_key: string, fallback: unknown) => fallback)
  ;(sendBooksClosedEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
```

and the new describe block:

```ts
describe("POST /closes — books-closed email (D-15)", () => {
  const flagOn = (accountant = "") =>
    (getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string, fallback: unknown) => {
      if (key === "bookkeeping_close_email_enabled") return true
      if (key === "bookkeeping_accountant_email") return accountant
      return fallback
    })
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it("flag OFF (default) → close succeeds, no send attempted", async () => {
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(201)
    await settle()
    expect(sendBooksClosedEmail).not.toHaveBeenCalled()
    expect(stampCloseEmailSent).not.toHaveBeenCalled()
  })

  it("flag ON + stored accountant → sends to the accountant, stamps email_sent_at, audits success", async () => {
    flagOn("cpa@example.com")
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(201) // response never waits on the send
    await vi.waitFor(() => expect(sendBooksClosedEmail).toHaveBeenCalled())
    expect(sendBooksClosedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "cpa@example.com", bookName: "Darren — DJP Athlete", period: "2019-01" }),
    )
    await vi.waitFor(() => expect(stampCloseEmailSent).toHaveBeenCalledWith(CLOSE))
    await vi.waitFor(() =>
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "bookkeeping.close_emailed", outcome: "success" }),
      ),
    )
  })

  it("flag ON + empty accountant → falls back to the coach alone", async () => {
    // Save/restore idiom (email-pack.test.ts:14-35 precedent) — .env.local
    // defines a real COACH_EMAIL, so an unconditional delete would leak into
    // later tests in this file/worker; this stubs it for one test only.
    const origCoachEmail = process.env.COACH_EMAIL
    flagOn("")
    process.env.COACH_EMAIL = "darren@darrenjpaul.com"
    try {
      const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
      expect(res.status).toBe(201)
      await vi.waitFor(() =>
        expect(sendBooksClosedEmail).toHaveBeenCalledWith(
          expect.objectContaining({ recipient: "darren@darrenjpaul.com" }),
        ),
      )
    } finally {
      if (origCoachEmail !== undefined) {
        process.env.COACH_EMAIL = origCoachEmail
      } else {
        delete process.env.COACH_EMAIL
      }
    }
  })

  it("send failure → close STILL 201, close_emailed audited as failure, no stamp", async () => {
    flagOn("cpa@example.com")
    ;(sendBooksClosedEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "boom" })
    const res = await POST(body({ book_id: BOOK, period: "2019-01" }))
    expect(res.status).toBe(201)
    await vi.waitFor(() =>
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "bookkeeping.close_emailed",
          outcome: "failure",
          metadata: expect.objectContaining({ error: "boom" }),
        }),
      ),
    )
    expect(stampCloseEmailSent).not.toHaveBeenCalled()
  })
})
```

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/closes.test.ts` → FAIL (route has no email code; flag-OFF cases pass, ON cases fail).

- [ ] **Step 4: Wire the POST close route**

In `app/api/admin/bookkeeping/closes/route.ts`, add imports:

```ts
import { getSetting } from "@/lib/db/system-settings"
import { sendBooksClosedEmail } from "@/lib/bookkeeping/email-close"
import { stampCloseEmailSent } from "@/lib/db/bookkeeping"
```

(`stampCloseEmailSent` joins the existing `@/lib/db/bookkeeping` import list — this route's own test file already mocks it since Task 4.)

Insert between the `period_closed` audit and the `return NextResponse.json({ close }, { status: 201 })`:

```ts
    // D-15: fire-and-forget AFTER the row persists — email failure never
    // fails the close. Flag default OFF; recipient = stored accountant
    // (cc coach inside sendBooksClosedEmail) else the coach alone.
    const emailEnabled = await getSetting<boolean>("bookkeeping_close_email_enabled", false)
    if (emailEnabled) {
      void (async () => {
        try {
          // String(x ?? "") junk-defense (house style): getSetting returns raw
          // jsonb, so a null/non-string stored value would otherwise throw
          // .trim() on undefined. 00187 seeds '""'::jsonb so this is a belt-
          // and-suspenders guard, not a currently-reachable path.
          const accountant = String((await getSetting<string>("bookkeeping_accountant_email", "")) ?? "").trim()
          const recipient = accountant !== "" ? accountant : (process.env.COACH_EMAIL ?? "")
          if (!recipient) throw new Error("no recipient configured (accountant email and COACH_EMAIL both empty)")
          const { error } = await sendBooksClosedEmail({
            recipient, bookName: book.name, period,
            income_cents: totals.income_cents, expense_cents: totals.expense_cents,
            net_cents: totals.net_cents, entry_count: totals.entry_count,
            closed_at: close.closed_at,
          })
          if (error) throw new Error(error)
          await stampCloseEmailSent(close.id)
          void recordAudit({
            action: "bookkeeping.close_emailed", category: "commerce", outcome: "success",
            target: { type: "bookkeeping_period_close", id: close.id },
            metadata: { book_id, period, recipient },
          })
        } catch (err) {
          void recordAudit({
            action: "bookkeeping.close_emailed", category: "commerce", outcome: "failure",
            target: { type: "bookkeeping_period_close", id: close.id },
            metadata: { book_id, period, error: (err as Error).message },
          })
        }
      })()
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/closes.test.ts __tests__/lib/bookkeeping/email-close.test.ts`
Expected: PASS (including every pre-Task-6 test in closes.test.ts — the added `getSetting` default mock returns the fallback, i.e. flag OFF).

- [ ] **Step 6: Commit**

```bash
git add lib/bookkeeping/email-close.ts app/api/admin/bookkeeping/closes/route.ts __tests__/lib/bookkeeping/email-close.test.ts __tests__/app/api/admin/bookkeeping/closes.test.ts
git commit -m "feat(bookkeeper): books-closed email — flag-gated fire-and-forget after persist, email_sent_at stamp, close_emailed audit"
```

---

### Task 7: `adjusts_period` plumbing — type, schemas, routes, dialog select, ledger badge

**Files:**
- Modify: `types/database.ts` (`BookkeepingLedgerEntry` gains `adjusts_period`)
- Modify: `lib/validators/bookkeeping.ts` (`createEntrySchema` + `updateEntrySchema`)
- Modify: `app/api/admin/bookkeeping/entries/route.ts` (POST passes it)
- Modify: `app/api/admin/bookkeeping/receipts/cash/route.ts` (passes `null` — required once the type widens)
- Modify: `components/admin/bookkeeping/ManualEntryDialog.tsx` (optional select)
- Modify: `components/admin/bookkeeping/LedgerTable.tsx` (badge)
- Test: `__tests__/lib/bookkeeping/close-validators.test.ts` (append), `__tests__/app/api/admin/bookkeeping/adjusts-period.test.ts`

**Interfaces:**
- `BookkeepingLedgerEntry.adjusts_period: string | null`. **Build-gate landmine:** `createEntry`'s input is `Omit<BookkeepingLedgerEntry, "id" | "created_at" | "updated_at">`, so widening the interface makes the field REQUIRED at BOTH `createEntry` call sites (`entries/route.ts:53` and `receipts/cash/route.ts:24`) — both must be updated in THIS task or `npm run build` breaks (`updateEntry` takes a `Partial`, unaffected; the batch writers build untyped row literals, unaffected).
- Dialog select visible only when the book has ≥1 closed month (`closedPeriods` prop, OPTIONAL with default `[]` — BooksClient wires it in Task 8).

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/bookkeeping/close-validators.test.ts`:

```ts
import { createEntrySchema, updateEntrySchema } from "@/lib/validators/bookkeeping"

describe("adjusts_period on entry schemas", () => {
  const base = { book_id: BOOK, direction: "expense" as const, amount_cents: 100, occurred_on: "2026-02-01" }
  it("optional/nullable and regex-validated on create", () => {
    expect(createEntrySchema.safeParse(base).success).toBe(true)
    expect(createEntrySchema.safeParse({ ...base, adjusts_period: null }).success).toBe(true)
    expect(createEntrySchema.safeParse({ ...base, adjusts_period: "2019-01" }).success).toBe(true)
    expect(createEntrySchema.safeParse({ ...base, adjusts_period: "2019-13" }).success).toBe(false)
    expect(createEntrySchema.safeParse({ ...base, adjusts_period: "2019-01-15" }).success).toBe(false)
  })
  it("same on update", () => {
    expect(updateEntrySchema.safeParse({ adjusts_period: "2019-12" }).success).toBe(true)
    expect(updateEntrySchema.safeParse({ adjusts_period: null }).success).toBe(true)
    expect(updateEntrySchema.safeParse({ adjusts_period: "2019-00" }).success).toBe(false)
  })
})
```

```ts
// __tests__/app/api/admin/bookkeeping/adjusts-period.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntries: vi.fn(),
  entryTotals: vi.fn(),
  createEntry: vi.fn(),
  getAccount: vi.fn(),
}))

import { POST as ENTRIES_POST } from "@/app/api/admin/bookkeeping/entries/route"
import { POST as CASH_POST } from "@/app/api/admin/bookkeeping/receipts/cash/route"
import { auth } from "@/lib/auth"
import { createEntry, getAccount } from "@/lib/db/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACCOUNT = "a0000000-0000-4000-8000-000000000001"
const ADMIN = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }
const post = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN)
  ;(createEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "e1", memo: null })
  ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: ACCOUNT, book_id: BOOK, account_type: "expense", requires_business_purpose: false,
  })
})

describe("adjusts_period plumbing", () => {
  it("POST /entries forwards adjusts_period to createEntry", async () => {
    const res = await ENTRIES_POST(post({
      book_id: BOOK, direction: "expense", amount_cents: 100, occurred_on: "2026-02-01", adjusts_period: "2019-01",
    }))
    expect(res.status).toBe(201)
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ adjusts_period: "2019-01" }))
  })
  it("POST /entries defaults it to null when absent", async () => {
    await ENTRIES_POST(post({ book_id: BOOK, direction: "expense", amount_cents: 100, occurred_on: "2026-02-01" }))
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ adjusts_period: null }))
  })
  it("POST /entries 400s a malformed adjusts_period", async () => {
    const res = await ENTRIES_POST(post({
      book_id: BOOK, direction: "expense", amount_cents: 100, occurred_on: "2026-02-01", adjusts_period: "2019-13",
    }))
    expect(res.status).toBe(400)
    expect(createEntry).not.toHaveBeenCalled()
  })
  it("POST /receipts/cash always writes adjusts_period: null (receipts are not adjustments)", async () => {
    const res = await CASH_POST(post({
      book_id: BOOK, account_id: ACCOUNT, amount_cents: 100, occurred_on: "2026-02-01",
    }))
    expect(res.status).toBe(201)
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ adjusts_period: null }))
  })
})
```

Run: `npx vitest run __tests__/lib/bookkeeping/close-validators.test.ts __tests__/app/api/admin/bookkeeping/adjusts-period.test.ts` → FAIL.

- [ ] **Step 2: Type + schemas + routes**

`types/database.ts` — add to `BookkeepingLedgerEntry` (after `document_id: string | null`, :575):

```ts
  adjusts_period: string | null
```

`lib/validators/bookkeeping.ts` — add to `createEntrySchema` AND `updateEntrySchema` object bodies:

```ts
  adjusts_period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM").nullable().optional(),
```

`app/api/admin/bookkeeping/entries/route.ts` POST — in the `createEntry({...})` literal (:53-58) add:

```ts
      adjusts_period: d.adjusts_period ?? null,
```

`app/api/admin/bookkeeping/receipts/cash/route.ts` — in its `createEntry({...})` literal (:24-30) add:

```ts
      adjusts_period: null,
```

(PATCH needs no edit: `updateEntry(id, parsed.data)` already forwards the whole parsed partial.)

- [ ] **Step 3: ManualEntryDialog select**

In `components/admin/bookkeeping/ManualEntryDialog.tsx`:
- Add import: `import { formatPeriodLabel } from "@/lib/bookkeeping/period-close"`.
- Props: add `closedPeriods = [] as string[]` — the destructured signature becomes `{ bookId, accounts, entry, open, onOpenChange, onSaved, closedPeriods = [] }` with `closedPeriods?: string[]` in the props type.
- `FormState`: add `adjustsPeriod: string` (`""` = none). `emptyForm()` gains `adjustsPeriod: ""`; `formFromEntry` gains `adjustsPeriod: entry.adjusts_period ?? ""`.
- `submit()` body object gains `adjusts_period: form.adjustsPeriod || null,`.
- Render, directly after the Category block and only when closed months exist:

```tsx
          {closedPeriods.length > 0 && (
            <div className="space-y-2">
              <Label>Adjusts closed month</Label>
              <Select
                value={form.adjustsPeriod || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, adjustsPeriod: v === "none" ? "" : v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {closedPeriods.map((p) => (
                    <SelectItem key={p} value={p}>
                      {formatPeriodLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Posts in this entry&apos;s own (open) month but is labeled as a correction to the closed month.
              </p>
            </div>
          )}
```

- [ ] **Step 4: LedgerTable badge**

In `components/admin/bookkeeping/LedgerTable.tsx`, inside the Memo cell (after the counterparty line, :109-111):

```tsx
              {row.adjusts_period ? (
                <span className="mt-0.5 inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                  adjusts {row.adjusts_period}
                </span>
              ) : null}
```

- [ ] **Step 5: Tests pass + typecheck (the two-call-site invariant)**

Run: `npx vitest run __tests__/lib/bookkeeping/close-validators.test.ts __tests__/app/api/admin/bookkeeping/adjusts-period.test.ts __tests__/app/api/admin/bookkeeping/closed-period-writes.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit 2>&1 | Select-String "adjusts_period|createEntry"`
Expected: no output (both `createEntry` call sites satisfied).

- [ ] **Step 6: Commit**

```bash
git add types/database.ts lib/validators/bookkeeping.ts app/api/admin/bookkeeping/entries/route.ts app/api/admin/bookkeeping/receipts/cash/route.ts components/admin/bookkeeping/ManualEntryDialog.tsx components/admin/bookkeeping/LedgerTable.tsx __tests__/lib/bookkeeping/close-validators.test.ts __tests__/app/api/admin/bookkeeping/adjusts-period.test.ts
git commit -m "feat(bookkeeper): adjusts_period — schema field, entry routes, dialog select, ledger badge"
```

---

### Task 8: CloseMonthCard + BooksClient wiring + dialogs' closed-period line

**Files:**
- Create: `components/admin/bookkeeping/CloseMonthCard.tsx`
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (closes state + card + `closedPeriods` to ManualEntryDialog)
- Modify: `components/admin/bookkeeping/ImportPlatformDialog.tsx` (:149-159), `StatementImportDialog.tsx` (:448-454), `AmazonImportDialog.tsx` (:404-410)

**Interfaces:**
- Consumes: `BookkeepingPeriodClose` (Task 4 type), `formatPeriodLabel`, `closableMonthOptions` (Task 2), `formatCents`, `formatOccurredOn` (`lib/bookkeeping/format.ts:3`), shadcn `Select`/`Button`, `window.confirm` (the LedgerTable delete precedent :58).
- Contract: existing dialog reads are ADDITIVE — `data.rejected_closed` typed optional; the "already imported" arithmetic becomes `includedRows.length − inserted − rejectedClosed` (D-4: rejects must not misreport as "already imported"). The dialogs close-and-reset on success, so the "distinct amber line" is delivered as a persistent `toast.warning` alongside the success toast (house precedent for partial success: `AddClientDialog.tsx:73`, `CopyFromProgramDialog.tsx:249`).

- [ ] **Step 1: CloseMonthCard**

```tsx
// components/admin/bookkeeping/CloseMonthCard.tsx
"use client"

// Phase 6a (D-1/D-5/D-7): per-book close list + close/reopen actions.
// The close freezes TOTALS, not documents — retention may still prune links.
import { useState } from "react"
import { Lock, Unlock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { closableMonthOptions, formatPeriodLabel } from "@/lib/bookkeeping/period-close"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import type { BookkeepingPeriodClose } from "@/types/database"

export function CloseMonthCard({
  bookId,
  closes,
  onChanged,
}: {
  bookId: string
  closes: BookkeepingPeriodClose[]
  onChanged: () => void
}) {
  const [selectedPeriod, setSelectedPeriod] = useState("")
  const [busy, setBusy] = useState(false)

  const closedSet = new Set(closes.map((c) => c.period))
  const options = closableMonthOptions(new Date().toISOString().slice(0, 10), closedSet)

  async function closeMonth() {
    if (!selectedPeriod) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/closes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, period: selectedPeriod }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Failed to close the month")
        return
      }
      const c = data.close as BookkeepingPeriodClose
      toast.success(
        `${formatPeriodLabel(c.period)} closed — income ${formatCents(c.income_cents)}, expenses ${formatCents(c.expense_cents)}, net ${formatCents(c.net_cents)} (${c.entry_count} entries).`,
      )
      setSelectedPeriod("")
      onChanged()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  async function reopen(close: BookkeepingPeriodClose) {
    const confirmed = window.confirm(
      `Reopen ${formatPeriodLabel(close.period)}? Its frozen totals are preserved in the audit log; re-closing will re-snapshot.`,
    )
    if (!confirmed) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/bookkeeping/closes/${close.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Failed to reopen")
        return
      }
      toast.success(`${formatPeriodLabel(close.period)} reopened`)
      onChanged()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-heading text-primary flex items-center gap-2">
          <Lock className="size-4" />
          Monthly close
        </h2>
        <div className="flex items-center gap-2">
          <Select value={selectedPeriod || "none"} onValueChange={(v) => setSelectedPeriod(v === "none" ? "" : v)}>
            <SelectTrigger className="w-44" aria-label="Month to close">
              <SelectValue placeholder="Pick a month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Pick a month…</SelectItem>
              {options.map((p) => (
                <SelectItem key={p} value={p}>
                  {formatPeriodLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={closeMonth} disabled={busy || !selectedPeriod}>
            Close month
          </Button>
        </div>
      </div>

      {closes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No months closed yet for this book. Close a finished month to freeze its totals.
        </p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {closes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-medium">{formatPeriodLabel(c.period)}</span>
              <span className={c.net_cents >= 0 ? "text-success font-mono" : "text-error font-mono"}>
                {formatCents(c.net_cents)} net
              </span>
              <span className="text-xs text-muted-foreground">
                {c.entry_count} entries · closed {formatOccurredOn(c.closed_at.slice(0, 10))}
              </span>
              <Button variant="ghost" size="sm" onClick={() => reopen(c)} disabled={busy} title="Reopen this month">
                <Unlock className="size-3.5" />
                Reopen
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Closing freezes this book&apos;s totals for the month — new entries, edits, deletes, and imports into it are
        blocked; post adjustment entries in an open month instead. Attached document links may still be pruned by the
        receipt-retention policy; the frozen totals are unaffected. Record-keeping only — your CPA files.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: BooksClient wiring**

In `components/admin/bookkeeping/BooksClient.tsx`:
- Imports: add `import { CloseMonthCard } from "@/components/admin/bookkeeping/CloseMonthCard"` and add `BookkeepingPeriodClose` to the `@/types/database` type import.
- State (with the other `useState` calls): `const [closes, setCloses] = useState<BookkeepingPeriodClose[]>([])`.
- Fetch callback + effect (after the accounts effect, :141):

```tsx
  const fetchCloses = useCallback(async () => {
    if (!bookId) {
      setCloses([])
      return
    }
    try {
      const res = await fetch(`/api/admin/bookkeeping/closes?book_id=${bookId}`)
      if (!res.ok) throw new Error("Failed to load closed months")
      const body = (await res.json()) as { closes: BookkeepingPeriodClose[] }
      setCloses(body.closes ?? [])
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [bookId])

  useEffect(() => {
    void fetchCloses()
  }, [fetchCloses])
```

- Render `CloseMonthCard` directly after the Totals strip `</div>` (:217), inside the `TabsContent`:

```tsx
          <CloseMonthCard
            bookId={bookId}
            closes={closes}
            onChanged={() => {
              void fetchCloses()
              void fetchEntries()
            }}
          />
```

- Pass the closed periods into the manual-entry dialog (:367-374): add prop `closedPeriods={closes.map((c) => c.period)}`.

- [ ] **Step 3: Dialog arithmetic + amber line (three commit handlers)**

`ImportPlatformDialog.tsx` — replace :149-159 with:

```ts
      // Additive server fields: rejected_closed rows are CLOSED-month rejects,
      // never "already imported" — exclude them from the skipped arithmetic (D-4).
      const data = (await res.json()) as { inserted: number; batchId: string; rejected_closed?: number }
      const rejectedClosed = data.rejected_closed ?? 0
      const skipped = includedRows.length - data.inserted - rejectedClosed
      if (rejectedClosed > 0) {
        toast.warning(
          `${rejectedClosed} row${rejectedClosed === 1 ? " falls" : "s fall"} in closed months — post them as adjustment entries in an open month.`,
        )
      }
      if (skipped > 0) {
        toast.success(
          `Posted ${data.inserted} ${data.inserted === 1 ? "entry" : "entries"} (${skipped} already imported — skipped).`,
        )
      } else {
        toast.success(`Posted ${data.inserted} ${data.inserted === 1 ? "entry" : "entries"}.`)
      }
```

`StatementImportDialog.tsx` — replace :448-454 with:

```ts
      const inserted = typeof data.inserted === "number" ? data.inserted : 0
      const rejectedClosed = typeof data.rejected_closed === "number" ? data.rejected_closed : 0
      const skipped = includedRows.length - inserted - rejectedClosed
      if (rejectedClosed > 0) {
        toast.warning(
          `${rejectedClosed} row${rejectedClosed === 1 ? " falls" : "s fall"} in closed months — post them as adjustment entries in an open month.`,
        )
      }
      if (skipped > 0) {
        toast.success(`Posted ${inserted} ${inserted === 1 ? "entry" : "entries"} (${skipped} already recorded — skipped).`)
      } else {
        toast.success(`Posted ${inserted} ${inserted === 1 ? "entry" : "entries"}.`)
      }
```

`AmazonImportDialog.tsx` — replace :404-410 with the SAME block as StatementImportDialog (it already uses the identical `data`/`inserted` idiom).

- [ ] **Step 4: Typecheck + all bookkeeping suites**

Run: `npx tsc --noEmit 2>&1 | Select-String "CloseMonthCard|BooksClient|ImportPlatformDialog|StatementImportDialog|AmazonImportDialog|ManualEntryDialog"`
Expected: no output.
Run: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/api/admin/bookkeeping`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/bookkeeping/CloseMonthCard.tsx components/admin/bookkeeping/BooksClient.tsx components/admin/bookkeeping/ImportPlatformDialog.tsx components/admin/bookkeeping/StatementImportDialog.tsx components/admin/bookkeeping/AmazonImportDialog.tsx
git commit -m "feat(bookkeeper): CloseMonthCard on /admin/books + closed-month wiring + dialogs' rejected_closed line"
```

---

### Task 9: Full verification + live sentinel proof

**Files:**
- Create (scratchpad only, never committed): a `tsx` proof script in the session scratchpad dir.

- [ ] **Step 1: Scoped suites**

Run: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/api/admin/bookkeeping`
Expected: PASS (all bookkeeping roots, old and new).

- [ ] **Step 2: Full suite vs the known-red baseline**

Run: `npm run test:run` (capture output). Compare failures against the known-red family (uploads/shop, import-excel-route, admin-nav, webhook-external, events). Any OTHER red: `git stash` the phase's diff, re-run that file, unstash — only chase it if it's ours. The no-closes-exist invariant means the guard is a pure no-op for every pre-existing fixture — the baseline must not move.

- [ ] **Step 3: Production build (its own command — NEVER `&&` after tests)**

Run: `npm run build`
Expected: GREEN. (Silent exit at "Running TypeScript" with no diagnostic = memory flake → re-run once before diagnosing.)

- [ ] **Step 4: D-2 grep proofs**

Use the Grep tool for all three (NOT `npx rg` — see Task 1 Step 2's note; `npx rg` resolves to an unrelated npm package, not ripgrep, in this environment):
Grep pattern `PeriodClosedError|listClosedPeriods`, path `app/`.
Expected: zero matches — no route imports the guard machinery (duck-typed `.code` only; D-2 holds).
Grep pattern `withAudit`, path `app/api/admin/bookkeeping/closes`.
Expected: zero matches (inline `void recordAudit` only).
Grep pattern `rejected_closed`, path `components/admin/bookkeeping`.
Expected: matches ONLY in the three dialogs' commit handlers.

- [ ] **Step 5: Live sentinel proof (requires 00188 applied via `mcp__supabase__apply_migration`; orchestrator-run)**

Far-PAST window `2019-01`/`2019-02` (D-7 makes future months unclosable; a pre-business past month is collision-proof on a near-empty ledger). Sentinel markers: memo prefix `f6-sentinel`, `source_ref` prefix `f6:`. Write a scratchpad `tsx` script (loads `.env.local`, imports the REAL `lib/db/bookkeeping.ts`) that, against the Household book (`b0000000-0000-4000-8000-000000000003`):
1. `createEntry` A: expense 123¢, `occurred_on: "2019-01-15"`, memo `f6-sentinel-a`, source `manual`, `adjusts_period: null` → succeeds (no close yet).
2. `createEntry` B: expense 100¢, `2019-02-10`, memo `f6-sentinel-b` → succeeds.
3. `insertClose` for `("2019-01")` with totals from `listEntriesForReports("2019-01-01","2019-01-31", book)` → snapshot shows A's 123¢.
4. EVERY guarded path against the closed month — expect `code === "PERIOD_CLOSED"` from: `createEntry` (2019-01-20); `updateEntry(A.id, { memo: "x" })` (old-period check); `updateEntry(B.id, { occurred_on: "2019-01-20" })` (**new-period check on an occurred_on-only edit** — the naive-placement landmine, proven live); `deleteEntry(A.id)`; `insertReceiptEntry` (2019-01-05, `source_ref: "f6:r1"`); and expect `rejected_closed: 1, inserted: 1` from `insertImportedEntries` (one draft in 2019-01 + one in 2019-02, refs `f6:i1`/`f6:i2`) and `insertAmazonEntries` (same split, refs `f6:z1`/`f6:z2`).
5. Adjustment posts: `createEntry` expense 50¢ in `2019-02-15` with `adjusts_period: "2019-01"`, memo `f6-sentinel-adj` → succeeds.
6. Reopen: `deleteClose(close.id)` → `deleteEntry(A.id)` now succeeds.
7. Cleanup via `mcp__supabase__execute_sql`: `DELETE FROM bookkeeping_ledger_entries WHERE memo LIKE 'f6-sentinel%' OR source_ref LIKE 'f6:%'; DELETE FROM bookkeeping_period_closes WHERE period IN ('2019-01','2019-02');` then `SELECT count(*)` on both predicates → **0 rows**. NEVER touch non-sentinel rows.

- [ ] **Step 6: Commit any fixes, then hand off to the sub-phase review**

No push (push HELD for the whole phase-6 branch). The eventual Opus whole-branch review must trace a closed-month write through every row of the spec §3.3 table — this plan's Task 3 diff plus Task 9's live proof are the evidence trail.

---

## Self-Review (done at plan time)

1. **Spec coverage:** §3.1→T1, §3.2→T2, §3.3→T3+T5, §3.4→T4, §3.5+D-15→T6, §3.6+D-3→T7+T8, §3.7/§9→every test step + T9. All of D-1 (reopen audited, snapshot in metadata), D-2 (DAL choke point, no new route-level DAL imports), D-4 (partition before upsert, additive responses, dialogs' arithmetic), D-5 (honesty copy in CloseMonthCard), D-6 (updateEntry rejects even account-only edits via the unconditional old-row check), D-7 (strict-past-UTC, empty-month zero snapshot) are pinned by named tests.
2. **Landmines encoded:** existing-mock safety (Task 3 Step 6, Task 5 Steps 1/3 legacy-shape test); closed rejects never ride the duplicate-skip (partition-before-upsert + the cap/count test + dialog arithmetic); guard no-ops with zero closes (pure test + Step-2 baseline check); the occurred_on-only PATCH bypass (DAL-internal unconditional fetch + live proof step 4); the `createEntry` two-call-site type break (Task 7 Step 5 grep).
3. **Signatures:** every existing function/type referenced was read from source this session (`lib/db/bookkeeping.ts`, both entries routes, all four commit routes, `receipts/cash`, `email-pack.ts`, `resend.ts`, `system-settings.ts`, `record.ts` + `actions.ts`, `money.ts`, `format.ts`, `types/database.ts:527-576`, `BooksClient`/`ManualEntryDialog`/`LedgerTable`/dialog commit handlers, 00183 RLS block, test-root conventions).
4. **Ambiguities resolved (documented for the reviewer):** `PeriodClosedError` is DEFINED in the pure module and re-exported from the DAL (spec places it in the DAL; the pure module placement keeps period-close.ts zero-IO and the class importable by tests without touching mocks). `getCloseById` + `stampCloseEmailSent` extend the spec's four DAL functions (DELETE-404 and the email stamp need them). The dialogs' "distinct amber line" ships as `toast.warning` (dialogs unconditionally close-and-reset on success; house partial-success precedent). The double-close race falls to the DB unique as a 500 backstop after the 409 pre-check (single-admin acceptable, noted inline).
