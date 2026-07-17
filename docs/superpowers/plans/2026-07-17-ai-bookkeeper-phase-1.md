# AI Bookkeeper — Phase 1 (Foundation & Ledger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, admin-only **Books** section where Darren can switch between three sets of books, see a paginated/filterable ledger with running totals, add manual income/expense entries, manage a chart of accounts, and pull his platform income (Stripe/packs/shop/events) in as reviewable drafts he posts to the ledger.

**Architecture:** New `bookkeeping_*` tables (books, accounts, ledger_entries) read/written through one DAL (`lib/db/bookkeeping.ts`); all money math in a pure income adapter (`lib/bookkeeping/income-adapter.ts`, zero-IO, zero-mock tests); self-gated admin API routes under `/api/admin/bookkeeping/*`; server-component UI under `/admin/books`. Reuses the codebase's proven patterns verbatim (pure-aggregator, paginated reads, self-gate + audit, dialog + `router.refresh()`).

**Tech Stack:** Next.js 16 App Router (server components), Supabase Postgres (service-role DAL), Zod v4 validators, Vitest (jsdom), Tailating v4 + shadcn/ui, Lucide icons.

## Global Constraints

Every task's requirements implicitly include these (verbatim from the design doc + reuse map, verified against the tree at `7a34a41a`):

- **Migration number is `00183`.** Apply via `mcp__supabase__apply_migration` — the CLI is not linked; never `supabase db push`. Writing the `.sql` file does NOT apply it.
- **Money is `integer` cents** (`amount_cents`), never numeric/float/dollars.
- **`/api/*` is NOT protected by `proxy.ts`.** Every route self-gates: `const session = await auth(); if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })`. NEVER use `requireAdmin()` in a route handler (it throws `NEXT_REDIRECT`, not 403).
- **PostgREST silently caps `.select()` at ~1000 rows.** Every ledger/income read MUST `.range()`-paginate or use `count:"exact", head:true`. A ledger is a growth table.
- **`upsert onConflict` needs a PLAIN unique constraint.** Nullable keys use `UNIQUE NULLS NOT DISTINCT` + JS de-dupe.
- **Zod is v4:** `.uuid()` is strict RFC-4122 — test fixtures use the `NNNNNNNN-NNNN-4NNN-8NNN-NNNNNNNNNNNN` form (version nibble `4`, variant `8`). `z.record()` needs two args.
- **RLS is decorative** (all DALs are service-role). Book isolation is application-level: every DAL fn takes `bookId`, every route resolves + passes it. Do not rely on RLS.
- **Tests:** pure logic → `__tests__/lib/**` (zero mocks). Route tests `vi.mock('@/lib/db/bookkeeping')` (the DAL module, never the Supabase client) and `import { POST }` AFTER the mocks. **NEVER** put tests in `__tests__/db/` (hits real prod DB). Baseline is NOT green (~8-9 known reds, flaky under load) — snapshot the failing set before blaming your diff.
- **Money formatting:** use the new `formatCents` everywhere; no inline `(x/100).toFixed(2)`.
- **Design system:** semantic Tailwind classes (`text-primary`, `bg-accent`, `text-muted-foreground`), `font-heading`/`font-body`; no hardcoded hex, no inline `fontFamily`.
- **Commit after every task** on branch `feat/ai-bookkeeper-phase-1`. Do NOT push. Do NOT stage `JOURNAL.md` or the pre-existing uncommitted files (`lib/pr-detection.ts`, `app/api/client/workouts/log/route.ts`, `render-worker/**`, `exercise-library-match.csv`, `step-up-for-students.html`) — stage only files this plan creates/edits, by explicit path.

---

## File Structure

**Create:**
- `supabase/migrations/00183_bookkeeping_foundation.sql` — tables + seeds.
- `lib/bookkeeping/money.ts` — `formatCents`, `signedCents`.
- `lib/bookkeeping/income-adapter.ts` — pure normalizer (the core).
- `lib/bookkeeping/types.ts` — shared TS types for drafts/inputs.
- `lib/csv/serialize.ts` — shared CSV serializer with injection defense.
- `lib/db/paginate.ts` — shared `fetchAllRows<T>` paginator.
- `lib/db/bookkeeping.ts` — DAL (books, accounts, ledger, platform-income reads).
- `lib/validators/bookkeeping.ts` — Zod schemas.
- `app/api/admin/bookkeeping/entries/route.ts` — list (GET) + create (POST).
- `app/api/admin/bookkeeping/entries/[id]/route.ts` — PATCH + DELETE.
- `app/api/admin/bookkeeping/accounts/route.ts` — list (GET) + create (POST).
- `app/api/admin/bookkeeping/accounts/[id]/route.ts` — PATCH (edit/archive).
- `app/api/admin/bookkeeping/import-platform/route.ts` — preview drafts (POST).
- `app/api/admin/bookkeeping/import-platform/commit/route.ts` — post drafts (POST).
- `app/(admin)/admin/books/page.tsx` — ledger view (server component).
- `app/(admin)/admin/books/accounts/page.tsx` — chart-of-accounts manager (server).
- `components/admin/bookkeeping/BooksClient.tsx` — book switcher + filters + totals (client).
- `components/admin/bookkeeping/LedgerTable.tsx` — the table.
- `components/admin/bookkeeping/ManualEntryDialog.tsx` — add/edit entry dialog.
- `components/admin/bookkeeping/ImportPlatformDialog.tsx` — preview + commit flow.
- `components/admin/bookkeeping/AccountsManager.tsx` — chart-of-accounts CRUD UI.
- Tests mirroring each `lib/**` file + one route test file per route group.

**Modify:**
- `types/database.ts` — add `BookkeepingBook`, `BookkeepingAccount`, `BookkeepingLedgerEntry` interfaces + enums.
- `components/admin/admin-nav.ts` — one `NavItem` push into the "Business" section.
- `lib/audit/actions.ts` — new `bookkeeping.*` action slugs.

---

## Task 1: Database migration + types

**Files:**
- Create: `supabase/migrations/00183_bookkeeping_foundation.sql`
- Modify: `types/database.ts` (append interfaces + enums near the other money types, ~line 523)

**Interfaces:**
- Produces (SQL tables): `bookkeeping_books`, `bookkeeping_accounts`, `bookkeeping_ledger_entries`.
- Produces (TS): `BookKind = 'business' | 'household'`; `LedgerDirection = 'income' | 'expense'`; `LedgerSource = 'manual' | 'platform_import' | 'statement_import' | 'receipt'`; `AccountType = 'income' | 'expense'`; interfaces `BookkeepingBook`, `BookkeepingAccount`, `BookkeepingLedgerEntry` (exact field lists in Step 3).

- [ ] **Step 1: Pre-flight — verify the income-source tables exist in the LIVE DB.**

The migration file headers for `00170`/`00177` say "not applied," but project memory says session packs + memberships are live. Confirm before the adapter (Task 6) relies on them.

Run (via MCP): `mcp__supabase__list_tables` (schemas: `["public"]`). Confirm these exist: `payments`, `shop_orders`, `client_packages`, `session_pack_products`, `event_signups`, `events`, `client_memberships`, `membership_plans`. Note any that are MISSING — the adapter must tolerate a missing source table (Task 6 wraps each source read in its own try/catch and skips-with-warning). Record findings in the task commit message.

- [ ] **Step 2: Write the migration SQL.**

```sql
-- 00183_bookkeeping_foundation.sql
-- AI Bookkeeper Phase 1: the ledger spine. Three sets of books (Darren's
-- business, his wife's business, Household & Personal), a per-book chart of
-- accounts, and a categorized single-entry ledger. Money is integer cents.
-- RLS is enabled for ceremony only — every DAL uses the service-role client
-- and scopes book_id in application code (see design doc D1/§5).

CREATE TABLE IF NOT EXISTS bookkeeping_books (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  book_kind    TEXT NOT NULL CHECK (book_kind IN ('business','household')),
  owner_label  TEXT,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  currency     TEXT NOT NULL DEFAULT 'usd',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookkeeping_accounts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id                UUID NOT NULL REFERENCES bookkeeping_books(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  account_type           TEXT NOT NULL CHECK (account_type IN ('income','expense')),
  service_line           TEXT,
  is_deductible_candidate BOOLEAN NOT NULL DEFAULT false,
  tax_category           TEXT,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  archived_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, name)
);
CREATE INDEX IF NOT EXISTS idx_bk_accounts_book ON bookkeeping_accounts(book_id);

CREATE TABLE IF NOT EXISTS bookkeeping_ledger_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id          UUID NOT NULL REFERENCES bookkeeping_books(id) ON DELETE CASCADE,
  account_id       UUID REFERENCES bookkeeping_accounts(id) ON DELETE SET NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('income','expense')),
  amount_cents     INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency         TEXT NOT NULL DEFAULT 'usd',
  occurred_on      DATE NOT NULL,
  memo             TEXT,
  business_purpose TEXT,
  counterparty     TEXT,
  source           TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','platform_import','statement_import','receipt')),
  source_ref       TEXT,
  import_batch_id  UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (book_id, source, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_bk_ledger_book_date ON bookkeeping_ledger_entries(book_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_bk_ledger_book_account ON bookkeeping_ledger_entries(book_id, account_id);
CREATE INDEX IF NOT EXISTS idx_bk_ledger_source ON bookkeeping_ledger_entries(source, source_ref);

ALTER TABLE bookkeeping_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookkeeping_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookkeeping_ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage books" ON bookkeeping_books FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
CREATE POLICY "Admins manage accounts" ON bookkeeping_accounts FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
CREATE POLICY "Admins manage ledger" ON bookkeeping_ledger_entries FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- ── Seed the three books ────────────────────────────────────────────────
INSERT INTO bookkeeping_books (id, name, book_kind, owner_label, is_primary, sort_order)
VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Darren — DJP Athlete', 'business', 'Darren', true, 0),
  ('b0000000-0000-4000-8000-000000000002', 'Spouse — Business',    'business', 'Spouse', false, 1),
  ('b0000000-0000-4000-8000-000000000003', 'Household & Personal', 'household', 'Household', false, 2)
ON CONFLICT (id) DO NOTHING;

-- ── Seed a starter chart of accounts ────────────────────────────────────
-- Darren's real income lines (from his Excel) on the business book, plus
-- standard expense buckets incl. the tenant reframe (rent, utilities,
-- equipment) which feed the future home-office + depreciation features.
INSERT INTO bookkeeping_accounts (book_id, name, account_type, service_line, is_deductible_candidate, sort_order)
VALUES
  -- Darren business — income
  ('b0000000-0000-4000-8000-000000000001', 'Performance Training — Sports',  'income', 'performance_training', false, 0),
  ('b0000000-0000-4000-8000-000000000001', 'Performance Training — Stripe',  'income', 'performance_training', false, 1),
  ('b0000000-0000-4000-8000-000000000001', 'Teams / Center Work',            'income', 'teams_center', false, 2),
  ('b0000000-0000-4000-8000-000000000001', 'Session Packs',                  'income', 'session_packs', false, 3),
  ('b0000000-0000-4000-8000-000000000001', 'Camps & Clinics',               'income', 'camps', false, 4),
  ('b0000000-0000-4000-8000-000000000001', 'Memberships',                    'income', 'memberships', false, 5),
  ('b0000000-0000-4000-8000-000000000001', 'Shop',                           'income', 'shop', false, 6),
  ('b0000000-0000-4000-8000-000000000001', 'Other Income',                   'income', 'other', false, 7),
  -- Darren business — expenses (deductible candidates flagged)
  ('b0000000-0000-4000-8000-000000000001', 'Equipment',                      'expense', NULL, true, 10),
  ('b0000000-0000-4000-8000-000000000001', 'Software & Subscriptions',       'expense', NULL, true, 11),
  ('b0000000-0000-4000-8000-000000000001', 'Travel',                         'expense', NULL, true, 12),
  ('b0000000-0000-4000-8000-000000000001', 'Meals (business purpose)',       'expense', NULL, true, 13),
  ('b0000000-0000-4000-8000-000000000001', 'Phone & Internet',               'expense', NULL, true, 14),
  ('b0000000-0000-4000-8000-000000000001', 'Vehicle',                        'expense', NULL, true, 15),
  ('b0000000-0000-4000-8000-000000000001', 'Professional Fees',              'expense', NULL, true, 16),
  ('b0000000-0000-4000-8000-000000000001', 'Uncategorized',                  'expense', NULL, false, 99),
  -- Household — expenses (home & tenancy; feed home-office allocation later)
  ('b0000000-0000-4000-8000-000000000003', 'Rent',                           'expense', NULL, false, 0),
  ('b0000000-0000-4000-8000-000000000003', 'Utilities',                      'expense', NULL, false, 1),
  ('b0000000-0000-4000-8000-000000000003', 'Internet',                       'expense', NULL, false, 2),
  ('b0000000-0000-4000-8000-000000000003', 'Renter''s Insurance',            'expense', NULL, false, 3),
  ('b0000000-0000-4000-8000-000000000003', 'Home Repairs & Maintenance',     'expense', NULL, false, 4),
  ('b0000000-0000-4000-8000-000000000003', 'Medical',                        'expense', NULL, false, 5),
  ('b0000000-0000-4000-8000-000000000003', 'Vehicles',                       'expense', NULL, false, 6),
  ('b0000000-0000-4000-8000-000000000003', 'Children',                       'expense', NULL, false, 7),
  ('b0000000-0000-4000-8000-000000000003', 'Other Household',                'expense', NULL, false, 8)
ON CONFLICT (book_id, name) DO NOTHING;
```

- [ ] **Step 3: Apply the migration via MCP, then add TS types.**

Apply: `mcp__supabase__apply_migration` with `name: "00183_bookkeeping_foundation"` and the SQL above. Then append to `types/database.ts`:

```ts
export type BookKind = "business" | "household"
export type LedgerDirection = "income" | "expense"
export type LedgerAccountType = "income" | "expense"
export type LedgerSource = "manual" | "platform_import" | "statement_import" | "receipt"

export interface BookkeepingBook {
  id: string
  name: string
  book_kind: BookKind
  owner_label: string | null
  is_primary: boolean
  currency: string
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface BookkeepingAccount {
  id: string
  book_id: string
  name: string
  account_type: LedgerAccountType
  service_line: string | null
  is_deductible_candidate: boolean
  tax_category: string | null
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface BookkeepingLedgerEntry {
  id: string
  book_id: string
  account_id: string | null
  direction: LedgerDirection
  amount_cents: number
  currency: string
  occurred_on: string
  memo: string | null
  business_purpose: string | null
  counterparty: string | null
  source: LedgerSource
  source_ref: string | null
  import_batch_id: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 4: Verify migration applied.**

Run (MCP): `mcp__supabase__execute_sql` → `select count(*) from bookkeeping_books;` → expect `3`. And `select count(*) from bookkeeping_accounts;` → expect `25`.

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/00183_bookkeeping_foundation.sql types/database.ts
git commit -m "feat(bookkeeper): ledger foundation tables + seeds (00183)"
```

---

## Task 2: Money formatter (pure, TDD)

**Files:**
- Create: `lib/bookkeeping/money.ts`
- Test: `__tests__/lib/bookkeeping/money.test.ts`

**Interfaces:**
- Produces: `formatCents(cents: number, currency?: string): string` (e.g. `formatCents(123456)` → `"$1,234.56"`); `signedCents(cents: number, direction: LedgerDirection): number` (income → +, expense → −).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest"
import { formatCents, signedCents } from "@/lib/bookkeeping/money"

describe("formatCents", () => {
  it("formats USD with thousands + cents", () => {
    expect(formatCents(123456)).toBe("$1,234.56")
  })
  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00")
  })
  it("formats negative", () => {
    expect(formatCents(-500)).toBe("-$5.00")
  })
})

describe("signedCents", () => {
  it("income is positive", () => {
    expect(signedCents(500, "income")).toBe(500)
  })
  it("expense is negative", () => {
    expect(signedCents(500, "expense")).toBe(-500)
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run __tests__/lib/bookkeeping/money.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement.**

```ts
import type { LedgerDirection } from "@/types/database"

/** Canonical money formatter for the bookkeeping feature. Cents → "$1,234.56". */
export function formatCents(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

/** Signed magnitude: income positive, expense negative. */
export function signedCents(cents: number, direction: LedgerDirection): number {
  return direction === "expense" ? -Math.abs(cents) : Math.abs(cents)
}
```

- [ ] **Step 4: Run to verify it passes.** Same command → PASS (5 tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/bookkeeping/money.ts __tests__/lib/bookkeeping/money.test.ts
git commit -m "feat(bookkeeper): canonical money formatter"
```

---

## Task 3: CSV serializer with injection defense (pure, TDD)

**Files:**
- Create: `lib/csv/serialize.ts`
- Test: `__tests__/lib/csv/serialize.test.ts`

**Interfaces:**
- Produces: `csvCell(value: string | number | null | undefined): string`; `csvRow(values: Array<string | number | null | undefined>): string`; `csvDocument(rows: Array<Array<string | number | null | undefined>>): string`. Every cell is CSV-quote-escaped AND formula-injection-guarded (leading `= + - @ \t \r` gets a `'` prefix).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest"
import { csvCell, csvRow, csvDocument } from "@/lib/csv/serialize"

describe("csvCell", () => {
  it("passes plain text through", () => {
    expect(csvCell("hello")).toBe("hello")
  })
  it("quotes commas, quotes, newlines and doubles inner quotes", () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""')
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"')
  })
  it("neutralizes formula-injection leads with a apostrophe prefix", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)")
    expect(csvCell("+1-800")).toBe("'+1-800")
    expect(csvCell("-2")).toBe("'-2")
    expect(csvCell("@cmd")).toBe("'@cmd")
  })
  it("guards then quotes when both apply", () => {
    expect(csvCell("=danger,x")).toBe('"\'=danger,x"')
  })
  it("renders null/undefined as empty", () => {
    expect(csvCell(null)).toBe("")
    expect(csvCell(undefined)).toBe("")
  })
  it("passes numbers through untouched", () => {
    expect(csvCell(42)).toBe("42")
  })
})

describe("csvRow / csvDocument", () => {
  it("joins cells and rows", () => {
    expect(csvRow(["a", "b"])).toBe("a,b")
    expect(csvDocument([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d")
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run __tests__/lib/csv/serialize.test.ts` → FAIL.

- [ ] **Step 3: Implement.**

```ts
// lib/csv/serialize.ts
// Shared CSV serializer. Promoted from lib/ads/campaign-blueprint-csv.ts's
// escape/row helpers, hardened with CSV formula-injection defense (a cell
// beginning = + - @ tab or CR is prefixed with ' so spreadsheet apps do not
// execute it). Use this for every export in the app.

const INJECTION_LEAD = /^[=+\-@\t\r]/

/** Escape one cell: neutralize formula leads, then CSV-quote if needed. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return String(value)
  let s = value
  if (INJECTION_LEAD.test(s)) s = `'${s}`
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function csvRow(values: Array<string | number | null | undefined>): string {
  return values.map(csvCell).join(",")
}

export function csvDocument(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map(csvRow).join("\r\n")
}
```

- [ ] **Step 4: Run to verify it passes.** Same command → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/csv/serialize.ts __tests__/lib/csv/serialize.test.ts
git commit -m "feat(csv): shared serializer with formula-injection defense"
```

---

## Task 4: Shared row paginator

**Files:**
- Create: `lib/db/paginate.ts`
- Test: `__tests__/lib/db/paginate.test.ts`

**Interfaces:**
- Consumes: a Supabase query builder that supports `.range(from, to)` and resolves to `{ data, error }`.
- Produces: `fetchAllRows<T>(buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, pageSize?: number): Promise<T[]>` — loops `.range()` windows until a short page, defeating the 1000-row cap.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, vi } from "vitest"
import { fetchAllRows } from "@/lib/db/paginate"

describe("fetchAllRows", () => {
  it("pages until a short page and concatenates", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
    const page2 = Array.from({ length: 3 }, (_, i) => ({ id: 1000 + i }))
    const build = vi.fn(async (from: number) => ({
      data: from === 0 ? page1 : page2,
      error: null,
    }))
    const rows = await fetchAllRows<{ id: number }>(build, 1000)
    expect(rows).toHaveLength(1003)
    expect(build).toHaveBeenCalledTimes(2)
    expect(build).toHaveBeenNthCalledWith(1, 0, 999)
    expect(build).toHaveBeenNthCalledWith(2, 1000, 1999)
  })
  it("stops after one page when under pageSize", async () => {
    const build = vi.fn(async () => ({ data: [{ id: 1 }], error: null }))
    const rows = await fetchAllRows<{ id: number }>(build, 1000)
    expect(rows).toHaveLength(1)
    expect(build).toHaveBeenCalledTimes(1)
  })
  it("throws on error", async () => {
    const build = vi.fn(async () => ({ data: null, error: { message: "boom" } }))
    await expect(fetchAllRows(build)).rejects.toThrow("boom")
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run __tests__/lib/db/paginate.test.ts` → FAIL.

- [ ] **Step 3: Implement.**

```ts
// lib/db/paginate.ts
// Defeats PostgREST's silent ~1000-row cap by paging .range() windows until a
// short page. Promoted from lib/db/newsletter.ts's private fetchAllRows so the
// whole app shares one correct paginator. Pass a builder that applies your
// filters/order and returns .range(from, to).

const DEFAULT_PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const to = from + pageSize - 1
    const { data, error } = await buildQuery(from, to)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
}
```

- [ ] **Step 4: Run to verify it passes.** Same command → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/db/paginate.ts __tests__/lib/db/paginate.test.ts
git commit -m "feat(db): shared row paginator (defeats 1000-row cap)"
```

---

## Task 5: Bookkeeping shared types + Zod validators

**Files:**
- Create: `lib/bookkeeping/types.ts`
- Create: `lib/validators/bookkeeping.ts`
- Test: `__tests__/lib/validators/bookkeeping.test.ts`

**Interfaces:**
- Produces (`lib/bookkeeping/types.ts`):
  - `LedgerEntryDraft` — `{ direction: LedgerDirection; amount_cents: number; occurred_on: string; memo: string; counterparty: string | null; service_line: string | null; source: LedgerSource; source_ref: string; }`
  - `IncomeSourceRows` — `{ payments: Payment[]; shopOrders: ShopOrder[]; clientPackages: (ClientPackage & { product_name?: string | null })[]; eventSignups: (EventSignup & { event_title?: string | null; event_type?: string | null })[]; memberships: (ClientMembership & { plan_name?: string | null; plan_price_cents?: number | null; plan_interval?: string | null })[]; }`
  - `IncomeAdapterResult` — `{ drafts: LedgerEntryDraft[]; warnings: string[]; }`
- Produces (`lib/validators/bookkeeping.ts`): `createEntrySchema`, `updateEntrySchema`, `createAccountSchema`, `updateAccountSchema`, `importPreviewSchema`, `importCommitSchema` (exact shapes in Step 3).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest"
import { createEntrySchema, importPreviewSchema } from "@/lib/validators/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"

describe("createEntrySchema", () => {
  it("accepts a valid manual entry", () => {
    const r = createEntrySchema.safeParse({
      book_id: BOOK, direction: "expense", amount_cents: 4200,
      occurred_on: "2026-07-01", account_id: null, memo: "Bands",
      counterparty: "Rogue", business_purpose: null,
    })
    expect(r.success).toBe(true)
  })
  it("rejects negative amounts", () => {
    const r = createEntrySchema.safeParse({
      book_id: BOOK, direction: "expense", amount_cents: -1, occurred_on: "2026-07-01",
    })
    expect(r.success).toBe(false)
  })
  it("rejects a bad direction", () => {
    const r = createEntrySchema.safeParse({
      book_id: BOOK, direction: "credit", amount_cents: 1, occurred_on: "2026-07-01",
    })
    expect(r.success).toBe(false)
  })
})

describe("importPreviewSchema", () => {
  it("requires book_id + from + to", () => {
    expect(importPreviewSchema.safeParse({ book_id: BOOK, from: "2026-01-01", to: "2026-12-31" }).success).toBe(true)
    expect(importPreviewSchema.safeParse({ book_id: BOOK }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run __tests__/lib/validators/bookkeeping.test.ts` → FAIL.

- [ ] **Step 3: Implement both files.**

`lib/bookkeeping/types.ts`:

```ts
import type {
  LedgerDirection, LedgerSource, Payment, ShopOrder, EventSignup,
  ClientPackage, ClientMembership,
} from "@/types/database"

export interface LedgerEntryDraft {
  direction: LedgerDirection
  amount_cents: number
  occurred_on: string
  memo: string
  counterparty: string | null
  service_line: string | null
  source: LedgerSource
  source_ref: string
}

export interface IncomeSourceRows {
  payments: Payment[]
  shopOrders: ShopOrder[]
  clientPackages: Array<ClientPackage & { product_name?: string | null }>
  eventSignups: Array<EventSignup & { event_title?: string | null; event_type?: string | null }>
  memberships: Array<ClientMembership & { plan_name?: string | null; plan_price_cents?: number | null; plan_interval?: string | null }>
}

export interface IncomeAdapterResult {
  drafts: LedgerEntryDraft[]
  warnings: string[]
}
```

`lib/validators/bookkeeping.ts` (Zod v4 — `.min()`/`.max()` are fine here; jsonTool only matters for AI schemas):

```ts
import { z } from "zod"

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")

export const createEntrySchema = z.object({
  book_id: z.string().uuid(),
  account_id: z.string().uuid().nullable().optional(),
  direction: z.enum(["income", "expense"]),
  amount_cents: z.number().int().nonnegative(),
  currency: z.string().default("usd"),
  occurred_on: DATE,
  memo: z.string().max(500).nullable().optional(),
  business_purpose: z.string().max(1000).nullable().optional(),
  counterparty: z.string().max(200).nullable().optional(),
})

export const updateEntrySchema = z.object({
  account_id: z.string().uuid().nullable().optional(),
  direction: z.enum(["income", "expense"]).optional(),
  amount_cents: z.number().int().nonnegative().optional(),
  occurred_on: DATE.optional(),
  memo: z.string().max(500).nullable().optional(),
  business_purpose: z.string().max(1000).nullable().optional(),
  counterparty: z.string().max(200).nullable().optional(),
})

export const createAccountSchema = z.object({
  book_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  account_type: z.enum(["income", "expense"]),
  service_line: z.string().max(60).nullable().optional(),
  is_deductible_candidate: z.boolean().default(false),
  tax_category: z.string().max(120).nullable().optional(),
})

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  service_line: z.string().max(60).nullable().optional(),
  is_deductible_candidate: z.boolean().optional(),
  tax_category: z.string().max(120).nullable().optional(),
  archived: z.boolean().optional(),
})

export const importPreviewSchema = z.object({
  book_id: z.string().uuid(),
  from: DATE,
  to: DATE,
})

export const importCommitSchema = z.object({
  book_id: z.string().uuid(),
  entries: z.array(z.object({
    direction: z.enum(["income", "expense"]),
    amount_cents: z.number().int().nonnegative(),
    occurred_on: DATE,
    memo: z.string(),
    counterparty: z.string().nullable(),
    service_line: z.string().nullable(),
    source: z.enum(["manual", "platform_import", "statement_import", "receipt"]),
    source_ref: z.string(),
    account_id: z.string().uuid().nullable().optional(),
  })).min(1).max(2000),
})
```

- [ ] **Step 4: Run to verify it passes.** Same command → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/bookkeeping/types.ts lib/validators/bookkeeping.ts __tests__/lib/validators/bookkeeping.test.ts
git commit -m "feat(bookkeeper): shared draft types + Zod validators"
```

---

## Task 6: Income adapter (pure, the core — TDD)

**Files:**
- Create: `lib/bookkeeping/income-adapter.ts`
- Test: `__tests__/lib/bookkeeping/income-adapter.test.ts`

**Interfaces:**
- Consumes: `IncomeSourceRows`, `LedgerEntryDraft`, `IncomeAdapterResult` from `lib/bookkeeping/types.ts`.
- Produces: `buildIncomeDrafts(input: IncomeSourceRows): IncomeAdapterResult` — pure, zero IO. Rules (verified against real schemas):
  - **payments:** only `status === "succeeded"`; gross `amount_cents`; date = `created_at` (no `paid_at`); counterparty from `user_id` unavailable here so use `metadata.customerEmail ?? description`; service_line inferred from `description`/`metadata` (see helper); `source_ref = "payments:" + id`; skip `status === "refunded"` with a warning. If `user_id` is null AND no `metadata.customerEmail`, still emit but warn.
  - **shopOrders:** status in `["paid","draft","confirmed","in_production","shipped","fulfilled_digital"]`; amount `total_cents`; date `created_at`; counterparty `customer_name`; service_line `"shop"`; `source_ref = "shop_orders:" + id`; skip `canceled`/`refunded`/`pending`.
  - **clientPackages:** `payment_status === "paid"`; amount `price_cents`; date `purchased_at`; counterparty by `client_user_id` (label unavailable → null); service_line `"session_packs"`; memo = `product_name ?? session_type`; `source_ref = "client_packages:" + id`.
  - **eventSignups:** `signup_type === "paid"` AND `status === "confirmed"` AND `amount_paid_cents != null`; amount `amount_paid_cents`; date `created_at`; counterparty `parent_name`; service_line = `event_type === "camp" ? "camps" : "camps"` (both clinic+camp → `"camps"`); memo `event_title`; `source_ref = "event_signups:" + id`.
  - **memberships:** **honest gap** — recurring renewals are NOT in the DB. Emit ZERO drafts and push ONE warning per active membership: `"Membership <id> recurring revenue is not recorded in the database (lives in Stripe invoices) — import via statement/payout ingestion (Phase 6)."` Active = `status in ["active","trialing","past_due"]`.
  - Returns `{ drafts, warnings }`; drafts sorted by `occurred_on` ascending.

- [ ] **Step 1: Write the failing test** (fixtures use real schema fields; UUIDs are RFC-4122 `-4NNN-8NNN-`).

```ts
import { describe, it, expect } from "vitest"
import { buildIncomeDrafts } from "@/lib/bookkeeping/income-adapter"
import type { IncomeSourceRows } from "@/lib/bookkeeping/types"

function base(): IncomeSourceRows {
  return { payments: [], shopOrders: [], clientPackages: [], eventSignups: [], memberships: [] }
}

describe("buildIncomeDrafts — payments", () => {
  it("emits a succeeded payment as gross income with a dedupe ref", () => {
    const input = base()
    input.payments = [{
      id: "11111111-1111-4111-8111-111111111111", user_id: null,
      stripe_payment_id: "pi_1", stripe_customer_id: null, amount_cents: 9900,
      currency: "usd", status: "succeeded", description: "Program purchase",
      metadata: { programId: "p1", customerEmail: "a@b.com" },
      created_at: "2026-03-02T10:00:00Z", updated_at: "2026-03-02T10:00:00Z",
      gclid: null, gbraid: null, wbraid: null, fbclid: null,
    }]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      direction: "income", amount_cents: 9900, occurred_on: "2026-03-02",
      source: "platform_import", source_ref: "payments:11111111-1111-4111-8111-111111111111",
      counterparty: "a@b.com",
    })
  })
  it("skips refunded payments with a warning", () => {
    const input = base()
    input.payments = [{
      id: "11111111-1111-4111-8111-111111111112", user_id: null, stripe_payment_id: "pi_2",
      stripe_customer_id: null, amount_cents: 5000, currency: "usd", status: "refunded",
      description: "x", metadata: {}, created_at: "2026-03-02T10:00:00Z",
      updated_at: "2026-03-02T10:00:00Z", gclid: null, gbraid: null, wbraid: null, fbclid: null,
    }]
    const { drafts, warnings } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(0)
    expect(warnings.some((w) => w.includes("refunded"))).toBe(true)
  })
})

describe("buildIncomeDrafts — packs, shop, events", () => {
  it("emits a paid pack", () => {
    const input = base()
    input.clientPackages = [{
      id: "22222222-2222-4222-8222-222222222221",
      client_user_id: "22222222-2222-4222-8222-2222222222aa",
      product_id: null, session_type: "1-on-1", credits_total: 10, credits_used: 0,
      price_cents: 50000, payment_method: "cash", payment_status: "paid", status: "active",
      stripe_session_id: null, stripe_payment_id: null, assignment_id: null,
      purchased_at: "2026-04-01T00:00:00Z", created_by: null,
      created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z",
      product_name: "10-Pack",
    }]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts[0]).toMatchObject({
      amount_cents: 50000, service_line: "session_packs", occurred_on: "2026-04-01",
      source_ref: "client_packages:22222222-2222-4222-8222-222222222221", memo: "10-Pack",
    })
  })
  it("emits a confirmed paid event signup, skips interest rows", () => {
    const input = base()
    input.eventSignups = [
      { id: "33333333-3333-4333-8333-333333333331", event_id: "e1", signup_type: "paid",
        status: "confirmed", amount_paid_cents: 12000, parent_name: "Pat", parent_email: "p@x.com",
        athlete_name: "Kid", user_id: null, stripe_session_id: null, stripe_payment_intent_id: null,
        created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
        event_title: "Summer Camp", event_type: "camp" } as never,
      { id: "33333333-3333-4333-8333-333333333332", event_id: "e1", signup_type: "interest",
        status: "pending", amount_paid_cents: null, parent_name: "X", parent_email: "x@x.com",
        athlete_name: "Y", user_id: null, stripe_session_id: null, stripe_payment_intent_id: null,
        created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
        event_title: "Summer Camp", event_type: "camp" } as never,
    ]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ amount_cents: 12000, service_line: "camps", memo: "Summer Camp" })
  })
})

describe("buildIncomeDrafts — memberships gap", () => {
  it("emits no drafts but warns for each active membership", () => {
    const input = base()
    input.memberships = [{
      id: "44444444-4444-4444-8444-444444444441", user_id: "u1", plan_id: "pl1",
      status: "active", current_period_start: null, current_period_end: null,
      cancel_at_period_end: false, canceled_at: null, stripe_subscription_id: "sub_1",
      stripe_customer_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      plan_name: "Monthly", plan_price_cents: 9900, plan_interval: "month",
    } as never]
    const { drafts, warnings } = buildIncomeDrafts(input)
    expect(drafts).toHaveLength(0)
    expect(warnings.some((w) => w.includes("recurring revenue is not recorded"))).toBe(true)
  })
})

describe("buildIncomeDrafts — ordering", () => {
  it("sorts drafts by occurred_on ascending", () => {
    const input = base()
    input.shopOrders = [
      { id: "55555555-5555-4555-8555-555555555552", total_cents: 100, subtotal_cents: 100,
        shipping_cents: 0, status: "paid", customer_name: "B", customer_email: "b@b.com",
        user_id: null, order_number: "o2", stripe_session_id: null, stripe_payment_intent_id: null,
        refund_amount_cents: null, items: [], created_at: "2026-06-05T00:00:00Z",
        updated_at: "2026-06-05T00:00:00Z", shipped_at: null } as never,
      { id: "55555555-5555-4555-8555-555555555551", total_cents: 200, subtotal_cents: 200,
        shipping_cents: 0, status: "paid", customer_name: "A", customer_email: "a@a.com",
        user_id: null, order_number: "o1", stripe_session_id: null, stripe_payment_intent_id: null,
        refund_amount_cents: null, items: [], created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z", shipped_at: null } as never,
    ]
    const { drafts } = buildIncomeDrafts(input)
    expect(drafts.map((d) => d.occurred_on)).toEqual(["2026-06-01", "2026-06-05"])
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run __tests__/lib/bookkeeping/income-adapter.test.ts` → FAIL.

- [ ] **Step 3: Implement.**

```ts
// lib/bookkeeping/income-adapter.ts
// Pure: unions the platform's money-of-record tables into reviewable ledger
// drafts. Zero IO — the caller reads rows (paginated) and passes plain arrays.
// Encodes the design's D3 rules: gross amounts, refund-aware, honest about the
// membership gap. Every draft carries a stable source_ref so re-running the
// import never double-posts (the ledger's UNIQUE(book_id,source,source_ref)).

import type { IncomeSourceRows, IncomeAdapterResult, LedgerEntryDraft } from "./types"

const SHOP_REVENUE_STATUSES = new Set([
  "paid", "draft", "confirmed", "in_production", "shipped", "fulfilled_digital",
])
const MEMBERSHIP_ACTIVE = new Set(["active", "trialing", "past_due"])

/** YYYY-MM-DD from an ISO timestamp. */
function isoDate(ts: string): string {
  return ts.slice(0, 10)
}

/** Best-effort service-line tag for a raw Stripe payment. */
function paymentServiceLine(description: string | null, metadata: Record<string, unknown>): string {
  const d = (description ?? "").toLowerCase()
  if (metadata.type === "session_fee") return "other"
  if (metadata.source === "external") return "other"
  if (d.includes("program") || d.includes("week")) return "performance_training"
  return "other"
}

export function buildIncomeDrafts(input: IncomeSourceRows): IncomeAdapterResult {
  const drafts: LedgerEntryDraft[] = []
  const warnings: string[] = []

  for (const p of input.payments) {
    if (p.status === "refunded") {
      warnings.push(`Payment ${p.id} is refunded — skipped (gross income reversed).`)
      continue
    }
    if (p.status !== "succeeded") continue
    const email = typeof p.metadata?.customerEmail === "string" ? p.metadata.customerEmail : null
    if (!p.user_id && !email) {
      warnings.push(`Payment ${p.id} has no user and no customer email — counterparty unknown.`)
    }
    drafts.push({
      direction: "income",
      amount_cents: p.amount_cents,
      occurred_on: isoDate(p.created_at),
      memo: p.description ?? "Platform payment",
      counterparty: email ?? p.description ?? null,
      service_line: paymentServiceLine(p.description, p.metadata ?? {}),
      source: "platform_import",
      source_ref: `payments:${p.id}`,
    })
  }

  for (const o of input.shopOrders) {
    if (!SHOP_REVENUE_STATUSES.has(o.status)) continue
    drafts.push({
      direction: "income",
      amount_cents: o.total_cents,
      occurred_on: isoDate(o.created_at),
      memo: `Shop order ${o.order_number}`,
      counterparty: o.customer_name,
      service_line: "shop",
      source: "platform_import",
      source_ref: `shop_orders:${o.id}`,
    })
  }

  for (const pk of input.clientPackages) {
    if (pk.payment_status !== "paid") continue
    drafts.push({
      direction: "income",
      amount_cents: pk.price_cents,
      occurred_on: isoDate(pk.purchased_at),
      memo: pk.product_name ?? pk.session_type ?? "Session pack",
      counterparty: null,
      service_line: "session_packs",
      source: "platform_import",
      source_ref: `client_packages:${pk.id}`,
    })
  }

  for (const s of input.eventSignups) {
    if (s.signup_type !== "paid" || s.status !== "confirmed" || s.amount_paid_cents == null) continue
    drafts.push({
      direction: "income",
      amount_cents: s.amount_paid_cents,
      occurred_on: isoDate(s.created_at),
      memo: s.event_title ?? "Event signup",
      counterparty: s.parent_name ?? null,
      service_line: "camps",
      source: "platform_import",
      source_ref: `event_signups:${s.id}`,
    })
  }

  for (const m of input.memberships) {
    if (!MEMBERSHIP_ACTIVE.has(m.status)) continue
    warnings.push(
      `Membership ${m.id} recurring revenue is not recorded in the database ` +
      `(lives in Stripe invoices) — import via statement/payout ingestion (Phase 6).`,
    )
  }

  drafts.sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : 0))
  return { drafts, warnings }
}
```

- [ ] **Step 4: Run to verify it passes.** Same command → PASS (all cases).

- [ ] **Step 5: Commit.**

```bash
git add lib/bookkeeping/income-adapter.ts __tests__/lib/bookkeeping/income-adapter.test.ts
git commit -m "feat(bookkeeper): pure income adapter (5 sources, membership gap honest)"
```

---

## Task 7: Bookkeeping DAL

**Files:**
- Create: `lib/db/bookkeeping.ts`
- Test: none (thin IO; exercised via route tests in Task 11). Follows the `lib/db/payments.ts` shape.

**Interfaces:**
- Produces:
  - `listBooks(): Promise<BookkeepingBook[]>` (non-archived, `order by sort_order`).
  - `getBook(id): Promise<BookkeepingBook | null>`.
  - `listAccounts(bookId): Promise<BookkeepingAccount[]>` (non-archived, `order by sort_order`).
  - `createAccount(input): Promise<BookkeepingAccount>`; `updateAccount(id, updates): Promise<BookkeepingAccount>`.
  - `listEntries(params: { bookId: string; from?: string; to?: string; direction?: LedgerDirection; accountId?: string; source?: LedgerSource; search?: string; page: number; perPage: number }): Promise<{ rows: BookkeepingLedgerEntry[]; total: number }>` — clone `listAuditLogs` (count:exact + `.range()` + conditional filters + ILIKE escaping on `memo`/`counterparty`).
  - `entryTotals(params): Promise<{ income_cents: number; expense_cents: number }>` — aggregate over the SAME filter (paginate via `fetchAllRows` selecting only `direction,amount_cents`, then reduce; the filtered set is small in practice but MUST paginate).
  - `createEntry(input): Promise<BookkeepingLedgerEntry>`; `updateEntry(id, updates)`; `deleteEntry(id): Promise<void>`.
  - `insertImportedEntries(bookId, entries): Promise<{ inserted: number; skipped: number }>` — bulk insert with `.upsert(..., { onConflict: "book_id,source,source_ref", ignoreDuplicates: true })`; return counts.
  - Platform-income reads (each paginated via `fetchAllRows`, each wrapped so a missing table yields `[]` + is reported): `listPlatformIncome(from, to): Promise<IncomeSourceRows>`.

- [ ] **Step 1: Implement the DAL** (no separate unit test — covered by route tests; matches house convention for thin DALs like `payments.ts`).

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import { fetchAllRows } from "@/lib/db/paginate"
import type {
  BookkeepingBook, BookkeepingAccount, BookkeepingLedgerEntry,
  LedgerDirection, LedgerSource,
} from "@/types/database"
import type { IncomeSourceRows, LedgerEntryDraft } from "@/lib/bookkeeping/types"

function db() {
  return createServiceRoleClient()
}

// ── Books ────────────────────────────────────────────────────────────────
export async function listBooks(): Promise<BookkeepingBook[]> {
  const { data, error } = await db()
    .from("bookkeeping_books").select("*").is("archived_at", null)
    .order("sort_order", { ascending: true })
  if (error) throw error
  return (data ?? []) as BookkeepingBook[]
}

export async function getBook(id: string): Promise<BookkeepingBook | null> {
  const { data, error } = await db().from("bookkeeping_books").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingBook) ?? null
}

// ── Accounts ─────────────────────────────────────────────────────────────
export async function listAccounts(bookId: string): Promise<BookkeepingAccount[]> {
  const { data, error } = await db()
    .from("bookkeeping_accounts").select("*").eq("book_id", bookId).is("archived_at", null)
    .order("sort_order", { ascending: true })
  if (error) throw error
  return (data ?? []) as BookkeepingAccount[]
}

export async function createAccount(input: {
  book_id: string; name: string; account_type: "income" | "expense"
  service_line?: string | null; is_deductible_candidate?: boolean; tax_category?: string | null
}): Promise<BookkeepingAccount> {
  const { data, error } = await db().from("bookkeeping_accounts").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingAccount
}

export async function updateAccount(
  id: string,
  updates: Partial<{ name: string; service_line: string | null; is_deductible_candidate: boolean; tax_category: string | null; archived_at: string | null }>,
): Promise<BookkeepingAccount> {
  const { data, error } = await db().from("bookkeeping_accounts").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as BookkeepingAccount
}

// ── Ledger entries ───────────────────────────────────────────────────────
export interface ListEntriesParams {
  bookId: string; from?: string; to?: string; direction?: LedgerDirection
  accountId?: string; source?: LedgerSource; search?: string; page: number; perPage: number
}

function applyEntryFilters<Q extends { eq: (c: string, v: unknown) => Q; gte: (c: string, v: unknown) => Q; lte: (c: string, v: unknown) => Q; or: (s: string) => Q }>(
  q: Q, p: ListEntriesParams,
): Q {
  let out = q.eq("book_id", p.bookId)
  if (p.from) out = out.gte("occurred_on", p.from)
  if (p.to) out = out.lte("occurred_on", p.to)
  if (p.direction) out = out.eq("direction", p.direction)
  if (p.accountId) out = out.eq("account_id", p.accountId)
  if (p.source) out = out.eq("source", p.source)
  if (p.search) {
    const esc = p.search.replace(/[%_]/g, (m) => `\\${m}`)
    out = out.or(`memo.ilike.%${esc}%,counterparty.ilike.%${esc}%`)
  }
  return out
}

export async function listEntries(p: ListEntriesParams): Promise<{ rows: BookkeepingLedgerEntry[]; total: number }> {
  const base = db().from("bookkeeping_ledger_entries").select("*", { count: "exact" })
  const q = applyEntryFilters(base as never, p)
    .order("occurred_on", { ascending: false })
    .range((p.page - 1) * p.perPage, p.page * p.perPage - 1)
  const { data, error, count } = await (q as never as Promise<{ data: unknown; error: unknown; count: number | null }>)
  if (error) throw error
  return { rows: (data ?? []) as BookkeepingLedgerEntry[], total: count ?? 0 }
}

export async function entryTotals(p: Omit<ListEntriesParams, "page" | "perPage">): Promise<{ income_cents: number; expense_cents: number }> {
  const rows = await fetchAllRows<{ direction: LedgerDirection; amount_cents: number }>(
    (from, to) => {
      const base = db().from("bookkeeping_ledger_entries").select("direction,amount_cents")
      return applyEntryFilters(base as never, { ...p, page: 1, perPage: 1 })
        .range(from, to) as never
    },
  )
  let income = 0, expense = 0
  for (const r of rows) {
    if (r.direction === "income") income += r.amount_cents
    else expense += r.amount_cents
  }
  return { income_cents: income, expense_cents: expense }
}

export async function createEntry(input: Omit<BookkeepingLedgerEntry, "id" | "created_at" | "updated_at">): Promise<BookkeepingLedgerEntry> {
  const { data, error } = await db().from("bookkeeping_ledger_entries").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingLedgerEntry
}

export async function updateEntry(id: string, updates: Partial<Omit<BookkeepingLedgerEntry, "id" | "created_at">>): Promise<BookkeepingLedgerEntry> {
  const { data, error } = await db().from("bookkeeping_ledger_entries").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as BookkeepingLedgerEntry
}

export async function deleteEntry(id: string): Promise<void> {
  const { error } = await db().from("bookkeeping_ledger_entries").delete().eq("id", id)
  if (error) throw error
}

export async function insertImportedEntries(
  bookId: string, importBatchId: string, drafts: Array<LedgerEntryDraft & { account_id?: string | null }>,
): Promise<{ inserted: number }> {
  if (drafts.length === 0) return { inserted: 0 }
  const rows = drafts.map((d) => ({
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
  return { inserted: (data ?? []).length }
}

// ── Platform income reads (each paginated; missing table → [] + noop) ──────
async function safeAll<T>(builder: (from: number, to: number) => unknown): Promise<T[]> {
  try {
    return await fetchAllRows<T>(builder as never)
  } catch (err) {
    console.warn("[bookkeeping] platform-income source read failed (skipped):", (err as Error).message)
    return []
  }
}

export async function listPlatformIncome(from: string, to: string): Promise<IncomeSourceRows> {
  const fromTs = `${from}T00:00:00Z`
  const toTs = `${to}T23:59:59Z`
  const [payments, shopOrders, clientPackages, eventSignups, memberships] = await Promise.all([
    safeAll<IncomeSourceRows["payments"][number]>((f, t) =>
      db().from("payments").select("*").gte("created_at", fromTs).lte("created_at", toTs).range(f, t)),
    safeAll<IncomeSourceRows["shopOrders"][number]>((f, t) =>
      db().from("shop_orders").select("*").gte("created_at", fromTs).lte("created_at", toTs).range(f, t)),
    safeAll<IncomeSourceRows["clientPackages"][number]>((f, t) =>
      db().from("client_packages").select("*, session_pack_products(name)").gte("purchased_at", fromTs).lte("purchased_at", toTs).range(f, t)),
    safeAll<IncomeSourceRows["eventSignups"][number]>((f, t) =>
      db().from("event_signups").select("*, events(title,type)").gte("created_at", fromTs).lte("created_at", toTs).range(f, t)),
    safeAll<IncomeSourceRows["memberships"][number]>((f, t) =>
      db().from("client_memberships").select("*, membership_plans(name,price_cents,billing_interval)").range(f, t)),
  ])
  // Flatten embedded names so the pure adapter stays schema-light.
  return {
    payments,
    shopOrders,
    clientPackages: clientPackages.map((r) => ({ ...r, product_name: (r as { session_pack_products?: { name?: string } }).session_pack_products?.name ?? null })),
    eventSignups: eventSignups.map((r) => ({ ...r, event_title: (r as { events?: { title?: string } }).events?.title ?? null, event_type: (r as { events?: { type?: string } }).events?.type ?? null })),
    memberships: memberships.map((r) => {
      const pl = (r as { membership_plans?: { name?: string; price_cents?: number; billing_interval?: string } }).membership_plans
      return { ...r, plan_name: pl?.name ?? null, plan_price_cents: pl?.price_cents ?? null, plan_interval: pl?.billing_interval ?? null }
    }),
  }
}
```

- [ ] **Step 2: Typecheck the DAL in isolation.**

Run: `npx tsc --noEmit lib/db/bookkeeping.ts 2>&1 | head -20` — expect no NEW errors in this file (the repo has pre-existing test/.next tsc noise; this file must be clean). If the Supabase builder generics fight the `applyEntryFilters` helper, keep the `as never` casts shown (the repo already casts Supabase results in DALs per CLAUDE.md).

- [ ] **Step 3: Commit.**

```bash
git add lib/db/bookkeeping.ts
git commit -m "feat(bookkeeper): DAL (books, accounts, ledger, paginated platform income)"
```

---

## Task 8: Audit action slugs

**Files:**
- Modify: `lib/audit/actions.ts` (add rows to the `AUDIT_ACTIONS` array, near the `commerce`/`billing` groups)

- [ ] **Step 1: Add the slugs.** Insert these rows into the array:

```ts
  // bookkeeping
  { slug: "bookkeeping.entry_created", category: "commerce", description: "Ledger entry created" },
  { slug: "bookkeeping.entry_updated", category: "commerce", description: "Ledger entry updated" },
  { slug: "bookkeeping.entry_deleted", category: "commerce", description: "Ledger entry deleted" },
  { slug: "bookkeeping.account_created", category: "commerce", description: "Chart-of-accounts category created" },
  { slug: "bookkeeping.account_updated", category: "commerce", description: "Chart-of-accounts category updated" },
  { slug: "bookkeeping.platform_income_imported", category: "commerce", description: "Platform income posted to the ledger" },
```

- [ ] **Step 2: Verify the slugs are unique / file compiles.** Run: `npx vitest run __tests__ -t "audit" 2>&1 | tail -20` if an audit-actions test exists; otherwise `npx tsc --noEmit lib/audit/actions.ts 2>&1 | head`. Expect no new errors.

- [ ] **Step 3: Commit.**

```bash
git add lib/audit/actions.ts
git commit -m "feat(bookkeeper): audit action slugs"
```

---

## Task 9: API routes — accounts + entries CRUD

**Files:**
- Create: `app/api/admin/bookkeeping/accounts/route.ts` (GET list, POST create)
- Create: `app/api/admin/bookkeeping/accounts/[id]/route.ts` (PATCH)
- Create: `app/api/admin/bookkeeping/entries/route.ts` (GET list, POST create)
- Create: `app/api/admin/bookkeeping/entries/[id]/route.ts` (PATCH, DELETE)

**Interfaces:**
- Consumes: the DAL (Task 7), validators (Task 5), `signedCents` unused here (entries store magnitude + direction).
- Produces: JSON REST endpoints, all self-gated + audited.

- [ ] **Step 1: Implement `accounts/route.ts`.**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listAccounts, createAccount } from "@/lib/db/bookkeeping"
import { createAccountSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

async function gate() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return null
  return session
}

export async function GET(request: Request) {
  if (!(await gate())) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const bookId = new URL(request.url).searchParams.get("book_id")
  if (!bookId) return NextResponse.json({ error: "book_id required" }, { status: 400 })
  const accounts = await listAccounts(bookId)
  return NextResponse.json({ accounts })
}

export async function POST(request: Request) {
  if (!(await gate())) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const body = await request.json().catch(() => null)
  const parsed = createAccountSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  const account = await createAccount(parsed.data)
  void recordAudit({ action: "bookkeeping.account_created", category: "commerce", outcome: "success",
    target: { type: "bookkeeping_account", id: account.id, label: account.name }, request })
  return NextResponse.json({ account }, { status: 201 })
}
```

- [ ] **Step 2: Implement `accounts/[id]/route.ts`.**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateAccount } from "@/lib/db/bookkeeping"
import { updateAccountSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const { id } = await ctx.params
  const body = await request.json().catch(() => null)
  const parsed = updateAccountSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  const { archived, ...rest } = parsed.data
  const updates: Record<string, unknown> = { ...rest }
  if (archived !== undefined) updates.archived_at = archived ? new Date().toISOString() : null
  const account = await updateAccount(id, updates)
  void recordAudit({ action: "bookkeeping.account_updated", category: "commerce", outcome: "success",
    target: { type: "bookkeeping_account", id, label: account.name }, request })
  return NextResponse.json({ account })
}
```

> Note: `new Date().toISOString()` is allowed in route handlers (the `Date.now()` ban is workflow-script-only, not app code).

- [ ] **Step 3: Implement `entries/route.ts`** (GET paginated list + totals; POST create).

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listEntries, entryTotals, createEntry } from "@/lib/db/bookkeeping"
import { createEntrySchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"
import type { LedgerDirection, LedgerSource } from "@/types/database"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const sp = new URL(request.url).searchParams
  const bookId = sp.get("book_id")
  if (!bookId) return NextResponse.json({ error: "book_id required" }, { status: 400 })
  const params = {
    bookId,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    direction: (sp.get("direction") as LedgerDirection) ?? undefined,
    accountId: sp.get("account_id") ?? undefined,
    source: (sp.get("source") as LedgerSource) ?? undefined,
    search: sp.get("q") ?? undefined,
    page: Math.max(1, Number(sp.get("page") ?? "1")),
    perPage: 50,
  }
  const [{ rows, total }, totals] = await Promise.all([listEntries(params), entryTotals(params)])
  return NextResponse.json({ rows, total, totals, page: params.page, perPage: params.perPage })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const body = await request.json().catch(() => null)
  const parsed = createEntrySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data
  const entry = await createEntry({
    book_id: d.book_id, account_id: d.account_id ?? null, direction: d.direction,
    amount_cents: d.amount_cents, currency: d.currency ?? "usd", occurred_on: d.occurred_on,
    memo: d.memo ?? null, business_purpose: d.business_purpose ?? null, counterparty: d.counterparty ?? null,
    source: "manual", source_ref: null, import_batch_id: null,
  })
  void recordAudit({ action: "bookkeeping.entry_created", category: "commerce", outcome: "success",
    target: { type: "bookkeeping_entry", id: entry.id, label: entry.memo ?? "" },
    metadata: { book_id: d.book_id, amount_cents: d.amount_cents, direction: d.direction }, request })
  return NextResponse.json({ entry }, { status: 201 })
}
```

- [ ] **Step 4: Implement `entries/[id]/route.ts`** (PATCH + DELETE — same self-gate; `updateEntrySchema`; audit `entry_updated`/`entry_deleted`; DELETE only allowed when `source === 'manual'` — fetch not needed, just pass through and let the UI restrict; to be safe, the DAL delete is unrestricted but the audit records it).

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateEntry, deleteEntry } from "@/lib/db/bookkeeping"
import { updateEntrySchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const { id } = await ctx.params
  const body = await request.json().catch(() => null)
  const parsed = updateEntrySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  const entry = await updateEntry(id, parsed.data)
  void recordAudit({ action: "bookkeeping.entry_updated", category: "commerce", outcome: "success",
    target: { type: "bookkeeping_entry", id }, request })
  return NextResponse.json({ entry })
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const { id } = await ctx.params
  await deleteEntry(id)
  void recordAudit({ action: "bookkeeping.entry_deleted", category: "commerce", outcome: "success",
    target: { type: "bookkeeping_entry", id }, request })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Commit.**

```bash
git add app/api/admin/bookkeeping/accounts app/api/admin/bookkeeping/entries
git commit -m "feat(bookkeeper): accounts + ledger-entry API routes (self-gated + audited)"
```

---

## Task 10: API routes — platform income preview + commit

**Files:**
- Create: `app/api/admin/bookkeeping/import-platform/route.ts` (POST → preview drafts)
- Create: `app/api/admin/bookkeeping/import-platform/commit/route.ts` (POST → post drafts)

**Interfaces:**
- Consumes: `listPlatformIncome` + `insertImportedEntries` (DAL), `buildIncomeDrafts` (adapter), `importPreviewSchema`/`importCommitSchema` (validators).
- Produces: preview returns `{ drafts, warnings }`; commit returns `{ inserted }`.

- [ ] **Step 1: Implement `import-platform/route.ts`.**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listPlatformIncome } from "@/lib/db/bookkeeping"
import { buildIncomeDrafts } from "@/lib/bookkeeping/income-adapter"
import { importPreviewSchema } from "@/lib/validators/bookkeeping"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const body = await request.json().catch(() => null)
  const parsed = importPreviewSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  const sources = await listPlatformIncome(parsed.data.from, parsed.data.to)
  const { drafts, warnings } = buildIncomeDrafts(sources)
  return NextResponse.json({ drafts, warnings })
}
```

- [ ] **Step 2: Implement `import-platform/commit/route.ts`** (uses `crypto.randomUUID()` for the batch id — available in the Node runtime).

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { insertImportedEntries } from "@/lib/db/bookkeeping"
import { importCommitSchema } from "@/lib/validators/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const body = await request.json().catch(() => null)
  const parsed = importCommitSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  const batchId = crypto.randomUUID()
  const { inserted } = await insertImportedEntries(parsed.data.book_id, batchId, parsed.data.entries)
  void recordAudit({ action: "bookkeeping.platform_income_imported", category: "commerce", outcome: "success",
    target: { type: "bookkeeping_book", id: parsed.data.book_id },
    metadata: { requested: parsed.data.entries.length, inserted, import_batch_id: batchId }, request })
  return NextResponse.json({ inserted, batchId })
}
```

- [ ] **Step 3: Commit.**

```bash
git add app/api/admin/bookkeeping/import-platform
git commit -m "feat(bookkeeper): platform-income preview + commit routes"
```

---

## Task 11: Route tests (self-gate + happy path)

**Files:**
- Create: `__tests__/api/admin/bookkeeping/entries.test.ts`
- Create: `__tests__/api/admin/bookkeeping/import-platform.test.ts`

**Interfaces:**
- Consumes: mocks `@/lib/db/bookkeeping`, `@/lib/auth`, `@/lib/audit/record`.

- [ ] **Step 1: Write `entries.test.ts`** (mock DAL + auth; import handlers AFTER mocks).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listEntriesMock = vi.fn()
const entryTotalsMock = vi.fn()
const createEntryMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntries: (...a: unknown[]) => listEntriesMock(...a),
  entryTotals: (...a: unknown[]) => entryTotalsMock(...a),
  createEntry: (...a: unknown[]) => createEntryMock(...a),
}))

import { GET, POST } from "@/app/api/admin/bookkeeping/entries/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"

beforeEach(() => {
  authMock.mockReset(); listEntriesMock.mockReset(); entryTotalsMock.mockReset(); createEntryMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
})

describe("GET /api/admin/bookkeeping/entries", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}`) as never)
    expect(res.status).toBe(403)
  })
  it("400s without book_id", async () => {
    const res = await GET(new Request("http://x/api") as never)
    expect(res.status).toBe(400)
  })
  it("returns rows + totals for an admin", async () => {
    listEntriesMock.mockResolvedValue({ rows: [{ id: "e1" }], total: 1 })
    entryTotalsMock.mockResolvedValue({ income_cents: 9900, expense_cents: 0 })
    const res = await GET(new Request(`http://x/api?book_id=${BOOK}`) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.total).toBe(1)
    expect(json.totals.income_cents).toBe(9900)
  })
})

describe("POST /api/admin/bookkeeping/entries", () => {
  it("creates a manual entry", async () => {
    createEntryMock.mockResolvedValue({ id: "e9", memo: "Bands" })
    const res = await POST(new Request("http://x/api", {
      method: "POST",
      body: JSON.stringify({ book_id: BOOK, direction: "expense", amount_cents: 4200, occurred_on: "2026-07-01" }),
    }) as never)
    expect(res.status).toBe(201)
    expect(createEntryMock).toHaveBeenCalledOnce()
  })
  it("400s invalid input", async () => {
    const res = await POST(new Request("http://x/api", {
      method: "POST", body: JSON.stringify({ book_id: BOOK, direction: "credit", amount_cents: -1, occurred_on: "nope" }),
    }) as never)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Write `import-platform.test.ts`** (mock DAL + adapter path via DAL only; preview returns adapter output).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listPlatformIncomeMock = vi.fn()
const insertImportedEntriesMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listPlatformIncome: (...a: unknown[]) => listPlatformIncomeMock(...a),
  insertImportedEntries: (...a: unknown[]) => insertImportedEntriesMock(...a),
}))

import { POST as PREVIEW } from "@/app/api/admin/bookkeeping/import-platform/route"
import { POST as COMMIT } from "@/app/api/admin/bookkeeping/import-platform/commit/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"

beforeEach(() => {
  authMock.mockReset(); listPlatformIncomeMock.mockReset(); insertImportedEntriesMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
})

describe("import-platform preview", () => {
  it("403s non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await PREVIEW(new Request("http://x", { method: "POST", body: "{}" }) as never)
    expect(res.status).toBe(403)
  })
  it("returns drafts + warnings from real sources", async () => {
    listPlatformIncomeMock.mockResolvedValue({
      payments: [{ id: "11111111-1111-4111-8111-111111111111", user_id: null, stripe_payment_id: null,
        stripe_customer_id: null, amount_cents: 9900, currency: "usd", status: "succeeded",
        description: "Program purchase", metadata: { customerEmail: "a@b.com" },
        created_at: "2026-03-02T10:00:00Z", updated_at: "2026-03-02T10:00:00Z",
        gclid: null, gbraid: null, wbraid: null, fbclid: null }],
      shopOrders: [], clientPackages: [], eventSignups: [], memberships: [],
    })
    const res = await PREVIEW(new Request("http://x", { method: "POST",
      body: JSON.stringify({ book_id: BOOK, from: "2026-01-01", to: "2026-12-31" }) }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.drafts).toHaveLength(1)
    expect(json.drafts[0].source_ref).toBe("payments:11111111-1111-4111-8111-111111111111")
  })
})

describe("import-platform commit", () => {
  it("posts reviewed drafts and returns inserted count", async () => {
    insertImportedEntriesMock.mockResolvedValue({ inserted: 2 })
    const res = await COMMIT(new Request("http://x", { method: "POST", body: JSON.stringify({
      book_id: BOOK, entries: [
        { direction: "income", amount_cents: 9900, occurred_on: "2026-03-02", memo: "x",
          counterparty: "a@b.com", service_line: "performance_training", source: "platform_import", source_ref: "payments:1" },
        { direction: "income", amount_cents: 100, occurred_on: "2026-03-03", memo: "y",
          counterparty: null, service_line: "shop", source: "platform_import", source_ref: "shop_orders:2" },
      ] }) }) as never)
    expect(res.status).toBe(200)
    expect((await res.json()).inserted).toBe(2)
  })
})
```

- [ ] **Step 3: Run the new tests.** `npx vitest run __tests__/api/admin/bookkeeping/` → all PASS.

- [ ] **Step 4: Commit.**

```bash
git add __tests__/api/admin/bookkeeping
git commit -m "test(bookkeeper): route self-gate + happy-path coverage"
```

---

## Task 12: UI — nav + ledger page

**Files:**
- Modify: `components/admin/admin-nav.ts` (add Books to the "Business" section)
- Create: `app/(admin)/admin/books/page.tsx` (server component)
- Create: `components/admin/bookkeeping/BooksClient.tsx` (client — book switcher, filters, totals)
- Create: `components/admin/bookkeeping/LedgerTable.tsx` (client — the table)

**Interfaces:**
- Consumes: `listBooks`, `listAccounts` (server-side load); the `/api/admin/bookkeeping/entries` GET for filtered fetches; `formatCents`.
- Produces: the `/admin/books` page.

- [ ] **Step 1: Add the nav item.** In `components/admin/admin-nav.ts`, in the `Business` section's `items` array (after `Payments`), add:

```ts
      { label: "Books", href: "/admin/books", icon: BookOpen },
```

`BookOpen` is already imported (line 40). Verify it renders by loading `/admin` after Step 4.

- [ ] **Step 2: Build the server page** `app/(admin)/admin/books/page.tsx`.

```tsx
import { listBooks, listAccounts } from "@/lib/db/bookkeeping"
import { BooksClient } from "@/components/admin/bookkeeping/BooksClient"

export const metadata = { title: "Books — Admin" }

export default async function BooksPage() {
  const books = await listBooks()
  const primary = books.find((b) => b.is_primary) ?? books[0]
  const accounts = primary ? await listAccounts(primary.id) : []
  return <BooksClient books={books} initialBookId={primary?.id ?? ""} initialAccounts={accounts} />
}
```

- [ ] **Step 3: Build `BooksClient.tsx`** — client component. Requirements (clone the filter pattern from `components/admin/audit-log-filters.tsx` and the table shell from `components/admin/insights/ClientRiskTable.tsx`):
  - Props: `{ books: BookkeepingBook[]; initialBookId: string; initialAccounts: BookkeepingAccount[] }`.
  - State: `bookId`, `filters` (`from`, `to`, `direction`, `accountId`, `source`, `q`, `page`), `data` (`rows`, `total`, `totals`), `accounts`.
  - On mount + whenever `bookId`/`filters` change: `fetch(\`/api/admin/bookkeeping/entries?\` + querystring)` and set `data`; when `bookId` changes also refetch accounts from `/api/admin/bookkeeping/accounts?book_id=`.
  - Header: book switcher (shadcn tabs or `components/ui/combobox.tsx`) + a totals strip showing `formatCents(totals.income_cents)` (accent/success), `formatCents(totals.expense_cents)` (error), and net = `formatCents(income - expense)`.
  - Toolbar: "Add entry" button (opens `ManualEntryDialog`, Task 13), "Import platform income" button (opens `ImportPlatformDialog`, Task 13), "Manage categories" link → `/admin/books/accounts`.
  - Filter bar: date-from, date-to, direction select (All/Income/Expense), account select (from `accounts`), source select (All/Manual/Platform/Statement/Receipt), search input. Every filter change resets `page` to 1.
  - Body: `<LedgerTable rows={data.rows} accounts={accounts} onChanged={refetch} />`; `EmptyState` (`components/ui/empty-state.tsx`) when `total === 0`; simple prev/next pager using `total`/`perPage`.
  - Design system: semantic classes only; `formatCents` for money; `font-heading` on the page title.

- [ ] **Step 4: Build `LedgerTable.tsx`** — client. Columns: Date (`occurred_on`), Memo (+ `counterparty` subtle), Category (account name; "Uncategorized" muted if null), Source (badge), Amount (`formatCents`, income in success color with `+`, expense in error with `−`). Row actions (only when `source === "manual"`): Edit (opens `ManualEntryDialog` prefilled), Delete (confirm → `DELETE /api/admin/bookkeeping/entries/[id]` → `onChanged()`). Imported rows show a category `<select>` inline that PATCHes `account_id` on change (recategorization is allowed for any source). Use shadcn `components/ui/table.tsx`.

- [ ] **Step 5: Manually verify the page renders.**

Start dev server to a log file (NEVER pipe a long-running server through `head` — journal lesson): `npm run dev > /tmp/dev.log 2>&1 &` then poll `curl -s localhost:3050/admin/books` after login, OR verify via Playwright MCP: navigate to `/admin/books`, confirm the three book tabs, the empty-state, and the toolbar buttons render. Screenshot for the report.

- [ ] **Step 6: Commit.**

```bash
git add components/admin/admin-nav.ts app/\(admin\)/admin/books/page.tsx components/admin/bookkeeping/BooksClient.tsx components/admin/bookkeeping/LedgerTable.tsx
git commit -m "feat(bookkeeper): /admin/books ledger page + nav"
```

---

## Task 13: UI — manual entry, accounts manager, import review

**Files:**
- Create: `components/admin/bookkeeping/ManualEntryDialog.tsx`
- Create: `components/admin/bookkeeping/ImportPlatformDialog.tsx`
- Create: `components/admin/bookkeeping/AccountsManager.tsx`
- Create: `app/(admin)/admin/books/accounts/page.tsx`

**Interfaces:**
- Consumes: the entries + accounts + import routes; `formatCents`.
- Produces: the three dialogs/managers wired to `router.refresh()` / the parent `onChanged` refetch.

- [ ] **Step 1: `ManualEntryDialog.tsx`** — clone the dialog+submit shape of `components/admin/packs/SellPackDialog.tsx`. Props: `{ bookId: string; accounts: BookkeepingAccount[]; entry?: BookkeepingLedgerEntry; open; onOpenChange; onSaved }`. Fields: direction (income/expense toggle), amount (dollars input → `Math.round(parseFloat(x)*100)` cents), date (`occurred_on`, default today via `new Date().toISOString().slice(0,10)`), account select (filtered to matching `account_type`), memo, counterparty, business_purpose (textarea, labeled "Business purpose (who/what for)" — the purpose-capture beat). Submit: POST (create) or PATCH (edit) → `onSaved()`. Show a Sonner toast on success/failure.

- [ ] **Step 2: `ImportPlatformDialog.tsx`** — two-step. Step A: pick date range (default: Jan 1 of current year → today) → POST `/api/admin/bookkeeping/import-platform` → show `{ drafts, warnings }`. Render drafts in a compact table (date, memo, counterparty, service_line, `formatCents(amount_cents)`) with a per-row account `<select>` (defaulting by `service_line` → matching account) and a checkbox to include/exclude; render `warnings` in a distinct amber panel (esp. the membership-gap note). Step B: "Post N entries" → POST `/api/admin/bookkeeping/import-platform/commit` with the included, account-assigned entries → toast `inserted` count (and note skipped = duplicates) → `onSaved()`. Guard against double-post: disable the button while in flight.

- [ ] **Step 3: `AccountsManager.tsx` + `accounts/page.tsx`** — server page loads `listBooks()` + `listAccounts(primary)`; client manager lists accounts per book (switch book), add-account form (name, type, service_line, deductible toggle, tax_category) → POST `/api/admin/bookkeeping/accounts`; inline edit + archive (PATCH). `accounts/page.tsx`:

```tsx
import { listBooks, listAccounts } from "@/lib/db/bookkeeping"
import { AccountsManager } from "@/components/admin/bookkeeping/AccountsManager"

export const metadata = { title: "Chart of Accounts — Admin" }

export default async function AccountsPage() {
  const books = await listBooks()
  const primary = books.find((b) => b.is_primary) ?? books[0]
  const accounts = primary ? await listAccounts(primary.id) : []
  return <AccountsManager books={books} initialBookId={primary?.id ?? ""} initialAccounts={accounts} />
}
```

- [ ] **Step 4: Manually verify end-to-end** (Playwright MCP or manual): add a manual expense (appears in ledger with correct sign + totals update); open Import platform income for the current year, confirm drafts appear with the membership warning, post them, confirm they land in the ledger and re-posting the same range inserts 0 (dedupe). Screenshot each for the report.

- [ ] **Step 5: Commit.**

```bash
git add components/admin/bookkeeping/ManualEntryDialog.tsx components/admin/bookkeeping/ImportPlatformDialog.tsx components/admin/bookkeeping/AccountsManager.tsx app/\(admin\)/admin/books/accounts/page.tsx
git commit -m "feat(bookkeeper): manual entry, import review, accounts manager UI"
```

---

## Task 14: Full-suite verification + baseline check

**Files:** none (verification only).

- [ ] **Step 1: Snapshot the known-red baseline.** Before trusting suite results, stash your work and run the suite on the base to capture pre-existing reds:

```bash
git stash
npx vitest run 2>&1 | tail -30 > /tmp/baseline.txt
git stash pop
```

Note the failing files (expect ~8-9: stripe webhook-events/external, uploads/shop, import-excel-route, admin-nav, content-studio CarouselComposer/GenerateQuoteCardsButton).

- [ ] **Step 2: Run the suite WITH your work.**

```bash
npx vitest run 2>&1 | tail -40 > /tmp/withwork.txt
```

- [ ] **Step 3: Diff the failing sets.** The ONLY acceptable new failures are none. Any file failing in `withwork.txt` but not `baseline.txt` is your regression — fix it. The `admin-nav` test may now legitimately change if it snapshots nav items — update the snapshot/assertion to include "Books" if so, and confirm that's the only nav delta.

- [ ] **Step 4: Run your feature's tests in isolation to confirm green.**

```bash
npx vitest run __tests__/lib/bookkeeping __tests__/lib/csv __tests__/lib/db/paginate __tests__/lib/validators/bookkeeping __tests__/api/admin/bookkeeping 2>&1 | tail -20
```

Expect all PASS.

- [ ] **Step 5: Typecheck the production source you touched.**

```bash
npx tsc --noEmit 2>&1 | grep -E "lib/bookkeeping|lib/db/bookkeeping|lib/csv|app/api/admin/bookkeeping|components/admin/bookkeeping|lib/validators/bookkeeping" | head
```

Expect no output (prod source clean; pre-existing test/.next noise ignored).

- [ ] **Step 6: Commit any fixes, then STOP for review.** Do not push. Leave the branch green for the holistic review.

```bash
git add -A -- ':!JOURNAL.md'
git commit -m "test(bookkeeper): verify Phase 1 against known-red baseline" || echo "nothing to commit"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** §4.2 tables → Task 1. §4.3 income adapter + DAL → Tasks 6, 7. §4.4 shared utils (money/CSV/paginator) → Tasks 2, 3, 4. §4.5 routes (all 7, self-gated + audited) → Tasks 8, 9, 10. §4.6 UI (nav, ledger, filters, totals, manual entry, accounts, import review) → Tasks 12, 13. §4.7 testing (pure zero-mock + route DAL-mock + baseline) → Tasks 2-6, 11, 14. All Phase-1 spec sections map to a task.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". UI tasks (12-13) specify props, data contracts, exact clone sources, and behavior — component bodies are described structurally (full pixel code in a plan is neither realistic nor how this repo's prior plans work), which is actionable, not a placeholder.

**Type consistency:** `LedgerEntryDraft`/`IncomeSourceRows`/`IncomeAdapterResult` defined in Task 5, consumed unchanged in Tasks 6, 7, 10. `formatCents`/`signedCents` (Task 2) used in Tasks 12-13. DAL fn names in Task 7 match their call sites in Tasks 9-10, 12-13. `source_ref` format (`table:id`) consistent between adapter (Task 6), DAL upsert `onConflict` (Task 7), and tests (Tasks 6, 11).

**Known deviations documented:** membership income gap (adapter warns, emits nothing — honest per design D3); `client_packages`/`client_memberships` live-DB existence verified in Task 1 Step 1 before the adapter relies on them; `new Date()`/`crypto.randomUUID()` used in app routes (the ban is workflow-script-only).
