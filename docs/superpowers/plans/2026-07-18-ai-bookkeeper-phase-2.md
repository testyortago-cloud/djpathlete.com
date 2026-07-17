# AI Bookkeeper Phase 2 — Statement Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the coach upload a Venmo/bank statement (CSV or PDF) into a book, have AI categorize each line, fuzzy-flag likely duplicates (expense-first; income pre-excluded), and review + post the rest into the Phase-1 ledger.

**Architecture:** Deterministic CSV parse (papaparse) owns dollar amounts for the common case; an AI job (Firestore `ai_jobs` → Firebase Function, mirroring `program_from_excel`) categorizes and structures PDF/odd-CSV text. `source_ref` + all three dedupe passes run **server-side in the dedupe route** over the full row set (pure `lib/` functions, no `functions/` twin). Posted rows use `source:"statement_import"` + a stable `source_ref` deduped by the existing `UNIQUE(book_id,source,source_ref)`. Reuses Phase-1's review-and-post model.

**Tech Stack:** Next.js 16 App Router (route handlers self-gate `auth()`→403), Supabase (service-role DAL), Firebase (Firestore `ai_jobs` + RTDB progress + private GCS bucket), Anthropic via functions-side `callAgent` (raw tool_use), Zod v4, Vitest, papaparse, pdf-parse.

**Spec:** `docs/superpowers/specs/2026-07-18-ai-bookkeeper-phase-2-design.md` (read it — every §ref below points there).

## Global Constraints

- **Self-gate every route:** `const s = await auth(); if (!s?.user?.id || s.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })`. NEVER `requireAdmin()` in an API route (returns a redirect). `auth` from `@/lib/auth`.
- **Money is integer cents** (`amount_cents`), never float. Parse cents by string-split on the decimal point.
- **Paginate every growth-table read** via `fetchAllRows` from `@/lib/db/paginate` (PostgREST caps `.select()` at ~1000 rows).
- **`occurred_on` is date-only, tz-independent** — slice first 10 chars of an ISO string (`isoDate` convention); never `new Date()`-local math.
- **functions/ cannot import lib/** — twin-copy schema/prompt into `functions/src/ai/`, `.js`-suffixed relative imports. functions-side `callAgent` uses raw SDK tool_use (no `jsonTool`).
- **No feature flag** (admin-only, reviewed, reversible; per D10 + `no_default_feature_flags`).
- **Financial files → `getPrivateBucket()` only**, signed URLs; never `storage.rules` public prefixes.
- **Tests:** pure logic → `__tests__/lib/**` zero-mock; routes → `vi.mock('@/lib/db/bookkeeping')` (+ storage/job helpers), import handler AFTER mocks, `Request as never`, async `params` Promise. NEVER add anything under `__tests__/db/` (hits prod). RFC-4122 UUIDs in fixtures (Zod v4 strict).
- **Migrations** applied to prod via `mcp__supabase__apply_migration` (CLI not linked). Migration file lives in `supabase/migrations/`.
- **Design system:** semantic color + font classes only; `formatCents` for every amount; no hardcoded hex.
- **Commit after each task.** Do NOT push (owner holds the push). Do NOT stage `JOURNAL.md` (gitignored). Only stage files this branch owns — the working tree has unrelated pre-existing dirty files (pr-detection, render-worker) that must NOT be committed.

---

## File Structure

**New:**
- `supabase/migrations/00185_bookkeeping_documents.sql`
- `lib/bookkeeping/statement-parse.ts` + `__tests__/lib/bookkeeping/statement-parse.test.ts`
- `lib/bookkeeping/statement-dedupe.ts` + `__tests__/lib/bookkeeping/statement-dedupe.test.ts`
- `lib/bookkeeping/documents.ts` + `__tests__/lib/bookkeeping/documents.test.ts`
- `lib/bookkeeping/format.ts` (extracted `formatOccurredOn`)
- `functions/src/ai/statement-schema.ts`, `functions/src/ai/statement-prompt.ts`
- `functions/src/statement-import.ts`
- `app/api/admin/bookkeeping/statement-import/route.ts` + `dedupe/route.ts` + `commit/route.ts`
- `app/api/admin/bookkeeping/documents/route.ts` + `[id]/route.ts` + `[id]/download/route.ts`
- Route tests under `__tests__/api/admin/bookkeeping/…`
- `components/admin/bookkeeping/StatementImportDialog.tsx`
- `components/admin/bookkeeping/StatementsList.tsx`

**Modified:**
- `types/database.ts` (BookkeepingDocument + NewDocument)
- `lib/db/bookkeeping.ts` (documents CRUD, getEntry, listPostedForDedupe, assertAccountInBook, findDocumentBySha256, linkDocumentBatch, M3, M6)
- `lib/bookkeeping/income-adapter.ts` (M3)
- `lib/validators/bookkeeping.ts` (statementDedupeSchema, statementCommitSchema)
- `lib/audit/actions.ts` (4 slugs)
- `lib/ai-jobs.ts` + `functions/src/ai/types.ts` (AiJobType += statement_import)
- `functions/src/index.ts` (onDocumentCreated dispatch)
- `hooks/use-ai-jobs-dock.tsx` (AiJobKind += statement_import)
- `app/api/admin/bookkeeping/entries/route.ts` (M4), `entries/[id]/route.ts` (M5)
- `components/admin/bookkeeping/ImportPlatformDialog.tsx`, `LedgerTable.tsx` (use shared `formatOccurredOn`)
- `components/admin/bookkeeping/BooksClient.tsx` (Import statement button)
- `components/admin/bookkeeping/AccountsManager.tsx` + `app/(admin)/admin/books/accounts/page.tsx` (documents list)
- `package.json` (papaparse, @types/papaparse)

---

## Task 1: Dependencies, migration, and document types

**Files:**
- Modify: `package.json` (add `papaparse`, `@types/papaparse`)
- Create: `supabase/migrations/00185_bookkeeping_documents.sql`
- Modify: `types/database.ts` (after `BookkeepingLedgerEntry`, ~line 574)

**Interfaces produced:** `BookkeepingDocument`, `NewDocument` types; `bookkeeping_documents` table.

- [ ] **Step 1: Add papaparse**

Run: `npm install papaparse && npm install -D @types/papaparse`
Expected: both appear in `package.json` dependencies / devDependencies.

- [ ] **Step 2: Write the migration** — `supabase/migrations/00185_bookkeeping_documents.sql` (verbatim from spec §5):

```sql
-- 00185_bookkeeping_documents.sql
-- Phase 2: stored bank/Venmo statements (private-bucket path + retention + parse metadata).
create table bookkeeping_documents (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references bookkeeping_books(id) on delete cascade,
  kind text not null default 'statement' check (kind in ('statement','receipt')),
  original_filename text,
  storage_path text not null,
  mime_type text,
  file_size_bytes integer,
  sha256 text,
  retain_until date not null,
  uploaded_by uuid,
  import_batch_id uuid,
  row_count integer,
  posted_count integer,
  period_start date,
  period_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookkeeping_documents_book_created_idx on bookkeeping_documents (book_id, created_at desc);
create index bookkeeping_documents_sha_idx on bookkeeping_documents (book_id, sha256);
alter table bookkeeping_documents enable row level security;
create policy bookkeeping_documents_service_all on bookkeeping_documents for all using (true) with check (true);
```

- [ ] **Step 3: Add the types** to `types/database.ts` immediately after `BookkeepingLedgerEntry`:

```ts
export interface BookkeepingDocument {
  id: string
  book_id: string
  kind: "statement" | "receipt"
  original_filename: string | null
  storage_path: string
  mime_type: string | null
  file_size_bytes: number | null
  sha256: string | null
  retain_until: string
  uploaded_by: string | null
  import_batch_id: string | null
  row_count: number | null
  posted_count: number | null
  period_start: string | null
  period_end: string | null
  created_at: string
  updated_at: string
}
export type NewDocument = Pick<
  BookkeepingDocument,
  "book_id" | "kind" | "original_filename" | "storage_path" | "mime_type" | "file_size_bytes" | "sha256" | "retain_until" | "uploaded_by" | "row_count"
>
```

- [ ] **Step 4: Typecheck** — Run: `npx tsc --noEmit 2>&1 | grep -E "types/database|bookkeeping_documents"` — Expected: no NEW errors referencing these additions (repo has pre-existing test/.next tsc noise; only check our files are clean).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json supabase/migrations/00185_bookkeeping_documents.sql types/database.ts
git commit -m "feat(bookkeeper): add papaparse, 00185 documents migration + types"
```

> Migration is applied to prod in a dedicated step AFTER the branch is green (see the plan's closing "Migration apply" note) — not here.

---

## Task 2: Extract shared `formatOccurredOn`

**Files:**
- Create: `lib/bookkeeping/format.ts`
- Modify: `components/admin/bookkeeping/ImportPlatformDialog.tsx` (remove local `formatOccurredOn`, import shared), `components/admin/bookkeeping/LedgerTable.tsx` (same)
- Test: `__tests__/lib/bookkeeping/format.test.ts`

**Interfaces produced:** `formatOccurredOn(dateStr: string): string`

- [ ] **Step 1: Write the failing test** — `__tests__/lib/bookkeeping/format.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { formatOccurredOn } from "@/lib/bookkeeping/format"

describe("formatOccurredOn", () => {
  it("formats a YYYY-MM-DD date without UTC rollback", () => {
    expect(formatOccurredOn("2026-07-04")).toBe("Jul 4, 2026")
  })
  it("returns the input unchanged when malformed", () => {
    expect(formatOccurredOn("not-a-date")).toBe("not-a-date")
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run __tests__/lib/bookkeeping/format.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Create `lib/bookkeeping/format.ts`** (moved verbatim from ImportPlatformDialog.tsx:30-34):

```ts
/** occurred_on is a plain YYYY-MM-DD date (no time) — parse as local parts to
 *  avoid the UTC-midnight-rolls-back-a-day bug. Shared by ledger + import UIs. */
export function formatOccurredOn(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  if (!y || !m || !d) return dateStr
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
```

- [ ] **Step 4: Repoint call sites** — In `ImportPlatformDialog.tsx` and `LedgerTable.tsx`: delete the local `function formatOccurredOn(...)` definition and add `import { formatOccurredOn } from "@/lib/bookkeeping/format"`.

- [ ] **Step 5: Run tests** — Run: `npx vitest run __tests__/lib/bookkeeping/format.test.ts` — Expected: PASS. Then `npx tsc --noEmit 2>&1 | grep -E "ImportPlatformDialog|LedgerTable|format"` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/bookkeeping/format.ts __tests__/lib/bookkeeping/format.test.ts components/admin/bookkeeping/ImportPlatformDialog.tsx components/admin/bookkeeping/LedgerTable.tsx
git commit -m "refactor(bookkeeper): extract shared formatOccurredOn"
```

---

## Task 3: `statement-parse.ts` (pure) — parsing, columns, normalization, transfers, source_ref

**Files:**
- Create: `lib/bookkeeping/statement-parse.ts`
- Test: `__tests__/lib/bookkeeping/statement-parse.test.ts`

**Interfaces produced** (spec §6.1):
```ts
export interface NormalizedStatementRow { occurred_on: string; description: string; amount_cents: number; direction: "income" | "expense" }
export interface StatementColumnMap { date: number; description: number; amountMode: "signed" | "debit_credit"; amount?: number; debit?: number; credit?: number; signConvention?: "negative_is_expense" | "positive_is_expense" }
export function parseCsvStatement(text: string): { headers: string[]; rows: string[][] }
export function detectStatementColumns(headers: string[], rows: string[][]): StatementColumnMap | null
export function normalizeStatementRows(rows: string[][], map: StatementColumnMap): { rows: NormalizedStatementRow[]; warnings: string[] }
export function dropNonTransactionRows(rows: NormalizedStatementRow[]): { rows: NormalizedStatementRow[]; dropped: number }
export function transferSuspicion(row: NormalizedStatementRow): "hard" | "soft" | null
export function normalizeDescription(desc: string): string
export function parseAmountToCents(raw: string): { cents: number; negative: boolean } | null
export function parseStatementDate(raw: string): string | null   // → YYYY-MM-DD, tz-independent
export function computeStatementSourceRef(row: NormalizedStatementRow, occurrenceIndex: number): string
export function assignOccurrenceIndexes(rows: NormalizedStatementRow[]): number[]
```

- [ ] **Step 1: Write the failing tests** — `__tests__/lib/bookkeeping/statement-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  parseCsvStatement, detectStatementColumns, normalizeStatementRows, dropNonTransactionRows,
  transferSuspicion, parseAmountToCents, parseStatementDate, computeStatementSourceRef,
  assignOccurrenceIndexes, normalizeDescription,
} from "@/lib/bookkeeping/statement-parse"

describe("parseAmountToCents", () => {
  it("parses plain decimal to integer cents (no float drift)", () => {
    expect(parseAmountToCents("1234.56")).toEqual({ cents: 123456, negative: false })
    expect(parseAmountToCents("$1,234.56")).toEqual({ cents: 123456, negative: false })
  })
  it("treats parentheses and trailing minus as negative", () => {
    expect(parseAmountToCents("(1,234.56)")).toEqual({ cents: 123456, negative: true })
    expect(parseAmountToCents("1234.56-")).toEqual({ cents: 123456, negative: true })
  })
  it("parses CR/DR suffixes (CR = credit/inflow, DR = debit/outflow)", () => {
    expect(parseAmountToCents("500.00 CR")).toEqual({ cents: 50000, negative: false })
    expect(parseAmountToCents("500.00 DR")).toEqual({ cents: 50000, negative: true })
  })
  it("returns null for non-numeric", () => {
    expect(parseAmountToCents("")).toBeNull()
    expect(parseAmountToCents("abc")).toBeNull()
  })
})

describe("parseStatementDate", () => {
  it("parses common formats to YYYY-MM-DD", () => {
    expect(parseStatementDate("07/04/2026")).toBe("2026-07-04")
    expect(parseStatementDate("2026-07-04")).toBe("2026-07-04")
    expect(parseStatementDate("7/4/26")).toBe("2026-07-04")
  })
  it("slices an ISO datetime tz-independently (no local rollback)", () => {
    expect(parseStatementDate("2026-07-04T23:30:00-04:00")).toBe("2026-07-04")
  })
  it("returns null for garbage", () => { expect(parseStatementDate("nope")).toBeNull() })
})

describe("parseCsvStatement (quote-aware)", () => {
  it("keeps commas inside quoted fields", () => {
    const { headers, rows } = parseCsvStatement('Date,Description,Amount\n07/04/2026,"COFFEE, LLC",-5.00\n')
    expect(headers).toEqual(["Date", "Description", "Amount"])
    expect(rows[0]).toEqual(["07/04/2026", "COFFEE, LLC", "-5.00"])
  })
  it("keeps embedded newlines inside quoted fields", () => {
    const { rows } = parseCsvStatement('Date,Description,Amount\n07/04/2026,"line1\nline2",-5.00\n')
    expect(rows).toHaveLength(1)
    expect(rows[0][1]).toBe("line1\nline2")
  })
})

describe("detectStatementColumns", () => {
  it("maps a generic Date/Description/Amount signed layout", () => {
    const map = detectStatementColumns(["Date", "Description", "Amount"], [["07/04/2026", "COFFEE", "-5.00"]])
    expect(map).toMatchObject({ date: 0, description: 1, amountMode: "signed", amount: 2 })
  })
  it("maps a debit/credit-pair layout", () => {
    const map = detectStatementColumns(["Date", "Description", "Debit", "Credit"], [["07/04/2026", "COFFEE", "5.00", ""]])
    expect(map).toMatchObject({ date: 0, description: 1, amountMode: "debit_credit", debit: 2, credit: 3 })
  })
  it("maps the Venmo export", () => {
    const map = detectStatementColumns(["Datetime", "Type", "Note", "From", "To", "Amount (total)"], [["2026-07-04T10:00:00", "Payment", "lunch", "A", "B", "- $5.00"]])
    expect(map).not.toBeNull()
    expect(map!.amountMode).toBe("signed")
  })
  it("returns null when it cannot confidently find date+amount", () => {
    expect(detectStatementColumns(["foo", "bar"], [["1", "2"]])).toBeNull()
  })
})

describe("normalizeStatementRows", () => {
  it("signed: negative → expense, positive → income", () => {
    const map = { date: 0, description: 1, amountMode: "signed" as const, amount: 2, signConvention: "negative_is_expense" as const }
    const { rows } = normalizeStatementRows([["07/04/2026", "COFFEE", "-5.00"], ["07/05/2026", "REFUND", "5.00"]], map)
    expect(rows[0]).toEqual({ occurred_on: "2026-07-04", description: "COFFEE", amount_cents: 500, direction: "expense" })
    expect(rows[1].direction).toBe("income")
  })
  it("debit_credit: picks the non-zero column, treats 0.00/blank as absent", () => {
    const map = { date: 0, description: 1, amountMode: "debit_credit" as const, debit: 2, credit: 3 }
    const { rows } = normalizeStatementRows([["07/04/2026", "COFFEE", "5.00", "0.00"], ["07/05/2026", "PAY", "", "100.00"]], map)
    expect(rows[0]).toMatchObject({ amount_cents: 500, direction: "expense" })
    expect(rows[1]).toMatchObject({ amount_cents: 10000, direction: "income" })
  })
  it("debit_credit: both columns non-zero → warning, row skipped", () => {
    const map = { date: 0, description: 1, amountMode: "debit_credit" as const, debit: 2, credit: 3 }
    const { rows, warnings } = normalizeStatementRows([["07/04/2026", "AMBIG", "5.00", "5.00"]], map)
    expect(rows).toHaveLength(0)
    expect(warnings.length).toBeGreaterThan(0)
  })
  it("negative value inside the credit column is an income reversal (→ expense direction)", () => {
    const map = { date: 0, description: 1, amountMode: "debit_credit" as const, debit: 2, credit: 3 }
    const { rows } = normalizeStatementRows([["07/04/2026", "CHARGEBACK", "0.00", "(50.00)"]], map)
    expect(rows[0]).toMatchObject({ amount_cents: 5000, direction: "expense" })
  })
})

describe("dropNonTransactionRows", () => {
  it("drops balance/total/subtotal and zero-amount lines", () => {
    const rows = [
      { occurred_on: "2026-07-01", description: "Beginning Balance", amount_cents: 100000, direction: "income" as const },
      { occurred_on: "2026-07-02", description: "COFFEE", amount_cents: 500, direction: "expense" as const },
      { occurred_on: "2026-07-31", description: "Total Withdrawals", amount_cents: 432100, direction: "expense" as const },
      { occurred_on: "2026-07-02", description: "ZERO", amount_cents: 0, direction: "expense" as const },
    ]
    const { rows: kept, dropped } = dropNonTransactionRows(rows)
    expect(kept.map((r) => r.description)).toEqual(["COFFEE"])
    expect(dropped).toBe(3)
  })
})

describe("transferSuspicion", () => {
  it("hard-flags explicit transfer keywords", () => {
    expect(transferSuspicion({ occurred_on: "2026-07-04", description: "PAYMENT TO CREDIT CARD", amount_cents: 50000, direction: "expense" })).toBe("hard")
    expect(transferSuspicion({ occurred_on: "2026-07-04", description: "Online Transfer to Savings", amount_cents: 20000, direction: "expense" })).toBe("hard")
    expect(transferSuspicion({ occurred_on: "2026-07-04", description: "ATM Withdrawal", amount_cents: 10000, direction: "expense" })).toBe("hard")
  })
  it("soft-flags a round outbound to a person-like name with no merchant tokens", () => {
    expect(transferSuspicion({ occurred_on: "2026-07-04", description: "John Smith", amount_cents: 100000, direction: "expense" })).toBe("soft")
  })
  it("returns null for an ordinary merchant expense", () => {
    expect(transferSuspicion({ occurred_on: "2026-07-04", description: "STARBUCKS #123", amount_cents: 542, direction: "expense" })).toBeNull()
  })
})

describe("computeStatementSourceRef + assignOccurrenceIndexes", () => {
  const rowA = { occurred_on: "2026-07-04", description: "COFFEE", amount_cents: 500, direction: "expense" as const }
  it("is stable for the same input", () => {
    expect(computeStatementSourceRef(rowA, 0)).toBe(computeStatementSourceRef(rowA, 0))
    expect(computeStatementSourceRef(rowA, 0)).toMatch(/^statement:[0-9a-f]{40}$/)
  })
  it("distinguishes two identical same-day rows by occurrence index", () => {
    expect(computeStatementSourceRef(rowA, 0)).not.toBe(computeStatementSourceRef(rowA, 1))
  })
  it("assigns stable 0-based indexes per identical tuple over the full set", () => {
    const rows = [rowA, { ...rowA }, { occurred_on: "2026-07-05", description: "TEA", amount_cents: 300, direction: "expense" as const }]
    expect(assignOccurrenceIndexes(rows)).toEqual([0, 1, 0])
  })
  it("unchecking a subset does not change a row's ref (indexes computed over the full set)", () => {
    const full = [rowA, { ...rowA }]
    const idx = assignOccurrenceIndexes(full)
    const refFull1 = computeStatementSourceRef(full[1], idx[1])
    // simulate re-import of the full file → same indexes → same refs
    expect(computeStatementSourceRef(full[1], assignOccurrenceIndexes(full)[1])).toBe(refFull1)
  })
})

describe("normalizeDescription", () => {
  it("lowercases, collapses whitespace, strips volatile tokens", () => {
    expect(normalizeDescription("SQ *COFFEE   #0007  bal 1,234.56")).toBe("sq coffee")
  })
})
```

- [ ] **Step 2: Run to verify fail** — Run: `npx vitest run __tests__/lib/bookkeeping/statement-parse.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/bookkeeping/statement-parse.ts`.** Use `papaparse` for `parseCsvStatement` (`Papa.parse(text, { skipEmptyLines: true })` → `data as string[][]`, first row = headers). Implement helpers per the test contract:
  - `parseAmountToCents`: strip `$`, commas, spaces; detect `(...)`, trailing `-`, ` DR` → negative; ` CR` → positive; split on `.`; `cents = intPart*100 + fracPart(padded/truncated to 2)`; return null if no digits.
  - `parseStatementDate`: if matches `^\d{4}-\d{2}-\d{2}` → slice(0,10). If `M/D/YYYY` or `M/D/YY` → build `YYYY-MM-DD` with 2-digit pad and `20YY` for 2-digit years. Else null.
  - `detectStatementColumns`: lowercase headers; find date col (header includes `date`/`datetime` OR first col parses as a date), description col (`description`/`note`/`name`/`memo`/`details`), amount (`amount`/`amount (total)`) → signed; or a `debit`+`credit` pair → debit_credit. Return null if date or amount/(debit&credit) missing.
  - `normalizeStatementRows`: per row → `parseStatementDate`; signed → `parseAmountToCents(amount)`, direction from negativity + `signConvention`; debit_credit → pick the column whose parsed magnitude ≠ 0 (both non-zero → warn+skip; neither → skip); a negative parsed value flips the column's natural direction (credit=income flips to expense, debit=expense flips to income). Skip rows with null date/amount (collect a warning count is optional). Return `{ rows, warnings }`.
  - `dropNonTransactionRows`: drop when `amount_cents === 0` OR `normalizeDescription(description)` matches `/(beginning|ending) balance|^balance|subtotal|^total (deposits|withdrawals|credits|debits)|running balance/`.
  - `transferSuspicion`: hard if `normalizeDescription` matches a keyword set (`transfer|xfer|zelle|wire| ach |online transfer|to savings|to checking|credit card payment|cc payment|card payment|loan payment|owner draw|atm|cash withdrawal|payment - thank you|payment thank you`). Soft (expense only) if description is a person-like name (letters+space, ≤3 tokens, no digits, no merchant markers like `#`, `llc`, `inc`, `*`) OR amount is an exact multiple of $100 (`amount_cents % 10000 === 0`) with a sparse (≤2-token, no merchant marker) description. Else null.
  - `normalizeDescription`: `desc.toLowerCase().replace(/\*/g," ").replace(/#\S+/g," ").replace(/\bbal\b.*$/,"").replace(/\d[\d,]*\.\d{2}\b/g," ").replace(/\s+/g," ").trim()` (strip card `#tokens`, trailing balance, embedded money tokens).
  - `computeStatementSourceRef`: `` `statement:${createHash("sha1").update(`${r.occurred_on}|${r.amount_cents}|${r.direction}|${normalizeDescription(r.description)}|${occurrenceIndex}`).digest("hex")}` `` (`import { createHash } from "node:crypto"`).
  - `assignOccurrenceIndexes`: walk rows in input order, keying a `Map<tuple,count>` on `${occurred_on}|${amount_cents}|${direction}|${normalizeDescription(desc)}`, assign then increment.

- [ ] **Step 4: Run tests** — Run: `npx vitest run __tests__/lib/bookkeeping/statement-parse.test.ts` — Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/statement-parse.ts __tests__/lib/bookkeeping/statement-parse.test.ts
git commit -m "feat(bookkeeper): pure statement parser (papaparse, columns, transfers, source_ref)"
```

---

## Task 4: `statement-dedupe.ts` (pure) — the three-layer fuzzy flagger

**Files:**
- Create: `lib/bookkeeping/statement-dedupe.ts`
- Test: `__tests__/lib/bookkeeping/statement-dedupe.test.ts`

**Interfaces produced** (spec §6.2):
```ts
export interface PostedRef { id: string; occurred_on: string; amount_cents: number; direction: "income" | "expense"; memo: string | null; source: LedgerSource }
export interface DedupeInputRow extends NormalizedStatementRow { source_ref: string; is_transfer: boolean; suggested_category: string | null; confidence: "low" | "medium" | "high"; transferSuspect?: boolean }
export interface AnnotatedStatementRow { row: DedupeInputRow; possibleDuplicate: boolean; matchedEntry: { id: string; occurred_on: string; memo: string | null; source: LedgerSource } | null; reason: string | null; defaultInclude: boolean; newCandidate: boolean }
export function flagStatementDuplicates(rows: DedupeInputRow[], posted: PostedRef[], opts?: { windowDays?: number; feeTolerancePct?: number }): AnnotatedStatementRow[]
```
(Consumes `NormalizedStatementRow`, `normalizeDescription` from Task 3; `LedgerSource` from `@/types/database`.)

- [ ] **Step 1: Write the failing tests** — `__tests__/lib/bookkeeping/statement-dedupe.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { flagStatementDuplicates, type DedupeInputRow, type PostedRef } from "@/lib/bookkeeping/statement-dedupe"

const inc = (over: Partial<DedupeInputRow> = {}): DedupeInputRow => ({
  occurred_on: "2026-07-04", description: "Deposit", amount_cents: 5000, direction: "income",
  source_ref: "statement:" + "a".repeat(40), is_transfer: false, suggested_category: null, confidence: "high", ...over,
})
const exp = (over: Partial<DedupeInputRow> = {}): DedupeInputRow => ({ ...inc({ direction: "expense", description: "COFFEE" }), ...over })
const posted = (over: Partial<PostedRef> = {}): PostedRef => ({ id: "p1", occurred_on: "2026-07-04", amount_cents: 5000, direction: "income", memo: "Stripe", source: "platform_import", ...over })

describe("flagStatementDuplicates — income", () => {
  it("all income defaults to include=false", () => {
    const [r] = flagStatementDuplicates([inc()], [])
    expect(r.defaultInclude).toBe(false)
  })
  it("exact amount+date within window → possibleDuplicate", () => {
    const [r] = flagStatementDuplicates([inc()], [posted()])
    expect(r.possibleDuplicate).toBe(true)
    expect(r.matchedEntry?.id).toBe("p1")
  })
  it("income with no match is tagged newCandidate", () => {
    const [r] = flagStatementDuplicates([inc({ amount_cents: 9999 })], [posted()])
    expect(r.newCandidate).toBe(true)
    expect(r.possibleDuplicate).toBe(false)
  })
  it("aggregate-payout: income ≈ sum of platform income in window (within fee tolerance) is flagged", () => {
    const rows = [inc({ amount_cents: 9600 })] // ~= 10000 gross minus ~4% fees
    const p = [posted({ id: "a", amount_cents: 6000 }), posted({ id: "b", amount_cents: 4000 })]
    const [r] = flagStatementDuplicates(rows, p)
    expect(r.possibleDuplicate).toBe(true)
    expect(r.reason).toMatch(/payout/i)
  })
})

describe("flagStatementDuplicates — expense", () => {
  it("plain expense defaults to include=true", () => {
    const [r] = flagStatementDuplicates([exp()], [])
    expect(r.defaultInclude).toBe(true)
    expect(r.newCandidate).toBe(false)
  })
  it("cross-statement expense dup requires description similarity (same amount+date, different desc → NOT flagged)", () => {
    const p = [posted({ id: "e1", direction: "expense", amount_cents: 5000, memo: "TEA HOUSE", source: "statement_import" })]
    const [r] = flagStatementDuplicates([exp({ description: "COFFEE" })], p)
    expect(r.possibleDuplicate).toBe(false)
    expect(r.defaultInclude).toBe(true)
  })
  it("cross-statement expense dup with similar desc → flagged + pre-excluded", () => {
    const p = [posted({ id: "e1", direction: "expense", amount_cents: 5000, memo: "COFFEE", source: "statement_import" })]
    const [r] = flagStatementDuplicates([exp({ description: "COFFEE" })], p)
    expect(r.possibleDuplicate).toBe(true)
    expect(r.defaultInclude).toBe(false)
  })
  it("is_transfer expense → include=false", () => {
    const [r] = flagStatementDuplicates([exp({ is_transfer: true })], [])
    expect(r.defaultInclude).toBe(false)
    expect(r.reason).toMatch(/transfer/i)
  })
  it("transferSuspect expense → include=false, still marked postable", () => {
    const [r] = flagStatementDuplicates([exp({ transferSuspect: true })], [])
    expect(r.defaultInclude).toBe(false)
    expect(r.reason).toMatch(/possible transfer/i)
  })
})

describe("flagStatementDuplicates — ordering + consumption", () => {
  it("returns rows in input order", () => {
    const rows = [exp({ occurred_on: "2026-07-10", description: "B" }), exp({ occurred_on: "2026-07-01", description: "A" })]
    const out = flagStatementDuplicates(rows, [])
    expect(out.map((r) => r.row.description)).toEqual(["B", "A"])
  })
  it("a posted entry is consumed by at most one statement row", () => {
    const rows = [inc(), inc()]
    const out = flagStatementDuplicates(rows, [posted()])
    expect(out.filter((r) => r.possibleDuplicate)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify fail** — Run: `npx vitest run __tests__/lib/bookkeeping/statement-dedupe.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `lib/bookkeeping/statement-dedupe.ts`.** Import `normalizeDescription` + `NormalizedStatementRow` from `./statement-parse`, `LedgerSource` from `@/types/database`. Algorithm:
  - `windowDays = opts?.windowDays ?? 4`, `feeTolerancePct = opts?.feeTolerancePct ?? 4`.
  - Build a `consumed = new Set<string>()` of posted ids. Helper `dayDiff(a,b)` = abs difference in days from two `YYYY-MM-DD` (parse as `Date.UTC`).
  - Process rows sorted by `(occurred_on, inputIndex)` for matching, but **collect results indexed by input position and return in input order**.
  - For each row:
    - `is_transfer` → `{ possibleDuplicate:false, defaultInclude:false, reason:"internal transfer / card payment — excluded from P&L", newCandidate:false, matchedEntry:null }`.
    - else if `transferSuspect` → `{ defaultInclude:false, reason:"possible transfer — verify", possibleDuplicate:false, newCandidate:false }`.
    - **income:** find nearest unconsumed posted income with `amount_cents===row.amount_cents` and `dayDiff ≤ windowDays` → exact match (consume, reason `matches ${source} entry on ${occurred_on}`). Else aggregate-payout: sum posted `platform_import` income within `[occurred_on-windowDays, occurred_on]`; if `abs(sum - row.amount_cents) ≤ sum*feeTolerancePct/100` → flag (reason `probable Stripe payout of ${formatted sum}`). Else period-overlap: if any posted platform income exists within window → soft caution (reason `falls in a period with recorded platform income`). `possibleDuplicate` = true when exact or aggregate matched. `newCandidate` = true when NO reason at all. `defaultInclude = false` always for income.
    - **expense:** find nearest unconsumed posted `statement_import`/`manual` expense with equal amount, `dayDiff ≤ windowDays`, AND `normalizeDescription` similarity ≥ threshold (implement `similar(a,b)` = token Jaccard ≥ 0.5 OR one contains the other) → flag (consume, reason `matches a previously imported expense on ${occurred_on}`), `defaultInclude=false`. Else `defaultInclude=true`, `newCandidate=false`.
  - Return `AnnotatedStatementRow[]` in **input order**.

- [ ] **Step 4: Run tests** — Run: `npx vitest run __tests__/lib/bookkeeping/statement-dedupe.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/statement-dedupe.ts __tests__/lib/bookkeeping/statement-dedupe.test.ts
git commit -m "feat(bookkeeper): pure three-layer statement dedupe flagger"
```

---

## Task 5: DAL additions + M3/M6 in `lib/db/bookkeeping.ts`

**Files:**
- Modify: `lib/db/bookkeeping.ts`
- Modify: `lib/bookkeeping/income-adapter.ts` (M3 warning) + `__tests__/lib/bookkeeping/income-adapter.test.ts` (extend)

**Interfaces produced:** `getEntry`, `listPostedForDedupe`, `assertAccountInBook`, `createDocument`, `getDocument`, `findDocumentBySha256`, `listDocuments`, `linkDocumentBatch`, `deleteDocument`; `buildIncomeDrafts(input, window?)`.

- [ ] **Step 1: Add the document + helper DAL functions** to `lib/db/bookkeeping.ts` (append; import `BookkeepingDocument`, `NewDocument` from `@/types/database`, and `PostedRef` shape inline). Each read paginates via `fetchAllRows`.

```ts
// ── Documents + Phase-2 helpers ────────────────────────────────────────────
export async function getEntry(id: string): Promise<BookkeepingLedgerEntry | null> {
  const { data, error } = await db().from("bookkeeping_ledger_entries").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingLedgerEntry) ?? null
}

export interface AccountScopeError extends Error { code: "ACCOUNT_NOT_FOUND" | "WRONG_BOOK" | "WRONG_TYPE" }
export async function assertAccountInBook(accountId: string, bookId: string, direction: LedgerDirection): Promise<void> {
  const { data, error } = await db().from("bookkeeping_accounts").select("book_id,account_type").eq("id", accountId).maybeSingle()
  if (error) throw error
  const mk = (code: AccountScopeError["code"], msg: string) => Object.assign(new Error(msg), { code }) as AccountScopeError
  if (!data) throw mk("ACCOUNT_NOT_FOUND", "account not found")
  if ((data as { book_id: string }).book_id !== bookId) throw mk("WRONG_BOOK", "account belongs to a different book")
  if ((data as { account_type: string }).account_type !== direction) throw mk("WRONG_TYPE", "account type does not match entry direction")
}

export interface PostedRefRow { id: string; occurred_on: string; amount_cents: number; direction: LedgerDirection; memo: string | null; source: LedgerSource }
export async function listPostedForDedupe(bookId: string, from: string, to: string): Promise<PostedRefRow[]> {
  return fetchAllRows<PostedRefRow>((f, t) =>
    db().from("bookkeeping_ledger_entries")
      .select("id,occurred_on,amount_cents,direction,memo,source")
      .eq("book_id", bookId).gte("occurred_on", from).lte("occurred_on", to)
      .in("source", ["platform_import", "manual", "statement_import"])
      .range(f, t) as never)
}

export async function createDocument(input: NewDocument): Promise<BookkeepingDocument> {
  const { data, error } = await db().from("bookkeeping_documents").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingDocument
}
export async function getDocument(id: string): Promise<BookkeepingDocument | null> {
  const { data, error } = await db().from("bookkeeping_documents").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingDocument) ?? null
}
export async function findDocumentBySha256(bookId: string, sha256: string): Promise<BookkeepingDocument | null> {
  const { data, error } = await db().from("bookkeeping_documents").select("*").eq("book_id", bookId).eq("sha256", sha256)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return (data as BookkeepingDocument) ?? null
}
export async function listDocuments(bookId: string): Promise<BookkeepingDocument[]> {
  return fetchAllRows<BookkeepingDocument>((f, t) =>
    db().from("bookkeeping_documents").select("*").eq("book_id", bookId).order("created_at", { ascending: false }).range(f, t) as never)
}
export async function linkDocumentBatch(id: string, importBatchId: string, postedCount: number): Promise<void> {
  const { error } = await db().from("bookkeeping_documents").update({ import_batch_id: importBatchId, posted_count: postedCount, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) throw error
}
export async function deleteDocument(id: string): Promise<void> {
  const { error } = await db().from("bookkeeping_documents").delete().eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 2: M6 — add `.` to search escaping.** In `applyEntryFilters`, change `.replace(/[,()]/g, " ")` → `.replace(/[,().]/g, " ")`.

- [ ] **Step 3: M3 — date-filter memberships.** In `listPlatformIncome`, change the memberships read to bound by the window. `client_memberships` has `created_at` (verify column via `mcp__supabase__execute_sql` `select * from client_memberships limit 1` during implementation; use `created_at` unless a period column exists) — add `.gte("created_at", fromTs).lte("created_at", toTs)` before `.range(f, t)`.

- [ ] **Step 4: M3 — window-driven membership warning.** In `lib/bookkeeping/income-adapter.ts`, change `buildIncomeDrafts(input: IncomeSourceRows)` → `buildIncomeDrafts(input: IncomeSourceRows, window?: { from: string; to: string })`. Replace the per-membership warning loop with a single window-scoped warning:

```ts
const activeInWindow = input.memberships.filter((m) => MEMBERSHIP_ACTIVE.has(m.status))
if (activeInWindow.length > 0) {
  const w = window ? ` during ${window.from}…${window.to}` : ""
  warnings.push(
    `${activeInWindow.length} membership(s) were active${w}, but recurring membership revenue is not in the database ` +
    `(it lives in Stripe invoices) — import it via statement/payout ingestion (Phase 6).`,
  )
}
```
Update the caller `app/api/admin/bookkeeping/import-platform/route.ts` to pass `{ from, to }`: `buildIncomeDrafts(sources, { from, to })`.

- [ ] **Step 5: Extend the income-adapter test** — in `__tests__/lib/bookkeeping/income-adapter.test.ts`, add a case: two active memberships + a window → exactly ONE warning that includes the window dates and the count "2".

- [ ] **Step 6: Run tests + tsc** — Run: `npx vitest run __tests__/lib/bookkeeping/income-adapter.test.ts` (PASS) and `npx tsc --noEmit 2>&1 | grep -E "db/bookkeeping|income-adapter|import-platform"` (no new errors).

- [ ] **Step 7: Commit**

```bash
git add lib/db/bookkeeping.ts lib/bookkeeping/income-adapter.ts __tests__/lib/bookkeeping/income-adapter.test.ts app/api/admin/bookkeeping/import-platform/route.ts
git commit -m "feat(bookkeeper): document DAL + dedupe reads; M3 membership window; M6 escaping"
```

---

## Task 6: Validators + audit slugs + job-type registries + dock kind

**Files:**
- Modify: `lib/validators/bookkeeping.ts`, `lib/audit/actions.ts`, `lib/ai-jobs.ts`, `functions/src/ai/types.ts`, `hooks/use-ai-jobs-dock.tsx`

**Interfaces produced:** `statementDedupeSchema`, `statementCommitSchema`; audit slugs; `AiJobType`/`AiJobKind` extended.

- [ ] **Step 1: Add validators** to `lib/validators/bookkeeping.ts`:

```ts
export const statementDedupeSchema = z.object({
  book_id: z.string().uuid(),
  rows: z.array(z.object({
    occurred_on: DATE,
    amount_cents: z.number().int().nonnegative(),
    direction: z.enum(["income", "expense"]),
    description: z.string(),
    suggested_category: z.string().nullable(),
    is_transfer: z.boolean(),
    confidence: z.enum(["low", "medium", "high"]),
  })).max(500),
})

export const statementCommitSchema = importCommitSchema.extend({
  document_id: z.string().uuid().optional(),
})
```

- [ ] **Step 2: Add audit slugs** to `lib/audit/actions.ts` after line 241 (`bookkeeping.platform_income_imported`):

```ts
  { slug: "bookkeeping.statement_uploaded", category: "commerce", description: "Bank/Venmo statement uploaded" },
  { slug: "bookkeeping.statement_imported", category: "commerce", description: "Bank/Venmo statement posted to the ledger" },
  { slug: "bookkeeping.document_deleted", category: "commerce", description: "Bookkeeping document deleted" },
  { slug: "bookkeeping.document_downloaded", category: "admin_read_sensitive", description: "Bookkeeping document downloaded" },
```

- [ ] **Step 3: Extend `AiJobType`** — in `lib/ai-jobs.ts` add `| "statement_import"` to the union; in `functions/src/ai/types.ts` add `| "statement_import"`.

- [ ] **Step 4: Extend `AiJobKind`** — in `hooks/use-ai-jobs-dock.tsx` line 24: `export type AiJobKind = "full_program" | "week" | "day" | "excel_import" | "statement_import"`. Find the dock card component that switches on `kind` (grep `AiJobKind` / `kind ===`) and add a `statement_import` icon/label case (use `FileText` from lucide, label "Statement import") so the switch is exhaustive.

- [ ] **Step 5: Typecheck** — Run: `npx tsc --noEmit 2>&1 | grep -E "validators/bookkeeping|audit/actions|ai-jobs|use-ai-jobs-dock|functions/src/ai/types"` — Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/validators/bookkeeping.ts lib/audit/actions.ts lib/ai-jobs.ts functions/src/ai/types.ts hooks/use-ai-jobs-dock.tsx
git commit -m "feat(bookkeeper): statement validators, audit slugs, job-type + dock-kind registries"
```

---

## Task 7: Storage helper `lib/bookkeeping/documents.ts`

**Files:**
- Create: `lib/bookkeeping/documents.ts` + `__tests__/lib/bookkeeping/documents.test.ts` (tests `safeStatementName` only — the GCS fns need Firebase and are covered by route tests via mocks).

**Interfaces produced:** `safeStatementName`, `storeStatementFile`, `signStatementDownload`, `deleteStatementFile`.

- [ ] **Step 1: Failing test** — `__tests__/lib/bookkeeping/documents.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { safeStatementName } from "@/lib/bookkeeping/documents"
describe("safeStatementName", () => {
  it("strips unsafe chars and keeps the basename + extension", () => {
    expect(safeStatementName("../My Statement (July).csv")).toMatch(/^My_Statement__July_\.csv$/)
  })
  it("caps length", () => { expect(safeStatementName("a".repeat(300) + ".pdf").length).toBeLessThanOrEqual(120) })
})
```

- [ ] **Step 2: Run fail** — Run: `npx vitest run __tests__/lib/bookkeeping/documents.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `lib/bookkeeping/documents.ts`:**

```ts
import { getPrivateBucket } from "@/lib/firebase-admin"

export function safeStatementName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file"
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_")
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned
}
export async function storeStatementFile(path: string, buffer: Buffer, contentType: string): Promise<void> {
  await getPrivateBucket().file(path).save(buffer, { metadata: { contentType }, resumable: false })
}
export async function signStatementDownload(path: string, ttlSeconds = 300): Promise<string> {
  const [url] = await getPrivateBucket().file(path).getSignedUrl({ action: "read", expires: Date.now() + ttlSeconds * 1000 })
  return url
}
export async function deleteStatementFile(path: string): Promise<void> {
  await getPrivateBucket().file(path).delete({ ignoreNotFound: true })
}
```

- [ ] **Step 4: Run + commit** — Run: `npx vitest run __tests__/lib/bookkeeping/documents.test.ts` (PASS).

```bash
git add lib/bookkeeping/documents.ts __tests__/lib/bookkeeping/documents.test.ts
git commit -m "feat(bookkeeper): private-bucket statement storage helpers"
```

---

## Task 8: functions-side twin schema + prompt

**Files:**
- Create: `functions/src/ai/statement-schema.ts`, `functions/src/ai/statement-prompt.ts`
- Test: `functions/` has its own vitest? If not, add a lib-side parity test `__tests__/lib/bookkeeping/statement-schema-parity.test.ts` that re-declares the same Zod shape and asserts a valid/invalid sample (the functions/ file is validated by tsc + the handler). Prefer a direct import test if `functions/` test tooling exists (check `functions/package.json` scripts).

**Interfaces produced:** `statementImportSchema` (Zod), `StatementImportResult` type, `STATEMENT_IMPORT_PROMPT`.

- [ ] **Step 1: Write `functions/src/ai/statement-schema.ts`** (Zod v4; `.js`-free — this is a source file, imports use `.js` only for relative runtime imports, none needed here):

```ts
import { z } from "zod"

export const statementImportSchema = z.object({
  rows: z.array(z.object({
    ref: z.string().nullable(),
    occurred_on: z.string(),
    description: z.string(),
    amount_cents: z.number().int().nonnegative(),
    direction: z.enum(["income", "expense"]),
    is_transfer: z.boolean(),
    suggested_category: z.string().nullable(),
    confidence: z.enum(["low", "medium", "high"]),
  })),
  control_totals: z.object({
    total_deposits_cents: z.number().nullable(),
    total_withdrawals_cents: z.number().nullable(),
    opening_balance_cents: z.number().nullable(),
    closing_balance_cents: z.number().nullable(),
  }).nullable().optional(),
  warnings: z.array(z.string()),
  truncated: z.boolean(),
})
export type StatementImportResult = z.infer<typeof statementImportSchema>
```

- [ ] **Step 2: Write `functions/src/ai/statement-prompt.ts`** — `export const STATEMENT_IMPORT_PROMPT = \`...\`` instructing: you are categorizing/structuring a bank or Venmo statement for the book "<name>"; for `csv_structured` you are given rows with a `ref` — echo the `ref`, DO NOT change occurred_on/amount_cents/direction, only fill suggested_category (one of the provided account names or null), is_transfer, confidence; for pdf/csv_raw structure each transaction line into a row (skip balance/total/subtotal/header lines), emit amounts in integer cents, set is_transfer for internal transfers/credit-card & loan payments/owner draws/ATM/cash-outs, and populate control_totals from any stated totals (null if none). Never invent categories. (The full prompt text is authored here; keep it explicit and unambiguous per the "no placeholder" rule.)

- [ ] **Step 3: Parity test** — assert a representative valid object parses and an invalid one (missing `direction`) fails.

- [ ] **Step 4: Typecheck functions** — Run: `cd functions && npx tsc --noEmit` — Expected: clean (or only pre-existing unrelated errors).

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/statement-schema.ts functions/src/ai/statement-prompt.ts __tests__/lib/bookkeeping/statement-schema-parity.test.ts
git commit -m "feat(bookkeeper): functions-side statement AI schema + prompt (twin)"
```

---

## Task 9: functions handler + dispatch

**Files:**
- Create: `functions/src/statement-import.ts`
- Modify: `functions/src/index.ts` (new `onDocumentCreated` export)

**Interfaces produced:** `handleStatementImport(jobId: string): Promise<void>`; the `statementImport` export.

- [ ] **Step 1: Implement `functions/src/statement-import.ts`** mirroring `program-from-excel.ts`. Key logic:
  - `getFirestore()`, load job, guard `status==="pending"`, re-check cancelled, mark `processing` (Firestore + RTDB).
  - `const input = job.input` with `{ kind, rows?, rawText?, accounts, bookName, bookKind, documentId, logId, requestedBy }`.
  - `updateProgress = createJobProgressUpdater(jobId, kind === "csv_structured" ? 2 : 3)`; `checkCancelled`.
  - Build the AI user message: for `csv_structured`, render the account list + a JSON array of `{ref, occurred_on, description, amount_cents, direction}`; for pdf/csv_raw, the account list + `rawText`.
  - `await updateProgress("parsing", 1)` only for pdf/csv_raw; `await updateProgress("categorizing", kind==="csv_structured"?1:2)`.
  - `const res = await callAgent<StatementImportResult>(STATEMENT_IMPORT_PROMPT.replace("<name>", bookName), userMessage, statementImportSchema, { model: MODEL_SONNET, cacheSystemPrompt: true })`.
  - **csv_structured join:** map input rows by `ref`; for each input row, find the AI row with the same `ref`; take ONLY `suggested_category/is_transfer/confidence` from it (unknown ref ignored; missing → `suggested_category:null, is_transfer:false, confidence:"low"`); keep deterministic `occurred_on/amount_cents/direction/description`. This yields the final `rows[]`.
  - **pdf/csv_raw:** use the AI rows as-is (already structured). Apply `MAX_STATEMENT_ROWS=500` cap; if truncated or `res.content.truncated`, push a warning. Reconcile control_totals: if all-null → warning "completeness unverified — no statement totals found; review carefully"; if row count === 500 → warning "hit the 500-row cap — statement may be truncated"; if totals present and `abs(sum(deposits)-total_deposits) > 100` (or withdrawals) → warning.
  - Compute `period_start=min(occurred_on)`, `period_end=max(occurred_on)`, `row_count=rows.length`; write them to `bookkeeping_documents` via `getSupabase().from("bookkeeping_documents").update({ row_count, period_start, period_end }).eq("id", documentId)`.
  - Complete the `ai_generation_log` (status completed, output_summary `{ row_count, warnings, truncated, document_id }`, tokens_used).
  - Write result `{ rows, control_totals, warnings, truncated }` to Firestore (`status: completed`) + RTDB.
  - Error/cancel paths mirror program-from-excel (mark failed/cancelled in Firestore + RTDB + log).

- [ ] **Step 2: Add the dispatch export** to `functions/src/index.ts` (after `programFromExcel`):

```ts
export const statementImport = onDocumentCreated(
  { document: "ai_jobs/{jobId}", timeoutSeconds: 540, memory: "1GiB", region: "us-central1", secrets: allSecrets },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "statement_import") return
    const { handleStatementImport } = await import("./statement-import.js")
    await handleStatementImport(event.params.jobId)
  },
)
```

- [ ] **Step 3: Typecheck functions** — Run: `cd functions && npx tsc --noEmit` — Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add functions/src/statement-import.ts functions/src/index.ts
git commit -m "feat(bookkeeper): statement_import Firebase job handler + dispatch"
```

---

## Task 10: Upload route

**Files:**
- Create: `app/api/admin/bookkeeping/statement-import/route.ts`
- Test: `__tests__/api/admin/bookkeeping/statement-import.test.ts`

**Interfaces produced:** `POST /api/admin/bookkeeping/statement-import`.

- [ ] **Step 1: Failing route test** (mock DAL + storage + firebase-admin + parse). Test cases: 403 when not admin; 400 on missing file / bad type; 202 `{ jobId, documentId, log_id }` on a valid CSV; `duplicateUploadHint` present when `findDocumentBySha256` returns a row. Mock `@/lib/db/bookkeeping`, `@/lib/bookkeeping/documents`, `@/lib/db/ai-generation-log`, `@/lib/firebase-admin`. Import handler AFTER `vi.mock`s. Use `Request as never` with a `formData()` stub.

- [ ] **Step 2: Run fail.**

- [ ] **Step 3: Implement the route.** Sequence: self-gate 403 → `getPrivateBucket()` presence guard (try/catch around the later store; or check `process.env.FIREBASE_PRIVATE_BUCKET` → friendly 500 `"statement storage not configured"`) → `formData()` → file presence/type (`text/csv`|`.csv`|`application/pdf`)/size (`10*1024*1024`) → `buffer = Buffer.from(await file.arrayBuffer())` → `sha256 = createHash("sha256").update(buffer).digest("hex")` → `const dup = await findDocumentBySha256(bookId, sha256)` → parse:
  - CSV: `text = buffer.toString("utf8")`; `const { headers, rows } = parseCsvStatement(text)`; `const map = detectStatementColumns(headers, rows)`; if map → `const norm = dropNonTransactionRows(normalizeStatementRows(rows, map).rows).rows`; cap to 500 (`truncated = norm.length > 500`, slice); attach `ref: String(i)`; `kind="csv_structured"`, `rowsForJob=…`, `rowCount=norm.length`. If map null → `kind="csv_raw"`, `rawText=text.slice(0, 200_000)`, `rowCount=null`.
  - PDF: `const pdfParse = require("pdf-parse/lib/pdf-parse.js"); const { text } = await pdfParse(buffer)`; `kind="pdf"`, `rawText=text.slice(0, 200_000)`, `rowCount=null`.
  - `documentId = crypto.randomUUID()`; `storage_path = bookkeeping/statements/${bookId}/${documentId}/${safeStatementName(file.name)}` → `storeStatementFile`.
  - `retain_until = ${new Date().getUTCFullYear() + 7}-12-31` (upload-year basis).
  - `await createDocument({ book_id: bookId, kind: "statement", original_filename: file.name, storage_path, mime_type: file.type, file_size_bytes: file.size, sha256, retain_until, uploaded_by: session.user.id, row_count: rowCount })` — reuse `documentId`? `createDocument` returns a fresh id; instead store the file under the RETURNED doc id. **Order:** create the document row FIRST (row_count), get `doc.id`, THEN build the storage path with `doc.id` and `storeStatementFile`, THEN `linkDocument`? Simpler: generate `documentId` up front and pass it as the row id — but `NewDocument` omits id (DB default). To keep the path stable, create the row, read `doc.id`, build path from it, store the file, and update `storage_path`. Implement: `const doc = await createDocument({... storage_path: "pending", ...}); const path = \`bookkeeping/statements/${bookId}/${doc.id}/${safe}\`; await storeStatementFile(path, buffer, file.type); await linkDocumentStoragePath?` — to avoid a new DAL fn, set `storage_path` in a follow-up `db update`. **Chosen approach:** add a tiny `updateDocumentStoragePath(id, path)` to the DAL (Task 5 addendum) OR compute the path with a pre-generated uuid and insert it directly by extending `createDocument` to accept `storage_path`. Since `NewDocument` already includes `storage_path` (required, `not null`), generate `const documentId = crypto.randomUUID()` is NOT usable as the row id, so use `crypto.randomUUID()` as a path segment independent of the row id: `storage_path = bookkeeping/statements/${bookId}/${crypto.randomUUID()}/${safe}`. Store first, then `createDocument({... storage_path ...})`. This keeps one insert, no follow-up update.
  - `createGenerationLog({ program_id:null, client_id:null, requested_by: session.user.id, status:"pending", input_params:{ source:"statement_import", document_id: doc.id, kind }, output_summary:null, error_message:null, model_used:"sonnet", tokens_used:null, cache_creation_tokens:null, cache_read_tokens:null, duration_ms:null, completed_at:null, current_step:0, total_steps: kind==="csv_structured"?2:3 })`.
  - Firestore `ai_jobs` doc `.set({ type:"statement_import", status:"pending", input:{ kind, rows: rowsForJob, rawText, accounts, bookName, bookKind, documentId: doc.id, logId: log.id, requestedBy: session.user.id }, result:null, error:null, userId: session.user.id, createdAt/updatedAt: FieldValue.serverTimestamp() })`.
  - RTDB seed `{ status:"pending", progress:{ status:"queued", current_step:0, total_steps: kind==="csv_structured"?2:3 }, result:null, error:null, updatedAt: Date.now() }` (best-effort try/catch).
  - `accounts` = `await listAccounts(bookId)` mapped to `{ id, name, account_type, service_line }`; `bookName/bookKind` from `await getBook(bookId)`.
  - `void recordAudit({ action:"bookkeeping.statement_uploaded", category:"commerce", outcome:"success", target:{ type:"bookkeeping_document", id: doc.id }, metadata:{ book_id: bookId, kind }, request })`.
  - Return `202 { jobId: jobRef.id, documentId: doc.id, log_id: log.id, duplicateUploadHint: dup ? dup.created_at : null }`.

- [ ] **Step 4: Run tests + tsc.** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookkeeping/statement-import/route.ts __tests__/api/admin/bookkeeping/statement-import.test.ts
git commit -m "feat(bookkeeper): statement upload + parse + job-create route"
```

---

## Task 11: Dedupe route

**Files:**
- Create: `app/api/admin/bookkeeping/statement-import/dedupe/route.ts`
- Test: `__tests__/api/admin/bookkeeping/statement-import-dedupe.test.ts`

- [ ] **Step 1: Failing test** — 403 non-admin; empty `rows` → `{ rows: [], excludedTransferTotalCents: 0, documentOverlapWarning: null }` with NO DAL read; a row set with a matching posted income → the returned row is `possibleDuplicate` + `defaultInclude:false`; `excludedTransferTotalCents` sums excluded transfers; overlap warning present when a prior document's period overlaps. Mock `@/lib/db/bookkeeping` (`listPostedForDedupe`, `listDocuments`).

- [ ] **Step 2: Run fail.**

- [ ] **Step 3: Implement.** Self-gate 403 → `statementDedupeSchema.safeParse` (400 on fail). Then:
  - If `rows.length === 0` → return `{ rows: [], excludedTransferTotalCents: 0, documentOverlapWarning: null }`.
  - Compute `occurrenceIndexes = assignOccurrenceIndexes(rows)`; build `DedupeInputRow[]` = each row + `source_ref: computeStatementSourceRef(row, idx)` + `transferSuspect: transferSuspicion(row) === "soft"` + `is_transfer: row.is_transfer || transferSuspicion(row)==="hard"`.
  - `from = min(occurred_on) - windowDays`, `to = max(occurred_on) + windowDays` (windowDays 4; date math via UTC).
  - `const posted = await listPostedForDedupe(book_id, from, to)`.
  - `const annotated = flagStatementDuplicates(dedupeRows, posted, {})`.
  - `excludedTransferTotalCents` = sum of `annotated` rows where `row.is_transfer || row.transferSuspect` of `row.amount_cents`.
  - Overlap: `const docs = await listDocuments(book_id)`; `documentOverlapWarning` = a string if any doc with `period_start`/`period_end` overlaps `[min,max]` occurred_on (else null).
  - Return `{ rows: annotated, excludedTransferTotalCents, documentOverlapWarning }`.

- [ ] **Step 4: Run + commit.**

```bash
git add app/api/admin/bookkeeping/statement-import/dedupe/route.ts __tests__/api/admin/bookkeeping/statement-import-dedupe.test.ts
git commit -m "feat(bookkeeper): statement dedupe route (source_ref + 3-layer flags + overlap)"
```

---

## Task 12: Commit route

**Files:**
- Create: `app/api/admin/bookkeeping/statement-import/commit/route.ts`
- Test: `__tests__/api/admin/bookkeeping/statement-import-commit.test.ts`

- [ ] **Step 1: Failing test** — 403; a mangled `source_ref` (not `^statement:[0-9a-f]{40}$`) → 400; happy path calls `insertImportedEntries` + `linkDocumentBatch` and returns `{ inserted, batchId }`. Mock `@/lib/db/bookkeeping`.

- [ ] **Step 2: Run fail.**

- [ ] **Step 3: Implement.** Self-gate 403 → `statementCommitSchema.safeParse` (400 + issues). Reject if any entry has `source:"statement_import"` and `!/^statement:[0-9a-f]{40}$/.test(source_ref)` → 400 `"invalid statement source_ref"`. `const batchId = crypto.randomUUID()`; `const { inserted } = await insertImportedEntries(book_id, batchId, entries)`; if `document_id` → `await linkDocumentBatch(document_id, batchId, inserted)`. `void recordAudit({ action:"bookkeeping.statement_imported", category:"commerce", outcome:"success", target:{ type:"bookkeeping_book", id: book_id }, metadata:{ requested: entries.length, inserted, import_batch_id: batchId, document_id } , request })`. Return `{ inserted, batchId }`.

- [ ] **Step 4: Run + commit.**

```bash
git add app/api/admin/bookkeeping/statement-import/commit/route.ts __tests__/api/admin/bookkeeping/statement-import-commit.test.ts
git commit -m "feat(bookkeeper): statement commit route (source_ref guard + idempotent post)"
```

---

## Task 13: Documents routes (list / delete / download)

**Files:**
- Create: `app/api/admin/bookkeeping/documents/route.ts` (GET), `documents/[id]/route.ts` (DELETE), `documents/[id]/download/route.ts` (GET)
- Test: `__tests__/api/admin/bookkeeping/documents.test.ts`

- [ ] **Step 1: Failing tests** — 403 on each; GET requires `book_id` (400) then returns `{ documents }`; DELETE loads doc, calls `deleteStatementFile(doc.storage_path)` + `deleteDocument(id)`, audits `document_deleted`; download returns `{ url }` and audits `document_downloaded`. Mock DAL + `@/lib/bookkeeping/documents`.

- [ ] **Step 2: Run fail.**

- [ ] **Step 3: Implement all three** with self-gate + inline `recordAudit`. DELETE: `const doc = await getDocument(id); if (!doc) return 404; await deleteStatementFile(doc.storage_path); await deleteDocument(id)`. Download: `const doc = await getDocument(id); if (!doc) return 404; const url = await signStatementDownload(doc.storage_path); recordAudit(document_downloaded, admin_read_sensitive); return { url }`.

- [ ] **Step 4: Run + commit.**

```bash
git add app/api/admin/bookkeeping/documents __tests__/api/admin/bookkeeping/documents.test.ts
git commit -m "feat(bookkeeper): documents list/delete/download routes (D12 deletion path)"
```

---

## Task 14: M4 + M5 route hardening

**Files:**
- Modify: `app/api/admin/bookkeeping/entries/route.ts` (M4), `app/api/admin/bookkeeping/entries/[id]/route.ts` (M5)
- Test: `__tests__/api/admin/bookkeeping/entries-guards.test.ts`

- [ ] **Step 1: Failing tests** — GET `entries?direction=foo` → 400; `entries?source=bar` → 400; valid values still 200. PATCH `entries/[id]` with `account_id` whose account is in a different book → 409; wrong `account_type` vs effective direction → 409; missing entry → 404; valid → 200. Mock `@/lib/db/bookkeeping` (`getEntry`, `assertAccountInBook`, `updateEntry`, `listEntries`, `entryTotals`).

- [ ] **Step 2: Run fail.**

- [ ] **Step 3: Implement M4** — in `entries/route.ts` GET, replace the blind casts:

```ts
const dirRaw = sp.get("direction")
if (dirRaw !== null && dirRaw !== "income" && dirRaw !== "expense") return NextResponse.json({ error: "invalid direction" }, { status: 400 })
const srcRaw = sp.get("source")
const SOURCES = ["manual", "platform_import", "statement_import", "receipt"]
if (srcRaw !== null && !SOURCES.includes(srcRaw)) return NextResponse.json({ error: "invalid source" }, { status: 400 })
// then: direction: (dirRaw ?? undefined) as LedgerDirection | undefined, source: (srcRaw ?? undefined) as LedgerSource | undefined
```

- [ ] **Step 4: Implement M5** — in `entries/[id]/route.ts` PATCH, after parsing, before `updateEntry`:

```ts
if (parsed.data.account_id) {
  const entry = await getEntry(id)
  if (!entry) return NextResponse.json({ error: "entry not found" }, { status: 404 })
  const effectiveDirection = parsed.data.direction ?? entry.direction
  try {
    await assertAccountInBook(parsed.data.account_id, entry.book_id, effectiveDirection)
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "account not found" }, { status: 404 })
    if (code === "WRONG_BOOK" || code === "WRONG_TYPE") return NextResponse.json({ error: (e as Error).message }, { status: 409 })
    throw e
  }
}
```

- [ ] **Step 5: Run + commit.**

```bash
git add app/api/admin/bookkeeping/entries/route.ts app/api/admin/bookkeeping/entries/[id]/route.ts __tests__/api/admin/bookkeeping/entries-guards.test.ts
git commit -m "fix(bookkeeper): M4 enum-validate entries GET; M5 book-scope entries PATCH"
```

---

## Task 15: `StatementImportDialog` component

**Files:**
- Create: `components/admin/bookkeeping/StatementImportDialog.tsx`

**Interfaces produced:** `<StatementImportDialog bookId bookKind bookIsPrimary bookName accounts open onOpenChange onSaved />` (same prop shape as `ImportPlatformDialog`).

- [ ] **Step 1: Implement the component.** Compose two proven patterns:
  - **Upload + RTDB polling** — clone `ExcelImportDialog.tsx`'s structure (file input, `handleSubmit` → `POST /api/admin/bookkeeping/statement-import` FormData with `file` + `book_id`; on 202, `addJob({ jobId, kind:"statement_import", label:"Statement import" })` + `onValue(ref(rtdb, \`ai_jobs/${jobId}\`), …)`; `stopListening`; cancel via `POST /api/admin/programs/generate/cancel`). Map RTDB `progress.status` via a `STMT_STEPS` union `[{key:"parsing"},{key:"categorizing"},{key:"finalizing"}]`.
  - **On `status==="completed"`** — `safeRows(result.rows)` (rebuild against RTDB dropping empty arrays), then `POST /api/admin/bookkeeping/statement-import/dedupe` with `{ book_id, rows: result.rows.map(r => ({ occurred_on, amount_cents, direction, description, suggested_category, is_transfer, confidence })) }` → set `annotated`, `excludedTransferTotalCents`, `documentOverlapWarning`, `warnings` (from job result), and advance to `review`.
  - **Review grid** — clone `ImportPlatformDialog.tsx`'s review table + warnings banner + non-business gate. Row model `DraftRow = AnnotatedStatementRow.row + { include: boolean; accountId: string }` initialized `include = annotated.defaultInclude`, `accountId = resolveAccount(row.suggested_category)` (case-insensitive match against `accounts.filter(a=>a.account_type===row.direction)`, else `""`). Show badge/reason from the annotation; `confidence==="low"` styled; income `newCandidate` rows grouped under a "New — opt-in candidate" subheader, other income under the caution. Amount colored by direction (`+` success / `−` error). Category `<select>` filtered by `account_type===row.direction`.
  - **Banners:** the income caution; when `excludedTransferTotalCents>0` the card-import caution; `documentOverlapWarning`; and the job `warnings[]` (control-total / truncation) in the existing warnings banner.
  - **Post** — `POST /api/admin/bookkeeping/statement-import/commit` with `{ book_id, document_id, entries: includedRows.map(r => ({ direction, amount_cents, occurred_on, memo: r.description, counterparty: null, service_line: null, source: "statement_import", source_ref: r.source_ref, account_id: r.accountId || null })) }`; toast `Posted N (M already recorded — skipped)` where `skipped = included - inserted`; `onOpenChange(false)` + `onSaved()`.
  - **Zero-row completion** → the friendly "No transactions detected — scanned image PDF? OCR arrives in Phase 3" empty state.
  - **Reset-on-open** effect; disable Post when `posting || includedRows.length===0 || (isNonBusinessBook && !confirmNonBusiness)`.

- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit 2>&1 | grep StatementImportDialog` — Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/bookkeeping/StatementImportDialog.tsx
git commit -m "feat(bookkeeper): StatementImportDialog (upload → poll → dedupe review → post)"
```

---

## Task 16: Wire the dialog into BooksClient + Statements management

**Files:**
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (Import statement button + dialog)
- Create: `components/admin/bookkeeping/StatementsList.tsx`
- Modify: `components/admin/bookkeeping/AccountsManager.tsx` (+ `initialDocuments` prop + StatementsList), `app/(admin)/admin/books/accounts/page.tsx` (load documents)

- [ ] **Step 1: BooksClient** — add an "Import statement" button beside "Import platform income" (toolbar ~line 212-227), a `statementOpen` state, and render `<StatementImportDialog bookId={bookId} bookKind={selectedBook?.book_kind ?? "business"} bookIsPrimary={selectedBook?.is_primary ?? true} bookName={selectedBook?.name ?? ""} accounts={accounts} open={statementOpen} onOpenChange={setStatementOpen} onSaved={fetchEntries} />`.

- [ ] **Step 2: StatementsList component** — `<StatementsList bookId initialDocuments />`: renders a list of documents (filename, `formatOccurredOn(created_at.slice(0,10))`, `row_count`/`posted_count`, `retain_until`) with **Download** (`GET documents/[id]/download` → `window.open(url)`) and **Delete** (confirm → `DELETE documents/[id]` → drop locally). Book-change refetch via `GET /api/admin/bookkeeping/documents?book_id=` (skip first render). `EmptyState` when none.

- [ ] **Step 3: AccountsManager** — add `initialDocuments: BookkeepingDocument[]` prop; render `<StatementsList bookId={bookId} initialDocuments={initialDocuments} />` inside the `TabsContent`, under the chart-of-accounts grid (a "Statements" section heading). Refetch documents on `bookId` change alongside accounts (or let StatementsList own it — pass `key={bookId}` to remount).

- [ ] **Step 4: accounts page** — `const documents = primary ? await listDocuments(primary.id) : []`; pass `initialDocuments={documents}` to `<AccountsManager>`.

- [ ] **Step 5: Typecheck + commit.**

```bash
git add components/admin/bookkeeping/BooksClient.tsx components/admin/bookkeeping/StatementsList.tsx components/admin/bookkeeping/AccountsManager.tsx "app/(admin)/admin/books/accounts/page.tsx"
git commit -m "feat(bookkeeper): wire StatementImportDialog + statements management UI"
```

---

## Migration apply (after the branch is green)

Once all tasks pass and the full suite is green, apply migration `00185` to prod:
`mcp__supabase__apply_migration` with name `00185_bookkeeping_documents` and the SQL from Task 1. Then run the throwaway money-path live-DB test (spec §11): create a temp book, commit statement drafts twice, assert the second inserts 0, clean up, DELETE the test file. Never commit that test.

---

## Self-Review checklist (run after writing, before execution)

- **Spec coverage:** §4 source_ref (Task 3), §5 migration+types (Task 1), §6.1 parse (Task 3), §6.2 dedupe (Task 4), §6.3 DAL (Task 5), §6.4 storage (Task 7), §7 AI job (Tasks 8-9), §8 routes (Tasks 10-14), §8.1 audit (Task 6), §9 UI (Tasks 2,15,16), §10 M3-M7 (Tasks 5,6,14 + M7 = whole feature), §11 tests (each task), §12-13 guardrails (encoded in dialog copy Task 15). ✅ all mapped.
- **Type consistency:** `NormalizedStatementRow`, `DedupeInputRow`, `AnnotatedStatementRow`, `BookkeepingDocument`, `NewDocument`, `StatementImportResult` used identically across tasks.
- **No placeholders:** every code step has concrete code or an explicit algorithm with named functions/fields.
```
