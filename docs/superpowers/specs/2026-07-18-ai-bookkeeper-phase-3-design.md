# AI Bookkeeper — Phase 3 — Receipts — Design

**Date:** 2026-07-18
**Phase:** 3 of 6 (see umbrella design `docs/superpowers/specs/2026-07-17-ai-bookkeeper-design.md` §3)
**Branch:** `feat/ai-bookkeeper-phase-3` (do NOT push until the owner says so)
**Status:** Design approved by owner ("lgtm", 2026-07-18) after three scoping decisions (below). Builds directly on Phase 1 (ledger spine) and Phase 2 (statement import), both SHIPPED and live on main (`b22a5ac7`).
**Builds on / reuses:** `bookkeeping_documents` (migration 00185, `kind='receipt'` already reserved), the private-bucket helpers `lib/bookkeeping/documents.ts`, the AI-job pattern (`functions/src/statement-import.ts` + the `onDocumentCreated` dispatch in `functions/src/index.ts` + twin schema/prompt in `functions/src/ai/`), the review-and-post UI (`StatementImportDialog.tsx`, `StatementsList.tsx`, `ManualEntryDialog.tsx`), the DAL `lib/db/bookkeeping.ts`, and the audit-slug / cron-retention patterns. The ledger already accepts `source='receipt'` (verified 00183:50) and `business_purpose` (00183:47) exists.

---

## 0. Scoping decisions (owner, 2026-07-18)

1. **Build scope this session:** receipts-CORE (cash 2-tap + photo→vision→review→post) **+ retention pruning cron + Amazon CSV import + the 3 Phase-2 review follow-ups.** The Gmail-label poller is **spec-only** (Phase-3b) — no inbound path exists and it needs app-runtime Gmail API credentials that are not configured. §12 carries its spec.
2. **business_purpose:** **required only for IRS-sensitive accounts** (a new per-account `requires_business_purpose` flag, seeded true for Meals / Travel / Vehicle). Optional but pre-filled from the AI hint everywhere else.
3. **Retention semantics:** DB-backed flag **default OFF**; when on, prune any document past `retain_until`; the ledger entry survives via `ON DELETE SET NULL` on a new `document_id` column (keep the bookkeeping record, drop the no-longer-required image).

---

## 1. Scope

Two capture modes plus a bulk importer, all posting into the existing ledger:

- **(a) Cash 2-tap (no file).** Coach enters amount + category + counterparty + `business_purpose` + date → posts a `source='receipt'`, `direction='expense'` entry. No document, no vision. `source_ref=null` (unlimited, NULLs-distinct, exactly like manual entries).
- **(b) Admin photo upload.** Image → private bucket + a `bookkeeping_documents` row `kind='receipt'` → a **vision AI job** extracts `{vendor, amount_cents, occurred_on, suggested_category, business_purpose_hint, confidence, warnings}` → coach reviews every field as a candidate → posts. The posted entry carries `document_id` (the receipt↔entry link) and `source_ref=receipt:{documentId}` (re-posting the same photo dedupes).
- **(c) Amazon CSV.** Amazon order-history CSV → deterministic parse (papaparse) → reuse the statement categorization job to assign accounts → review → post as `source='receipt'`, `source_ref=amazon:{orderId}:{lineIndex}` (re-import dedupes).

Every AI-extracted field is a **candidate the coach confirms** — nothing posts unreviewed. `business_purpose` (the beat Darren named) is captured on every receipt and **required** for IRS-sensitive categories.

### 1.1 Non-goals (explicitly out of Phase 3 / this build)

- **Gmail-label poller** for forwarded-email receipts → **spec-only, Phase-3b** (§12; needs Gmail API creds + a new poll infra).
- **PDF receipts** (scanned or digital-invoice PDFs) → **Phase-3b.** Core photo intake is images (`jpeg`/`png`/`webp`); Amazon covers the bulk-digital case. (A one-file `pdf-parse` text path is a cheap fast-follow, noted in §5.6.)
- **HEIC** images → Phase-3b (needs libheif conversion; friendly "convert to JPG/PNG" message for now).
- **Cross-source fuzzy dedupe of receipts vs statements** (the same purchase appearing as both a photo receipt and a bank line) → Phase-3b. Each receipt has a *stable* `source_ref`, so re-imports are already deduped; receipts stay out of `listPostedForDedupe`'s fuzzy matcher for now.
- Depreciation (D7, Phase 6), reports/exports (Phase 4), AI deduction suite (Phase 5), monthly close (Phase 6), payouts/net (Phase 6), chat tools (Phase 6).

---

## 2. Inherited decision anchors

- **D5 — receipt intake ranking:** cash 2-tap + admin photo upload first (cheap, this build); Amazon CSV next (this build, papaparse); forwarded email last (Phase-3b, hardest — no inbound path). Vision→structured needs the functions-side `callAgent` widened to accept image content blocks (§5.1).
- **D12 — retention:** receipt images → **private bucket only** (`getPrivateBucket()`, signed-URL). A `bookkeeping_documents` row carries `retain_until`. **Basis for receipts = occurred-year + 7** (set at upload as upload-year+7, updated to the confirmed occurred-year+7 at commit). Deletion path already exists (Phase 2); the **automated pruning cron ships now** (§7).
- **D7 — depreciation is NOT this phase.** Receipts capture what was spent; whether an asset is expensed or depreciated is a Phase-6 accountant decision.
- **Standing risk (D1):** book isolation is application-level only (RLS decorative; all DALs service-role). Every new DAL/route scopes `book_id`.

---

## 3. Data model — migration `00186_bookkeeping_receipts.sql`

Additive + reversible. `kind='receipt'` (00185:6) and `source='receipt'` (00183:50) already exist → no enum churn. Applied to prod via `mcp__supabase__apply_migration` (`supabase_migrations_via_mcp`; CLI not linked). Next-available `00186` (confirmed after 00185).

```sql
-- 00186_bookkeeping_receipts.sql
-- Phase 3 (receipts): link a receipt document to its ledger entry, mark
-- IRS-sensitive accounts as requiring a business purpose, and seed the
-- (default OFF) retention-pruning cron flag. Additive + reversible.

-- 1) receipt <-> ledger link. ON DELETE SET NULL is what lets the retention
--    cron drop an expired image while the ledger entry survives (D12, §7).
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

-- 3) retention cron flag — DB-backed, default OFF (destructive; no_default_feature_flags).
insert into system_settings (key, value, description) values
  ('cron_bookkeeping_retention_enabled', 'false'::jsonb,
   'Daily cron: prune bookkeeping_documents (statements + receipts) past retain_until — deletes the bucket object + row, nulls the linked ledger entry document_id. Default OFF (destructive).')
on conflict (key) do nothing;
```

**`types/database.ts` additions:**
- `BookkeepingLedgerEntry` (line ~529 area): add `document_id: string | null`.
- `BookkeepingAccount`: add `requires_business_purpose: boolean`.

No new table — `bookkeeping_documents` (00185) already holds receipts.

---

## 4. Cash 2-tap capture (no file)

The cheapest, most-used path. A compact dialog (clone `ManualEntryDialog`, which already has a `businessPurpose` field): amount, category `<select>` (expense accounts only), counterparty, `occurred_on` (default today), `business_purpose`.

- **Route:** `POST /api/admin/bookkeeping/receipts/cash` — Zod `receiptCashSchema`. Auth self-gate → 403. Builds a `createEntry({ …, direction:'expense', source:'receipt', source_ref:null, import_batch_id:null, document_id:null })`.
- **Business-purpose gate (server):** if the chosen account's `requires_business_purpose` is true and `business_purpose` is blank → **422** `{ error: "business_purpose required for this category" }`. Resolve the flag via `getAccount(account_id)` (new tiny DAL read) and confirm the account is in `book_id` and is an expense account (reuse `assertAccountInBook`).
- **Audit:** `bookkeeping.receipt_cash_recorded` (`commerce`).

`source_ref=null` means the plain `UNIQUE(book_id, source, source_ref)` (00184, NULLs-distinct) allows unlimited cash receipts — same as manual entries.

---

## 5. Admin photo upload → vision → review → post

### 5.1 Widen the functions-side `callAgent` for images

`functions/src/ai/anthropic.ts` `callAgent`/`callAgentWithModel` currently take `userMessage: string`. The `userContent` builder already produces `Anthropic.Messages.ContentBlockParam[] | string`. Add an **optional** `images?: Array<{ media_type: string; data: string }>` to the options; when present, prepend image blocks to the user content:

```ts
// inside callAgentWithModel, when building userContent:
const imageBlocks = (options?.images ?? []).map((img) => ({
  type: "image" as const,
  source: { type: "base64" as const, media_type: img.media_type, data: img.data },
}))
// userContent = [...imageBlocks, ...(cachedPrefix ? [prefixBlock] : []), { type:"text", text:userMessage }]
```

- **Backward-compatible:** every existing caller passes no `images` → unchanged behavior (string path). A unit test asserts the image blocks are assembled in the right shape and that omitting `images` yields the exact prior content.
- **Model:** `MODEL_SONNET` (`claude-sonnet-4-6`) is vision-capable; the Haiku 4.5 fallback (`callAgent`'s transient-error path) is too. No new model constant.
- Applies to the **primary tool_use path**; the text-fallback path also prepends the same image blocks (a vision receipt that falls back to text still needs the image).

### 5.2 Job type + dispatch (twin registries)

- Add `"receipt_scan"` to **both** `AiJobType` unions: `lib/ai-jobs.ts` (line ~12-43) and `functions/src/ai/types.ts` (line ~208-216).
- Add `"receipt_scan"` to `AiJobKind` in `hooks/use-ai-jobs-dock.tsx` (line 24) + a dock card label ("Receipt scan").
- New `onDocumentCreated("ai_jobs/{jobId}")` export in `functions/src/index.ts` guarding `data.type === "receipt_scan"` (mandatory — every `ai_jobs` create fires all triggers), dynamic-importing `./receipt-scan.js` → `handleReceiptScan(jobId)`. Config mirrors `statementImport`: `timeoutSeconds:540, memory:"1GiB", region:"us-central1", secrets: allSecrets`.

### 5.3 The image lives in the bucket, not the job doc

Firestore docs cap at 1 MB; receipt photos are larger. So the job doc carries only `storagePath` (+ `mimeType`, `accounts`, `bookName`, `bookKind`, `documentId`, `logId`, `requestedBy`). The **function** downloads the bytes from the private bucket (functions/ has native admin bucket access — `storage_firebase`), and, if the image exceeds the Anthropic limit, **downscales** before the vision call:

- The function calls `getPrivateBucket().file(storagePath).download()` → Buffer.
- **Downscale:** if `sharp` is available in `functions/` (plan Task 1 verifies `functions/package.json`), resize to ≤1568px longest edge, re-encode JPEG q80 → guaranteed under Anthropic's 5 MB base64 / size limits and token-optimal. If `sharp` is **not** present, the upload gauntlet caps images at **3.5 MB raw** (≈ <5 MB base64) and the function sends bytes as-is; a friendly warning covers oversized uploads. (Plan records which branch was taken.)
- base64-encode → pass as `images:[{ media_type, data }]` to `callAgent`.

### 5.4 Twin schema/prompt

`functions/src/ai/receipt-schema.ts` + `receipt-prompt.ts` (no lib twin needed for the AI schema — mirrors statement). Output schema (**every field nullable + optional — see 5.5**):

```ts
export const receiptScanSchema = z.object({
  vendor: z.string().nullable().optional(),
  amount_cents: z.number().int().nonnegative().nullable().optional(),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  suggested_category: z.string().nullable().optional(),   // one of the provided account names, or null
  business_purpose_hint: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  confidence: z.enum(["low", "medium", "high"]),
  warnings: z.array(z.string()),
})
```

The prompt: "You are reading a photographed receipt for a strength-and-conditioning coach's bookkeeping. Extract the vendor, total amount (integer cents), date (YYYY-MM-DD), the best-matching expense category from the provided list (or null), and a one-line business-purpose suggestion. If a field is unreadable, return null for it and add a short note to `warnings`. Never guess an amount or date you cannot read." Account names are passed in the user message (like statements). `suggested_category` resolves to `account_id` by case-insensitive name match at review; unmatched → uncategorized. The AI never creates categories.

### 5.5 The RTDB-null landmine (amplified here — the Phase-2 Critical)

`rtdb_drops_null_leaves`: Firebase RTDB silently drops `null` **leaf** values on write. Phase 2's Critical (C1) was exactly this — a `null` field became `undefined` in the dialog and a `.nullable()`-but-not-`.optional()` schema rejected it, 400-ing the whole review. **Receipts are worse: most vision fields are nullable** (a blurry photo returns nulls). Mitigations, all mandatory:
1. Every schema field except `confidence`/`warnings` is `.nullable().optional()` (above).
2. The function writes the result to Firestore + RTDB; a `safeReceiptResult()` on the dialog side **coalesces every field `?? null`** and rebuilds `warnings` as `[]` if the array was dropped (mirror `safeResultRows`/`safeResultWarnings` in `StatementImportDialog.tsx:64-75`).
3. An explicit end-to-end test: a vision result of `{ vendor:null, amount_cents:null, occurred_on:null, suggested_category:null, business_purpose_hint:null, confidence:"low", warnings:[] }` survives job→RTDB-strip→dialog→review without error.

### 5.6 Progress + log lifecycle (mirror statement handler)

- `createJobProgressUpdater(jobId, 2)` with pinned statuses `extracting → finalizing` (2 steps — single vision call, no separate parse). `createCancellationChecker(jobId)`.
- `ai_generation_log`: created at upload (route) with `input_params:{ source:"receipt_scan", document_id }`, `total_steps:2`; completed by the function with `output_summary:{ vendor, amount_cents, occurred_on, confidence, warnings, document_id }`, `tokens_used`; `markLogCancelled`/failed on cancel/fail.
- On completion the function may back-fill `bookkeeping_documents.period_start=period_end=occurred_on` and `row_count=1` (parity with statements; harmless).
- Failure/cancel: the document row + object persist (deletable via the statements/receipts list; `retain_until` applies).

*(Fast-follow, if cheap: a `pdf` receipt path — `pdf-parse` text app-side → text-only `callAgent` (no image block) — reuses the same job. Deferred to Phase-3b unless it fits the build budget.)*

### 5.7 Review + post (single receipt = single entry)

A **review card** (not a grid — one receipt = one entry): the receipt image preview (signed URL via `signStatementDownload(storage_path)`), plus editable candidates: vendor→counterparty, amount (`formatCents`-styled input), date, category `<select>` (expense accounts of `book_id`), and **business_purpose** (pre-filled from `business_purpose_hint`). Low-confidence fields flagged; `warnings` surfaced in a banner.

- **Commit:** `POST /api/admin/bookkeeping/receipts/commit` — `receiptCommitSchema` (§9). Creates **one** entry: `source:'receipt'`, `source_ref:'receipt:'+document_id`, `document_id`, `business_purpose`, `account_id`, `direction:'expense'`, via a new `insertReceiptEntry()` DAL call (the generic `insertImportedEntries` does **not** carry `business_purpose` or `document_id`; §6). Then update the document's `retain_until` to `occurred-year + 7` and `linkDocumentBatch`.
- **Business-purpose gate (server + client):** blocked when the chosen account `requires_business_purpose` and `business_purpose` is blank → 422. Account-scope checked via `assertAccountInBook`.
- **source_ref guard:** commit rejects a `source='receipt'` row whose `source_ref` doesn't match `^receipt:[0-9a-f-]{36}$` or `^amazon:` (defends layer-1 idempotency; mirrors the statement route's regex guard).
- **Audit:** `bookkeeping.receipt_uploaded` (upload), `bookkeeping.receipt_imported` (commit).

---

## 6. DAL additions — `lib/db/bookkeeping.ts`

```ts
export async function getAccount(id: string): Promise<BookkeepingAccount | null>          // resolve requires_business_purpose + book scope
export async function insertReceiptEntry(input: {                                          // single receipt → one entry, carries business_purpose + document_id
  book_id: string; account_id: string | null; amount_cents: number; occurred_on: string
  counterparty: string | null; business_purpose: string | null; memo: string | null
  source_ref: string; document_id: string | null; import_batch_id: string | null
}): Promise<{ inserted: number; id: string | null }>                                       // upsert onConflict(book_id,source,source_ref) ignoreDuplicates
export async function updateDocumentRetainUntil(id: string, retainUntil: string): Promise<void>
export async function assertAccountsInBook(                                                 // Phase-2 follow-up: batch account-scope check
  bookId: string, items: Array<{ accountId: string; direction: LedgerDirection }>,
): Promise<void>                                                                            // loops assertAccountInBook; throws the same coded errors
export async function insertAmazonEntries(bookId: string, importBatchId: string, drafts: ...): Promise<{ inserted: number }>  // source='receipt', carries business_purpose per row (optional)
export async function pruneExpiredDocuments(today: string): Promise<{ documents: Array<{ id: string; storage_path: string }> }>  // retention (§7)
```

- `insertReceiptEntry` is `insertImportedEntries` + `business_purpose` + `document_id` + returns the new id (needed to confirm the link). Uses the same `onConflict:"book_id,source,source_ref", ignoreDuplicates:true` upsert.
- **`linkDocumentBatch` gets book-scoped** (Phase-2 follow-up): add a `bookId` param and `.eq("book_id", bookId)` so a document is only linkable within its own book. Update the one existing caller (statement commit) accordingly.
- Every read paginates via `fetchAllRows` (PostgREST 1000-row cap; `postgrest_1000_row_cap`).

---

## 7. Retention pruning cron (D12 — ships now)

Modeled exactly on `auditLogRetentionCron` (`functions/src/index.ts:1779-1822`).

- **Twin helper `pruneExpiredDocuments`** — `lib/db/bookkeeping.ts` (constructs its own service-role client) **and** `functions/src/lib/bookkeeping-retention.ts` (takes `supabase` as a param), mirroring the `pruneAuditLogs` twin (`lib/db/audit-logs.ts` ↔ `functions/src/lib/audit-logs.ts`). It:
  1. Selects `bookkeeping_documents where retain_until < today` (paginated).
  2. For each: delete the **bucket object first** (`getPrivateBucket().file(storage_path).delete({ ignoreNotFound:true })` — resilient to a missing object), then delete the row. The FK `ON DELETE SET NULL` nulls any linked ledger entry's `document_id` (the entry — the actual book record — survives; §3).
  3. Returns the count + the pruned ids for logging.
- **Cron export `bookkeepingRetentionCron`** — `onSchedule` daily `"0 4 * * *"` UTC, `timeoutSeconds:300, memory:"256MiB", region:"us-central1", secrets:[supabaseUrl, supabaseServiceRoleKey]` (+ the Firebase storage env for bucket deletes). Reads `system_settings.cron_bookkeeping_retention_enabled === true` (default OFF, seeded 00186) — **skips entirely when off.** Wrapped in `logCronStart`/`logCronEnd` (`functions/src/lib/cron-runs.js`).
- **Health visibility:** add `bookkeepingRetentionCron` to the `automation-health-scanner` expected-cron list (`lib/automation/automation-health-scanner.ts`) so a silent failure surfaces (the audit cron is already there — parity).
- **Destructive-safety:** nothing is near 7 years old (feature is days old) → the cron prunes **nothing** imminently regardless. Correctness now, effect later. The pure "which docs are expired" predicate is unit-tested; a route-style test asserts flag-OFF short-circuits and bucket-delete errors are swallowed (`ignoreNotFound`).

---

## 8. Amazon CSV import

Rides the statement pipeline shape with an Amazon-specific parser and a receipt-flavored commit.

- **Parser (pure) `parseAmazonCsv(text)` in `lib/bookkeeping/amazon-parse.ts`** (papaparse; zero-IO; zero-mock tests). Amazon's "Order History Report" / "Items" CSV columns vary by export; detect the common shapes (`Order Date`, `Order ID`, `Title`/`Product Name`, `Item Total`/`Total Owed`, `Currency`). Emits normalized expense rows `{ occurred_on, description, amount_cents, direction:'expense', orderId, lineIndex }` + `warnings[]` for rows it can't place. Amounts parsed via the existing `parseAmountToCents` (string-split, never `parseFloat*100`), dates via `parseStatementDate` (tz-independent) — both already exported from `statement-parse.ts`.
- **Stable source_ref (deterministic, app-side at parse):** `amazon:${orderId}:${lineIndex}` — re-importing the same CSV dedupes via the UNIQUE. No fuzzy dedupe needed (order IDs are stable).
- **Upload route** `POST /api/admin/bookkeeping/receipts/amazon`: multipart `csv` + `book_id` → storage-configured guard → gauntlet (`text/csv`/`.csv`, 10 MB) → `parseAmazonCsv` → store CSV as a `bookkeeping_documents` row `kind:'receipt'` → create a **`statement_import` `csv_structured` job** feeding the Amazon rows (as `{ ref: source_ref, occurred_on, description, amount_cents, direction:'expense' }`) + accounts (the statement AI job just assigns categories — genuine reuse; it is content-agnostic). 202 `{ jobId, documentId, log_id }`. Audit `bookkeeping.receipt_uploaded`.
- **Review + commit:** reuse the statement review grid (category `<select>` + include checkboxes) in an `AmazonImportDialog` (a thin variant of `StatementImportDialog`, or the same dialog parameterized). Commit → `POST /api/admin/bookkeeping/receipts/amazon/commit` → `insertAmazonEntries(source='receipt', source_ref='amazon:…')` + `linkDocumentBatch`. Rejects a mangled `amazon:` ref. Audit `bookkeeping.receipt_imported`.
- Amazon rows are ordinary purchases — `business_purpose` is optional here (not per-receipt IRS substantiation); the coach can add one in review. The `requires_business_purpose` gate still applies if a coach assigns a sensitive category to an Amazon row.

---

## 9. Routes + validators

All under `app/api/admin/bookkeeping/`, all **self-gate** (`const s = await auth(); if (!s?.user?.id || s.user.role !== "admin") return 403`; never `requireAdmin()` — it returns a redirect in API routes). Mutations `void recordAudit(...)` inline (the bookkeeping convention).

| Route | Method | Behavior |
|---|---|---|
| `receipts/cash` | POST | `receiptCashSchema` → business-purpose gate (422) → `assertAccountInBook` → `createEntry({source:'receipt', direction:'expense', source_ref:null})`. Audit `receipt_cash_recorded`. |
| `receipts/upload` | POST | multipart `file`(image) + `book_id` → storage guard → gauntlet (jpeg/png/webp; ≤3.5 MB or ≤10 MB per §5.3) → sha256 + `findDocumentBySha256` hint → `storeStatementFile` (generic, reused) + `createDocument(kind:'receipt', retain_until: upload-year+7)` → `receipt_scan` job (Firestore doc + `createGenerationLog` + RTDB seed) → 202 `{jobId, documentId, log_id, duplicateUploadHint?}`. Audit `receipt_uploaded`. |
| `receipts/commit` | POST | `receiptCommitSchema` → source_ref guard → business-purpose gate (422) → `assertAccountInBook` → `insertReceiptEntry` (sets `document_id`, `business_purpose`) → `updateDocumentRetainUntil(occurred-year+7)` → `linkDocumentBatch(document_id, book_id, batchId, 1)`. Audit `receipt_imported`. |
| `receipts/amazon` | POST | multipart `csv` + `book_id` → `parseAmazonCsv` → store doc `kind:'receipt'` → `statement_import` csv_structured job. Audit `receipt_uploaded`. |
| `receipts/amazon/commit` | POST | `amazonCommitSchema` → batch `assertAccountsInBook` → `insertAmazonEntries(source:'receipt')` → `linkDocumentBatch`. Audit `receipt_imported`. |

**Documents list/delete/download** (`documents`, `documents/[id]`, `documents/[id]/download`) already exist (Phase 2) and are `kind`-agnostic — receipts appear there automatically. The receipts management UI (§10) filters/labels by `kind`.

**Statement commit follow-up:** the existing `statement-import/commit` route gains the batch `assertAccountsInBook` check (Phase-2 M5 only guarded the single-entry PATCH) and the book-scoped `linkDocumentBatch`.

**New Zod schemas in `lib/validators/bookkeeping.ts`:**
- `receiptCashSchema = { book_id: uuid, account_id: uuid, amount_cents: int≥0, occurred_on: DATE, counterparty: string.max200.nullable().optional(), business_purpose: string.max1000.nullable().optional(), memo: string.max500.nullable().optional() }`.
- `receiptCommitSchema = { book_id: uuid, document_id: uuid, account_id: uuid.nullable().optional(), amount_cents: int≥0, occurred_on: DATE, counterparty: nullable, business_purpose: string.max1000.nullable().optional(), memo: nullable, source_ref: string }`.
- `amazonCommitSchema = importCommitSchema.extend({ document_id: uuid.optional() })` shape but `source` fixed to `'receipt'` and each entry may carry `business_purpose`.

### 9.1 Audit slugs (add to `lib/audit/actions.ts`)

```ts
{ slug: "bookkeeping.receipt_cash_recorded", category: "commerce",             description: "Cash receipt recorded to the ledger" },
{ slug: "bookkeeping.receipt_uploaded",       category: "commerce",             description: "Receipt image / Amazon CSV uploaded" },
{ slug: "bookkeeping.receipt_imported",       category: "commerce",             description: "Receipt posted to the ledger" },
```
(Document delete/download slugs already exist and are `kind`-agnostic.)

---

## 10. UI

- **`components/admin/bookkeeping/ReceiptCashDialog.tsx`** — clone `ManualEntryDialog` (already has `businessPurpose`). Expense accounts only; business-purpose field turns required (client-side) when the selected account `requires_business_purpose`; POST `receipts/cash`; `router.refresh()`.
- **`components/admin/bookkeeping/ReceiptUploadDialog.tsx`** — clone `StatementImportDialog`'s upload + RTDB-polling shell, but the **review is a single card** (§5.7), not a grid. States `upload → processing → review → done`. Registers with the dock (`addJob({ kind:"receipt_scan", label:"Receipt scan" })`). `safeReceiptResult()` coalesces RTDB-dropped nulls (§5.5). Image preview via a signed download URL. Business-purpose required (client) for sensitive accounts.
- **`components/admin/bookkeeping/AmazonImportDialog.tsx`** — statement review grid + RTDB polling, commit to `receipts/amazon/commit`.
- **`BooksClient.tsx` toolbar:** add **"Add cash receipt"**, **"Upload receipt"**, **"Import Amazon"** beside the existing import buttons. `SOURCE_OPTIONS` already includes `{value:"receipt", label:"Receipt"}`; `LedgerTable` already labels/tones `receipt`.
- **`LedgerTable.tsx`:** add a small **📎 receipt** indicator on rows with a non-null `document_id` (click → sign + open the image). Requires `document_id` on the row shape (added via `listEntries`).
- **Receipts in the documents list:** `StatementsList` (mounted by `AccountsManager`) is `kind`-agnostic; add a `kind` label column (Statement / Receipt) so receipts are visible/downloadable/deletable there. (Rename is optional — it's really a "Documents" list now.)
- Design system: semantic colors + font classes only; `formatCents` for every amount; `formatOccurredOn` for dates; `EmptyState` where nothing is present.

---

## 11. Folded-in Phase-2 review follow-ups

| # | Fix | Location |
|---|---|---|
| **F1** | **Commit routes re-validate account scope in batch.** M5 guarded only `entries/[id]` PATCH. Add `assertAccountsInBook(bookId, items)` to the **statement commit** and **new receipt/amazon commit** routes before insert (reject cross-book / wrong-type account pointers → 409). | `app/api/admin/bookkeeping/statement-import/commit`, `receipts/commit`, `receipts/amazon/commit`; `lib/db/bookkeeping.ts` |
| **F2** | **`linkDocumentBatch` book-scoped.** Add a `bookId` param + `.eq("book_id", bookId)`; update the statement-commit caller. | `lib/db/bookkeeping.ts`; statement commit route |
| **F3** | **Pure tests for `reconcileControlTotals` + the 500-cap logic** in `functions/src/statement-import.ts` (currently untested). Extract the reconciliation + cap helpers into a pure exported function if needed, then unit-test (mismatch warning, all-null totals → "completeness unverified" warning, row-count-at-cap → truncation warning). | `functions/src/statement-import.ts` (+ a functions-side test) |

---

## 12. Phase-3b spec — Gmail-label poller (NOT built this session)

**Why deferred:** there is no inbound email path in the platform, and forwarding-based receipt intake needs app-runtime Gmail API OAuth credentials (a Google Cloud project + a refresh token for the coach's inbox, or a domain-wide-delegation service account) that are **not configured**. Building it blind would be untested infrastructure on the money path. Left cleanly specced for a Phase-3b session once creds exist.

**Shape when built:**
1. **Creds:** a Gmail API OAuth refresh token (or DWD service account) for `darren@darrenjpaul.com`, stored in Firebase Secret Manager **and** the Vercel runtime (`split_reel_vercel_env` applies). Coach forwards receipts to a Gmail label (e.g. `Receipts/Bookkeeping`).
2. **Poller:** a Firebase `onSchedule` (e.g. hourly) → Gmail `users.messages.list?labelIds=<label>&q=is:unread` → for each new message: pull attachments (image/PDF) + body → store each attachment as a `bookkeeping_documents` row `kind:'receipt'` (default book = primary business) → enqueue a `receipt_scan` job → on success, remove the label / mark read (idempotent via message-id in `source_ref` or a processed-ids table). Flag-gated (`cron_gmail_receipt_poll_enabled`, default OFF). Logged via `logCronStart/End`; added to the health scanner.
3. **Review:** the same receipt review card — forwarded receipts land in the coach's review queue exactly like photo uploads.
4. **Risks:** Gmail API quotas, attachment MIME variety (inline vs attached), idempotency across re-polls, and the same RTDB-null discipline. Its own spec → plan → build → review cycle.

---

## 13. Testing strategy

- **Pure, zero mocks (`__tests__/lib/bookkeeping/…`):**
  - `amazon-parse.test.ts` — column-shape detection, `amazon:${orderId}:${lineIndex}` ref stability + distinctness, amount/date parsing boundaries, quoted-comma / multi-line, garbage→warning.
  - `receipt.test.ts` — `accountRequiresBusinessPurpose` logic, receipt `source_ref` shape, the retention "which docs expired" predicate (`retain_until < today`, tz-independent).
  - `statement-reconcile.test.ts` (F3) — extracted `reconcileControlTotals`/cap helpers: mismatch warning, all-null totals warning, row-count-at-cap truncation warning.
- **Route tests** (`vi.mock('@/lib/db/bookkeeping')` + storage/job mocks; import handler after mocks; `Request as never`; async `params`): 403 self-gate every new route; **business-purpose 422** on a sensitive account with blank purpose (cash + commit); receipt commit **sets document_id** + rejects a mangled `receipt:`/`amazon:` source_ref; upload sha256 `duplicateUploadHint`; **F1 409** on cross-book / wrong-type account in the statement + receipt commit routes.
- **Functions-side** — twin `receiptScanSchema` parse test (incl. the **all-null vision result** survives, §5.5); the `callAgent` image-block assembly test (§5.1); F3 reconciliation tests. RFC-4122 UUID fixtures (Zod v4 strict UUIDs).
- **Money-path proof** — one throwaway live-DB test: post a receipt entry with `document_id` twice → second inserts 0 (source_ref idempotency); confirm the `document_id` link + `business_purpose` persisted; then **deleted**. Never `__tests__/db/`.
- **Baseline discipline** — snapshot the ~8-9 known reds before/after; stash-test to prove causation; prod source stays `tsc`-clean.

---

## 14. Standing risks carried forward

1. **RTDB drops null leaves** — the Phase-2 Critical, amplified because vision fields are mostly nullable. `.nullable().optional()` everywhere + `?? null` coalesce on read + an explicit all-null e2e test (§5.5). **Highest risk.**
2. **Book isolation is application-only** (RLS decorative) — every new DAL/route scopes `book_id`; F1/F2 close the commit-side gaps.
3. **PostgREST 1000-row cap** — every document/entry read paginates via `fetchAllRows`.
4. **Financial docs → private bucket only** — `getPrivateBucket()`, signed URLs, `retain_until`, working deletion + now automated pruning (D12). **Deployment precondition:** `FIREBASE_PRIVATE_BUCKET` (+ Firebase admin creds) must be set in the **Vercel runtime** (`split_reel_vercel_env`); the upload routes fail friendly if unset.
5. **functions/ ↔ lib/ twin copy** — `receiptScanSchema`/`receipt-prompt` live only in `functions/src/ai/`; `pruneExpiredDocuments` is a twin (`lib/db/bookkeeping.ts` ↔ `functions/src/lib/bookkeeping-retention.ts`), `.js`-suffixed imports.
6. **Vision image size** — Anthropic 5 MB base64 limit; downscale via `sharp` if present, else cap the upload (§5.3).
7. **Retention cron is destructive** — flag-gated default OFF, bucket-delete `ignoreNotFound`, `ON DELETE SET NULL` keeps the ledger record; prunes nothing imminently.

---

## 15. Honesty guardrails (inherited + receipt-specific)

- Every AI-extracted field (vendor/amount/date/category/purpose) is a **candidate the coach confirms** — nothing posts unreviewed.
- The AI **never guesses** an amount or date it cannot read — it returns null + a warning, and the coach fills it in.
- `business_purpose` is captured on every receipt and **required** for IRS-sensitive categories — the substantiation the sale promised.
- Receipt images retained **7 years** (occurred-year basis), private bucket, working deletion + automated pruning (D12).
- Business and personal **stay in separate books** — a receipt posts to exactly one selected book.
- Amazon/bank/Venmo = **file import**, never implied live sync.
