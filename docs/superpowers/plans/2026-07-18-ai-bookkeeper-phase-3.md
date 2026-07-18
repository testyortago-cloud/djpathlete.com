# AI Bookkeeper Phase 3 — Receipts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add receipt capture to the AI Bookkeeper — cash 2-tap, admin photo→vision→review→post, and Amazon CSV import — plus a retention-pruning cron and three Phase-2 follow-ups, all posting into the existing ledger with `source='receipt'`.

**Architecture:** Reuse Phase 2 wholesale. Cash receipts ride the manual-entry path. Photo receipts store to the private bucket + a `bookkeeping_documents` row (`kind='receipt'`), then a `receipt_scan` Firebase job downloads the image, sharp-resizes it, and calls a vision-widened `callAgent` for structured extraction the coach reviews. Amazon CSV reuses the shipped statement `csv_structured` categorization job unchanged (rows zipped back by input order). A daily flag-gated cron prunes documents past `retain_until`.

**Tech Stack:** Next.js 16 App Router, Firebase Functions (raw Anthropic SDK, `sharp`), Supabase (service-role), Zod v4, Vitest.

**Design doc:** `docs/superpowers/specs/2026-07-18-ai-bookkeeper-phase-3-design.md`.

## Global Constraints

- **Branch `feat/ai-bookkeeper-phase-3`. Do NOT push** until the owner says so.
- **Migrations via `mcp__supabase__apply_migration`** (CLI not linked). The migration APPLY to prod is done by the **controller** (not a task subagent), after Task 1's file is reviewed — mirrors Phase 1/2 (additive/reversible). Next number: **`00186`**.
- **All `/api/*` routes self-gate:** `const s = await auth(); if (!s?.user?.id || s.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })`. **Never `requireAdmin()`** (it returns a redirect in API routes).
- **RTDB drops `null` leaf values on write** (`rtdb_drops_null_leaves`). Every vision-result field is `.nullable().optional()` in Zod; the dialog coalesces every field `?? null` and rebuilds dropped arrays as `[]`. This caused the Phase-2 Critical — non-negotiable.
- **functions/ ↔ lib/ twin copy:** functions/ has `rootDir:"src"` and cannot import `lib/`/`types/`. Twin any shared helper; imports inside functions/ use `.js` suffixes.
- **PostgREST caps `.select()` at ~1000 rows** — every document/entry read paginates via `fetchAllRows` (`lib/db/paginate.ts`).
- **Money is integer cents.** All amounts `amount_cents` (integer, ≥0); `direction` carries sign.
- **`getPrivateBucket()` needs `FIREBASE_PRIVATE_BUCKET` in the Vercel runtime** (`split_reel_vercel_env`) — routes fail friendly if unset.
- **Tests:** pure logic → `__tests__/lib/**` zero-mock; routes → mock the DAL (`vi.mock('@/lib/db/bookkeeping')`), import handler after mocks, `Request as never`, async `params` Promise; functions → `functions/src/**/__tests__/`. **Never `__tests__/db/`.** RFC-4122 UUID fixtures (`…-4NNN-8NNN-…`).
- **Commands:** root tests `npm run test:run -- <path>`; functions tests `npm --prefix functions run test -- <path-relative-to-functions>`; root typecheck `npx tsc --noEmit` (grep touched filenames, not the count — `test_baseline_not_green`); functions typecheck `npm --prefix functions run build`.
- **Baseline is known-red** (~8-9 pre-existing failures across uploads/shop, stripe webhook, admin-nav, import-excel). Snapshot before/after; a diff is clean if it adds no NEW reds.
- **Do NOT touch the pre-existing dirty working-tree files** (pr-detection, render-worker, etc.) — stage only files you create/modify for the task.

---

### Task 1: Migration 00186 + `types/database.ts`

**Files:**
- Create: `supabase/migrations/00186_bookkeeping_receipts.sql`
- Modify: `types/database.ts` (`BookkeepingLedgerEntry`, `BookkeepingAccount`)

**Interfaces:**
- Produces: ledger column `document_id uuid|null`; account column `requires_business_purpose boolean`; `system_settings` flag `cron_bookkeeping_retention_enabled` (default `false`).

- [ ] **Step 1: Write the migration**

```sql
-- 00186_bookkeeping_receipts.sql
-- Phase 3 (receipts): link a receipt document to its ledger entry, mark
-- IRS-sensitive accounts as requiring a business purpose, and seed the
-- (default OFF) retention-pruning cron flag. Additive + reversible.

-- 1) receipt <-> ledger link. ON DELETE SET NULL lets the retention cron drop
--    an expired image while the ledger entry (the actual book record) survives.
alter table bookkeeping_ledger_entries
  add column if not exists document_id uuid
    references bookkeeping_documents(id) on delete set null;
create index if not exists idx_bk_ledger_document
  on bookkeeping_ledger_entries(document_id);

-- 2) per-account "business purpose required" flag (IRS-sensitive categories).
alter table bookkeeping_accounts
  add column if not exists requires_business_purpose boolean not null default false;
update bookkeeping_accounts set requires_business_purpose = true
  where account_type = 'expense'
    and name in ('Meals (business purpose)', 'Travel', 'Vehicle');

-- 3) retention cron flag — DB-backed, default OFF (destructive).
insert into system_settings (key, value, description) values
  ('cron_bookkeeping_retention_enabled', 'false'::jsonb,
   'Daily cron: prune bookkeeping_documents (statements + receipts) past retain_until — deletes the bucket object + row, nulls the linked ledger entry document_id. Default OFF (destructive).')
on conflict (key) do nothing;
```

- [ ] **Step 2: Update `types/database.ts`**

In `interface BookkeepingLedgerEntry` add:
```ts
  document_id: string | null
```
In `interface BookkeepingAccount` add:
```ts
  requires_business_purpose: boolean
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "database\.ts|bookkeeping" | grep -v "__tests__"` — Expected: no new errors referencing these two interfaces.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00186_bookkeeping_receipts.sql types/database.ts
git commit -m "feat(bookkeeper): 00186 receipts migration + types (document_id, requires_business_purpose, retention flag)"
```

> **Controller step (not the subagent):** after review, apply 00186 to prod via `mcp__supabase__apply_migration` (name `bookkeeping_receipts`), then verify with `mcp__supabase__execute_sql` that the two columns + flag exist.

---

### Task 2: Pure receipt helpers — `lib/bookkeeping/receipts.ts`

**Files:**
- Create: `lib/bookkeeping/receipts.ts`
- Test: `__tests__/lib/bookkeeping/receipts.test.ts`

**Interfaces:**
- Produces:
  - `accountRequiresBusinessPurpose(account: { requires_business_purpose?: boolean | null }): boolean`
  - `businessPurposeMissing(account: { requires_business_purpose?: boolean | null }, purpose: string | null | undefined): boolean`
  - `receiptSourceRef(documentId: string): string` → `` `receipt:${documentId}` ``
  - `RECEIPT_SOURCE_REF: RegExp` = `/^receipt:[0-9a-f-]{36}$/`
  - `AMAZON_SOURCE_REF: RegExp` = `/^amazon:.+$/`
  - `isValidReceiptCommitRef(ref: string): boolean` (matches receipt OR amazon)
  - `receiptRetainUntil(occurredOn: string): string` → `` `${Number(occurredOn.slice(0,4)) + 7}-12-31` ``

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/receipts.test.ts
import { describe, it, expect } from "vitest"
import {
  accountRequiresBusinessPurpose, businessPurposeMissing, receiptSourceRef,
  RECEIPT_SOURCE_REF, isValidReceiptCommitRef, receiptRetainUntil,
} from "@/lib/bookkeeping/receipts"

describe("accountRequiresBusinessPurpose", () => {
  it("true only when flag set", () => {
    expect(accountRequiresBusinessPurpose({ requires_business_purpose: true })).toBe(true)
    expect(accountRequiresBusinessPurpose({ requires_business_purpose: false })).toBe(false)
    expect(accountRequiresBusinessPurpose({})).toBe(false)
    expect(accountRequiresBusinessPurpose({ requires_business_purpose: null })).toBe(false)
  })
})

describe("businessPurposeMissing", () => {
  it("missing only when required AND blank", () => {
    const sensitive = { requires_business_purpose: true }
    expect(businessPurposeMissing(sensitive, "team lunch")).toBe(false)
    expect(businessPurposeMissing(sensitive, "")).toBe(true)
    expect(businessPurposeMissing(sensitive, "   ")).toBe(true)
    expect(businessPurposeMissing(sensitive, null)).toBe(true)
    expect(businessPurposeMissing({ requires_business_purpose: false }, null)).toBe(false)
  })
})

describe("receiptSourceRef / validation", () => {
  it("builds and validates a receipt ref", () => {
    const id = "11111111-2222-4333-8444-555555555555"
    expect(receiptSourceRef(id)).toBe(`receipt:${id}`)
    expect(RECEIPT_SOURCE_REF.test(receiptSourceRef(id))).toBe(true)
    expect(isValidReceiptCommitRef(receiptSourceRef(id))).toBe(true)
    expect(isValidReceiptCommitRef("amazon:112-3456789-0000000:0")).toBe(true)
    expect(isValidReceiptCommitRef("statement:deadbeef")).toBe(false)
    expect(isValidReceiptCommitRef("receipt:not-a-uuid")).toBe(false)
  })
})

describe("receiptRetainUntil", () => {
  it("occurred-year + 7, Dec 31", () => {
    expect(receiptRetainUntil("2026-07-18")).toBe("2033-12-31")
    expect(receiptRetainUntil("2020-01-01")).toBe("2027-12-31")
  })
})
```

- [ ] **Step 2: Run — Expected: FAIL** (module not found)

Run: `npm run test:run -- __tests__/lib/bookkeeping/receipts.test.ts`

- [ ] **Step 3: Implement**

```ts
// lib/bookkeeping/receipts.ts
// Pure helpers for the receipts subsystem (Phase 3). Zero IO.

export function accountRequiresBusinessPurpose(account: { requires_business_purpose?: boolean | null }): boolean {
  return account.requires_business_purpose === true
}

export function businessPurposeMissing(
  account: { requires_business_purpose?: boolean | null },
  purpose: string | null | undefined,
): boolean {
  if (!accountRequiresBusinessPurpose(account)) return false
  return !purpose || purpose.trim().length === 0
}

export function receiptSourceRef(documentId: string): string {
  return `receipt:${documentId}`
}

export const RECEIPT_SOURCE_REF = /^receipt:[0-9a-f-]{36}$/
export const AMAZON_SOURCE_REF = /^amazon:.+$/

export function isValidReceiptCommitRef(ref: string): boolean {
  return RECEIPT_SOURCE_REF.test(ref) || AMAZON_SOURCE_REF.test(ref)
}

export function receiptRetainUntil(occurredOn: string): string {
  const year = Number(occurredOn.slice(0, 4))
  return `${year + 7}-12-31`
}
```

- [ ] **Step 4: Run — Expected: PASS**

Run: `npm run test:run -- __tests__/lib/bookkeeping/receipts.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/receipts.ts __tests__/lib/bookkeeping/receipts.test.ts
git commit -m "feat(bookkeeper): pure receipt helpers (business-purpose gate, source_ref, retain_until)"
```

---

### Task 3: Amazon CSV parser — `lib/bookkeeping/amazon-parse.ts`

**Files:**
- Create: `lib/bookkeeping/amazon-parse.ts`
- Test: `__tests__/lib/bookkeeping/amazon-parse.test.ts`

**Interfaces:**
- Consumes (from `lib/bookkeeping/statement-parse.ts`): `parseCsvStatement(text) → { headers: string[]; rows: string[][] }`, `parseAmountToCents(raw) → { cents: number; negative: boolean } | null`, `parseStatementDate(raw) → string | null`.
- Produces:
  - `interface AmazonRow { occurred_on: string; description: string; amount_cents: number; direction: "expense"; orderId: string; lineIndex: number; source_ref: string }`
  - `parseAmazonCsv(text: string): { rows: AmazonRow[]; warnings: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/amazon-parse.test.ts
import { describe, it, expect } from "vitest"
import { parseAmazonCsv } from "@/lib/bookkeeping/amazon-parse"

const CSV = `Order Date,Order ID,Title,Item Total,Currency
2026-07-01,112-3456789-1111111,"Resistance Bands, Set of 5",$24.99,USD
2026-07-03,112-3456789-2222222,Foam Roller,$31.50,USD
2026-07-03,112-3456789-2222222,Lacrosse Ball,$8.00,USD`

describe("parseAmazonCsv", () => {
  it("parses order lines into expense rows with stable refs", () => {
    const { rows, warnings } = parseAmazonCsv(CSV)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      occurred_on: "2026-07-01", description: "Resistance Bands, Set of 5",
      amount_cents: 2499, direction: "expense", orderId: "112-3456789-1111111",
    })
    expect(rows[0].source_ref).toBe("amazon:112-3456789-1111111:0")
    // two items on the same order get distinct line indexes
    expect(rows[1].source_ref).toBe("amazon:112-3456789-2222222:0")
    expect(rows[2].source_ref).toBe("amazon:112-3456789-2222222:1")
    expect(warnings).toEqual([])
  })

  it("re-parsing the same CSV yields identical refs (idempotent)", () => {
    const a = parseAmazonCsv(CSV).rows.map((r) => r.source_ref)
    const b = parseAmazonCsv(CSV).rows.map((r) => r.source_ref)
    expect(a).toEqual(b)
  })

  it("recognizes the 'Total Owed' / 'Product Name' variant", () => {
    const alt = `Order Date,Order ID,Product Name,Total Owed\n2026-06-15,111-0000000-0000000,Whiteboard,$45.00`
    const { rows } = parseAmazonCsv(alt)
    expect(rows[0]).toMatchObject({ amount_cents: 4500, orderId: "111-0000000-0000000", description: "Whiteboard" })
  })

  it("warns and skips rows with an unreadable amount or missing order id", () => {
    const bad = `Order Date,Order ID,Title,Item Total\n2026-06-15,,Mystery,$10.00\n2026-06-16,111-1,Broken,notanumber`
    const { rows, warnings } = parseAmazonCsv(bad)
    expect(rows).toHaveLength(0)
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })

  it("returns a warning (no throw) when no Amazon columns are detected", () => {
    const { rows, warnings } = parseAmazonCsv("foo,bar\n1,2")
    expect(rows).toEqual([])
    expect(warnings[0]).toMatch(/could not detect/i)
  })
})
```

- [ ] **Step 2: Run — Expected: FAIL**

Run: `npm run test:run -- __tests__/lib/bookkeeping/amazon-parse.test.ts`

- [ ] **Step 3: Implement**

```ts
// lib/bookkeeping/amazon-parse.ts
// Pure parser for Amazon "Order History" / "Items" CSV exports (Phase 3).
// Reuses the money-safe primitives from statement-parse.ts (string-split cents,
// tz-independent dates) so amounts/dates are parsed identically to statements.
import { parseCsvStatement, parseAmountToCents, parseStatementDate } from "./statement-parse"

export interface AmazonRow {
  occurred_on: string
  description: string
  amount_cents: number
  direction: "expense"
  orderId: string
  lineIndex: number
  source_ref: string
}

const DATE_HEADERS = ["order date", "date"]
const ORDER_HEADERS = ["order id", "order id ", "orderid"]
const TITLE_HEADERS = ["title", "product name", "item name", "name"]
const AMOUNT_HEADERS = ["item total", "total owed", "item subtotal", "purchase price per unit", "total charged"]

function findCol(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase())
  for (const c of candidates) {
    const i = lower.indexOf(c)
    if (i >= 0) return i
  }
  return -1
}

export function parseAmazonCsv(text: string): { rows: AmazonRow[]; warnings: string[] } {
  const warnings: string[] = []
  const { headers, rows } = parseCsvStatement(text)
  const dateCol = findCol(headers, DATE_HEADERS)
  const orderCol = findCol(headers, ORDER_HEADERS)
  const titleCol = findCol(headers, TITLE_HEADERS)
  const amountCol = findCol(headers, AMOUNT_HEADERS)

  if (dateCol < 0 || orderCol < 0 || amountCol < 0) {
    return { rows: [], warnings: ["Could not detect Amazon order columns (need Order Date, Order ID, and an item total)."] }
  }

  const out: AmazonRow[] = []
  const lineByOrder = new Map<string, number>()

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i]
    const orderId = (cells[orderCol] ?? "").trim()
    const occurred_on = parseStatementDate(cells[dateCol] ?? "")
    const amt = parseAmountToCents(cells[amountCol] ?? "")
    const description = titleCol >= 0 ? (cells[titleCol] ?? "").trim() : "Amazon order"

    if (!orderId) { warnings.push(`Row ${i + 1}: missing Order ID — skipped.`); continue }
    if (!occurred_on) { warnings.push(`Row ${i + 1} (${orderId}): unreadable date — skipped.`); continue }
    if (!amt || amt.cents <= 0) { warnings.push(`Row ${i + 1} (${orderId}): unreadable amount — skipped.`); continue }

    const lineIndex = lineByOrder.get(orderId) ?? 0
    lineByOrder.set(orderId, lineIndex + 1)
    out.push({
      occurred_on, description: description || "Amazon order", amount_cents: amt.cents,
      direction: "expense", orderId, lineIndex,
      source_ref: `amazon:${orderId}:${lineIndex}`,
    })
  }

  return { rows: out, warnings }
}
```

> Note: verify `parseAmountToCents`/`parseStatementDate` are `export`ed from `statement-parse.ts` (they are — confirmed at lines 47/100). If a signature differs, adapt the call, not the money math.

- [ ] **Step 4: Run — Expected: PASS**

Run: `npm run test:run -- __tests__/lib/bookkeeping/amazon-parse.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/amazon-parse.ts __tests__/lib/bookkeeping/amazon-parse.test.ts
git commit -m "feat(bookkeeper): pure Amazon CSV parser (order lines -> expense rows, stable amazon: refs)"
```

---

### Task 4: Validators + audit slugs

**Files:**
- Modify: `lib/validators/bookkeeping.ts`
- Modify: `lib/audit/actions.ts`
- Test: `__tests__/lib/bookkeeping/receipt-validators.test.ts`

**Interfaces:**
- Produces: `receiptCashSchema`, `receiptCommitSchema`, `amazonCommitSchema`; audit slugs `bookkeeping.receipt_cash_recorded`, `bookkeeping.receipt_uploaded`, `bookkeeping.receipt_imported`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bookkeeping/receipt-validators.test.ts
import { describe, it, expect } from "vitest"
import { receiptCashSchema, receiptCommitSchema, amazonCommitSchema } from "@/lib/validators/bookkeeping"
import { AUDIT_ACTIONS } from "@/lib/audit/actions"

const UUID = "11111111-2222-4333-8444-555555555555"

describe("receiptCashSchema", () => {
  it("accepts a minimal cash receipt", () => {
    const r = receiptCashSchema.safeParse({ book_id: UUID, account_id: UUID, amount_cents: 1200, occurred_on: "2026-07-18" })
    expect(r.success).toBe(true)
  })
  it("rejects a bad date and negative amount", () => {
    expect(receiptCashSchema.safeParse({ book_id: UUID, account_id: UUID, amount_cents: -1, occurred_on: "2026-07-18" }).success).toBe(false)
    expect(receiptCashSchema.safeParse({ book_id: UUID, account_id: UUID, amount_cents: 1, occurred_on: "07/18/2026" }).success).toBe(false)
  })
})

describe("receiptCommitSchema", () => {
  it("requires document_id + source_ref", () => {
    const ok = receiptCommitSchema.safeParse({
      book_id: UUID, document_id: UUID, account_id: UUID, amount_cents: 999,
      occurred_on: "2026-07-18", source_ref: `receipt:${UUID}`, business_purpose: "conference",
    })
    expect(ok.success).toBe(true)
    expect(receiptCommitSchema.safeParse({ book_id: UUID, amount_cents: 1, occurred_on: "2026-07-18" }).success).toBe(false)
  })
})

describe("amazonCommitSchema", () => {
  it("accepts entries with amazon refs", () => {
    const r = amazonCommitSchema.safeParse({
      book_id: UUID, document_id: UUID,
      entries: [{ direction: "expense", amount_cents: 2499, occurred_on: "2026-07-01", memo: "Bands", counterparty: "Amazon", service_line: null, source: "receipt", source_ref: "amazon:112-1:0", account_id: UUID }],
    })
    expect(r.success).toBe(true)
  })
})

describe("audit slugs", () => {
  it("registers the three receipt slugs", () => {
    const slugs = AUDIT_ACTIONS.map((a) => a.slug)
    expect(slugs).toContain("bookkeeping.receipt_cash_recorded")
    expect(slugs).toContain("bookkeeping.receipt_uploaded")
    expect(slugs).toContain("bookkeeping.receipt_imported")
  })
})
```

- [ ] **Step 2: Run — Expected: FAIL**

Run: `npm run test:run -- __tests__/lib/bookkeeping/receipt-validators.test.ts`

- [ ] **Step 3: Implement — add to `lib/validators/bookkeeping.ts`** (after `statementCommitSchema`):

```ts
export const receiptCashSchema = z.object({
  book_id: z.string().uuid(),
  account_id: z.string().uuid(),
  amount_cents: z.number().int().nonnegative(),
  occurred_on: DATE,
  counterparty: z.string().max(200).nullable().optional(),
  business_purpose: z.string().max(1000).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
})

export const receiptCommitSchema = z.object({
  book_id: z.string().uuid(),
  document_id: z.string().uuid(),
  account_id: z.string().uuid().nullable().optional(),
  amount_cents: z.number().int().nonnegative(),
  occurred_on: DATE,
  counterparty: z.string().max(200).nullable().optional(),
  business_purpose: z.string().max(1000).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
  source_ref: z.string().min(1),
})

export const amazonCommitSchema = z.object({
  book_id: z.string().uuid(),
  document_id: z.string().uuid().optional(),
  entries: z.array(z.object({
    direction: z.enum(["income", "expense"]),
    amount_cents: z.number().int().nonnegative(),
    occurred_on: DATE,
    memo: z.string().nullable(),
    counterparty: z.string().nullable(),
    business_purpose: z.string().max(1000).nullable().optional(),
    service_line: z.string().nullable(),
    source: z.literal("receipt"),
    source_ref: z.string().min(1),
    account_id: z.string().uuid().nullable().optional(),
  })).min(1).max(2000),
})
```

- [ ] **Step 4: Implement — add to `lib/audit/actions.ts`** in the `bookkeeping.*` block:

```ts
  { slug: "bookkeeping.receipt_cash_recorded", category: "commerce", description: "Cash receipt recorded to the ledger" },
  { slug: "bookkeeping.receipt_uploaded",       category: "commerce", description: "Receipt image / Amazon CSV uploaded" },
  { slug: "bookkeeping.receipt_imported",       category: "commerce", description: "Receipt posted to the ledger" },
```

- [ ] **Step 5: Run — Expected: PASS**

Run: `npm run test:run -- __tests__/lib/bookkeeping/receipt-validators.test.ts`

- [ ] **Step 6: Commit**

```bash
git add lib/validators/bookkeeping.ts lib/audit/actions.ts __tests__/lib/bookkeeping/receipt-validators.test.ts
git commit -m "feat(bookkeeper): receipt Zod schemas + audit slugs"
```

---

### Task 5: DAL additions + F2 (book-scoped `linkDocumentBatch`) — `lib/db/bookkeeping.ts`

**Files:**
- Modify: `lib/db/bookkeeping.ts`
- Modify: `app/api/admin/bookkeeping/statement-import/commit/route.ts` (update the one `linkDocumentBatch` caller)

**Interfaces:**
- Consumes: existing `assertAccountInBook(accountId, bookId, direction)`, `db()` service client, `LedgerDirection`, `BookkeepingAccount`.
- Produces:
  - `getAccount(id): Promise<BookkeepingAccount | null>`
  - `insertReceiptEntry(input): Promise<{ inserted: number; id: string | null }>`
  - `insertAmazonEntries(bookId, importBatchId, drafts): Promise<{ inserted: number }>`
  - `updateDocumentRetainUntil(id, retainUntil): Promise<void>`
  - `assertAccountsInBook(bookId, items: Array<{ accountId: string | null; direction: LedgerDirection }>): Promise<void>`
  - **Changed:** `linkDocumentBatch(id, bookId, importBatchId, postedCount): Promise<void>` (added `bookId`).

- [ ] **Step 1: Implement the DAL functions** (append near the other document helpers):

```ts
export async function getAccount(id: string): Promise<BookkeepingAccount | null> {
  const { data, error } = await db().from("bookkeeping_accounts").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingAccount) ?? null
}

export async function insertReceiptEntry(input: {
  book_id: string; account_id: string | null; amount_cents: number; occurred_on: string
  counterparty: string | null; business_purpose: string | null; memo: string | null
  source_ref: string; document_id: string | null; import_batch_id: string | null
}): Promise<{ inserted: number; id: string | null }> {
  const row = {
    book_id: input.book_id, account_id: input.account_id, direction: "expense" as const,
    amount_cents: input.amount_cents, occurred_on: input.occurred_on, memo: input.memo,
    business_purpose: input.business_purpose, counterparty: input.counterparty,
    source: "receipt" as const, source_ref: input.source_ref,
    import_batch_id: input.import_batch_id, document_id: input.document_id,
  }
  const { data, error } = await db()
    .from("bookkeeping_ledger_entries")
    .upsert([row], { onConflict: "book_id,source,source_ref", ignoreDuplicates: true })
    .select("id")
  if (error) throw error
  return { inserted: (data ?? []).length, id: (data?.[0] as { id: string } | undefined)?.id ?? null }
}

export async function insertAmazonEntries(
  bookId: string, importBatchId: string,
  drafts: Array<{ direction: "income" | "expense"; amount_cents: number; occurred_on: string; memo: string | null; counterparty: string | null; business_purpose?: string | null; source_ref: string; account_id?: string | null }>,
): Promise<{ inserted: number }> {
  if (drafts.length === 0) return { inserted: 0 }
  const rows = drafts.map((d) => ({
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
  return { inserted: (data ?? []).length }
}

export async function updateDocumentRetainUntil(id: string, retainUntil: string): Promise<void> {
  const { error } = await db()
    .from("bookkeeping_documents")
    .update({ retain_until: retainUntil, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

export async function assertAccountsInBook(
  bookId: string, items: Array<{ accountId: string | null; direction: LedgerDirection }>,
): Promise<void> {
  const pairs = new Set<string>()
  for (const it of items) if (it.accountId) pairs.add(`${it.accountId}|${it.direction}`)
  for (const p of pairs) {
    const [accountId, direction] = p.split("|")
    await assertAccountInBook(accountId, bookId, direction as LedgerDirection)
  }
}
```

- [ ] **Step 2: Change `linkDocumentBatch` to be book-scoped (F2)**

Replace the existing `linkDocumentBatch`:
```ts
export async function linkDocumentBatch(id: string, bookId: string, importBatchId: string, postedCount: number): Promise<void> {
  const { error } = await db()
    .from("bookkeeping_documents")
    .update({ import_batch_id: importBatchId, posted_count: postedCount, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("book_id", bookId)
  if (error) throw error
}
```

- [ ] **Step 3: Update the statement-commit caller**

In `app/api/admin/bookkeeping/statement-import/commit/route.ts`, change:
```ts
    if (document_id) await linkDocumentBatch(document_id, batchId, inserted)
```
to:
```ts
    if (document_id) await linkDocumentBatch(document_id, book_id, batchId, inserted)
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "bookkeeping\.ts|statement-import/commit" | grep -v "__tests__"` — Expected: no new errors. (DAL functions are exercised by route tests in later tasks.)

- [ ] **Step 5: Commit**

```bash
git add lib/db/bookkeeping.ts app/api/admin/bookkeeping/statement-import/commit/route.ts
git commit -m "feat(bookkeeper): receipt DAL (insertReceiptEntry/insertAmazonEntries/getAccount/assertAccountsInBook) + book-scope linkDocumentBatch (F2)"
```

---

### Task 6: Widen functions-side `callAgent` for images

**Files:**
- Modify: `functions/src/ai/anthropic.ts`
- Test: `functions/src/ai/__tests__/call-agent-images.test.ts`

**Interfaces:**
- Produces: `callAgent(system, user, schema, options?)` and `callAgentWithModel(...)` gain `options.images?: Array<{ media_type: string; data: string }>` — when present, image blocks are prepended to the user content (both the tool_use and text-fallback paths). Omitting `images` is byte-for-byte the prior behavior.

- [ ] **Step 1: Write the failing test** (exercise the pure content-builder via a small exported helper)

Add an exported pure helper to `anthropic.ts` and test it:
```ts
// functions/src/ai/__tests__/call-agent-images.test.ts
import { describe, it, expect } from "vitest"
import { buildUserContent } from "../anthropic.js"

describe("buildUserContent", () => {
  it("returns the bare string when no images/prefix", () => {
    expect(buildUserContent("hello", undefined, undefined)).toBe("hello")
  })
  it("prepends image blocks before the text", () => {
    const content = buildUserContent("read this receipt", undefined, [{ media_type: "image/jpeg", data: "AAAA" }])
    expect(Array.isArray(content)).toBe(true)
    const blocks = content as Array<Record<string, unknown>>
    expect(blocks[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } })
    expect(blocks[blocks.length - 1]).toEqual({ type: "text", text: "read this receipt" })
  })
  it("orders image, cached prefix, then text", () => {
    const content = buildUserContent("q", "CACHED", [{ media_type: "image/png", data: "B" }]) as Array<Record<string, unknown>>
    expect(content.map((b) => b.type)).toEqual(["image", "text", "text"])
    expect((content[1] as { text: string }).text).toBe("CACHED")
  })
})
```

- [ ] **Step 2: Run — Expected: FAIL**

Run: `npm --prefix functions run test -- src/ai/__tests__/call-agent-images.test.ts`

- [ ] **Step 3: Implement**

In `anthropic.ts`, add the exported builder and use it in both branches. Add to the options type of `callAgentWithModel` and `callAgent`: `images?: Array<{ media_type: string; data: string }>`.

```ts
export function buildUserContent(
  userMessage: string,
  cachedUserPrefix: string | undefined,
  images: Array<{ media_type: string; data: string }> | undefined,
): Anthropic.Messages.ContentBlockParam[] | string {
  const hasImages = !!images && images.length > 0
  if (!hasImages && !cachedUserPrefix) return userMessage
  const blocks: Anthropic.Messages.ContentBlockParam[] = []
  if (hasImages) {
    for (const img of images!) {
      blocks.push({ type: "image", source: { type: "base64", media_type: img.media_type as "image/jpeg", data: img.data } })
    }
  }
  if (cachedUserPrefix) {
    blocks.push({ type: "text", text: cachedUserPrefix, cache_control: { type: "ephemeral" } })
  }
  blocks.push({ type: "text", text: userMessage })
  return blocks
}
```

Replace the existing `userContent` construction (tool_use path) with:
```ts
      const userContent = buildUserContent(userMessage, options?.cachedUserPrefix, options?.images)
```
And in the text-fallback path replace `fallbackUserContent` construction with:
```ts
        const fallbackUserContent = buildUserContent(fallbackUserText, options?.cachedUserPrefix, options?.images)
```
Add `images?: Array<{ media_type: string; data: string }>` to both options object types.

- [ ] **Step 4: Run — Expected: PASS**

Run: `npm --prefix functions run test -- src/ai/__tests__/call-agent-images.test.ts`

- [ ] **Step 5: Typecheck functions**

Run: `npm --prefix functions run build` — Expected: exit 0 (no new tsc errors).

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/anthropic.ts functions/src/ai/__tests__/call-agent-images.test.ts
git commit -m "feat(bookkeeper): widen functions callAgent to accept image blocks (backward-compatible)"
```

---

### Task 7: Twin receipt schema + prompt — `functions/src/ai/`

**Files:**
- Create: `functions/src/ai/receipt-schema.ts`
- Create: `functions/src/ai/receipt-prompt.ts`
- Test: `functions/src/ai/__tests__/receipt-schema.test.ts`

**Interfaces:**
- Produces: `receiptScanSchema` (Zod), `type ReceiptScanResult = z.infer<...>`, `RECEIPT_SCAN_PROMPT`.

- [ ] **Step 1: Write the failing test** (the all-null result MUST parse — RTDB landmine)

```ts
// functions/src/ai/__tests__/receipt-schema.test.ts
import { describe, it, expect } from "vitest"
import { receiptScanSchema } from "../receipt-schema.js"

describe("receiptScanSchema", () => {
  it("parses a full extraction", () => {
    const r = receiptScanSchema.safeParse({
      vendor: "Whole Foods", amount_cents: 4212, occurred_on: "2026-07-18",
      suggested_category: "Meals (business purpose)", business_purpose_hint: "team lunch",
      currency: "usd", confidence: "high", warnings: [],
    })
    expect(r.success).toBe(true)
  })
  it("parses an ALL-NULL result (unreadable photo) — RTDB null-leaf safety", () => {
    const r = receiptScanSchema.safeParse({
      vendor: null, amount_cents: null, occurred_on: null,
      suggested_category: null, business_purpose_hint: null, currency: null,
      confidence: "low", warnings: ["image too blurry to read"],
    })
    expect(r.success).toBe(true)
  })
  it("parses a result with fields OMITTED entirely (RTDB dropped the null leaves)", () => {
    const r = receiptScanSchema.safeParse({ confidence: "low", warnings: [] })
    expect(r.success).toBe(true)
  })
  it("rejects a bad date shape", () => {
    expect(receiptScanSchema.safeParse({ occurred_on: "07/18/2026", confidence: "low", warnings: [] }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run — Expected: FAIL**

Run: `npm --prefix functions run test -- src/ai/__tests__/receipt-schema.test.ts`

- [ ] **Step 3: Implement `receipt-schema.ts`**

```ts
// functions/src/ai/receipt-schema.ts
// Twin (functions-side) schema for the receipt_scan vision job. EVERY extracted
// field is .nullable().optional() — a blurry photo yields nulls, and RTDB drops
// null leaves on write, so consumers must tolerate missing fields (Phase-2 C1).
import { z } from "zod"

export const receiptScanSchema = z.object({
  vendor: z.string().nullable().optional(),
  amount_cents: z.number().int().nonnegative().nullable().optional(),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  suggested_category: z.string().nullable().optional(),
  business_purpose_hint: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  confidence: z.enum(["low", "medium", "high"]),
  warnings: z.array(z.string()),
})

export type ReceiptScanResult = z.infer<typeof receiptScanSchema>
```

- [ ] **Step 4: Implement `receipt-prompt.ts`**

```ts
// functions/src/ai/receipt-prompt.ts
export const RECEIPT_SCAN_PROMPT = `You are reading a photographed receipt for <name>, a strength-and-conditioning coach's bookkeeping. Extract, as strict structured output:
- vendor: the merchant/store name (or null if unreadable)
- amount_cents: the TOTAL paid, as an integer number of cents (e.g. $42.12 -> 4212). Prefer the grand total (incl. tax/tip). null if you cannot read it.
- occurred_on: the transaction date as YYYY-MM-DD (null if unreadable)
- suggested_category: the single BEST-matching expense category from the provided chart of accounts, copied verbatim, or null if none fits
- business_purpose_hint: a short (<= 12 words) plausible business purpose for a coaching business (e.g. "protein for athlete recovery testing"), or null
- currency: the ISO currency if shown (e.g. "usd"), else null
- confidence: "low" | "medium" | "high" — your overall confidence in the extraction
- warnings: array of short strings for anything unreadable or ambiguous

NEVER guess an amount or date you cannot actually read — return null and add a warning instead. Only choose a category from the provided list; never invent one. The chart of accounts and any notes follow.`
```

- [ ] **Step 5: Run — Expected: PASS**

Run: `npm --prefix functions run test -- src/ai/__tests__/receipt-schema.test.ts`

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/receipt-schema.ts functions/src/ai/receipt-prompt.ts functions/src/ai/__tests__/receipt-schema.test.ts
git commit -m "feat(bookkeeper): twin receipt_scan vision schema + prompt (all-null safe)"
```

---

### Task 8: `receipt_scan` job handler + dispatch + registries

**Files:**
- Create: `functions/src/receipt-scan.ts`
- Modify: `functions/src/index.ts` (new `onDocumentCreated` export)
- Modify: `functions/src/ai/types.ts` (`AiJobType` += `"receipt_scan"`)
- Modify: `lib/ai-jobs.ts` (`AiJobType` += `"receipt_scan"`)
- Modify: `hooks/use-ai-jobs-dock.tsx` (`AiJobKind` += `"receipt_scan"`)
- Test: `functions/src/__tests__/receipt-scan.test.ts`

**Interfaces:**
- Consumes: `callAgent` (with `images`), `receiptScanSchema`, `RECEIPT_SCAN_PROMPT`, `createJobProgressUpdater`, `createCancellationChecker`, `getSupabase`, `sharp`, `getStorage` (firebase-admin).
- Produces: `handleReceiptScan(jobId): Promise<void>`; exported pure `resizeReceiptForVision(buffer): Promise<{ data: string; media_type: "image/jpeg" }>`.

**Job input shape** (written by the upload route, Task 11):
```ts
{ storagePath: string, mimeType: string, accounts: {name,account_type}[], bookName: string, bookKind: "business"|"household", documentId: string, logId?: string, requestedBy: string }
```
**Result shape written to Firestore + RTDB:** `{ result: ReceiptScanResult }` (all fields coalesced `?? null` before write so RTDB has explicit keys where possible; the dialog also re-coalesces).

- [ ] **Step 1: Write the failing test** (pure resize + the all-null coalesce)

```ts
// functions/src/__tests__/receipt-scan.test.ts
import { describe, it, expect } from "vitest"
import { resizeReceiptForVision, coalesceReceiptResult } from "../receipt-scan.js"

describe("resizeReceiptForVision", () => {
  it("produces a base64 jpeg under the vision size budget", async () => {
    const sharp = (await import("sharp")).default
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 180, b: 160 } } }).jpeg().toBuffer()
    const out = await resizeReceiptForVision(big)
    expect(out.media_type).toBe("image/jpeg")
    expect(out.data.length).toBeGreaterThan(0)
    // decoded bytes well under Anthropic's 5MB limit
    expect(Buffer.from(out.data, "base64").length).toBeLessThan(5 * 1024 * 1024)
  })
})

describe("coalesceReceiptResult", () => {
  it("fills missing/null fields (RTDB-dropped) with null and warnings []", () => {
    expect(coalesceReceiptResult({ confidence: "low" } as never)).toEqual({
      vendor: null, amount_cents: null, occurred_on: null, suggested_category: null,
      business_purpose_hint: null, currency: null, confidence: "low", warnings: [],
    })
  })
})
```

- [ ] **Step 2: Run — Expected: FAIL**

Run: `npm --prefix functions run test -- src/__tests__/receipt-scan.test.ts`

- [ ] **Step 3: Implement `functions/src/receipt-scan.ts`** (mirror `statement-import.ts` orchestration; download+resize+vision)

```ts
import { getFirestore, FieldValue, type DocumentReference } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { getStorage } from "firebase-admin/storage"
import sharp from "sharp"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { receiptScanSchema, type ReceiptScanResult } from "./ai/receipt-schema.js"
import { RECEIPT_SCAN_PROMPT } from "./ai/receipt-prompt.js"
import { createJobProgressUpdater, createCancellationChecker } from "./ai/shared-helpers.js"
import { getSupabase } from "./lib/supabase.js"

export interface ReceiptScanAccount { name: string; account_type: "income" | "expense" }
export interface ReceiptScanJobInput {
  storagePath: string; mimeType: string; accounts: ReceiptScanAccount[]
  bookName: string; bookKind: "business" | "household"; documentId: string
  logId?: string; requestedBy: string
}

/** Auto-orient (EXIF), downscale to <=1568px longest edge, re-encode JPEG.
 *  Guarantees the vision payload is under Anthropic's size/5MB limits. */
export async function resizeReceiptForVision(buffer: Buffer): Promise<{ data: string; media_type: "image/jpeg" }> {
  const out = await sharp(buffer)
    .rotate()
    .resize(1568, 1568, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
  return { data: out.toString("base64"), media_type: "image/jpeg" }
}

/** Coalesce every field (RTDB drops null leaves) so downstream always sees a full object. */
export function coalesceReceiptResult(r: Partial<ReceiptScanResult> | null | undefined): ReceiptScanResult {
  return {
    vendor: r?.vendor ?? null,
    amount_cents: r?.amount_cents ?? null,
    occurred_on: r?.occurred_on ?? null,
    suggested_category: r?.suggested_category ?? null,
    business_purpose_hint: r?.business_purpose_hint ?? null,
    currency: r?.currency ?? null,
    confidence: r?.confidence ?? "low",
    warnings: Array.isArray(r?.warnings) ? r!.warnings : [],
  }
}

async function updateRtdb(jobId: string, data: Record<string, unknown>) {
  try { await getDatabase().ref(`ai_jobs/${jobId}`).update({ ...data, updatedAt: Date.now() }) }
  catch (e) { console.warn(`[receipt-scan] RTDB update failed:`, e) }
}
async function markLogCancelled(logId: string | undefined) {
  if (!logId) return
  try { await getSupabase().from("ai_generation_log").update({ status: "cancelled" }).eq("id", logId) }
  catch (e) { console.warn(`[receipt-scan] mark log cancelled failed:`, e) }
}
function renderAccounts(accounts: ReceiptScanAccount[]): string {
  const expense = accounts.filter((a) => a.account_type === "expense").map((a) => a.name)
  return `## Expense categories\n${expense.length ? expense.join(", ") : "(none)"}`
}

export async function handleReceiptScan(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef: DocumentReference = db.collection("ai_jobs").doc(jobId)
  const snap = await jobRef.get()
  if (!snap.exists) { console.error(`[receipt-scan] Job ${jobId} not found`); return }
  const job = snap.data()!
  if (job.status !== "pending") { console.log(`[receipt-scan] Job ${jobId} already ${job.status}`); return }
  const fresh = await jobRef.get()
  if (fresh.data()?.status === "cancelled") return
  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })
  await updateRtdb(jobId, { status: "processing" })
  const input = job.input as ReceiptScanJobInput

  try {
    const checkCancelled = createCancellationChecker(jobId)
    const updateProgress = createJobProgressUpdater(jobId, 2)

    await updateProgress("extracting", 1)
    if (await checkCancelled()) { await markLogCancelled(input.logId); await updateRtdb(jobId, { status: "cancelled" }); return }

    const bucketName = process.env.FIREBASE_PRIVATE_BUCKET
    if (!bucketName) throw new Error("FIREBASE_PRIVATE_BUCKET not set")
    const [buffer] = await getStorage().bucket(bucketName).file(input.storagePath).download()
    const image = await resizeReceiptForVision(buffer)

    const userMessage = `${renderAccounts(input.accounts ?? [])}\n\nRead the attached receipt image and extract the fields.`
    const res = await callAgent<ReceiptScanResult>(
      RECEIPT_SCAN_PROMPT.replace("<name>", input.bookName),
      userMessage,
      receiptScanSchema,
      { model: MODEL_SONNET, images: [image] },
    )
    const result = coalesceReceiptResult(res.content)

    await updateProgress("finalizing", 2)

    // back-fill the document + complete the log
    const supabase = getSupabase()
    await supabase.from("bookkeeping_documents")
      .update({ period_start: result.occurred_on, period_end: result.occurred_on, row_count: 1 })
      .eq("id", input.documentId)
    if (input.logId) {
      await supabase.from("ai_generation_log").update({
        status: "completed",
        output_summary: { vendor: result.vendor, amount_cents: result.amount_cents, occurred_on: result.occurred_on, confidence: result.confidence, warnings: result.warnings, document_id: input.documentId },
        tokens_used: res.tokens_used, completed_at: new Date().toISOString(),
      }).eq("id", input.logId)
    }

    await jobRef.update({ status: "completed", result, updatedAt: FieldValue.serverTimestamp() })
    await updateRtdb(jobId, { status: "completed", result })
    console.log(`[receipt-scan] Job ${jobId} completed — document ${input.documentId}`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error(`[receipt-scan] Job ${jobId} failed:`, msg)
    await jobRef.update({ status: "failed", error: msg, updatedAt: FieldValue.serverTimestamp() })
    await updateRtdb(jobId, { status: "failed", error: msg })
    if (input.logId) {
      try { await getSupabase().from("ai_generation_log").update({ status: "failed", error_message: msg }).eq("id", input.logId) }
      catch (e) { console.warn(`[receipt-scan] mark log failed failed:`, e) }
    }
  }
}
```

- [ ] **Step 4: Add the dispatch export in `functions/src/index.ts`** (next to `statementImport`):

```ts
export const receiptScan = onDocumentCreated(
  { document: "ai_jobs/{jobId}", timeoutSeconds: 540, memory: "1GiB", region: "us-central1", secrets: allSecrets },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "receipt_scan") return
    const { handleReceiptScan } = await import("./receipt-scan.js")
    await handleReceiptScan(event.params.jobId)
  },
)
```

- [ ] **Step 5: Extend the registries**

`functions/src/ai/types.ts` — add `| "receipt_scan"` to `AiJobType`.
`lib/ai-jobs.ts` — add `| "receipt_scan"` to `AiJobType`.
`hooks/use-ai-jobs-dock.tsx` — add `| "receipt_scan"` to `AiJobKind`.

- [ ] **Step 6: Run test + typecheck functions**

Run: `npm --prefix functions run test -- src/__tests__/receipt-scan.test.ts` — Expected: PASS.
Run: `npm --prefix functions run build` — Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add functions/src/receipt-scan.ts functions/src/index.ts functions/src/ai/types.ts lib/ai-jobs.ts hooks/use-ai-jobs-dock.tsx functions/src/__tests__/receipt-scan.test.ts
git commit -m "feat(bookkeeper): receipt_scan vision job (download+sharp-resize+callAgent) + dispatch + registries"
```

---

### Task 9: F3 — unit-test `reconcileControlTotals` + the 500-cap logic

**Files:**
- Modify: `functions/src/statement-import.ts` (export `reconcileControlTotals`; add exported `applyRowCap`)
- Test: `functions/src/__tests__/statement-reconcile.test.ts`

**Interfaces:**
- Produces (newly exported): `reconcileControlTotals(rows, controlTotals, warnings): void`; `applyRowCap(rows, warnings, truncatedIn): { rows; truncated }`.

- [ ] **Step 1: Export the helpers.** In `statement-import.ts`, add `export` to `function reconcileControlTotals(...)`. Extract the cap logic (currently inline at lines ~395-401) into:

```ts
export function applyRowCap(
  rows: StatementImportOutputRow[], warnings: string[], truncatedIn: boolean,
): { rows: StatementImportOutputRow[]; truncated: boolean } {
  let out = rows
  let truncated = truncatedIn
  if (out.length > MAX_STATEMENT_ROWS) { out = out.slice(0, MAX_STATEMENT_ROWS); truncated = true }
  if (out.length === MAX_STATEMENT_ROWS) warnings.push("hit the 500-row cap — statement may be truncated")
  return { rows: out, truncated }
}
```
Then replace the inline block in the pdf/csv_raw branch with:
```ts
    const capped = applyRowCap(rows, warnings, truncated)
    rows = capped.rows
    truncated = capped.truncated
```
(Keep behavior identical.)

- [ ] **Step 2: Write the test**

```ts
// functions/src/__tests__/statement-reconcile.test.ts
import { describe, it, expect } from "vitest"
import { reconcileControlTotals, applyRowCap, MAX_STATEMENT_ROWS, type StatementImportOutputRow } from "../statement-import.js"

const row = (o: Partial<StatementImportOutputRow>): StatementImportOutputRow => ({
  occurred_on: "2026-07-01", description: "x", amount_cents: 100, direction: "expense",
  suggested_category: null, is_transfer: false, confidence: "high", ...o,
})

describe("reconcileControlTotals", () => {
  it("warns 'completeness unverified' when all totals null", () => {
    const w: string[] = []; reconcileControlTotals([row({})], null, w)
    expect(w.some((s) => /completeness unverified/i.test(s))).toBe(true)
  })
  it("warns on a deposit-total mismatch beyond tolerance", () => {
    const w: string[] = []
    reconcileControlTotals([row({ direction: "income", amount_cents: 5000 })],
      { total_deposits_cents: 9999, total_withdrawals_cents: null, opening_balance_cents: null, closing_balance_cents: null }, w)
    expect(w.some((s) => /deposit total mismatch/i.test(s))).toBe(true)
  })
  it("no mismatch warning when sums agree within tolerance", () => {
    const w: string[] = []
    reconcileControlTotals([row({ direction: "expense", amount_cents: 5000 })],
      { total_deposits_cents: null, total_withdrawals_cents: 5050, opening_balance_cents: null, closing_balance_cents: null }, w)
    expect(w.some((s) => /mismatch/i.test(s))).toBe(false)
  })
})

describe("applyRowCap", () => {
  it("caps at MAX and flags truncation", () => {
    const many = Array.from({ length: MAX_STATEMENT_ROWS + 5 }, () => row({}))
    const w: string[] = []
    const res = applyRowCap(many, w, false)
    expect(res.rows).toHaveLength(MAX_STATEMENT_ROWS)
    expect(res.truncated).toBe(true)
    expect(w.some((s) => /500-row cap/i.test(s))).toBe(true)
  })
  it("leaves a small set untouched", () => {
    const w: string[] = []
    const res = applyRowCap([row({}), row({})], w, false)
    expect(res.rows).toHaveLength(2)
    expect(res.truncated).toBe(false)
    expect(w).toEqual([])
  })
})
```

- [ ] **Step 3: Run — Expected: PASS** (and confirm no statement regression)

Run: `npm --prefix functions run test -- src/__tests__/statement-reconcile.test.ts src/__tests__/program-from-excel.test.ts` — Expected: PASS (existing statement tests unaffected).
Run: `npm --prefix functions run build` — Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add functions/src/statement-import.ts functions/src/__tests__/statement-reconcile.test.ts
git commit -m "test(bookkeeper): F3 export+cover reconcileControlTotals + 500-cap (statement-import)"
```

---

### Task 10: Cash 2-tap route — `receipts/cash`

**Files:**
- Create: `app/api/admin/bookkeeping/receipts/cash/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/receipts-cash.test.ts`

**Interfaces:**
- Consumes: `receiptCashSchema`, `getAccount`, `assertAccountInBook`, `createEntry`, `businessPurposeMissing`, `recordAudit`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/app/api/admin/bookkeeping/receipts-cash.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  getAccount: vi.fn(), assertAccountInBook: vi.fn(), createEntry: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { getAccount, createEntry } from "@/lib/db/bookkeeping"
import { POST } from "@/app/api/admin/bookkeeping/receipts/cash/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const admin = { user: { id: UUID, role: "admin" } }
const body = (b: unknown) => ({ json: async () => b }) as never

beforeEach(() => { vi.clearAllMocks(); (auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin) })

it("403 when not admin", async () => {
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "client" } })
  const res = await POST(body({}))
  expect(res.status).toBe(403)
})

it("422 when a sensitive account has no business_purpose", async () => {
  ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID, book_id: UUID, account_type: "expense", requires_business_purpose: true })
  const res = await POST(body({ book_id: UUID, account_id: UUID, amount_cents: 1200, occurred_on: "2026-07-18" }))
  expect(res.status).toBe(422)
  expect(createEntry).not.toHaveBeenCalled()
})

it("posts a source=receipt expense entry", async () => {
  ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID, book_id: UUID, account_type: "expense", requires_business_purpose: false })
  ;(createEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID, memo: null })
  const res = await POST(body({ book_id: UUID, account_id: UUID, amount_cents: 1200, occurred_on: "2026-07-18", counterparty: "Gas Station" }))
  expect(res.status).toBe(201)
  const arg = (createEntry as ReturnType<typeof vi.fn>).mock.calls[0][0]
  expect(arg).toMatchObject({ source: "receipt", direction: "expense", source_ref: null, amount_cents: 1200 })
})
```

- [ ] **Step 2: Run — Expected: FAIL**

Run: `npm run test:run -- __tests__/app/api/admin/bookkeeping/receipts-cash.test.ts`

- [ ] **Step 3: Implement `route.ts`**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { receiptCashSchema } from "@/lib/validators/bookkeeping"
import { getAccount, assertAccountInBook, createEntry, type AccountScopeError } from "@/lib/db/bookkeeping"
import { businessPurposeMissing } from "@/lib/bookkeeping/receipts"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const parsed = receiptCashSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const d = parsed.data

    const account = await getAccount(d.account_id)
    if (!account || account.book_id !== d.book_id) return NextResponse.json({ error: "account not in book" }, { status: 409 })
    if (account.account_type !== "expense") return NextResponse.json({ error: "cash receipts must use an expense category" }, { status: 409 })
    if (businessPurposeMissing(account, d.business_purpose ?? null)) {
      return NextResponse.json({ error: "business_purpose required for this category" }, { status: 422 })
    }

    const entry = await createEntry({
      book_id: d.book_id, account_id: d.account_id, direction: "expense",
      amount_cents: d.amount_cents, currency: "usd", occurred_on: d.occurred_on,
      memo: d.memo ?? null, business_purpose: d.business_purpose ?? null,
      counterparty: d.counterparty ?? null,
      source: "receipt", source_ref: null, import_batch_id: null, document_id: null,
    })
    void recordAudit({
      action: "bookkeeping.receipt_cash_recorded", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_entry", id: entry.id, label: entry.memo ?? "" },
      metadata: { book_id: d.book_id, amount_cents: d.amount_cents }, request,
    })
    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    const code = (error as AccountScopeError)?.code
    if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
    if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: "account scope" }, { status: 409 })
    console.error("receipt cash error:", error)
    return NextResponse.json({ error: "Failed to record receipt" }, { status: 500 })
  }
}
```

> Note: `createEntry`'s input type is `Omit<BookkeepingLedgerEntry, "id"|"created_at"|"updated_at">`, which now includes `document_id` (Task 1) — pass `document_id: null`. Confirm `AccountScopeError` is exported from the DAL (Phase-2 M5 added it at line ~184); if it isn't exported, add `export` to the interface.

- [ ] **Step 4: Run — Expected: PASS**

Run: `npm run test:run -- __tests__/app/api/admin/bookkeeping/receipts-cash.test.ts`

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookkeeping/receipts/cash/route.ts __tests__/app/api/admin/bookkeeping/receipts-cash.test.ts
git commit -m "feat(bookkeeper): cash 2-tap receipt route (source=receipt, business-purpose 422 gate)"
```

---

### Task 11: Receipt upload route — `receipts/upload`

**Files:**
- Create: `app/api/admin/bookkeeping/receipts/upload/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/receipts-upload.test.ts`

**Interfaces:**
- Consumes: `createHash` (node:crypto), `randomUUID`, `findDocumentBySha256`, `storeStatementFile`, `createDocument`, `listAccounts`, `getBook`, `createGenerationLog`, `getAdminFirestore`, `getAdminRtdb`, `recordAudit`. Mirrors `statement-import/route.ts`.
- Produces: 202 `{ jobId, documentId, log_id, duplicateUploadHint }`; job doc `{ type:"receipt_scan", input: ReceiptScanJobInput }`.

- [ ] **Step 1: Write the failing test** (403 + happy path creates a receipt document + job)

```ts
// __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  findDocumentBySha256: vi.fn().mockResolvedValue(null),
  createDocument: vi.fn().mockResolvedValue({ id: "d1" }),
  listAccounts: vi.fn().mockResolvedValue([{ id: "a1", name: "Equipment", account_type: "expense", service_line: null }]),
  getBook: vi.fn().mockResolvedValue({ id: "b1", name: "Darren", book_kind: "business" }),
}))
vi.mock("@/lib/bookkeeping/documents", () => ({ storeStatementFile: vi.fn(), safeStatementName: (n: string) => n }))
vi.mock("@/lib/ai/generation-log", () => ({ createGenerationLog: vi.fn().mockResolvedValue({ id: "log1" }) }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ id: "job1", set: vi.fn() }) }) }),
  getAdminRtdb: () => ({ ref: () => ({ set: vi.fn() }) }),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { createDocument } from "@/lib/db/bookkeeping"
import { POST } from "@/app/api/admin/bookkeeping/receipts/upload/route"

const UUID = "11111111-2222-4333-8444-555555555555"
beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "admin" } })
  process.env.FIREBASE_PRIVATE_BUCKET = "bucket"
})

function form(fileBytes = "JPEGDATA", type = "image/jpeg", name = "r.jpg", bookId = UUID) {
  const fd = new FormData()
  fd.set("book_id", bookId)
  fd.set("file", new File([fileBytes], name, { type }))
  return { formData: async () => fd } as never
}

it("403 when not admin", async () => {
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "client" } })
  expect((await POST(form())).status).toBe(403)
})

it("rejects a non-image type", async () => {
  const res = await POST(form("x", "application/zip", "r.zip"))
  expect(res.status).toBe(400)
})

it("stores a receipt document + returns 202 with job ids", async () => {
  const res = await POST(form())
  expect(res.status).toBe(202)
  const json = await res.json()
  expect(json).toMatchObject({ jobId: "job1", documentId: "d1", log_id: "log1" })
  expect((createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ kind: "receipt" })
})
```

- [ ] **Step 2: Run — Expected: FAIL**

Run: `npm run test:run -- __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts`

- [ ] **Step 3: Implement `route.ts`** (clone `statement-import/route.ts`; swap type gate to images; job type `receipt_scan`)

```ts
import { NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { auth } from "@/lib/auth"
import { findDocumentBySha256, createDocument, listAccounts, getBook } from "@/lib/db/bookkeeping"
import { storeStatementFile, safeStatementName } from "@/lib/bookkeeping/documents"
import { createGenerationLog } from "@/lib/ai/generation-log"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { recordAudit } from "@/lib/audit/record"
import { FieldValue } from "firebase-admin/firestore"

const MAX_SIZE = 10 * 1024 * 1024
const ALLOWED = ["image/jpeg", "image/png", "image/webp"]

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    if (!process.env.FIREBASE_PRIVATE_BUCKET) return NextResponse.json({ error: "receipt storage not configured" }, { status: 500 })

    const fd = await request.formData()
    const bookId = String(fd.get("book_id") ?? "")
    if (!/^[0-9a-f-]{36}$/i.test(bookId)) return NextResponse.json({ error: "invalid book_id" }, { status: 400 })
    const file = fd.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 })
    const type = file.type
    const isImage = ALLOWED.includes(type) || /\.(jpe?g|png|webp)$/i.test(file.name)
    if (!isImage) return NextResponse.json({ error: "receipt must be a JPG, PNG, or WEBP image" }, { status: 400 })
    if (file.size === 0) return NextResponse.json({ error: "empty file" }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const sha256 = createHash("sha256").update(buffer).digest("hex")
    const dup = await findDocumentBySha256(bookId, sha256)

    const documentId = randomUUID()
    const storagePath = `bookkeeping/receipts/${bookId}/${documentId}/${safeStatementName(file.name)}`
    await storeStatementFile(storagePath, buffer, type || "image/jpeg")

    const uploadYear = new Date().getUTCFullYear()
    const doc = await createDocument({
      book_id: bookId, kind: "receipt", original_filename: file.name, storage_path: storagePath,
      mime_type: type || "image/jpeg", file_size_bytes: file.size, sha256,
      retain_until: `${uploadYear + 7}-12-31`, uploaded_by: session.user.id, row_count: 1,
    })

    const [accounts, book] = await Promise.all([listAccounts(bookId), getBook(bookId)])
    if (!book) return NextResponse.json({ error: "book not found" }, { status: 404 })
    const log = await createGenerationLog({
      user_id: session.user.id, generation_type: "receipt_scan", model_used: "sonnet",
      status: "pending", total_steps: 2, program_id: null,
      input_params: { source: "receipt_scan", document_id: doc.id },
    })

    const firestore = getAdminFirestore()
    const jobRef = firestore.collection("ai_jobs").doc()
    await jobRef.set({
      type: "receipt_scan", status: "pending",
      input: {
        storagePath, mimeType: type || "image/jpeg",
        accounts: accounts.map((a) => ({ name: a.name, account_type: a.account_type })),
        bookName: book.name, bookKind: book.book_kind, documentId: doc.id, logId: log.id, requestedBy: session.user.id,
      },
      result: null, error: null, userId: session.user.id,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
    await getAdminRtdb().ref(`ai_jobs/${jobRef.id}`).set({
      status: "pending", progress: { status: "queued", current_step: 0, total_steps: 2 },
      result: null, error: null, updatedAt: Date.now(),
    })

    void recordAudit({
      action: "bookkeeping.receipt_uploaded", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_document", id: doc.id }, metadata: { book_id: bookId, kind: "receipt" }, request,
    })
    return NextResponse.json({ jobId: jobRef.id, documentId: doc.id, log_id: log.id, duplicateUploadHint: dup ? dup.created_at : null }, { status: 202 })
  } catch (error) {
    console.error("receipt upload error:", error)
    return NextResponse.json({ error: "Failed to upload receipt" }, { status: 500 })
  }
}
```

> **Verify the real signatures before finalizing** (they differ subtly across the repo): `createGenerationLog` field names (`generation_type` vs `type`; the statement route uses whatever the real helper expects — copy that route's call verbatim and only change `generation_type`/`input_params`/`total_steps`), and whether `getBook` returns `book_kind`. Match `app/api/admin/bookkeeping/statement-import/route.ts` exactly for the log/firestore/rtdb triple-write; only the type gate, storage path, job `type`, and `input` shape differ.

- [ ] **Step 4: Run — Expected: PASS**

Run: `npm run test:run -- __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts`

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookkeeping/receipts/upload/route.ts __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts
git commit -m "feat(bookkeeper): receipt image upload route (private bucket + receipt_scan job)"
```

---

### Task 12: Receipt commit route — `receipts/commit`

**Files:**
- Create: `app/api/admin/bookkeeping/receipts/commit/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/receipts-commit.test.ts`

**Interfaces:**
- Consumes: `receiptCommitSchema`, `isValidReceiptCommitRef`, `businessPurposeMissing`, `getAccount`, `assertAccountInBook`, `insertReceiptEntry`, `updateDocumentRetainUntil`, `receiptRetainUntil`, `linkDocumentBatch`, `recordAudit`, `randomUUID`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/app/api/admin/bookkeeping/receipts-commit.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  getAccount: vi.fn(), assertAccountInBook: vi.fn(),
  insertReceiptEntry: vi.fn().mockResolvedValue({ inserted: 1, id: "e1" }),
  updateDocumentRetainUntil: vi.fn(), linkDocumentBatch: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
import { auth } from "@/lib/auth"
import { insertReceiptEntry } from "@/lib/db/bookkeeping"
import { POST } from "@/app/api/admin/bookkeeping/receipts/commit/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const body = (b: unknown) => ({ json: async () => b }) as never
beforeEach(() => { vi.clearAllMocks(); (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "admin" } }) })

it("rejects a mangled source_ref", async () => {
  const res = await POST(body({ book_id: UUID, document_id: UUID, account_id: UUID, amount_cents: 100, occurred_on: "2026-07-18", source_ref: "statement:deadbeef", business_purpose: "x" }))
  expect(res.status).toBe(400)
})

it("422 when sensitive account has no purpose", async () => {
  const { getAccount } = await import("@/lib/db/bookkeeping")
  ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID, book_id: UUID, account_type: "expense", requires_business_purpose: true })
  const res = await POST(body({ book_id: UUID, document_id: UUID, account_id: UUID, amount_cents: 100, occurred_on: "2026-07-18", source_ref: `receipt:${UUID}` }))
  expect(res.status).toBe(422)
})

it("posts the entry with document_id + business_purpose", async () => {
  const { getAccount } = await import("@/lib/db/bookkeeping")
  ;(getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID, book_id: UUID, account_type: "expense", requires_business_purpose: false })
  const res = await POST(body({ book_id: UUID, document_id: UUID, account_id: UUID, amount_cents: 4212, occurred_on: "2026-07-18", source_ref: `receipt:${UUID}`, business_purpose: "team lunch", counterparty: "Cafe" }))
  expect(res.status).toBe(200)
  expect((insertReceiptEntry as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ document_id: UUID, business_purpose: "team lunch", source_ref: `receipt:${UUID}` })
})
```

- [ ] **Step 2: Run — Expected: FAIL**

Run: `npm run test:run -- __tests__/app/api/admin/bookkeeping/receipts-commit.test.ts`

- [ ] **Step 3: Implement `route.ts`**

```ts
import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { auth } from "@/lib/auth"
import { receiptCommitSchema } from "@/lib/validators/bookkeeping"
import { isValidReceiptCommitRef, businessPurposeMissing, receiptRetainUntil } from "@/lib/bookkeeping/receipts"
import { getAccount, assertAccountInBook, insertReceiptEntry, updateDocumentRetainUntil, linkDocumentBatch, type AccountScopeError } from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const parsed = receiptCommitSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const d = parsed.data
    if (!isValidReceiptCommitRef(d.source_ref)) return NextResponse.json({ error: "invalid receipt source_ref" }, { status: 400 })

    if (d.account_id) {
      const account = await getAccount(d.account_id)
      if (!account || account.book_id !== d.book_id) return NextResponse.json({ error: "account not in book" }, { status: 409 })
      if (account.account_type !== "expense") return NextResponse.json({ error: "receipts must use an expense category" }, { status: 409 })
      if (businessPurposeMissing(account, d.business_purpose ?? null)) return NextResponse.json({ error: "business_purpose required for this category" }, { status: 422 })
    }

    const batchId = randomUUID()
    const { inserted } = await insertReceiptEntry({
      book_id: d.book_id, account_id: d.account_id ?? null, amount_cents: d.amount_cents,
      occurred_on: d.occurred_on, counterparty: d.counterparty ?? null,
      business_purpose: d.business_purpose ?? null, memo: d.memo ?? null,
      source_ref: d.source_ref, document_id: d.document_id, import_batch_id: batchId,
    })
    await updateDocumentRetainUntil(d.document_id, receiptRetainUntil(d.occurred_on))
    await linkDocumentBatch(d.document_id, d.book_id, batchId, inserted)

    void recordAudit({
      action: "bookkeeping.receipt_imported", category: "commerce", outcome: "success",
      target: { type: "bookkeeping_document", id: d.document_id },
      metadata: { book_id: d.book_id, inserted, import_batch_id: batchId }, request,
    })
    return NextResponse.json({ inserted, batchId })
  } catch (error) {
    const code = (error as AccountScopeError)?.code
    if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
    if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: "account scope" }, { status: 409 })
    console.error("receipt commit error:", error)
    return NextResponse.json({ error: "Failed to post receipt" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run — Expected: PASS**

Run: `npm run test:run -- __tests__/app/api/admin/bookkeeping/receipts-commit.test.ts`

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookkeeping/receipts/commit/route.ts __tests__/app/api/admin/bookkeeping/receipts-commit.test.ts
git commit -m "feat(bookkeeper): receipt commit route (document_id link + business-purpose gate + retain_until)"
```

---

### Task 13: Amazon routes — `receipts/amazon` + `receipts/amazon/commit`

**Files:**
- Create: `app/api/admin/bookkeeping/receipts/amazon/route.ts`
- Create: `app/api/admin/bookkeeping/receipts/amazon/commit/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/receipts-amazon.test.ts`

**Interfaces:**
- Consumes: `parseAmazonCsv`, `AMAZON_SOURCE_REF`, `insertAmazonEntries`, `assertAccountsInBook`, `linkDocumentBatch`, `amazonCommitSchema`, plus the same storage/log/firestore/rtdb triple-write as Task 11 (job `type:"statement_import"`, `kind:"csv_structured"`).
- Produces: upload 202 `{ jobId, documentId, log_id, refs: string[] }` (refs in input order for the dialog to zip by index); commit `{ inserted, batchId }`.

- [ ] **Step 1: Write the failing test** (upload parses + returns refs; commit rejects bad ref)

```ts
// __tests__/app/api/admin/bookkeeping/receipts-amazon.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  createDocument: vi.fn().mockResolvedValue({ id: "d1" }),
  listAccounts: vi.fn().mockResolvedValue([{ id: "a1", name: "Equipment", account_type: "expense", service_line: null }]),
  getBook: vi.fn().mockResolvedValue({ id: "b1", name: "Darren", book_kind: "business" }),
  findDocumentBySha256: vi.fn().mockResolvedValue(null),
  insertAmazonEntries: vi.fn().mockResolvedValue({ inserted: 1 }),
  assertAccountsInBook: vi.fn(), linkDocumentBatch: vi.fn(),
}))
vi.mock("@/lib/bookkeeping/documents", () => ({ storeStatementFile: vi.fn(), safeStatementName: (n: string) => n }))
vi.mock("@/lib/ai/generation-log", () => ({ createGenerationLog: vi.fn().mockResolvedValue({ id: "log1" }) }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ id: "job1", set: vi.fn() }) }) }),
  getAdminRtdb: () => ({ ref: () => ({ set: vi.fn() }) }),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { POST as UPLOAD } from "@/app/api/admin/bookkeeping/receipts/amazon/route"
import { POST as COMMIT } from "@/app/api/admin/bookkeeping/receipts/amazon/commit/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const body = (b: unknown) => ({ json: async () => b }) as never
beforeEach(() => { vi.clearAllMocks(); (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "admin" } }); process.env.FIREBASE_PRIVATE_BUCKET = "bucket" })

function form(csv: string) {
  const fd = new FormData(); fd.set("book_id", UUID); fd.set("file", new File([csv], "orders.csv", { type: "text/csv" })); return { formData: async () => fd } as never
}

it("upload parses Amazon rows and returns refs", async () => {
  const csv = "Order Date,Order ID,Title,Item Total\n2026-07-01,112-1,Bands,$24.99"
  const res = await UPLOAD(form(csv))
  expect(res.status).toBe(202)
  const json = await res.json()
  expect(json.refs).toEqual(["amazon:112-1:0"])
})

it("commit rejects a non-amazon ref", async () => {
  const res = await COMMIT(body({ book_id: UUID, document_id: UUID, entries: [{ direction: "expense", amount_cents: 100, occurred_on: "2026-07-01", memo: "x", counterparty: "Amazon", service_line: null, source: "receipt", source_ref: "receipt:xyz" }] }))
  expect(res.status).toBe(400)
})
```

- [ ] **Step 2: Run — Expected: FAIL**

Run: `npm run test:run -- __tests__/app/api/admin/bookkeeping/receipts-amazon.test.ts`

- [ ] **Step 3: Implement the upload route** (`amazon/route.ts`) — clone Task 11's triple-write, but parse CSV and emit a `statement_import` `csv_structured` job:

```ts
import { NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { auth } from "@/lib/auth"
import { findDocumentBySha256, createDocument, listAccounts, getBook } from "@/lib/db/bookkeeping"
import { storeStatementFile, safeStatementName } from "@/lib/bookkeeping/documents"
import { parseAmazonCsv } from "@/lib/bookkeeping/amazon-parse"
import { createGenerationLog } from "@/lib/ai/generation-log"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { recordAudit } from "@/lib/audit/record"
import { FieldValue } from "firebase-admin/firestore"

const MAX_SIZE = 10 * 1024 * 1024
const ROW_CAP = 500

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    if (!process.env.FIREBASE_PRIVATE_BUCKET) return NextResponse.json({ error: "receipt storage not configured" }, { status: 500 })
    const fd = await request.formData()
    const bookId = String(fd.get("book_id") ?? "")
    if (!/^[0-9a-f-]{36}$/i.test(bookId)) return NextResponse.json({ error: "invalid book_id" }, { status: 400 })
    const file = fd.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 })
    if (!(file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv"))) return NextResponse.json({ error: "Amazon export must be a CSV" }, { status: 400 })
    if (file.size === 0) return NextResponse.json({ error: "empty file" }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const text = buffer.toString("utf8")
    const { rows: allRows, warnings } = parseAmazonCsv(text)
    if (allRows.length === 0) return NextResponse.json({ error: warnings[0] ?? "No Amazon orders detected in the CSV." }, { status: 400 })
    const rows = allRows.slice(0, ROW_CAP)
    const uploadTruncated = allRows.length > ROW_CAP
    const uploadWarnings = [...warnings]
    if (uploadTruncated) uploadWarnings.push(`Only the first ${ROW_CAP} of ${allRows.length} order lines were imported.`)

    const sha256 = createHash("sha256").update(buffer).digest("hex")
    const dup = await findDocumentBySha256(bookId, sha256)
    const documentId = randomUUID()
    const storagePath = `bookkeeping/receipts/${bookId}/${documentId}/${safeStatementName(file.name)}`
    await storeStatementFile(storagePath, buffer, "text/csv")

    const uploadYear = new Date().getUTCFullYear()
    const doc = await createDocument({
      book_id: bookId, kind: "receipt", original_filename: file.name, storage_path: storagePath,
      mime_type: "text/csv", file_size_bytes: file.size, sha256,
      retain_until: `${uploadYear + 7}-12-31`, uploaded_by: session.user.id, row_count: rows.length,
    })

    const [accounts, book] = await Promise.all([listAccounts(bookId), getBook(bookId)])
    if (!book) return NextResponse.json({ error: "book not found" }, { status: 404 })
    const log = await createGenerationLog({
      user_id: session.user.id, generation_type: "statement_import", model_used: "sonnet",
      status: "pending", total_steps: 2, program_id: null,
      input_params: { source: "amazon_import", document_id: doc.id, kind: "csv_structured" },
    })

    const firestore = getAdminFirestore()
    const jobRef = firestore.collection("ai_jobs").doc()
    await jobRef.set({
      type: "statement_import", status: "pending",
      input: {
        kind: "csv_structured",
        rows: rows.map((r) => ({ ref: r.source_ref, occurred_on: r.occurred_on, description: r.description, amount_cents: r.amount_cents, direction: r.direction })),
        accounts: accounts.map((a) => ({ id: a.id, name: a.name, account_type: a.account_type, service_line: a.service_line })),
        bookName: book.name, bookKind: book.book_kind, documentId: doc.id, logId: log.id, requestedBy: session.user.id,
        uploadWarnings, uploadTruncated,
      },
      result: null, error: null, userId: session.user.id,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
    await getAdminRtdb().ref(`ai_jobs/${jobRef.id}`).set({
      status: "pending", progress: { status: "queued", current_step: 0, total_steps: 2 },
      result: null, error: null, updatedAt: Date.now(),
    })

    void recordAudit({ action: "bookkeeping.receipt_uploaded", category: "commerce", outcome: "success", target: { type: "bookkeeping_document", id: doc.id }, metadata: { book_id: bookId, kind: "amazon" }, request })
    return NextResponse.json({ jobId: jobRef.id, documentId: doc.id, log_id: log.id, refs: rows.map((r) => r.source_ref), duplicateUploadHint: dup ? dup.created_at : null }, { status: 202 })
  } catch (error) {
    console.error("amazon upload error:", error)
    return NextResponse.json({ error: "Failed to import Amazon CSV" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Implement the commit route** (`amazon/commit/route.ts`):

```ts
import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { auth } from "@/lib/auth"
import { amazonCommitSchema } from "@/lib/validators/bookkeeping"
import { AMAZON_SOURCE_REF } from "@/lib/bookkeeping/receipts"
import { insertAmazonEntries, assertAccountsInBook, linkDocumentBatch, type AccountScopeError } from "@/lib/db/bookkeeping"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    const parsed = amazonCommitSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { book_id, entries, document_id } = parsed.data
    if (entries.some((e) => !AMAZON_SOURCE_REF.test(e.source_ref))) return NextResponse.json({ error: "invalid amazon source_ref" }, { status: 400 })

    await assertAccountsInBook(book_id, entries.map((e) => ({ accountId: e.account_id ?? null, direction: e.direction })))
    const batchId = randomUUID()
    const { inserted } = await insertAmazonEntries(book_id, batchId, entries.map((e) => ({
      direction: e.direction, amount_cents: e.amount_cents, occurred_on: e.occurred_on,
      memo: e.memo, counterparty: e.counterparty, business_purpose: e.business_purpose ?? null,
      source_ref: e.source_ref, account_id: e.account_id ?? null,
    })))
    if (document_id) await linkDocumentBatch(document_id, book_id, batchId, inserted)

    void recordAudit({ action: "bookkeeping.receipt_imported", category: "commerce", outcome: "success", target: { type: "bookkeeping_book", id: book_id }, metadata: { requested: entries.length, inserted, import_batch_id: batchId, document_id, source: "amazon" }, request })
    return NextResponse.json({ inserted, batchId })
  } catch (error) {
    const code = (error as AccountScopeError)?.code
    if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
    if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: "account scope" }, { status: 409 })
    console.error("amazon commit error:", error)
    return NextResponse.json({ error: "Failed to import Amazon entries" }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run — Expected: PASS**

Run: `npm run test:run -- __tests__/app/api/admin/bookkeeping/receipts-amazon.test.ts`

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/bookkeeping/receipts/amazon __tests__/app/api/admin/bookkeeping/receipts-amazon.test.ts
git commit -m "feat(bookkeeper): Amazon CSV import routes (reuse statement job, amazon: refs, source=receipt)"
```

---

### Task 14: F1 — batch account-scope check on statement commit

**Files:**
- Modify: `app/api/admin/bookkeeping/statement-import/commit/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/statement-commit-scope.test.ts`

**Interfaces:**
- Consumes: `assertAccountsInBook` (Task 5).

- [ ] **Step 1: Write the failing test** (a cross-book account → 409)

```ts
// __tests__/app/api/admin/bookkeeping/statement-commit-scope.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  insertImportedEntries: vi.fn().mockResolvedValue({ inserted: 1 }),
  linkDocumentBatch: vi.fn(),
  assertAccountsInBook: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
import { auth } from "@/lib/auth"
import { assertAccountsInBook } from "@/lib/db/bookkeeping"
import { POST } from "@/app/api/admin/bookkeeping/statement-import/commit/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const SHA = "a".repeat(40)
const body = (b: unknown) => ({ json: async () => b }) as never
beforeEach(() => { vi.clearAllMocks(); (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: UUID, role: "admin" } }) })

it("409 when an account fails the batch scope check", async () => {
  ;(assertAccountsInBook as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("scope"), { code: "WRONG_BOOK" }))
  const res = await POST(body({ book_id: UUID, entries: [{ direction: "expense", amount_cents: 100, occurred_on: "2026-07-01", memo: "x", counterparty: null, service_line: null, source: "statement_import", source_ref: `statement:${SHA}`, account_id: UUID }] }))
  expect(res.status).toBe(409)
})
```

- [ ] **Step 2: Run — Expected: FAIL**

Run: `npm run test:run -- __tests__/app/api/admin/bookkeeping/statement-commit-scope.test.ts`

- [ ] **Step 3: Edit the commit route.** After the `source_ref` mangle guard and before `insertImportedEntries`, add:

```ts
    try {
      await assertAccountsInBook(book_id, entries.map((e) => ({ accountId: e.account_id ?? null, direction: e.direction })))
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
      if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: "account scope" }, { status: 409 })
      throw err
    }
```
Add `assertAccountsInBook` to the DAL import in this route.

- [ ] **Step 4: Run — Expected: PASS** (and re-run the existing statement-commit test if present to confirm no regression)

Run: `npm run test:run -- __tests__/app/api/admin/bookkeeping/statement-commit-scope.test.ts`

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookkeeping/statement-import/commit/route.ts __tests__/app/api/admin/bookkeeping/statement-commit-scope.test.ts
git commit -m "feat(bookkeeper): F1 batch account-scope check on statement commit"
```

---

### Task 15: Retention pruning cron (twin + `onSchedule` + health list)

**Files:**
- Create: `functions/src/lib/bookkeeping-retention.ts` (functions twin)
- Modify: `lib/db/bookkeeping.ts` (lib twin `pruneExpiredDocuments` + pure `isDocumentExpired`)
- Modify: `functions/src/index.ts` (new `bookkeepingRetentionCron` export)
- Modify: `lib/automation/automation-health-scanner.ts` (add to expected crons)
- Test: `__tests__/lib/bookkeeping/retention.test.ts` (pure predicate), `functions/src/lib/__tests__/bookkeeping-retention.test.ts` (twin prune w/ mocks)

**Interfaces:**
- Produces: `isDocumentExpired(retainUntil: string, today: string): boolean`; lib `pruneExpiredDocuments(today): Promise<{ deleted: number; ids: string[] }>`; functions `pruneExpiredDocuments(supabase, bucket, today): Promise<{ deleted: number; ids: string[] }>`.

- [ ] **Step 1: Write the pure predicate test**

```ts
// __tests__/lib/bookkeeping/retention.test.ts
import { describe, it, expect } from "vitest"
import { isDocumentExpired } from "@/lib/db/bookkeeping"

describe("isDocumentExpired", () => {
  it("expired strictly before today (date-string compare, tz-independent)", () => {
    expect(isDocumentExpired("2020-12-31", "2026-07-18")).toBe(true)
    expect(isDocumentExpired("2033-12-31", "2026-07-18")).toBe(false)
    expect(isDocumentExpired("2026-07-18", "2026-07-18")).toBe(false) // not past yet
  })
})
```

- [ ] **Step 2: Run — Expected: FAIL** → implement the predicate in `lib/db/bookkeeping.ts`:

```ts
export function isDocumentExpired(retainUntil: string, today: string): boolean {
  return retainUntil < today
}
```

- [ ] **Step 3: Implement the lib twin `pruneExpiredDocuments`** in `lib/db/bookkeeping.ts` (uses the app-side bucket helpers):

```ts
import { deleteStatementFile } from "@/lib/bookkeeping/documents"   // if not already imported

export async function pruneExpiredDocuments(today: string): Promise<{ deleted: number; ids: string[] }> {
  const rows = await fetchAllRows<{ id: string; storage_path: string }>((from, to) =>
    db().from("bookkeeping_documents").select("id, storage_path").lt("retain_until", today).range(from, to),
  )
  const ids: string[] = []
  for (const r of rows) {
    await deleteStatementFile(r.storage_path)                       // ignoreNotFound
    const { error } = await db().from("bookkeeping_documents").delete().eq("id", r.id)
    if (error) throw error
    ids.push(r.id)
  }
  return { deleted: ids.length, ids }
}
```
> Match the real `fetchAllRows` signature in this file (Phase-1 promoted it); if it takes a query builder instead of a `(from,to)` callback, adapt to the existing usage in `listPostedForDedupe`/`listDocuments`.

- [ ] **Step 4: Implement the functions twin** `functions/src/lib/bookkeeping-retention.ts`:

```ts
// Twin of lib/db/bookkeeping.ts:pruneExpiredDocuments — functions/ can't import lib/.
// Deletes the bucket object first (ignoreNotFound), then the row. ON DELETE SET NULL
// nulls any linked ledger entry's document_id (the entry survives).
import type { SupabaseClient } from "@supabase/supabase-js"

interface Bucket { file(path: string): { delete(opts: { ignoreNotFound: boolean }): Promise<unknown> } }

export async function pruneExpiredDocuments(
  supabase: SupabaseClient, bucket: Bucket, today: string,
): Promise<{ deleted: number; ids: string[] }> {
  const ids: string[] = []
  // paginate to dodge the 1000-row cap
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("bookkeeping_documents").select("id, storage_path").lt("retain_until", today).range(from, from + 999)
    if (error) throw error
    const batch = (data ?? []) as Array<{ id: string; storage_path: string }>
    for (const r of batch) {
      try { await bucket.file(r.storage_path).delete({ ignoreNotFound: true }) }
      catch (e) { console.warn(`[retention] object delete failed for ${r.storage_path}:`, e) }
      const { error: delErr } = await supabase.from("bookkeeping_documents").delete().eq("id", r.id)
      if (delErr) throw delErr
      ids.push(r.id)
    }
    if (batch.length < 1000) break
  }
  return { deleted: ids.length, ids }
}
```

- [ ] **Step 5: Write the functions twin test**

```ts
// functions/src/lib/__tests__/bookkeeping-retention.test.ts
import { describe, it, expect, vi } from "vitest"
import { pruneExpiredDocuments } from "../bookkeeping-retention.js"

function fakeSupabase(rows: Array<{ id: string; storage_path: string }>) {
  const del = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  return {
    _del: del,
    from: () => ({
      select: () => ({ lt: () => ({ range: async () => ({ data: rows, error: null }) }) }),
      delete: del,
    }),
  } as never
}

it("deletes object then row for each expired doc", async () => {
  const rows = [{ id: "d1", storage_path: "p1" }]
  const fileDelete = vi.fn().mockResolvedValue(undefined)
  const bucket = { file: () => ({ delete: fileDelete }) }
  const supabase = fakeSupabase(rows)
  const res = await pruneExpiredDocuments(supabase, bucket, "2026-07-18")
  expect(res.deleted).toBe(1)
  expect(fileDelete).toHaveBeenCalledWith({ ignoreNotFound: true })
})

it("swallows a missing-object error and still deletes the row", async () => {
  const bucket = { file: () => ({ delete: vi.fn().mockRejectedValue(new Error("not found")) }) }
  const res = await pruneExpiredDocuments(fakeSupabase([{ id: "d1", storage_path: "p1" }]), bucket, "2026-07-18")
  expect(res.deleted).toBe(1)
})
```
> The `range()` mock returns the same rows every call; the real loop breaks when `batch.length < 1000`, so a 1-row fixture terminates after one iteration. Keep fixtures < 1000 rows.

- [ ] **Step 6: Add the cron export** in `functions/src/index.ts` (model on `auditLogRetentionCron`):

```ts
export const bookkeepingRetentionCron = onSchedule(
  { schedule: "0 4 * * *", timeZone: "UTC", timeoutSeconds: 300, memory: "256MiB", region: "us-central1", secrets: allSecrets },
  async () => {
    const { getSupabase } = await import("./lib/supabase.js")
    const { logCronStart, logCronEnd } = await import("./lib/cron-runs.js")
    const { pruneExpiredDocuments } = await import("./lib/bookkeeping-retention.js")
    const { getStorage } = await import("firebase-admin/storage")
    const supabase = getSupabase()
    const { data: enabled } = await supabase.from("system_settings").select("value").eq("key", "cron_bookkeeping_retention_enabled").single()
    if (enabled?.value !== true) { console.log("[bookkeepingRetentionCron] disabled via flag, skipping"); return }
    const bucketName = process.env.FIREBASE_PRIVATE_BUCKET
    if (!bucketName) { console.warn("[bookkeepingRetentionCron] FIREBASE_PRIVATE_BUCKET not set, skipping"); return }
    const bucket = getStorage().bucket(bucketName)
    const today = new Date().toISOString().slice(0, 10)
    const runId = await logCronStart(supabase, "bookkeepingRetentionCron")
    try {
      const { deleted, ids } = await pruneExpiredDocuments(supabase, bucket, today)
      await logCronEnd(supabase, runId, "success", { deleted, ids: ids.slice(0, 50) })
      console.log(`[bookkeepingRetentionCron] pruned ${deleted} document(s) past retain_until`)
    } catch (err) {
      await logCronEnd(supabase, runId, "failed", { message: (err as Error).message })
      throw err
    }
  },
)
```
> Confirm `allSecrets` includes the Supabase + storage env; if `auditLogRetentionCron` uses a narrower `secrets` list, match that plus whatever `getStorage().bucket(FIREBASE_PRIVATE_BUCKET)` needs.

- [ ] **Step 7: Add to the health scanner expected list.** In `lib/automation/automation-health-scanner.ts`, add `bookkeepingRetentionCron` to the `EXPECTED_CRONS` list next to `auditLogRetentionCron` (copy the shape — `{ name, slaHours }` or whatever it uses; a daily cron ⇒ sla ~30h).

- [ ] **Step 8: Run tests + typecheck**

Run: `npm run test:run -- __tests__/lib/bookkeeping/retention.test.ts`
Run: `npm --prefix functions run test -- src/lib/__tests__/bookkeeping-retention.test.ts`
Run: `npm --prefix functions run build` — Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add lib/db/bookkeeping.ts functions/src/lib/bookkeeping-retention.ts functions/src/index.ts lib/automation/automation-health-scanner.ts __tests__/lib/bookkeeping/retention.test.ts functions/src/lib/__tests__/bookkeeping-retention.test.ts
git commit -m "feat(bookkeeper): retention pruning cron (flag-gated, twin pruneExpiredDocuments, ON DELETE SET NULL keeps entries)"
```

---

### Task 16: UI — cash + upload dialogs + `BooksClient` wiring

**Files:**
- Create: `components/admin/bookkeeping/ReceiptCashDialog.tsx` (clone `ManualEntryDialog.tsx`)
- Create: `components/admin/bookkeeping/ReceiptUploadDialog.tsx` (clone `StatementImportDialog.tsx` upload+poll shell, single-card review)
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (toolbar buttons + dialog mounts)

**Interfaces:**
- Consumes: `receipts/cash`, `receipts/upload`, `receipts/commit`; `accountRequiresBusinessPurpose`; dock `addJob({ kind:"receipt_scan" })`; `formatCents`, `formatOccurredOn`.

- [ ] **Step 1: `ReceiptCashDialog.tsx`** — clone `ManualEntryDialog.tsx`; then:
  - Restrict the account `<select>` to `accounts.filter(a => a.account_type === "expense")`.
  - Fix `direction = "expense"` (drop the income/expense toggle).
  - POST to `/api/admin/bookkeeping/receipts/cash` with `{ book_id, account_id, amount_cents, occurred_on, counterparty, business_purpose, memo }`.
  - Make the business-purpose field visually **required** when the selected account has `requires_business_purpose` (use `accountRequiresBusinessPurpose`): red asterisk + disable submit while blank. On a 422 response, surface the server error under the field.
  - `onSaved()` → `router.refresh()`.

- [ ] **Step 2: `ReceiptUploadDialog.tsx`** — clone `StatementImportDialog.tsx`'s `upload → processing → review → done` shell and RTDB polling (`onValue` on `ai_jobs/${jobId}`), but:
  - Upload accepts an image (`accept="image/jpeg,image/png,image/webp"`); POST FormData to `/api/admin/bookkeeping/receipts/upload`; on 202 `addJob({ jobId: data.jobId, kind: "receipt_scan", label: "Receipt scan" })` and subscribe.
  - **Review is a single card, not a grid.** On `completed`, read `snapshot.result` and coalesce every field `?? null` (RTDB drop safety — mirror `safeResultRows`): `{ vendor, amount_cents, occurred_on, suggested_category, business_purpose_hint, currency, confidence, warnings }`. Render:
    - the receipt image preview via a signed URL (GET `/api/admin/bookkeeping/documents/${documentId}/download` → `{ url }` → `<img src={url}>`),
    - editable inputs: counterparty (default `vendor ?? ""`), amount (dollars; convert to cents on submit), date (default `occurred_on ?? today`), category `<select>` (expense accounts; default = the account whose name case-insensitively equals `suggested_category`), business_purpose (default `business_purpose_hint ?? ""`),
    - a `warnings` banner + a low-`confidence` caution.
  - Business-purpose **required** (disable Post) when the selected account `requires_business_purpose`.
  - Post → POST `/api/admin/bookkeeping/receipts/commit` with `{ book_id, document_id: documentId, account_id, amount_cents, occurred_on, counterparty, business_purpose, memo:null, source_ref: "receipt:"+documentId }`; toast; `onSaved()`; close.
  - Cancel reuses the shared cancel route (as `StatementImportDialog` does).

- [ ] **Step 3: Wire `BooksClient.tsx`.** Add three toolbar buttons — **"Add cash receipt"**, **"Upload receipt"** — beside the existing import buttons, each toggling the new dialog's `open` state; mount `<ReceiptCashDialog>` and `<ReceiptUploadDialog>` with `bookId/bookKind/bookName/accounts/open/onOpenChange/onSaved={fetchEntries or router.refresh}` (mirror how `StatementImportDialog` is mounted). (The Amazon button is added in Task 17.)

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "ReceiptCashDialog|ReceiptUploadDialog|BooksClient" ` — Expected: no errors in these files.
Run: `npm run build` — Expected: production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/admin/bookkeeping/ReceiptCashDialog.tsx components/admin/bookkeeping/ReceiptUploadDialog.tsx components/admin/bookkeeping/BooksClient.tsx
git commit -m "feat(bookkeeper): receipt cash + photo-upload dialogs + BooksClient wiring"
```

---

### Task 17: UI — Amazon dialog + ledger receipt indicator + documents kind label

**Files:**
- Create: `components/admin/bookkeeping/AmazonImportDialog.tsx` (clone `StatementImportDialog.tsx` grid; zip refs by index; commit to `receipts/amazon/commit`)
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (Amazon toolbar button + mount)
- Modify: `components/admin/bookkeeping/LedgerTable.tsx` (📎 receipt indicator on `document_id` rows)
- Modify: `components/admin/bookkeeping/StatementsList.tsx` (a "Kind" label column: Statement / Receipt)
- Modify: `lib/db/bookkeeping.ts` (`listEntries` select must include `document_id`) + `types` for the ledger row shape used by `LedgerTable`

**Interfaces:**
- Consumes: upload 202 `{ jobId, documentId, refs }`; the shipped `statement_import` job result rows (input order); `receipts/amazon/commit`.

- [ ] **Step 1: `AmazonImportDialog.tsx`** — clone `StatementImportDialog.tsx`, but:
  - Upload accepts `.csv`; POST to `/api/admin/bookkeeping/receipts/amazon`; on 202 store `refs: string[]` from the response and `addJob({ kind:"receipt_scan", label:"Amazon import" })` (dock kind reused).
  - **No dedupe route call.** On job `completed`, take `result.rows` (statement output shape: `{occurred_on, description, amount_cents, direction, suggested_category, is_transfer, confidence}`), and **zip by index** to the stored refs: `rows.map((r, i) => ({ ...r, source_ref: refs[i], include: !r.is_transfer, accountId: resolveByName(r.suggested_category) }))`. (Order is guaranteed by the statement job — one output row per input row, input order.)
  - Reuse the statement review grid (checkbox / date / desc / amount / category `<select>` filtered to `expense`). Skip the income-caution / newCandidate / transfer-total banners (Amazon is all expenses).
  - Post → POST `/api/admin/bookkeeping/receipts/amazon/commit` with `{ book_id, document_id, entries: included.map(r => ({ direction:"expense", amount_cents, occurred_on, memo: r.description, counterparty:"Amazon", business_purpose:null, service_line:null, source:"receipt", source_ref: r.source_ref, account_id })) }`.

- [ ] **Step 2: Wire the Amazon button** in `BooksClient.tsx` ("Import Amazon" → mount `<AmazonImportDialog>`).

- [ ] **Step 3: Ledger receipt indicator.** In `lib/db/bookkeeping.ts` `listEntries`, ensure the `.select(...)` includes `document_id` (add it if the select is explicit). In `LedgerTable.tsx`, for a row with `document_id`, render a small 📎 button that GETs `/api/admin/bookkeeping/documents/${document_id}/download` and `window.open(url)`. Add `document_id: string | null` to the row type `LedgerTable` consumes.

- [ ] **Step 4: Documents kind label.** In `StatementsList.tsx`, add a "Kind" column rendering `doc.kind === "receipt" ? "Receipt" : "Statement"` so receipts are visible/downloadable/deletable in the existing list.

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "AmazonImportDialog|LedgerTable|StatementsList|BooksClient|bookkeeping\.ts" | grep -v __tests__` — Expected: no new errors.
Run: `npm run build` — Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add components/admin/bookkeeping/AmazonImportDialog.tsx components/admin/bookkeeping/BooksClient.tsx components/admin/bookkeeping/LedgerTable.tsx components/admin/bookkeeping/StatementsList.tsx lib/db/bookkeeping.ts
git commit -m "feat(bookkeeper): Amazon import dialog + ledger receipt indicator + documents kind label"
```

---

## Final verification (controller, after all tasks)

1. **Full suite** vs the known-red baseline: `npm run test:run` — confirm only the ~8-9 pre-existing reds; zero new. `npm --prefix functions run test` — functions green.
2. **Typecheck:** `npx tsc --noEmit` (prod source clean; test noise per `test_baseline_not_green`) and `npm --prefix functions run build` (exit 0).
3. **Production build:** `npm run build`.
4. **Live-DB money-path throwaway test** (then delete, never `__tests__/db/`): post a receipt entry with a `document_id` + `business_purpose` twice → second inserts 0 (source_ref idempotency); confirm the link + purpose persisted; clean up.
5. **Opus whole-branch review** (the SDD final pass) tracing one vision value job→RTDB→dialog→commit for the null-leaf landmine, one Amazon ref parse→job→zip→commit, and the retention delete order.
6. Update `JOURNAL.md` + memory. **Hold the push.**

## Self-review (author checklist — done)

- **Spec coverage:** cash 2-tap (T10/T16) · photo→vision→review→post (T6/T7/T8/T11/T12/T16) · business-purpose gate required-for-sensitive (T2/T4/T10/T12) · receipt↔ledger `document_id` (T1/T5/T12/T17) · retention cron (T15) · Amazon CSV (T3/T13/T17) · F1 (T14) · F2 (T5) · F3 (T9) · RTDB-null discipline (T7/T8/T16) · Gmail poller = spec-only (design §12, no task). ✅ every §.
- **Placeholder scan:** none — code shown in every code step; UI clone-tasks name the exact source component + exact diffs.
- **Type consistency:** `receiptSourceRef`/`RECEIPT_SOURCE_REF`/`isValidReceiptCommitRef` (T2) used verbatim in T12; `insertReceiptEntry` return `{inserted,id}` (T5) consumed in T12; `linkDocumentBatch(id, bookId, batch, count)` (T5) used in T12/T13/updated in T5-Step3; `ReceiptScanJobInput` (T8) matches the upload job `input` (T11); `refs` 202 field (T13) consumed in T17.
