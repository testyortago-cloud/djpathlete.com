# AI Bookkeeper — Phase 2 — Statement Import — Design

**Date:** 2026-07-18
**Phase:** 2 of 6 (see umbrella design `docs/superpowers/specs/2026-07-17-ai-bookkeeper-design.md` §3)
**Branch:** `feat/ai-bookkeeper-phase-2` (do NOT push until the owner says so)
**Status:** Design approved by owner ("lgtm", 2026-07-18). Two forks resolved by owner: **deterministic parse + AI-categorize** (code owns dollar amounts for the common CSV case) and **store statements + manual delete path now, retention-pruning cron deferred to Phase 3**.
**Builds on:** Phase 1 (SHIPPED, live on main) — the ledger spine: `lib/bookkeeping/*`, `lib/db/bookkeeping.ts`, `lib/validators/bookkeeping.ts`, `app/api/admin/bookkeeping/*`, `app/(admin)/admin/books/*`, `components/admin/bookkeeping/*`, migrations `00183`/`00184`.

---

## 1. Scope

Coach uploads a Venmo/bank statement (CSV or PDF) into a chosen book. The system:

1. **Parses** the file into normalized rows `{ occurred_on, description, amount_cents, direction }`.
2. **Categorizes** each row into that book's chart of accounts via an AI job.
3. **Fuzzy-dedupes** each income line against income already posted in the ledger (D6) so a Stripe payout that also shows up as a bank deposit is flagged, not double-counted.
4. Lets the coach **review + post** the rest, reusing Phase 1's review-and-post model.

Posted rows use `source:"statement_import"` and a **stable `source_ref`** so re-importing the same file dedupes via `UNIQUE(book_id, source, source_ref)`.

**This phase brings the first EXPENSE data into the ledger** (bank withdrawals, Venmo payments out). Phase 1's income adapter only produced income; the chart of accounts already has expense accounts waiting. This directly feeds the Phase 5 deduction finder.

### 1.1 Non-goals (explicitly out of Phase 2)

Receipts and vision (Phase 3), Gmail-label / Amazon-CSV intake (Phase 3), Stripe **payout ingestion + net revenue + real payout-vs-bank dedupe** (Phase 6 — v1 dedupe is fuzzy amount+date only, D6), the automated **retention-pruning cron** (Phase 3, ships with receipts), reports/exports/QuickBooks (Phase 4), monthly close/freeze (Phase 6), depreciation (Phase 6), ask-your-books chat tools (Phase 6). Statement import imports into **one selected book**; cross-book row routing is out of scope (upload the business bank statement into the business book, the personal card into the household book).

---

## 2. Inherited decision anchors

- **D6 — dedupe:** v1 = fuzzy `amount + date (± window)` matching a statement line against already-posted platform income, **flagged for the coach to confirm, never auto-dropped**. Real payout-level dedupe needs the Stripe payout subsystem → Phase 6.
- **D10 — flags:** none on read/review surfaces; DB-backed flags only on outward-emitting actions. Statement import reads/writes the internal ledger, is admin-only, reviewed, and reversible, and emits nothing outward → **no feature flag** (also per the `no_default_feature_flags` house rule). AI token spend is manual, one file at a time.
- **D12 — retention:** statements are among the most sensitive data the platform holds → **private bucket only** (`getPrivateBucket()`, signed-URL, never the world-writable `storage.rules` prefixes). A `bookkeeping_documents` row carries `retain_until` (upload year + 7). A **deletion path exists from day one**. Automated pruning cron is Phase 3.
- **Standing risk (D1):** book isolation is application-level only (RLS is decorative; all DALs are service-role). Every new DAL/route scopes `book_id`; the folded-in **M5** hardens the Phase-1 PATCH routes against cross-book account pointers.

---

## 3. End-to-end flow

```
Coach picks a book → "Import statement" → StatementImportDialog

1. UPLOAD   POST /api/admin/bookkeeping/statement-import   (multipart: file + book_id)
            ├─ auth()→403 · size cap (10 MB) · type gate (text/csv|.csv | application/pdf)
            ├─ CSV → parseCsvStatement (papaparse, quote-aware) → detectStatementColumns()
            │        confident → normalizeStatementRows()  → kind="csv_structured" (rows)
            │        unsure   → kind="csv_raw" (table text handed to the AI)
            ├─ PDF → pdf-parse text (app-side, capped)      → kind="pdf" (text handed to AI)
            ├─ store file → private bucket + bookkeeping_documents row (retain_until = yr+7, sha256)
            └─ create AI job (Firestore ai_jobs + Supabase log + RTDB seed) → 202 {jobId, documentId}

2. JOB      functions/ onDocumentCreated · guard data.type==="statement_import"
            ├─ csv_structured → AI CATEGORIZES only (never re-derives the numbers)
            ├─ pdf | csv_raw  → AI STRUCTURES + categorizes (emits rows from text)
            ├─ cap MAX_STATEMENT_ROWS · chunk categorization · WARN on truncation (never silent)
            └─ write {rows, warnings, truncated} → Firestore + RTDB

3. POLL     Dialog listens to RTDB (ExcelImportDialog pattern) → on complete → review

4. DEDUPE   POST /api/admin/bookkeeping/statement-import/dedupe   {book_id, rows}
            └─ reads posted ledger income for the span (paginated) → flagStatementDuplicates() (pure)
               → rows annotated {possibleDuplicate, matchedEntry, reason}

5. REVIEW   include checkbox (dupes pre-unchecked) · date · desc · amount · direction
            · category <select> (default = AI suggestion, resolved name→account_id)
            · dup badge + note · low-confidence highlight · warnings banner
            · non-business-book confirm gate                     (all reused from Phase 1)

6. POST     POST /api/admin/bookkeeping/statement-import/commit   {book_id, document_id, entries[]}
            └─ insertImportedEntries (source="statement_import", stable source_ref)
               → idempotent upsert on UNIQUE(book_id, source, source_ref)
               → link import_batch_id + posted_count back onto the document
               → audit bookkeeping.statement_imported
```

### 3.1 Two dedupe layers (do not conflate)

1. **Re-import dedupe (exact).** The `source_ref` UNIQUE means re-uploading the same file never double-posts statement rows. Handled by the existing `insertImportedEntries` upsert.
2. **Cross-source fuzzy dedupe (D6).** A bank deposit that corresponds to a Stripe payout already posted as `platform_import`. Amount + date-window match → **flag + pre-uncheck**, coach confirms. New pure matcher (§6).

---

## 4. `source_ref` design (stable dedupe key)

A statement line has no natural id. Compute a deterministic key so re-importing the same file dedupes while genuinely-distinct-but-identical charges both post:

```
source_ref = `statement:${sha1(`${occurred_on}|${amount_cents}|${direction}|${normalizedDescription}|${occurrenceIndex}`)}`
```

- `normalizedDescription` = lowercased, collapsed whitespace, trimmed.
- `occurrenceIndex` = the 0-based ordinal of this exact `(occurred_on, amount_cents, direction, normalizedDescription)` tuple **within this file** (stable sort → assign 0,1,2…). Two identical same-day $5 charges get indices 0 and 1 → two distinct refs → both post. Re-importing the same file reproduces the same indices → the UNIQUE dedupes.
- Documented edge: two different statement files with overlapping periods that list an identical tuple a different number of times can drift on the occurrence index; dedupe is best-effort and the coach reviews. Acceptable.
- `sha1` via `crypto` (Node built-in); pure helper `computeStatementSourceRef(row, occurrenceIndex)` in `lib/bookkeeping/statement-parse.ts`, unit-tested for stability.

---

## 5. Data model — migration `00185_bookkeeping_documents.sql`

The ledger already carries `source='statement_import'` (verified in `00183` line 50: `CHECK (source IN ('manual','platform_import','statement_import','receipt'))`) and `import_batch_id`, so **no ledger-table migration**. One new table:

```sql
create table bookkeeping_documents (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references bookkeeping_books(id) on delete cascade,
  kind text not null default 'statement' check (kind in ('statement','receipt')),  -- 'receipt' reserved for Phase 3
  original_filename text,
  storage_path text not null,          -- private-bucket object path
  mime_type text,
  file_size_bytes integer,
  sha256 text,                         -- integrity + "you already uploaded this file" hint
  retain_until date not null,          -- upload year + 7 (D12)
  uploaded_by uuid,
  import_batch_id uuid,                -- links to the posted ledger batch; null until committed
  row_count integer,
  posted_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookkeeping_documents_book_created_idx on bookkeeping_documents (book_id, created_at desc);
-- RLS enabled for ceremony; policies decorative (all DALs are service-role, D1).
```

Applied to prod via `mcp__supabase__apply_migration` (per `supabase_migrations_via_mcp`; CLI is not linked). Numbering confirmed next-available `00185`.

New `types/database.ts` type `BookkeepingDocument`.

---

## 6. Modules (new)

All pure modules are unit-tested in `__tests__/lib/**` with **zero mocks**.

### 6.1 `lib/bookkeeping/statement-parse.ts` (pure)

Add dependency **`papaparse`** (+ `@types/papaparse`), server-only. The hand-rolled `lib/csv-parser.ts` splits on newlines before handling quotes (landmine) and is left untouched — bank CSVs have quoted, comma- and newline-containing descriptions.

```ts
export interface NormalizedStatementRow {
  occurred_on: string          // YYYY-MM-DD
  description: string
  amount_cents: number         // magnitude (>= 0); direction carries sign
  direction: LedgerDirection   // "income" | "expense"
}
export interface StatementColumnMap {
  date: number
  description: number
  amountMode: "signed" | "debit_credit"
  amount?: number              // when amountMode === "signed"
  debit?: number; credit?: number  // when amountMode === "debit_credit"
  signConvention: "negative_is_expense" | "positive_is_expense"
}

export function parseCsvStatement(text: string): { headers: string[]; rows: string[][] }
export function detectStatementColumns(headers: string[], rows: string[][]): StatementColumnMap | null
export function normalizeStatementRows(rows: string[][], map: StatementColumnMap): NormalizedStatementRow[]
export function computeStatementSourceRef(row: NormalizedStatementRow, occurrenceIndex: number): string
export function assignOccurrenceIndexes(rows: NormalizedStatementRow[]): number[]  // stable, deterministic
```

- `detectStatementColumns` heuristics: find a date-like header/column, a description/note column, and **either** one signed amount column **or** a debit/credit pair. Recognizes the Venmo export layout (`Datetime`, `Type`, `Note`, `From`, `To`, `Amount (total)`). Returns `null` (→ AI structuring fallback) when it cannot confidently map — never guesses on the money path.
- `normalizeStatementRows`: parses common date formats (`MM/DD/YYYY`, `M/D/YY`, `YYYY-MM-DD`, ISO datetimes) → `occurred_on`; parses currency strings (`$1,234.56`, `(1,234.56)`, trailing `-`) → integer cents (never float); derives `direction` from sign / credit column.
- Test fixtures: Venmo, generic `Date,Description,Amount`, debit/credit-pair bank, quoted-comma description, embedded-newline description, multiple date formats, parenthesized negatives, BOM/CRLF, empty/garbage → `null`.

### 6.2 `lib/bookkeeping/statement-dedupe.ts` (pure)

```ts
export interface PostedIncomeRef {
  id: string; occurred_on: string; amount_cents: number; memo: string | null; source: LedgerSource
}
export interface DuplicateMatch { id: string; occurred_on: string; memo: string | null; source: LedgerSource }
export interface AnnotatedStatementRow<T> {
  row: T
  possibleDuplicate: boolean
  matchedEntry: DuplicateMatch | null
  reason: string | null
}
export function flagStatementDuplicates<T extends { occurred_on: string; amount_cents: number; direction: LedgerDirection }>(
  rows: T[], postedIncome: PostedIncomeRef[], opts?: { windowDays?: number },   // default windowDays = 4
): AnnotatedStatementRow<T>[]
```

- Income rows only (`direction === "income"`). Match when a posted entry has equal `amount_cents` and `|occurred_on − posted.occurred_on| ≤ windowDays`. **Closest-by-date wins; ties break to the first** posted entry in input order. A posted entry is claimed by at most one statement row (mark consumed) so N identical deposits don't all match the same single posted payout. `reason` = `"matches ${source} entry on ${occurred_on}"`. Never mutates/drops — pure annotation. Lives in `lib/` (not `functions/`) so it stays a single, unit-testable copy.

### 6.3 DAL additions — `lib/db/bookkeeping.ts`

```ts
// posted income for the fuzzy matcher — paginated (fetchAllRows), scoped to book + span + direction=income
export async function listPostedIncomeBetween(bookId: string, from: string, to: string): Promise<PostedIncomeRef[]>
// bookkeeping_documents CRUD
export async function createDocument(input: NewDocument): Promise<BookkeepingDocument>
export async function getDocument(id: string): Promise<BookkeepingDocument | null>
export async function listDocuments(bookId: string): Promise<BookkeepingDocument[]>          // paginated
export async function linkDocumentBatch(id: string, importBatchId: string, postedCount: number): Promise<void>
export async function deleteDocument(id: string): Promise<void>                              // row only; caller deletes the object
```

Every read paginates via `fetchAllRows` (`lib/db/paginate.ts`) — the ledger is a growth table and PostgREST silently caps `.select()` at ~1000 rows.

### 6.4 Storage helper — `lib/bookkeeping/documents.ts`

```ts
export async function storeStatementFile(path: string, buffer: Buffer, contentType: string): Promise<void> // getPrivateBucket().file(path).save(...)
export async function signStatementDownload(path: string, ttlSeconds?: number): Promise<string>            // getSignedUrl read
export async function deleteStatementFile(path: string): Promise<void>                                     // getPrivateBucket().file(path).delete()
```

Object path: `bookkeeping/statements/${bookId}/${documentId}/${safeName}` (mirrors the `shop-downloads/${uuid}/${safeName}` direct-server-upload pattern in `app/api/uploads/shop-pdf/route.ts`). There is no existing private-bucket delete helper — this adds the first, satisfying D12's "deletion path from day one".

---

## 7. AI categorization job

### 7.1 Job type registry (two files, per the twin-copy boundary)

- `lib/ai-jobs.ts` — add `"statement_import"` to the `AiJobType` union (Location A, always).
- `functions/src/ai/types.ts` — add `"statement_import"` (Location B, because a Firebase Function processes it).

### 7.2 Handler — `functions/src/statement-import.ts`

Mirrors `functions/src/program-from-excel.ts`:

- `functions/src/index.ts` — new `onDocumentCreated("ai_jobs/{jobId}")` export guarding `data.type === "statement_import"`, dynamic-importing `./statement-import.js` → `handleStatementImport(jobId)` (`timeoutSeconds: 540`, `memory: "1GiB"`, `secrets: allSecrets`).
- Uses the **functions-side** `callAgent` (raw `@anthropic-ai/sdk` `tool_use`, `MODEL_SONNET`, `cacheSystemPrompt: true`) — the functions runtime has no `structuredOutputMode: "jsonTool"` concern (that is the lib/ AI-SDK path only; see `ai_sdk_jsontool_mode`).
- Twin schema/prompt in `functions/src/ai/` (`statementImportSchema`, `STATEMENT_IMPORT_PROMPT`), `.js`-suffixed relative imports.
- Progress via `createJobProgressUpdater(jobId, N)` + cancellation via `createCancellationChecker(jobId)`; write-back to Firestore + RTDB via the existing helpers; RTDB drops empty arrays (defensively rebuild on the client, per `safeReport`).

### 7.3 Job input (embedded at create time, snapshot)

```ts
{
  kind: "csv_structured" | "csv_raw" | "pdf",
  rows?: NormalizedStatementRow[],   // csv_structured (numbers already exact — AI categorizes only)
  rawText?: string,                  // csv_raw | pdf  (AI structures + categorizes)
  accounts: { id: string; name: string; account_type: "income"|"expense"; service_line: string|null }[], // book chart snapshot
  bookName: string, bookKind: BookKind,
  documentId: string, logId: string, requestedBy: string,
}
```

### 7.4 Output schema (`statementImportSchema`, twin in `functions/src/ai/`)

```ts
{
  rows: Array<{
    occurred_on: string,               // YYYY-MM-DD
    description: string,
    amount_cents: number,              // integer magnitude
    direction: "income" | "expense",
    suggested_category: string | null, // must be one of the provided account names, or null
    service_line: string | null,
    confidence: "low" | "medium" | "high",
  }>,
  warnings: string[],
  truncated: boolean,
}
```

- For `csv_structured` the prompt instructs the model to **echo the provided rows verbatim** (`occurred_on/amount_cents/direction/description` unchanged) and add only `suggested_category/service_line/confidence` — the numbers stay code-derived. The route additionally cross-checks: the AI's row count and per-direction totals must match the deterministic input, else it emits a warning (a hallucination tripwire).
- **Caps:** `MAX_STATEMENT_ROWS = 500`. If the parsed input exceeds it, process the first 500 and **push an explicit truncation warning** (never silently drop — the `postgrest_1000_row_cap` lesson). Chunking is asymmetric by kind: **`csv_structured`** rows are known, so categorization is chunked (~80 rows/call) and merged when large; **`pdf` / `csv_raw`** must be structured from the whole text in a **single call** (you cannot chunk text you have not yet parsed) — the cap bounds the output and a truncation warning fires if the text obviously carries more rows than were returned.
- App resolves `suggested_category` → `account_id` by **case-insensitive name match** against the book's accounts at review time; unmatched → uncategorized (`null`), coach picks. The AI never creates categories.

---

## 8. Routes

All under `app/api/admin/bookkeeping/`, all **self-gate** (`/api/*` is NOT protected by `proxy.ts`): `const s = await auth(); if (!s?.user?.id || s.user.role !== "admin") return 403`. Never `requireAdmin()` (throws `NEXT_REDIRECT`). Mutations fire-and-forget `void recordAudit(...)` inline (the established bookkeeping-route convention; not `withAudit`).

| Route | Method | Body / params | Behavior |
|---|---|---|---|
| `statement-import` | POST | multipart `file` + `book_id` | gauntlet (size/type) → parse (CSV det. / PDF text) → `storeStatementFile` + `createDocument` → create AI job (Firestore doc + Supabase `createGenerationLog` + RTDB seed) → `202 {jobId, documentId, log_id}`. Audit `bookkeeping.statement_uploaded`. |
| `statement-import/dedupe` | POST | `{ book_id, rows }` (Zod) | resolve span from rows → `listPostedIncomeBetween` → `flagStatementDuplicates` → `{ rows: AnnotatedStatementRow[] }`. No audit (read-only). |
| `statement-import/commit` | POST | `importCommitSchema` + optional `document_id` | `insertImportedEntries` → `{ inserted, batchId }`; if `document_id`, `linkDocumentBatch`. Audit `bookkeeping.statement_imported`. |
| `documents` | GET | `?book_id=` | `listDocuments` → `{ documents }`. |
| `documents/[id]` | DELETE | — | load doc (scope check) → `deleteStatementFile` + `deleteDocument`. Audit `bookkeeping.document_deleted`. |
| `documents/[id]/download` | GET | — | `signStatementDownload` → `{ url }`. Audit `bookkeeping.document_downloaded`. |

- **Upload gauntlet:** `MAX_SIZE = 10 * 1024 * 1024`; allowed = `text/csv` / filename `.csv` / `application/pdf` (extension OR-fallback like the Excel route, since browsers send inconsistent CSV MIME). Reject empty; friendly 400s.
- **Commit schema:** reuse `importCommitSchema` (already accepts `source:"statement_import"` — **M7**); extend the commit route to accept an optional `document_id: z.string().uuid().optional()` (add to a thin wrapper schema, not `importCommitSchema` itself, to avoid disturbing the platform-income commit).
- New Zod schemas in `lib/validators/bookkeeping.ts`: `statementDedupeSchema`, `statementCommitSchema` (= importCommitSchema shape + `document_id?`).

### 8.1 Audit slugs (add to `lib/audit/actions.ts`, category `commerce`)

- `bookkeeping.statement_uploaded` — "Bank/Venmo statement uploaded"
- `bookkeeping.statement_imported` — "Bank/Venmo statement posted to the ledger"
- `bookkeeping.document_deleted` — "Bookkeeping document deleted"
- `bookkeeping.document_downloaded` — "Bookkeeping document downloaded"

`AUDIT_ACTIONS` is a closed `as const` array — adding slugs is a code edit there.

---

## 9. UI

- **`components/admin/bookkeeping/StatementImportDialog.tsx`** (new) = ImportPlatformDialog's review grid + ExcelImportDialog's RTDB polling. Steps: `upload → processing → review → done`.
  - **Upload:** file input (CSV/PDF), book context line, submit → `POST statement-import` (FormData), on `202` subscribe to `ai_jobs/${jobId}` via RTDB `onValue` (add to the shared jobs dock via `useAiJobsDock`). Cancel reuses the shared cancel route.
  - **Processing:** step progress mapped from `progress.status` (`parsing|categorizing|finalizing`).
  - **Review:** on completion, POST the result rows to `statement-import/dedupe`, then render the grid — reuse the **warnings banner**, the account `<select>` filtered `account_type === row.direction` (default = resolved AI suggestion), the **non-business-book confirm gate**, and `formatOccurredOn`. Duplicate rows show a "Likely already recorded" badge + reason and are **pre-unchecked**; `confidence === "low"` rows are visually flagged.
  - **Post:** `POST statement-import/commit` with included rows (+ `document_id`); toast `posted N (M already imported — skipped)` where `skipped = included − inserted`; `onSaved()` + close.
- **`BooksClient` toolbar:** add an **"Import statement"** button beside "Import platform income".
- **`LedgerTable`** already renders the `statement_import` → "Statement" badge and the `SOURCE_OPTIONS` filter already lists it — no change.
- **Statements management** (D12 delete/download reachability): a modest list on `/admin/books/accounts` — each document row shows filename, date, row/posted counts, retain-until, with **Download** (signed URL) and **Delete** (confirm) actions. Kept off a dedicated page to hold scope.
- Design system: semantic colors + font classes only; `formatCents` for every amount; `EmptyState` where nothing is present.

---

## 10. Folded-in Phase-1 review minors

| # | Fix | Location |
|---|---|---|
| **M3** | Date-filter `client_memberships` in `listPlatformIncome` (currently `.range()` only, no `gte/lte`); drive the membership-gap warning by the import window so back-year imports don't under-disclose. | `lib/db/bookkeeping.ts` `listPlatformIncome`; `lib/bookkeeping/income-adapter.ts` membership warning |
| **M4** | Validate `direction`/`source` query params against the enums in the `entries` GET → `400` on invalid (today an invalid value is blind-cast and yields 0 rows, not an error). | `app/api/admin/bookkeeping/entries/route.ts` |
| **M5** | Book-scoped consistency on `PATCH entries/[id]` and `accounts/[id]`: load the entry + target account, assert `account.book_id === entry.book_id` and `account.account_type === (new)direction` → `400/409` on mismatch. Top standing risk: book isolation is app-level only. | `app/api/admin/bookkeeping/entries/[id]/route.ts`, `accounts/[id]/route.ts`; helper in `lib/db/bookkeeping.ts` |
| **M6** | Add `.` to the `.or()` search-escaping set. | `lib/db/bookkeeping.ts` `applyEntryFilters` |
| **M7** | `statement_import` wired end-to-end (this feature). | — |

M5 requires the entries PATCH to load the entry and the target account first — a book-scoped guard `assertAccountInBook(accountId, bookId, direction)` in the DAL, called from both PATCH routes.

---

## 11. Testing strategy

- **Pure, zero mocks (`__tests__/lib/bookkeeping/…`, `__tests__/lib/…`):**
  - `statement-parse.test.ts` — column detection + normalization across Venmo / generic / debit-credit / quoted-comma / embedded-newline / multiple date formats / parenthesized negatives / BOM-CRLF / garbage→null; `computeStatementSourceRef` stability + occurrence-index distinctness.
  - `statement-dedupe.test.ts` — exact match, within/outside window, direction filter, closest-match selection, no-mutation.
  - `income-adapter.test.ts` — extend for the M3 window-driven membership warning.
- **Route tests** — `vi.mock('@/lib/db/bookkeeping')` (and the storage/job helpers); import handler after mocks; `Request as never`; async `params` Promise. Cover the 403 self-gate for every new route and the M4 `400` validation.
- **Functions-side** — twin `statementImportSchema` parse test (RFC-4122 UUID fixtures; Zod v4 strict UUIDs).
- **Money-path proof** — one throwaway live-DB test asserting `source_ref` idempotency (commit the same drafts twice → second inserts 0), then **deleted**. Never `__tests__/db/` (hits prod).
- **Baseline discipline** — snapshot the known ~8–9 pre-existing reds before/after (full suite flakes under load; stash-test to prove causation before blaming the diff). Prod source stays `tsc`-clean.

---

## 12. Standing risks carried forward

1. **Book isolation is application-only** (RLS decorative) — every new DAL/route scopes `book_id`; **M5** closes the Phase-1 PATCH gap.
2. **PostgREST 1000-row cap** — every ledger/income/document read paginates via `fetchAllRows`.
3. **Never edit the shared Stripe webhook** — dedupe reads posted income; it does not touch billing writers.
4. **Financial docs → private bucket only** — `getPrivateBucket()`, signed URLs, 7-year `retain_until`, deletion path from day one (D12).
5. **functions/ ↔ lib/ twin copy** — the AI schema/prompt duplicate into `functions/src/ai/`; the fuzzy matcher stays in `lib/` (run app-side) to avoid a second copy.
6. **AI must not silently truncate** — row caps emit explicit warnings; `csv_structured` cross-checks AI totals against the deterministic parse.

---

## 13. Honesty guardrails (inherited, non-negotiable)

- Every AI category is a **candidate the coach confirms** in review — nothing posts unreviewed.
- Fuzzy duplicates are **flagged, never auto-dropped** (D6).
- Venmo/bank = **statement-file import**, never implied live sync (no Venmo API, no Plaid).
- Statements retained **7 years**, private bucket, with a working deletion path (D12).
- Business and personal **stay in separate books** — a statement imports into exactly one selected book.
