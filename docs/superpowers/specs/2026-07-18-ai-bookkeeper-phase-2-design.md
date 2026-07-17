# AI Bookkeeper — Phase 2 — Statement Import — Design

**Date:** 2026-07-18
**Phase:** 2 of 6 (see umbrella design `docs/superpowers/specs/2026-07-17-ai-bookkeeper-design.md` §3)
**Branch:** `feat/ai-bookkeeper-phase-2` (do NOT push until the owner says so)
**Status:** Design approved by owner ("lgtm", 2026-07-18), then **hardened after an adversarial 4-lens spec review** (41 findings; 4 blockers). Two forks resolved by owner: **deterministic parse + AI-categorize** (code owns dollar amounts for the common CSV case) and **store statements + manual delete path now, retention-pruning cron deferred to Phase 3**. The review forced one material scope refinement — see §1.1 (**expense-first**) — made under autonomous-mode delegation and flagged for the owner's review on return.
**Builds on:** Phase 1 (SHIPPED, live on main) — the ledger spine: `lib/bookkeeping/*`, `lib/db/bookkeeping.ts`, `lib/validators/bookkeeping.ts`, `app/api/admin/bookkeeping/*`, `app/(admin)/admin/books/*`, `components/admin/bookkeeping/*`, migrations `00183`/`00184`.

---

## 1. Scope

Coach uploads a Venmo/bank statement (CSV or PDF) into a chosen book. The system:

1. **Parses** the file into normalized rows `{ occurred_on, description, amount_cents, direction }`.
2. **Categorizes** each row into that book's chart of accounts via an AI job, and **classifies internal transfers / card payments / owner draws as non-posting** so they never become fake P&L lines.
3. **Fuzzy-flags** likely duplicates across three layers (§3.1) — most importantly, income that is probably a Stripe payout of revenue Phase 1 already recorded — **flagged and pre-excluded, never auto-dropped and never silently posted**.
4. Lets the coach **review + post** the rest, reusing Phase 1's review-and-post model.

Posted rows use `source:"statement_import"` and a **stable `source_ref`** so re-importing the same file dedupes via `UNIQUE(book_id, source, source_ref)`.

### 1.1 Expense-first (the review's material refinement)

The adversarial review proved that importing bank/Venmo **income** in Phase 2 is structurally double-count-prone and cannot be honestly auto-deduped yet:

- **Stripe payouts are aggregated + net of fees.** Phase 1 posts platform income as *individual gross charges* (`income-adapter.ts` — one draft per payment/order/pack). A real bank payout deposits `$100 + $50 + $30` charges as one `$175.20` line — which equals *no* individual posted charge, so exact-amount matching can never flag it. Real payout reconciliation needs the Stripe payout subsystem → **Phase 6** (D6).
- Therefore Phase 2 treats statement **income** as *presumptively already recorded*: every income row is **pre-excluded** in review behind a prominent caution, and the coach opts in per row only for genuinely-new income (e.g. a client who Venmo'd Darren directly, never through Stripe). Rows that match a dedupe heuristic carry a specific reason.
- Phase 2's confident value is the **expense** side (bank withdrawals, card purchases, Venmo payments out) — money the ledger has *none* of yet, and the fuel for the Phase 5 deduction finder. Expenses are **pre-checked** (minus transfers and cross-statement duplicates).

This does not shrink the sold feature; it makes the "so a payout isn't double-counted" promise honest instead of relying on a matcher that structurally cannot fire.

### 1.2 Non-goals (explicitly out of Phase 2)

Receipts and vision (Phase 3), Gmail-label / Amazon-CSV intake (Phase 3), Stripe **payout ingestion + net revenue + real payout-vs-bank reconciliation** (Phase 6), the automated **retention-pruning cron** (Phase 3, ships with receipts), reports/exports/QuickBooks (Phase 4), monthly close/freeze (Phase 6), depreciation (Phase 6), ask-your-books chat tools (Phase 6). Statement import imports into **one selected book**; cross-book row routing is out of scope.

---

## 2. Inherited decision anchors

- **D6 — dedupe:** v1 = fuzzy flagging (amount+date, aggregate-payout heuristic, cross-statement), **flagged for the coach to confirm, never auto-dropped**. Payout-level reconciliation → Phase 6. Per §1.1, income is pre-excluded because v1 flagging cannot fully protect it.
- **D10 — flags:** none on read/review surfaces; DB-backed flags only on outward-emitting actions. Statement import reads/writes the internal ledger, is admin-only, reviewed, reversible, emits nothing outward → **no feature flag** (also per `no_default_feature_flags`). AI token spend is manual, one file at a time.
- **D12 — retention:** statements → **private bucket only** (`getPrivateBucket()`, signed-URL, never the world-writable `storage.rules` prefixes). A `bookkeeping_documents` row carries `retain_until`. **Basis = upload-year + 7** (a statement spans periods and has no single occurred date — this intentionally supersedes the umbrella's "occurred-year + 7" for documents). Deletion path exists day one; pruning cron is Phase 3.
- **Standing risk (D1):** book isolation is application-level only (RLS decorative; all DALs service-role). Every new DAL/route scopes `book_id`; **M5** closes the Phase-1 `entries/[id]` PATCH gap.

---

## 3. End-to-end flow

```
Coach picks a book → "Import statement" → StatementImportDialog

1. UPLOAD   POST /api/admin/bookkeeping/statement-import   (multipart: file + book_id)
            ├─ auth()→403 · size cap (10 MB) · type gate (text/csv|.csv | application/pdf)
            ├─ storage-configured guard (FIREBASE_PRIVATE_BUCKET) → friendly 500 if unset
            ├─ CSV → parseCsvStatement (papaparse) → detectStatementColumns()
            │        confident → normalizeStatementRows() + dropNonTransactionRows()
            │                    → kind="csv_structured" (rows, capped to 500 at embed time)
            │        unsure   → kind="csv_raw" (raw table text handed to the AI)
            ├─ PDF → pdf-parse text (app-side, capped)                 → kind="pdf" (text to AI)
            ├─ store file → private bucket + bookkeeping_documents row (retain_until, sha256, row_count*)
            └─ create AI job (Firestore ai_jobs + Supabase log + RTDB seed) → 202 {jobId, documentId, log_id}
               (* row_count set now for csv_structured; back-filled at job completion for pdf/csv_raw)

2. JOB      functions/ onDocumentCreated · guard data.type==="statement_import"
            ├─ csv_structured → AI ANNOTATES ONLY: joins by opaque per-row `ref`; deterministic
            │                    occurred_on/amount/direction are authoritative; AI adds
            │                    suggested_category + is_transfer + confidence. AI cannot alter the row set.
            ├─ pdf | csv_raw  → AI STRUCTURES + categorizes from text; also extracts control_totals;
            │                    instructed to skip balance/total/subtotal/header lines and mark transfers.
            ├─ cap 500 · deterministic truncation warning (csv) · control-total reconciliation (pdf)
            └─ write {rows[], control_totals?, warnings, truncated} → Firestore + RTDB; complete the log

3. POLL     Dialog listens to RTDB (ExcelImportDialog pattern) → on complete → review

4. DEDUPE   POST /api/admin/bookkeeping/statement-import/dedupe   {book_id, rows}
            ├─ server computes source_ref + occurrenceIndex over the FULL returned row set (frozen per row)
            ├─ reads posted rows for dedupe (paginated, span widened by ±windowDays):
            │     listPostedForDedupe(bookId, from−W, to+W) → income+expense across platform_import/manual/statement_import
            └─ flagStatementDuplicates() (pure) → per-row {possibleDuplicate, matchedEntry, reason,
               defaultInclude}   (income pre-excluded per §1.1; transfers pre-excluded; cross-statement dupes pre-excluded)

5. REVIEW   include checkbox · date · desc · amount · direction · category <select> (default = resolved
            AI suggestion) · dup/transfer/payout badge + reason · low-confidence highlight · warnings +
            control-total banner · income-caution banner · non-business-book confirm gate

6. POST     POST /api/admin/bookkeeping/statement-import/commit   {book_id, document_id, entries[]}
            └─ excluded/transfer rows omitted → insertImportedEntries (source="statement_import",
               echoed frozen source_ref) → idempotent upsert on UNIQUE(book_id, source, source_ref)
               → linkDocumentBatch(document_id, batchId, posted_count) → audit bookkeeping.statement_imported
```

### 3.1 Three dedupe layers (do not conflate)

1. **Exact re-import (same file).** The `source_ref` UNIQUE means re-uploading the same file never double-posts. Handled by `insertImportedEntries` upsert.
2. **Cross-source income vs platform (D6).** A bank deposit that corresponds to Stripe revenue Phase 1 already posted as `platform_import`. Because payouts are aggregate/net, this layer **flags, it cannot fully protect** — so income is *also* pre-excluded (§1.1). Three signals, each a reason: (a) exact `amount_cents` + date-window match; (b) **aggregate-payout** heuristic — the income line ≈ the sum of posted `platform_import` income in a trailing window within a fee tolerance (default 1–4%); (c) **period-overlap caution** — any income row whose date falls in a span already containing posted platform income.
3. **Cross-statement, both directions.** The same transaction re-appearing in a different but overlapping statement download (the normal rolling-window case). Fuzzy-match incoming rows of **income AND expense** against already-posted `statement_import`/`manual` rows in the same book within the widened span → pre-exclude + reason. Plus a document-level warning when the new import's date span overlaps an existing `bookkeeping_documents` window for the book.

Separately (a classification, not a dedupe layer): **transfer / non-P&L exclusion** — the AI (primary) and a deterministic keyword pass (backstop) mark internal transfers, credit-card/loan payments, owner draws/contributions, ATM withdrawals, and Venmo→own-bank cash-outs as **non-posting**; pre-excluded with a reason, omitted from commit. This prevents the credit-card-payment double-count (§13).

---

## 4. `source_ref` design (stable dedupe key)

A statement line has no natural id. **Computed once, server-side, in the dedupe route** (`lib/bookkeeping/statement-parse.ts`, Node `crypto`) over the **full** job-result row set — never in the browser, never over the coach's checked subset. Frozen onto each row and carried opaquely through review → commit; the commit echoes it verbatim.

```
source_ref = `statement:${sha1(`${occurred_on}|${amount_cents}|${direction}|${normalizedDescription}|${occurrenceIndex}`)}`
```

- `occurred_on` — **date-only, timezone-independent** (slice the first 10 chars of an ISO string, matching Phase 1's `isoDate`; never local-time math). A fixture asserts the same input yields the same `occurred_on` under any runtime tz — otherwise re-imports drift and dedupe silently breaks.
- `amount_cents` — integer cents parsed by **string split on the decimal point** (or `Math.round` after scaling), never `parseFloat*100` truncation. `1234.56 → 123456`, unit-tested at boundaries. Exact-cent parity with Stripe integer cents is what makes layer-2(a) matching work.
- `normalizedDescription` — lowercased, whitespace-collapsed, **and volatile-token-stripped** (trailing running-balance/reference numbers, `pending`/`posted` markers, collapse `*`) so re-exports of the same line hash the same. (Layer 3 backstops any residual drift.)
- `occurrenceIndex` — 0-based ordinal of this exact `(occurred_on, amount_cents, direction, normalizedDescription)` tuple **within the full file** (stable sort → 0,1,2…), assigned by `assignOccurrenceIndexes` over the complete row set **before** any include/exclude. Two identical same-day charges → indices 0,1 → both post; re-importing the same file reproduces the indices → the UNIQUE dedupes. **Never recomputed on the checked subset** (a unit test unchecks rows then re-imports all and asserts still-deduped).

---

## 5. Data model — migration `00185_bookkeeping_documents.sql`

The ledger already carries `source='statement_import'` (verified `00183:50`) and `import_batch_id`, so **no ledger-table migration**. One new table + explicit RLS (decorative, mirroring 00183/00184):

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
  retain_until date not null,          -- upload year + 7 (D12, §2)
  uploaded_by uuid,
  import_batch_id uuid,                -- links to the posted ledger batch; null until committed / on fail
  row_count integer,                   -- set at create for csv_structured; back-filled at job completion for pdf/csv_raw
  posted_count integer,                -- set at commit via linkDocumentBatch
  period_start date,                   -- min(occurred_on) of parsed rows; set at job completion. Powers the layer-3 document-overlap warning.
  period_end date,                     -- max(occurred_on) of parsed rows; set at job completion.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookkeeping_documents_book_created_idx on bookkeeping_documents (book_id, created_at desc);
alter table bookkeeping_documents enable row level security;
create policy bookkeeping_documents_service_all on bookkeeping_documents for all using (true) with check (true);
```

Applied to prod via `mcp__supabase__apply_migration` (`supabase_migrations_via_mcp`; CLI not linked). Next-available `00185` (confirmed).

**`types/database.ts` additions** (alongside `BookkeepingLedgerEntry`, line 574):

```ts
export interface BookkeepingDocument {
  id: string; book_id: string; kind: "statement" | "receipt"
  original_filename: string | null; storage_path: string; mime_type: string | null
  file_size_bytes: number | null; sha256: string | null; retain_until: string
  uploaded_by: string | null; import_batch_id: string | null
  row_count: number | null; posted_count: number | null
  period_start: string | null; period_end: string | null
  created_at: string; updated_at: string
}
export type NewDocument = Pick<BookkeepingDocument,
  "book_id" | "kind" | "original_filename" | "storage_path" | "mime_type" | "file_size_bytes" | "sha256" | "retain_until" | "uploaded_by" | "row_count">
```

---

## 6. Modules (new)

All pure modules are unit-tested in `__tests__/lib/**` with **zero mocks**. Add dependency **`papaparse`** (+ `@types/papaparse`), server-only. `pdf-parse` is already a dependency. The hand-rolled `lib/csv-parser.ts` (splits newlines before quotes — landmine) is left untouched.

### 6.1 `lib/bookkeeping/statement-parse.ts` (pure)

```ts
export interface NormalizedStatementRow {
  occurred_on: string          // YYYY-MM-DD, tz-independent (§4)
  description: string
  amount_cents: number         // magnitude (>= 0); direction carries sign
  direction: LedgerDirection   // "income" | "expense"
}
export interface StatementColumnMap {
  date: number
  description: number
  amountMode: "signed" | "debit_credit"
  amount?: number                       // signed mode
  debit?: number; credit?: number       // debit_credit mode
  signConvention?: "negative_is_expense" | "positive_is_expense"  // consulted only in signed mode
}

export function parseCsvStatement(text: string): { headers: string[]; rows: string[][] }
export function detectStatementColumns(headers: string[], rows: string[][]): StatementColumnMap | null
export function normalizeStatementRows(rows: string[][], map: StatementColumnMap): { rows: NormalizedStatementRow[]; warnings: string[] }
export function dropNonTransactionRows(rows: NormalizedStatementRow[]): { rows: NormalizedStatementRow[]; dropped: number }
export function transferSuspicion(row: NormalizedStatementRow): "hard" | "soft" | null   // deterministic backstop, two tiers
export function computeStatementSourceRef(row: NormalizedStatementRow, occurrenceIndex: number): string
export function assignOccurrenceIndexes(rows: NormalizedStatementRow[]): number[]  // stable, over the FULL set
```

- **Column detection** — a date-like column, a description/note column, and **either** one signed amount **or** a debit/credit pair. Recognizes the Venmo export (`Datetime`, `Type`, `Note`, `From`, `To`, `Amount (total)`). Returns `null` (→ AI fallback) when not confident — never guesses on the money path.
- **Sign / direction rules** (money-path critical): in `debit_credit` mode choose the column by **non-zero magnitude** (treat `0.00`/blank as absent); if **both** are non-zero → push a warning and don't guess (skip or flag the row). **Preserve sign within a column** — a negative/parenthesized value in the *credit* column is an income *reversal* (posts as expense-direction), and vice-versa. Parse `CR`/`DR` suffixes (`"500.00 CR"`). `signConvention` is consulted **only** in `signed` mode.
- **Non-transaction filtering** — `dropNonTransactionRows` drops rows whose description matches balance/total/subtotal/header markers (`beginning balance`, `ending balance`, `total`, `subtotal`, running-balance headers) and zero-magnitude rows. (For pdf/csv_raw the AI is *also* instructed to skip these.)
- **Transfer suspicion** (money-path — closes the expense-default-include asymmetry) — `transferSuspicion` returns `"hard"` for explicit keywords (`transfer`, `xfer`, `zelle`, `wire`, `ach`, `online transfer`, `to savings`/`to checking`, **`payment`+`credit card` co-occurring** (either order — so a "payment to credit card" flags but a "credit card annual fee" does not), `loan payment`, `owner draw`, `atm`/`cash withdrawal`, `payment - thank you`) → forces `is_transfer`; `"soft"` for an outbound (expense) row that is **either** a person-name-like counterparty with no merchant tokens **and ≥ $100** (person-to-person transfers/draws are rarely tiny; the amount gate keeps small named-merchant charges from false-flagging), **or** a large exact-round outbound with a sparse description → pre-unchecked + a "possible transfer — verify" badge (still postable). Non-transaction filtering (above) drops only genuine balance/summary lines (`beginning`/`ending balance`, `balance forward`/`due`, standalone `balance`, `total`/`subtotal`), never a real transaction whose description merely starts with "balance". Effective `is_transfer = ai.is_transfer || hard`. This makes an undetected transfer **fail toward exclusion** rather than post as a fake expense.
- **Dates** — parse `MM/DD/YYYY`, `M/D/YY`, `YYYY-MM-DD`, ISO datetimes → `occurred_on` via the tz-independent slice (§4).
- Test fixtures: Venmo, generic `Date,Description,Amount`, debit/credit-pair, **both-columns-populated (warn)**, **negative-in-credit reversal**, **CR/DR suffixes**, quoted-comma, embedded-newline, multiple date formats, parenthesized negatives, BOM/CRLF, **balance+total summary lines (excluded)**, garbage→null; `computeStatementSourceRef` stability + occurrence-index distinctness + unchecked-subset re-import; cents boundary (`1234.56→123456`); tz-invariance.

### 6.2 `lib/bookkeeping/statement-dedupe.ts` (pure)

```ts
export interface PostedRef {
  id: string; occurred_on: string; amount_cents: number; direction: LedgerDirection
  memo: string | null; source: LedgerSource
}
export interface DedupeInputRow extends NormalizedStatementRow {
  source_ref: string; is_transfer: boolean
  suggested_category: string | null; confidence: "low" | "medium" | "high"  // pass-through: the review grid reads these keyed by source_ref
  transferSuspect?: boolean          // soft-suspect (§6.1)
}
export interface AnnotatedStatementRow {
  row: DedupeInputRow                 // carries source_ref + suggested_category + confidence (nothing discarded)
  possibleDuplicate: boolean
  matchedEntry: { id: string; occurred_on: string; memo: string | null; source: LedgerSource } | null
  reason: string | null
  defaultInclude: boolean
  newCandidate: boolean               // income row with no dedupe match — likely genuinely new (§9 surfaces these)
}
export function flagStatementDuplicates(
  rows: DedupeInputRow[],
  posted: PostedRef[],
  opts?: { windowDays?: number; feeTolerancePct?: number },   // defaults: windowDays 4, feeTolerancePct 4
): AnnotatedStatementRow[]
```

- **Iteration + return order** fixed: process by `occurred_on` then input order, but **return rows in INPUT order** so the client can zip annotations back by index (belt-and-suspenders alongside the per-row `source_ref` key; a unit test asserts input-order return). Greedy "closest-by-date wins, ties→first, mark posted-entry consumed" — a best-effort advisory heuristic (flags advisory, coach confirms).
- **Income rows** — all default `include=false` (§1.1). Reasons, strongest first: exact amount+date-window match vs `platform_import`/`manual` income; aggregate-payout (line ≈ sum of `platform_import` income in the trailing window ± `feeTolerancePct`); period-overlap (row falls in a span containing platform income). An income row with **no** matched reason is tagged `newCandidate: true` so §9 can surface the handful that are genuinely new (a direct Venmo/cash payment) apart from the likely-already-recorded pile.
- **Expense rows** — default `include=true` **unless** `is_transfer`, `transferSuspect`, or a cross-statement duplicate. Cross-statement match requires amount + date-window + direction **and normalized-description similarity** (so two different same-amount charges a few days apart — daily Ads billing, metered SaaS — are not false-flagged); a match → `possibleDuplicate`, pre-exclude with reason.
- **Transfers** (`is_transfer`): `include=false`, reason "internal transfer / card payment — excluded from P&L". **Soft suspects** (`transferSuspect`): `include=false` + "possible transfer — verify" (still postable).
- **Self-match note**: `posted` includes prior `statement_import` rows so an overlapping re-import can match its own earlier post — intended (layer 3). Documented.
- Pure, zero mocks. Lives in `lib/` (run app-side in the dedupe route) — no `functions/` twin. The route (not the pure fn) derives the **excluded-transfer total** (sum of excluded transfer amounts) and the **document-overlap warning** (§8) since both need IO.

### 6.3 DAL additions — `lib/db/bookkeeping.ts`

```ts
export async function getEntry(id: string): Promise<BookkeepingLedgerEntry | null>          // M5 pre-image (mirror getBook)
export async function listPostedForDedupe(bookId: string, from: string, to: string): Promise<PostedRef[]>  // income+expense, sources platform_import|manual|statement_import, paginated (fetchAllRows)
export async function assertAccountInBook(accountId: string, bookId: string, direction: LedgerDirection): Promise<void>  // M5; throws typed error on mismatch
export async function createDocument(input: NewDocument): Promise<BookkeepingDocument>
export async function getDocument(id: string): Promise<BookkeepingDocument | null>
export async function findDocumentBySha256(bookId: string, sha256: string): Promise<BookkeepingDocument | null>  // "already uploaded this file" hint
export async function listDocuments(bookId: string): Promise<BookkeepingDocument[]>          // paginated; carries period_start/end for the overlap warning
export async function linkDocumentBatch(id: string, importBatchId: string, postedCount: number): Promise<void>
export async function deleteDocument(id: string): Promise<void>                              // row only; caller deletes the object
```

Every read paginates via `fetchAllRows` (PostgREST silently caps `.select()` at ~1000 rows). **`row_count` + `period_start`/`period_end` are back-filled at job completion by the *function* (functions/ supabase write), not a lib/ setter** — the dedupe route reads them via `listDocuments`.

### 6.4 Storage helper — `lib/bookkeeping/documents.ts`

```ts
export function safeStatementName(name: string): string   // basename → strip to [a-zA-Z0-9._-] → cap length (parity with shop-pdf)
export async function storeStatementFile(path: string, buffer: Buffer, contentType: string): Promise<void>
export async function signStatementDownload(path: string, ttlSeconds?: number): Promise<string>
export async function deleteStatementFile(path: string): Promise<void>
```

Object path: `bookkeeping/statements/${bookId}/${documentId}/${safeStatementName(name)}` (mirrors `shop-pdf`'s direct-server-upload). Raw filename kept in `original_filename`. First private-bucket delete helper — satisfies D12's day-one deletion path.

---

## 7. AI categorization job

### 7.1 Job type registry (twin-copy boundary)

- `lib/ai-jobs.ts` — add `"statement_import"` to `AiJobType` (Location A, always).
- `functions/src/ai/types.ts` — add `"statement_import"` (Location B, a Firebase Function processes it).

### 7.2 Handler — `functions/src/statement-import.ts` (mirrors `program-from-excel.ts`)

- `functions/src/index.ts` — new `onDocumentCreated("ai_jobs/{jobId}")` export guarding `data.type === "statement_import"`, dynamic-importing `./statement-import.js` → `handleStatementImport(jobId)` (`timeoutSeconds: 540`, `memory: "1GiB"`, `secrets: allSecrets`, `region: "us-central1"`).
- **Exact Firestore doc + RTDB seed shape** (written by the upload route, mirroring import-excel so pickup/cancel/progress don't drift): Firestore `{ type:"statement_import", status:"pending", input:{ kind, rows?, rawText?, accounts, bookName, bookKind, documentId, logId, requestedBy }, result:null, error:null, userId, createdAt/updatedAt: serverTimestamp() }`; RTDB seed `{ status:"pending", progress:{ status:"queued", current_step:0, total_steps: (kind==="csv_structured" ? 2 : 3) }, result:null, error:null, updatedAt: Date.now() }`.
- Functions-side `callAgent` (raw `@anthropic-ai/sdk` tool_use, `MODEL_SONNET`, `cacheSystemPrompt: true`) — no `jsonTool` concern (that's the lib/ AI-SDK path). Twin `statementImportSchema` + `STATEMENT_IMPORT_PROMPT` in `functions/src/ai/`, `.js`-suffixed imports.
- **Progress statuses (pinned):** the dialog's step map is the **union keyed by status name** — `parsing → categorizing → finalizing`. csv_structured emits `categorizing → finalizing` (`total_steps:2`); pdf/csv_raw emits all three (`total_steps:3`). Progress via `createJobProgressUpdater`, cancellation via `createCancellationChecker`; write-back to Firestore + RTDB; RTDB drops empty arrays (client `safeRows` rebuild).
- **Document back-fill:** at completion the function writes `row_count`, `period_start = min(occurred_on)`, `period_end = max(occurred_on)` onto the `bookkeeping_documents` row (functions/ supabase) so the layer-3 document-overlap warning has data.
- **`ai_generation_log` lifecycle:** create at upload with `program_id:null`, `input_params:{ source:"statement_import", document_id, kind }`, `total_steps: (kind==="csv_structured" ? 2 : 3)`. On completion: `status:"completed"`, `output_summary:{ row_count, warnings, truncated, document_id }`, `tokens_used`; `program_id` stays null. On cancel/fail: `markLogCancelled`/failed twin.
- **Failure/cancel:** the `bookkeeping_documents` row + stored object persist (deletable via §9 list; `retain_until` applies). Dialog reuses the ExcelImportDialog error-banner + toast on `status:"failed"`/`"cancelled"`.

### 7.3 Job input (embedded at create time)

```ts
{
  kind: "csv_structured" | "csv_raw" | "pdf",
  rows?: Array<NormalizedStatementRow & { ref: string }>,  // csv_structured, capped to 500 AT EMBED TIME (Firestore 1 MB); `ref` = opaque per-row key
  rawText?: string,                                        // csv_raw | pdf (capped)
  accounts: { id: string; name: string; account_type: "income"|"expense"; service_line: string|null }[],
  bookName: string, bookKind: BookKind, documentId: string, logId: string, requestedBy: string,
}
```

### 7.4 Output schema (`statementImportSchema`, twin)

```ts
{
  rows: Array<{
    ref: string | null,                 // echoes the input `ref` (csv_structured join key); null for pdf/csv_raw
    occurred_on: string, description: string, amount_cents: number, direction: "income"|"expense",
    is_transfer: boolean,               // internal transfer / card payment / owner draw / cash-out
    suggested_category: string | null,  // one of the provided account names, or null
    confidence: "low" | "medium" | "high",
  }>,
  control_totals?: { total_deposits_cents: number|null, total_withdrawals_cents: number|null,
                     opening_balance_cents: number|null, closing_balance_cents: number|null },  // pdf/csv_raw
  warnings: string[],
  truncated: boolean,
}
```

- **`csv_structured` — AI annotates only, never alters the row set.** The function joins AI rows to the deterministic input rows by `ref`; deterministic `occurred_on/amount_cents/direction` are authoritative (AI's copies ignored). AI contributes only `suggested_category`, `is_transfer`, `confidence`. An AI row with an unknown `ref` is ignored; an input `ref` absent from AI output → uncategorized, not transfer, **never dropped**. (This closes the "AI drops one $50 + duplicates another $50" tripwire hole — the row set is fixed by construction, not by a count check.)
- **`pdf`/`csv_raw` — AI structures from text.** AI emits `occurred_on/amount/direction/description`; instructed to skip balance/total/subtotal/header lines and set `is_transfer` for transfers/card-payments. **Control-total reconciliation:** compare `sum(imported deposits)` / `sum(imported withdrawals)` (or opening→closing balance delta) against `control_totals`; on mismatch push a loud warning. **Completeness never rests on totals alone:** when `control_totals` come back **all-null** (many exports state none), push an explicit **"completeness unverified — no statement totals found; review carefully"** warning; **additionally warn whenever the returned row count hits the 500 cap** (a hard truncation signal independent of totals). A pdf/csv_raw job never completes silently.
- **`service_line`** is derived from the *resolved account*, not the AI — the AI does not emit `service_line` (avoids an unvalidated free-text field).
- **Caps:** `MAX_STATEMENT_ROWS = 500`. csv_structured is capped **deterministically at embed time** in the upload route (exact count vs 500 → hard truncation warning; keeps the Firestore doc < 1 MB). pdf/csv_raw is single-call; the control-total mismatch is the truncation signal (the "obviously more rows" heuristic alone is unreliable).
- App resolves `suggested_category` → `account_id` by case-insensitive name match at review; unmatched → uncategorized. AI never creates categories.

---

## 8. Routes

All under `app/api/admin/bookkeeping/`, all **self-gate** (`const s = await auth(); if (!s?.user?.id || s.user.role !== "admin") return 403`; never `requireAdmin()` — it returns a redirect in API routes, as `shop-pdf` mistakenly does). Mutations fire-and-forget `void recordAudit(...)` inline (the bookkeeping convention).

| Route | Method | Body / params | Behavior |
|---|---|---|---|
| `statement-import` | POST | multipart `file` + `book_id` | storage-configured guard → gauntlet (size/type) → parse (CSV det.+filter+cap / PDF text) → compute sha256; `findDocumentBySha256(book_id, sha256)` → if a prior identical file exists, still proceed but return a non-blocking `duplicateUploadHint` (prior date) → `storeStatementFile` + `createDocument` → create job (Firestore doc + `createGenerationLog` + RTDB seed) → `202 {jobId, documentId, log_id, duplicateUploadHint?}`. Audit `bookkeeping.statement_uploaded`. |
| `statement-import/dedupe` | POST | `statementDedupeSchema` | compute source_ref/occurrenceIndex over full set → span = `[min,max]` of income+expense rows, **widened ±windowDays** → `listPostedForDedupe` → `flagStatementDuplicates` → the route also sums the excluded-transfer total and, via `listDocuments`, warns when the new span overlaps a prior statement's `period_start..period_end` → `{ rows, excludedTransferTotalCents, documentOverlapWarning }`. Short-circuit (no DAL read) when rows empty. No audit (read-only). |
| `statement-import/commit` | POST | `statementCommitSchema` | drop excluded/transfer rows client-side; **reject any `statement_import` entry whose `source_ref` doesn't match `^statement:[0-9a-f]{40}$`** (defends layer-1 idempotency against a mangled/out-of-flow client); `insertImportedEntries` → `{ inserted, batchId }`; `linkDocumentBatch(document_id, batchId, posted_count)`. Audit `bookkeeping.statement_imported`. |
| `documents` | GET | `?book_id=` | `listDocuments` → `{ documents }`. |
| `documents/[id]` | DELETE | — | load doc (scope) → `deleteStatementFile` + `deleteDocument`. Audit `bookkeeping.document_deleted`. |
| `documents/[id]/download` | GET | — | `signStatementDownload` → `{ url }`. Audit `bookkeeping.document_downloaded` (category `admin_read_sensitive`). |

- **Upload gauntlet:** `MAX_SIZE = 10 MB`; allowed `text/csv` / filename `.csv` / `application/pdf` (extension OR-fallback). Reject empty; **friendly 500** ("statement storage not configured") if `getPrivateBucket()` throws (the `split_reel_vercel_env` trap — `FIREBASE_PRIVATE_BUCKET` must exist in the Vercel runtime; deployment precondition, §12).
- **202 payload** is `{ jobId, documentId, log_id }` (single canonical shape).
- **New Zod schemas** in `lib/validators/bookkeeping.ts`:
  - `statementDedupeSchema = { book_id: uuid, rows: array({ occurred_on: DATE, amount_cents: int>=0, direction: enum, description: string, suggested_category: string.nullable(), is_transfer: boolean, confidence: enum }).max(500) }`.
  - `statementCommitSchema` = `importCommitSchema` shape (already accepts `source:"statement_import"` — **M7**) + `document_id: uuid.optional()`. (The existing platform-income commit route is untouched.)

### 8.1 Audit slugs (add to `lib/audit/actions.ts`)

- `bookkeeping.statement_uploaded` — "Bank/Venmo statement uploaded" (`commerce`)
- `bookkeeping.statement_imported` — "Bank/Venmo statement posted to the ledger" (`commerce`)
- `bookkeeping.document_deleted` — "Bookkeeping document deleted" (`commerce`)
- `bookkeeping.document_downloaded` — "Bookkeeping document downloaded" (`admin_read_sensitive` — a sensitive 7-year-retained financial read)

---

## 9. UI

- **`components/admin/bookkeeping/StatementImportDialog.tsx`** (new) = ImportPlatformDialog's review grid + ExcelImportDialog's RTDB polling. Steps: `upload → processing → review → done`.
  - **Upload:** file input (CSV/PDF), book context, submit → `POST statement-import` (FormData), on `202` subscribe to `ai_jobs/${jobId}` via RTDB `onValue`; register with the dock (`addJob({ kind:"statement_import", ... })` — **extend `AiJobKind` in `hooks/use-ai-jobs-dock.tsx` with `"statement_import"` + a dock-card icon/label**; the card has no Open deep-link, which is fine). Cancel reuses the shared cancel route.
  - **Processing:** step progress from the pinned statuses (§7.2), reusing ExcelImportDialog's checklist/progress bar. Error banner + toast on `failed`/`cancelled`.
  - **Review:** on completion, `safeRows`-rebuild the result (RTDB drops empty arrays), POST to `statement-import/dedupe`, render the grid. Reuse the **warnings banner** (now also carries control-total + truncation + document-overlap warnings), the account `<select>` filtered `account_type === row.direction` (default = resolved AI suggestion, keyed by `source_ref`), the **non-business-book confirm gate**, and `formatOccurredOn`. Add:
    - a **prominent income caution banner** ("Bank/Venmo income is likely already recorded as platform income — leave these unchecked unless this is money that never went through the platform");
    - income rows tagged `newCandidate` are **visually separated** ("New — opt-in candidate") from the flagged-duplicate pile so the coach's attention lands on the handful that are genuinely new;
    - when `excludedTransferTotalCents > 0`, a caution: "We excluded $X of transfers/card payments. If any is a credit-card payment, **import that card's statement** so its purchases are counted (excluding without importing loses those deductions).";
    - duplicate/transfer/soft-suspect/payout rows show a badge + reason and are **pre-excluded** per `defaultInclude`; `confidence==="low"` rows visually flagged.
  - **Post:** `POST statement-import/commit` with included rows (+ `document_id`); excluded/transfer rows omitted; toast `posted N (M already recorded — skipped)`; `onSaved()` + close.
  - **Zero-row / image-PDF state:** friendly "No transactions detected — is this a scanned image PDF? OCR arrives in Phase 3" (the handler pushes a warning when parsed text is empty).
  - **Closed-dialog contract:** closing mid-job **abandons the in-flight review** (candidate rows post client-side, so there is no server-side resume in Phase 2). The file + `bookkeeping_documents` row persist; re-importing is safe (source_ref dedupe). Documented in the dialog copy; no resume path this phase.
- **`formatOccurredOn`** is currently a private duplicate in ImportPlatformDialog + LedgerTable — **extract to a shared `lib/bookkeeping/format.ts`** (next to `formatCents`) and repoint all three call sites.
- **`BooksClient` toolbar:** add **"Import statement"** beside "Import platform income".
- **`LedgerTable`** already renders the `statement_import` "Statement" badge + `SOURCE_OPTIONS` filter — no change.
- **Statements management** (D12 delete/download reachability): on `/admin/books/accounts` — the page server-loads `listDocuments(primaryBook.id)` and passes `initialDocuments`; `AccountsManager` gains an `initialDocuments` prop + a book-change refetch (`GET documents?book_id=`) and renders a list (filename, date, row/posted counts, retain-until) with **Download** (→ `documents/[id]/download` → `window.open`) and **Delete** (confirm → `documents/[id]` DELETE → refetch).
- Design system: semantic colors + font classes only; `formatCents` for every amount; `EmptyState` where nothing is present.

---

## 10. Folded-in Phase-1 review minors

| # | Fix | Location |
|---|---|---|
| **M3** | Date-filter `client_memberships` in `listPlatformIncome` (currently `.range()` only); drive the membership-gap warning by the import window (`buildIncomeDrafts` takes an optional window; warn about memberships overlapping it). | `lib/db/bookkeeping.ts`; `lib/bookkeeping/income-adapter.ts` |
| **M4** | Validate `direction`/`source` query params against the enums in `entries` GET → `400` on invalid (today blind-cast → 0 rows). | `app/api/admin/bookkeeping/entries/route.ts` |
| **M5** | Book-scoped guard on **`entries/[id]` PATCH only** (accounts PATCH cannot move book/type — its schema exposes neither, so no cross-book mutation is possible): load the pre-image via new `getEntry(id)`; if the patch sets `account_id`, assert the target account's `book_id === entry.book_id` **and** `account_type === effective direction` (`patch.direction ?? entry.direction`) → `409` on mismatch (`404` if the entry is gone). Helper `assertAccountInBook(accountId, bookId, direction)` in the DAL (§6.3). | `app/api/admin/bookkeeping/entries/[id]/route.ts`; `lib/db/bookkeeping.ts` |
| **M6** | Add `.` to the `.or()` search-escaping set in `applyEntryFilters`. | `lib/db/bookkeeping.ts` |
| **M7** | `statement_import` wired end-to-end (this feature). | — |

---

## 11. Testing strategy

- **Pure, zero mocks (`__tests__/lib/bookkeeping/…`):**
  - `statement-parse.test.ts` — all §6.1 fixtures incl. both-columns-populated/negative-credit/CR-DR/summary-line-exclusion; `transferSuspicion` hard/soft/null tiers; `computeStatementSourceRef` stability + occurrence-index + **unchecked-subset re-import still dedupes**; cents boundary; tz-invariance.
  - `statement-dedupe.test.ts` — exact/aggregate-payout/period-overlap income flags; `newCandidate` on unmatched income; expense cross-statement match **requires description similarity** (near-daily different charges not false-flagged); transfer + soft-suspect pre-exclude; span-window boundaries; income `defaultInclude=false`; **input-order return**; greedy determinism; self-match.
  - `income-adapter.test.ts` — extend for the M3 window-driven membership warning.
- **Route tests** — `vi.mock('@/lib/db/bookkeeping')` (+ storage/job helpers); import handler after mocks; `Request as never`; async `params`. Cover: 403 self-gate every route; M4 `400`; **M5 `409`/`404`** on cross-book / wrong-type account pointer / missing entry; dedupe span-widening + empty-rows short-circuit + overlap warning; **commit rejects a mangled `source_ref`** and omits excluded rows; upload returns `duplicateUploadHint` on a repeat sha256.
- **M6** — a small `.or()` escaping test.
- **Functions-side** — twin `statementImportSchema` parse test + the csv_structured `ref`-join (unknown ref ignored, missing ref → uncategorized never dropped) (RFC-4122 UUID fixtures; Zod v4 strict UUIDs).
- **Money-path proof** — one throwaway live-DB test: commit statement drafts twice → second inserts 0 (source_ref idempotency); then **deleted**. Never `__tests__/db/`.
- **Baseline discipline** — snapshot the ~8–9 known reds before/after; stash-test to prove causation; prod source stays `tsc`-clean.

---

## 12. Standing risks carried forward

1. **Book isolation is application-only** (RLS decorative) — every new DAL/route scopes `book_id`; **M5** closes the Phase-1 `entries/[id]` PATCH gap.
2. **PostgREST 1000-row cap** — every ledger/income/document read paginates via `fetchAllRows`.
3. **Statement income cannot be auto-deduped against Stripe payouts in Phase 2** (aggregate/net) — income is pre-excluded + flagged; real reconciliation is Phase 6 (§1.1, D6).
4. **Credit-card / transfer classification** — mitigated by the AI `is_transfer` + `transferSuspicion` hard/soft tiers (undetected transfers now fail toward exclusion, not toward a fake expense). Residual under-count risks — a transfer both detectors miss, new income left unchecked, a card payment excluded without importing the card — are surfaced in review and documented in §13.
5. **Financial docs → private bucket only** — `getPrivateBucket()`, signed URLs, upload-year+7 `retain_until`, deletion path day one (D12). **Deployment precondition:** `FIREBASE_PRIVATE_BUCKET` (and Firebase admin creds) must be set in the **Vercel runtime**, not only Firebase Secret Manager (`split_reel_vercel_env`) — verify before the owner ships; the upload route fails friendly if unset.
6. **functions/ ↔ lib/ twin copy** — the AI schema/prompt duplicate into `functions/src/ai/`; the parser + fuzzy matcher stay in `lib/` (run app-side) to avoid extra copies. `source_ref` is computed app-side (dedupe route), so no crypto twin.
7. **AI must not silently truncate/alter** — csv_structured row set is fixed by construction (ref-join); pdf/csv_raw reconciles against control totals; caps warn deterministically.

---

## 13. Honesty guardrails (inherited + review-hardened)

- Every AI category is a **candidate the coach confirms** — nothing posts unreviewed.
- Duplicates are **flagged, never auto-dropped**; statement **income is pre-excluded** because Phase-2 flagging cannot fully protect against aggregated Stripe payouts (§1.1) — the review UI says so plainly.
- **Known hazard — credit-card payments cut both ways.** A "PAYMENT TO CREDIT CARD" on a bank statement and the card's own purchases are the same money — the transfer/exclude classification pre-excludes the bank-side payment so it is not double-counted. **But excluding it without importing that card's statement silently drops the card's real (deductible) purchases** — the review surfaces the excluded-transfer total and prompts the coach to import the card statement. Both directions are stated in the caution copy so the coach neither double-counts nor under-counts.
- Venmo/bank = **statement-file import**, never implied live sync (no Venmo API, no Plaid).
- Statements retained **7 years** (upload-year basis), private bucket, working deletion path (D12).
- Business and personal **stay in separate books** — a statement imports into exactly one selected book.
