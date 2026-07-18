# AI Bookkeeper — Phase 4 — Reports & Accountant Pack — Design

**Date:** 2026-07-18
**Status:** Approved under autonomous-mode delegation (kickoff prompt + standing "full autonomy" rule). The four open decisions below were resolved by Claude with documented rationale; Darren reviews on return.
**Branch:** `feat/ai-bookkeeper-phase-4` (base `73696508`). Push HELD for owner.
**Umbrella:** `docs/superpowers/specs/2026-07-17-ai-bookkeeper-design.md` §3 Phase 4. Governing decisions D3 (gross), D4 (recompute-able, no close), D7 (no depreciation), D8 (QuickBooks = importable CSV, not QBO API), D9 (exceljs + browser Save-as-PDF, no PDF lib), D10 (no flags on reads; DB flags on outward emits).

---

## 1. Scope — reports-CORE now, outbound tails specced as Phase-4b

**Built this phase (reports-core — nothing reaches outward):**
1. Pure aggregators `lib/bookkeeping/reports.ts` — income-by-service-line, P&L-by-category, per-book summary (zero-IO, zero-mock tested).
2. Pure period helpers `lib/bookkeeping/period.ts` (month/quarter/year presets + custom).
3. Pure QuickBooks CSV builder `lib/bookkeeping/quickbooks-csv.ts` + download route.
4. Accountant pack workbook builder `lib/bookkeeping/accountant-pack.ts` (exceljs) + download route.
5. Reports UI at `/admin/books/reports` (sibling page — see §3.5) + JSON report API.
6. Print page `/admin/books/reports/print` (`.print-document` + `PrintToolbar`, browser Save-as-PDF).
7. Folded-in Phase-3 minors (§12).

**NOT built — Phase-4b, specced in §13:** emailed accountant pack (Resend `attachments`, flag-gated default OFF) and quarterly pack cron. Both are outward-emitting; both stay cleanly specced until authorized.

### 1.1 Non-goals
- Stripe-fee net, payouts, dedupe-vs-bank (Phase 6, D3/D6). **Every report is GROSS and labeled gross.**
- Depreciation (Phase 6, D7). The pack carries no depreciation numbers.
- Immutable monthly close (Phase 6, D4) — reports run over any `occurred_on` window and recompute freely; nothing here blocks the future freeze (no snapshot rows, no cached totals).
- Deduction finder / `is_deductible_candidate` logic (Phase 5). The flag is displayed nowhere in Phase-4 output.
- QBO OAuth API (D8). New tables (none needed — reports read existing tables; **no migration this phase**).

---

## 2. Inherited decision anchors (verified against real code 2026-07-18)

- **Reports read ONLY `bookkeeping_ledger_entries`** (+ accounts/books/documents for joins). Never `payments` or the other money-of-record tables — the ledger is already deduped/reviewed upstream by the Phase-1 adapter (mirror-row trap: `payments_mirror_rows_double_count`, $1,842 real).
- **There is no `status` column on ledger entries** (verified migrations 00183–00186): a row's existence IS "posted". No draft state exists in the DB.
- **`service_line` lives ONLY on `bookkeeping_accounts`** — entries reach a service line via `account_id → accounts.service_line`. `insertImportedEntries` drops the draft's `service_line`; it was always account-mediated.
- **Money:** integer `amount_cents` magnitude + `direction` carries sign (`signedCents` exists). Display via `formatCents(cents, currency)` (`Intl.NumberFormat en-US`). Zero float anywhere.
- **Every ledger read paginates** via `fetchAllRows` (`lib/db/paginate.ts`, PAGE 1000, loops `.range()` until short page). A year of ledger can exceed 1000 rows; a bare `.select()` silently caps.
- **CSV:** `lib/csv/serialize.ts` (`csvCell/csvRow/csvDocument`) — injection defense prefixes `'` on leading `= + - @ \t \r` (strings only; numbers bypass), RFC-4180 quoting, CRLF, no BOM, no trailing newline.
- **xlsx:** exceljs default-import pattern from `lib/excel-templates.ts` (server-only; `applySheetFormatting` is private — we re-instantiate the style constants, we don't export it). Route returns `Buffer` with the xlsx MIME + `Content-Disposition`, no `runtime` declaration (Node default).
- **Print:** global `@media print` in `app/globals.css` keyed to `.print-document` (+ `@page { margin: 1.5cm }`); reusable `PrintToolbar` at `components/admin/performance/print-toolbar.tsx` (auto-`window.print()` after 500ms + manual button + Back).
- **Routes self-gate** `auth()` → 403 `{ error: "Unauthorized" }` (never `requireAdmin()`); bookkeeping convention is **inline `void recordAudit(...)`**, explicitly NOT `withAudit` (documented in statement-import/route.ts).
- **Books:** 3 seeded, fixed ids `b0000000-0000-4000-8000-00000000000{1,2,3}` — `Darren — DJP Athlete` (business, primary), `Spouse — Business` (business), `Household & Personal` (household).

---

## 3. Decisions resolved this phase

### 3.1 QuickBooks CSV download: NO feature flag (amends the umbrella's D8 note "flag-gated")
The umbrella wrote "QuickBooks export … flag-gated (D10)" before D10's own principle was settled. Applying D10's actual test: a **self-download of your own books to your own machine is not outward-emitting** — no third party receives anything. `no_default_feature_flags` reserves flags for genuine money/mass-email risk; a read-only CSV download is neither. **Resolution: no flag on the QuickBooks CSV download, no flag on the workbook download, no flag on any Phase-4-core surface (all read-only). The ONLY flagged surface is the Phase-4b emailed workbook (outbound to the accountant), flag default OFF.** Consequence: **Phase 4 core needs no migration at all.**

### 3.2 QuickBooks CSV shape: the documented QBO 4-column bank-transaction CSV
Intuit documents exactly two bank-upload CSV shapes ([Format CSV files](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-transactions/format-csv-files-excel-get-bank-transactions/L4BjLWckq_US_en_US), [Manually upload transactions](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-transactions/manually-upload-transactions-quickbooks-online/L0rE9OXBz_US_en_US)): 3-column `Date, Description, Amount` (signed) and 4-column `Date, Description, Credit, Debit` (both positive). The journal-entries import ([Import journal entries](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US)) requires balanced debits/credits per journal number and **account names that already exist in the QBO chart** — our single-entry ledger (D2) would need a synthetic offsetting cash line per entry and would break on any chart mismatch, exactly the fragility an accountant hates.

**Pinned: the 4-column shape — header `Date,Description,Credit,Debit`; `Credit` = money in (income), `Debit` = money out (expense); amounts positive, two decimals, no `$`/commas; dates `MM/DD/YYYY` (US company file); blank cell (not `0`) in the unused column.** Two shape-forcing details:
- The 3-column shape needs **negative** amounts, and `csvCell` prefixes `'` on a leading `-` in strings — corrupting the data. The 4-column shape is all-positive; amounts stay clean.
- QBO caps an upload at **1,000 lines / 350 KB**. The export never truncates (no-silent-truncation invariant); instead the Reports UI shows a visible hint when the period's row count exceeds 1,000: "QuickBooks caps CSV imports at 1,000 rows — export a shorter period."

Category names are NOT in this CSV (the bank shape has no category column — QBO categorizes on import); the categorized truth rides the accountant pack. Description = `counterparty — memo` (fallbacks §6).

### 3.3 Period model: `occurred_on`-driven inclusive windows, preset + custom, always recompute-able
`{ from, to }` as `YYYY-MM-DD` inclusive, filtering `occurred_on` (`gte/lte` — same semantics the ledger filters already use). Presets: this month, last month, this quarter, last quarter, this year (default), last year — computed by pure helpers in `lib/bookkeeping/period.ts` taking `today` as a parameter (testable, no `new Date()` in logic). Custom = raw date inputs. **No snapshot/cache rows anywhere** — every request recomputes from the ledger, so the Phase-6 immutable close can layer a freeze on top without touching Phase-4 code (D4 honored: `occurred_on` is already distinct from `created_at`).

### 3.4 Spouse book: data-driven, never a stub (open question stays open)
Whether the spouse runs a business or is W-2 salaried is STILL unconfirmed (carried from Phase 1; flagged again in the final report). The design makes the answer non-blocking: the spouse tab/sheet is a **real P&L renderer over whatever the spouse book contains**. Entries present → a true P&L-by-category. Zero entries → an explicit note: "No entries recorded for this period. This book exists to keep the spouse's business separate — if the spouse is W-2 salaried, it stays empty by design." Either way the accountant sees the separation, which is the requirement.

### 3.5 "Reports tab" → sibling page `/admin/books/reports` (structural correction to the kickoff wording)
Verified: the Tabs in `BooksClient` ARE the book switcher (`value` = book UUID, one trigger per book) — a "Reports" TabsTrigger would collide with book switching. The established sub-surface pattern is a sibling route + toolbar link (`/admin/books/accounts` ← "Manage categories"). **Reports get `app/(admin)/admin/books/reports/page.tsx` + a `ReportsClient` with its own per-book Tabs, linked from the BooksClient toolbar ("Reports").**

### 3.6 Phase-3 dead-catch: DELETE the dead catch mappings (option A, consistently)
Verified TRUE: `receipts/cash` + `receipts/commit` catch `AccountScopeError` but only do inline `getAccount` checks that can never throw it (the catch is dead); `receipts/amazon/commit`, `statement-import/commit`, `entries/[id]` use the real `assertAccountInBook`/`assertAccountsInBook` guard. The kickoff offered "switch to assertAccountInBook" as the alternative — rejected on inspection: **both routes need the `getAccount` row anyway to feed `businessPurposeMissing(account, …)`**, so the switch would add a second DB read per request purely for consistency theater. **Resolution: keep the inline checks (they are semantically correct and feed the purpose gate); delete the unreachable `AccountScopeError` code-mapping lines from both catches and the now-unused `type AccountScopeError` imports.** Zero behavior change; existing tests keep passing unmodified.

### 3.7 Workbook money cells are `formatCents` strings, not numeric cells
Numeric xlsx cells would require `cents / 100` floats. All money in the workbook and print page renders as `formatCents` strings ("$1,234.56") — zero float, consistent with every other surface. The accountant reads; nothing downstream re-computes from the workbook.

---

## 4. Pure aggregators — `lib/bookkeeping/reports.ts` (zero IO, zero mocks)

Input types (type-only imports from `@/types/database` are fine; no runtime imports beyond none):

```ts
export interface ReportEntry {
  book_id: string
  account_id: string | null
  direction: LedgerDirection        // sign truth
  amount_cents: number              // magnitude ≥ 0
  occurred_on: string               // YYYY-MM-DD, pre-filtered by the DAL window
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
```

Functions (all take pre-windowed entries; the DAL owns the date filter):

- `incomeByServiceLine(entries, accounts)` → `{ rows: Array<{ service_line: string | null; label: string; total_cents: number; entry_count: number }>; total_cents: number }`
  Income-direction entries only. `service_line = account?.service_line ?? (account ? "other" : null)` — an account without a service line folds into the seeded `other` line; **no account at all → `service_line: null`, label "Uncategorized"** (distinct bucket, surfaced for review). Labels from a `SERVICE_LINE_LABELS` map (the 7 canonical values; unknown free-text values pass through as-is — the column has no CHECK). Rows sorted `total_cents` desc.
- `profitAndLossByCategory(entries, accounts)` → `{ income: CategoryRow[]; expense: CategoryRow[]; income_total_cents; expense_total_cents; net_cents }` with `CategoryRow = { account_id: string | null; name: string; tax_category: string | null; total_cents: number; entry_count: number }`
  Grouped by `entry.direction` (the sign truth — if an entry's direction disagrees with its account's `account_type`, the entry lands on its OWN direction's side under that account's name; a dedicated test documents this). `account_id: null` → name "Uncategorized". `net_cents = income_total − expense_total` (may be negative). Rows sorted `total_cents` desc.
- `perBookSummary(entries, books)` → `Array<{ book_id; name; book_kind; income_cents; expense_cents; net_cents; entry_count }>` ordered by book `sort_order`. **Every non-archived book appears even with zero entries** (the spouse empty-state depends on this).

Arithmetic discipline: sums are magnitude-per-direction over integer cents; `net` is the only subtraction; no float, no `signedCents` inside accumulation loops. Unit tests cover: empty period; zero-amount entries; the uncategorized bucket; account-without-service-line fold; direction/account_type disagreement; a book with no entries; totals that cross zero.

## 5. Period helpers — `lib/bookkeeping/period.ts` (pure)

```ts
export type PeriodPreset = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_year" | "last_year"
export function presetRange(preset: PeriodPreset, today: string): { from: string; to: string }
```

Pure `YYYY-MM-DD` string/UTC math (`Date.UTC` parts only — never local-time parsing; the `formatOccurredOn` local-parts trap noted). Tests: month ends (Jan 31 → Feb 28/29 boundaries), leap year, quarter edges (Mar 31/Apr 1), year edges, `today` injected.

## 6. QuickBooks CSV — `lib/bookkeeping/quickbooks-csv.ts` (pure) + route

- `centsToDecimalString(cents: number): string` — integer math only: `` `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}` `` (input is ≥ 0 by DB CHECK; a defensive throw on negatives).
- `toQuickBooksDate(occurredOn: string): string` — `"2026-07-05"` → `"07/05/2026"` (string slicing, no Date).
- `buildQuickBooksCsv(entries: ReportEntry[], accounts: ReportAccount[]): string` — header `Date,Description,Credit,Debit`; rows ordered `occurred_on` asc; Description = `[counterparty, memo].filter(Boolean).join(" — ")` → fallback account name → fallback `"Ledger entry"`; income → Credit cell, expense → Debit cell, other cell `null` (empty, not 0 — per Intuit doc). Amount strings start with a digit so `csvCell`'s injection prefix never touches them; Description gets the full defense. Built on `csvRow`/`csvDocument` (CRLF, no BOM).

**Route** `GET /api/admin/bookkeeping/reports/quickbooks-csv?book_id&from&to`
`auth()` → 403; Zod-validate params (§10); reads via `listEntriesForReports(from, to, bookId)` + `listAccountsForReports()`; `void recordAudit({ action: "bookkeeping.report_exported", category: "admin_read_sensitive", metadata: { format: "quickbooks_csv", book_id, from, to, row_count } })`; responds `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="quickbooks-<book-slug>-<from>-<to>.csv"`, `cache-control: no-store` (blueprint.csv precedent). Full export always — the 1,000-row QBO cap is a **UI hint**, never a truncation.

## 7. Accountant pack — `lib/bookkeeping/accountant-pack.ts` (exceljs, server-only) + route

`buildAccountantPack(input: { from: string; to: string; books: BookkeepingBook[]; accounts: ReportAccount[]; entries: ReportEntry[]; documents: BookkeepingDocument[] }): Promise<Buffer>` — no IO; the route fetches, the builder builds. Styling re-instantiates the `lib/excel-templates.ts` constants (HEADER_FILL `FF0E3F50`, white bold 11 font, thin `FFE5E7EB` borders, frozen header row, tab colors FF0E3F50/FFC49B7A/FF6B7280 — the established xlsx ARGB convention). All money = `formatCents` strings (§3.7).

**Sheets (a tab per question the accountant asks):**
1. **Read Me** — period, generated date, and the honesty block: GROSS figures (fees/payouts Phase 6), every number an **estimate — the CPA files**, business/personal in separate books, pack is a **candidate for accountant review, never a filed return**.
2. **Summary** — one row per book: income / expense / net / entry count. **No cross-book grand total** (summing business + spouse + household is tax-meaningless and violates the separation principle).
3. **Income by Service** — primary book's `incomeByServiceLine` rows.
4. **P&L — Darren** — primary book's P&L: sections Income / Expenses, columns Category | Tax hint (`tax_category`, blank when null — it's a free-text accountant hint, never a grouping key) | Entries | Total; net line.
5. **P&L — Spouse** — same renderer over the spouse book; zero entries → the §3.4 note row.
6. **Household & Personal** — same renderer over the household book. Its seeded categories (Rent, Utilities, Internet, Renter's Insurance, Home Repairs & Maintenance, …) ARE the Home & tenancy view — no separate hardcoded-name tab.
7. **Document Index** — every `bookkeeping_documents` row (all books): book, kind (statement/receipt), filename, period_start/end, uploaded, posted_count, and a download ref (`https://www.darrenjpaul.com/api/admin/bookkeeping/documents/<id>/download` — requires admin login; noted on the sheet).

Sheet-name safety: book names are user-editable → sanitize (strip `: \ / ? * [ ]`, cap 31 chars, de-dupe) — Excel hard limits.

**Route** `GET /api/admin/bookkeeping/reports/accountant-pack?from&to` — all books always (the pack is inherently cross-book); Buffer response, xlsx MIME, `Content-Disposition: attachment; filename="djp-accountant-pack-<from>-<to>.xlsx"`, `cache-control: no-store`; audit `bookkeeping.report_exported` with `format: "accountant_pack_xlsx"`. exceljs stays server-only (route + lib module; never imported by a client component — the Blob-returning `generateExerciseTemplate` client pattern is NOT copied).

## 8. Print page — `app/(admin)/admin/books/reports/print/page.tsx`

Async server component; `searchParams: Promise<{ from?: string; to?: string }>` awaited (Next 16); missing/invalid params default to this-year. Double auth (page `auth()` self-check + proxy.ts layer, performance-print precedent). Fetches the same data as the pack route; renders `<PrintToolbar />` (reused import from `components/admin/performance/print-toolbar.tsx`) + `<div className="print-document mx-auto max-w-3xl bg-white text-black">` with: brand header (DJP Athlete eyebrow, "Accountant Pack — <period label>", generated date, the honesty line), then sections mirroring workbook tabs 2–7 (summary table, income-by-service, three P&Ls, document index — table markup per the performance print page's `table/Stat` patterns, em-dash for empties). Opened from the Reports UI via `target="_blank"` link with the current period in the query.

## 9. Reports UI — `/admin/books/reports` + JSON API

**API** `GET /api/admin/bookkeeping/reports?from&to` → 403 gate; one `listEntriesForReports(from, to)` (all books) + `listAccountsForReports()` + `listBooks()`; returns `{ from, to, books: [{ book: { id, name, book_kind, is_primary, currency }, summary, income_by_service, pnl, row_count }] }` — aggregation server-side via §4 functions. Plain read → no audit row (matches ledger-list reads), no flag (D10).

**Page** `app/(admin)/admin/books/reports/page.tsx` — server: `listBooks()` → `<ReportsClient books={books} />` (accounts page precedent). Metadata title "Reports — Books — Admin".

**`components/admin/bookkeeping/ReportsClient.tsx`** (`"use client"`):
- Period bar: preset `Select` (§5 presets, default **this_year**) + always-visible from/to `<input type="date">` pair (editing either switches the preset to Custom); one `fetch` per period change with the `fetchRequestIdRef` stale-guard pattern; `toast.error` on failure.
- Honesty strip: "Gross figures from the posted ledger — Stripe fees & payouts land in Phase 6. Estimates for planning; your CPA files."
- **All-books summary table** (per-book income / expense / net via `formatCents`) — the per-book-summary view.
- **Book Tabs** (shadcn, one per book — same idiom as BooksClient): totals cards; Income-by-service table (income books; renders the Uncategorized row highlighted when present); P&L two-section table with Tax-hint column.
- Export row: **QuickBooks CSV** (selected book; plain `<a href>` to the route; disabled at 0 rows; amber hint when `row_count > 1000` per §3.2), **Accountant pack (.xlsx)** (all books), **Print view** (new tab).
- `EmptyState` (icon `BarChart3`) when the ledger has no entries at all: "No posted entries yet — post platform income, statements, or receipts first." Period-empty (but ledger non-empty) states render zeroed tables, not the EmptyState.
- BooksClient toolbar gains `<Link href="/admin/books/reports">Reports</Link>` beside "Manage categories".

## 10. DAL + validators + audit additions

`lib/db/bookkeeping.ts`:
- `listEntriesForReports(from: string, to: string, bookId?: string): Promise<ReportEntry[]>` — `fetchAllRows` over slim select `book_id,account_id,direction,amount_cents,occurred_on,counterparty,memo,source`, `gte/lte occurred_on`, `.order("occurred_on").order("id")` (deterministic pagination), optional `eq book_id`.
- `listAccountsForReports(): Promise<ReportAccount[]>` — all books, **INCLUDING archived accounts** (entries keep `account_id` after archival; filtering would silently re-bucket real money as Uncategorized — a wrong report). Small coach-managed table → single select, ordered `book_id, sort_order` (matches `listAccounts`'s no-pagination precedent).
- `listAllDocuments(): Promise<BookkeepingDocument[]>` — `fetchAllRows`, all books, ordered `created_at` desc `, id` (documents grow).

`lib/validators/bookkeeping.ts`: `reportRangeSchema` — `from`/`to` `YYYY-MM-DD` regex + `from <= to` refine + a 5-year max window (rejects runaway ranges); `book_id` optional strict UUID (Zod v4 RFC-4122).

`lib/audit/actions.ts`: one new row — `{ slug: "bookkeeping.report_exported", category: "admin_read_sensitive", description: "Bookkeeping report exported" }` (the `document_downloaded` precedent; `metadata.format` distinguishes `quickbooks_csv` / `accountant_pack_xlsx`).

**No migration. No new tables. No flags.** (§3.1 — first phase with zero DB changes.)

## 11. Error handling

- Routes: try/catch → 500 `{ error: "Failed to build report" }` (entries-route precedent); Zod failures → 400 with flattened issues; unknown `book_id` → 404.
- Aggregators are total functions — any entry list (including pathological direction/account mismatches) produces a report; nothing throws on data shape.
- Workbook/CSV builders throw only on programmer error (negative cents defensive throw); routes surface as 500.
- Print page: invalid dates → fall back to this-year rather than erroring (a print surface should always render).

## 12. Folded-in Phase-3 minors (verified §3.6)

1. `receipts/cash/route.ts` + `receipts/commit/route.ts`: delete the unreachable `AccountScopeError` mapping lines from both catch blocks (and the unused `type AccountScopeError` imports); the inline `getAccount` checks stay (they also feed `businessPurposeMissing`). Zero behavior change; existing tests unmodified (§3.6).
2. Amazon `ROW_CAP` regression test in `__tests__/app/api/admin/bookkeeping/receipts-amazon.test.ts`: a 501-row CSV → `refs.length === 500`, `refs[i] === input.rows[i].ref` for sampled i (the money-critical index-zip), truncation warning present in the job input. Locks today's correct behavior.

## 13. Phase-4b spec — outbound tails (NOT built this session)

**Why deferred:** both surfaces emit financial data outward (D10 ⇒ DB-backed flags, default OFF) and Resend `attachments` is a never-used-in-repo surface on the money path. Reports-core is complete and useful without them; a one-word go-ahead builds them against this spec.

1. **Emailed accountant pack.** `POST /api/admin/bookkeeping/reports/email-pack { from, to, recipient_email }` — flag `bookkeeping_email_pack_enabled` (system_settings, seeded `'false'::jsonb` via migration `00187` WHEN built; `INSERT … ON CONFLICT DO NOTHING`). Builds the §7 Buffer, sends via a new `sendAccountantPackEmail` in `lib/email.ts` using Resend `attachments: [{ filename, content: buffer.toString("base64") }]` (SDK type already admits it through the existing wrapper cast; workbook is KBs, far under Resend's 40MB cap). Resilient: send failure → 502 + `toast.error`, audit `outcome: "failure"`; success → audit new slug `bookkeeping.report_emailed` (category `commerce`, outbound write). Recipient defaults empty — the coach types the accountant's address each time (no stored-recipient risk while unconfirmed). UI: an "Email to accountant" button in the export row, visible only when the flag is ON.
2. **Quarterly pack cron.** Firebase `onSchedule` (`0 9 1 1,4,7,10 *`) → POST `/api/admin/internal/bookkeeping-quarterly-pack` (cron_pattern; no functions/lib twin needed — the app route builds/emails using lib code). Flag `cron_bookkeeping_quarterly_pack_enabled` default OFF; `logCronStart/End`; added to the automation-health expected list; emails the prior calendar quarter's pack to the stored accountant address (which then needs a `bookkeeping_accountant_email` setting — part of this tail, not core). Requires tail #1 shipped first.

## 14. Testing strategy

- **Pure, zero mocks (`__tests__/lib/bookkeeping/`):** `reports.test.ts` (§4 edge list), `period.test.ts` (§5 boundaries), `quickbooks-csv.test.ts` — injection cases (`=cmd()`, `+1 555…`, `-lead`, `@x` in counterparty/memo → `'`-prefixed in output), decimal strings (0→"0.00", 1→"0.01", 99→"0.99", 123456→"1234.56"), date format, credit/debit placement, CRLF + header, empty-entry list → header-only. `accountant-pack.test.ts` — build from fixtures, re-open via `new ExcelJS.Workbook().xlsx.load(buffer)`, assert sheet names (incl. sanitized long/invalid book name), spouse empty-note row, a sampled `formatCents` cell, document-index row count.
- **Route tests** (mock the DAL module, import handler after mocks, `Request as never`, awaited params): 403 self-gate × 3 new routes; param validation 400s; unknown book 404; CSV response headers + body spot-check; xlsx response headers; reports JSON shape.
- **Folded minors:** cash/commit tests must still pass unmodified after the dead-catch deletion (§12.1 — zero behavior change is the assertion); the ROW_CAP test (§12.2).
- **Live-DB proof (throwaway, then deleted):** READ-ONLY — run the real DAL + aggregators against prod for a known window, assert per-book totals equal a hand-run SQL `SUM(amount_cents) GROUP BY direction`, zero writes. Never `__tests__/db/`.
- **Baseline:** snapshotted pre-build (2786 pass / 11 fail / 5 files: uploads-shop, webhook-external, import-excel-route, admin-nav, events — the known-red family + suspected flake). Compare after; stash-test any suspicious new red. `npm run build` after the LAST fix (`npm_build_vs_tsc` — the build is the deploy gate, tsc is not).
- Fixtures use RFC-4122 UUIDs (Zod v4 strict).

## 15. Standing risks carried forward

1. **Mirror double-count** — reports read the posted ledger ONLY; any future "reconcile vs payments" feature must not creep in here (Phase 6 owns it).
2. **PostgREST 1000-row cap** — every entry/document read via `fetchAllRows`; the QBO 1,000-line limit is a UI hint, never a data cap.
3. **Book isolation is application-level** — report routes take explicit `book_id` or aggregate per-book server-side; no cross-book grand totals anywhere (Summary lists books side-by-side).
4. **exceljs server-only** — builder module + routes only; a client import would balloon the bundle and break.
5. **Archived accounts must stay joinable** (§10) — filtering them re-buckets historical money as Uncategorized.
6. **User-editable book names → Excel sheet-name sanitization** (31-char/forbidden-chars hard limits).
7. **functions/ ↔ lib/** — Phase-4 core is app-only (no functions/ changes); the 4b cron deliberately routes through an app endpoint to avoid a twin.

## 16. Honesty guardrails (non-negotiable, surfaced in-product)

- Every surface (UI strip, workbook Read Me, print header) labels figures **GROSS** and **estimates — the CPA files**.
- The QuickBooks CSV + pack are a **candidate the accountant reviews**, never a filed return (stated on the Read Me sheet).
- Business and personal stay in **separate books**; no cross-book totals (§7.2).
- `tax_category` renders as the accountant's own free-text hint — the product never invents a tax line.
