# AI Bookkeeper — Phase 5 — AI Intelligence Suite (finder-core) — Design

**Date:** 2026-07-18
**Status:** Approved under autonomous-mode delegation (kickoff prompt + standing "full autonomy" rule). The five open decisions below were resolved by Claude with documented rationale; Darren reviews on return.
**Branch:** `feat/ai-bookkeeper-phase-5` (base = main `2d9732fc`). Push HELD for owner.
**Umbrella:** `docs/superpowers/specs/2026-07-17-ai-bookkeeper-design.md` §3 Phase 5. Governing decisions: D1 (home-office = derived candidate, never a cross-book transfer), D4 (recompute-able, no snapshots), D7 (no depreciation), D10 (no flags on read surfaces).

---

## 1. Scope — four read-only finders + one page + one tiny write

**Built this phase (all heuristics, zero AI spend):**
1. **Deduction finder** `lib/bookkeeping/deduction-finder.ts` — watchlist totals per `is_deductible_candidate` account with top counterparties; substantiation gaps (blank `business_purpose` on `requires_business_purpose` accounts); uncategorized-expense sweep; **home-office allocation candidate** (Household tenancy spend × stored office-%).
2. **Profit by service line after costs** `lib/bookkeeping/service-line-profit.ts` — income by line minus direct-assigned costs + shared/overhead bucket. Labeled ESTIMATE.
3. **Vendor / subscription sweep** `lib/bookkeeping/vendor-sweep.ts` — recurring-cadence detection over normalized counterparties, annualized cost list, duplicate-tool flags.
4. **Year-end timing flags** `lib/bookkeeping/year-end-flags.ts` — few, generic, data-driven, honest.
5. **UI** `/admin/books/insights` (Reports-page pattern) + toolbar links from BooksClient and ReportsClient; **JSON API** `GET /api/admin/bookkeeping/insights?from&to`.
6. **Home-office % setting** — inline editor on the insights page → `PATCH /api/admin/bookkeeping/insights/home-office` (the ONLY write surface in the phase).

**Zero migrations. Zero feature flags. Zero functions/ changes (app-only → Vercel-only push). Zero new tables.**

### 1.1 Non-goals
- Depreciation (Phase 6, D7). The finder never mentions it.
- Stripe fees / net / payouts (Phase 6). Every number is GROSS and labeled.
- Monthly close (Phase 6, D4) — everything here recomputes freely; no snapshot/cached-finding rows.
- AI narrative, findings dismissal/persistence, proportional cost allocation, gap deep-links → **Phase-5b** (§11).
- No new nav item — Insights hangs off the Books toolbar like Reports and Accounts.

---

## 2. Inherited anchors (verified against real code 2026-07-18 by a 6-reader context sweep)

- **Ledger-only reads.** Finders aggregate `bookkeeping_ledger_entries` (+ accounts/books joins). Never `payments` / `client_packages` / `event_signups` / `shop_orders` / `client_memberships` (mirror-row trap, $1,842 real). Structurally enforced: finders are pure functions; the only IO is `insight-data.ts` → existing DAL patterns.
- **Sign convention:** `amount_cents` is a positive magnitude; `direction` carries sign; net is the only subtraction. Expenses are NOT negative. (reports.ts:3-4)
- **`ReportEntry`/`ReportAccount` are slim projections** — no entry `id`, no `business_purpose`, no `document_id`, no `is_deductible_candidate`/`requires_business_purpose`. Phase 5 adds widened sibling types + two new DAL readers (§5) instead of churning Phase-4 interfaces and their test fixtures.
- **Archive asymmetry (deliberate):** `listBooks()` excludes archived books; accounts-for-reports INCLUDES archived accounts (else historical entries re-bucket as Uncategorized). Insights mirrors both.
- **Seeded chart facts (00183 + 00186):**
  - Darren book: 7 expense accounts `is_deductible_candidate=TRUE` (Equipment, Software & Subscriptions, Travel, Meals (business purpose), Phone & Internet, Vehicle, Professional Fees); `requires_business_purpose=TRUE` on exactly Meals (business purpose) / Travel / Vehicle. 'Uncategorized' (sort 99) is deductible=FALSE.
  - Household book: Rent, Utilities, Internet, Renter's Insurance, Home Repairs & Maintenance, Medical, Vehicles, Children, Other Household — ALL `is_deductible_candidate=FALSE`, no income accounts. Note `Vehicles` (plural) ≠ Darren's `Vehicle`.
  - Spouse book: ZERO seeded accounts. Finders treat it identically per-book (well-shaped empties) — the W-2-vs-business question stays open, never special-cased.
  - `tax_category` is NULL on every seeded account.
- **Audit convention (corrects the kickoff's "no audit on reads"):** file-download/export GETs audit as `admin_read_sensitive`; **pure-JSON screen-read GETs do NOT audit** (reports/route.ts, entries GET, accounts GET). The insights GET is a JSON read → no audit. The home-office PATCH is a write → inline `void recordAudit`, new slug (§6.2).
- **Auth self-gate:** every bookkeeping route inlines `const session = await auth(); if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })` — single 403, no 401 branch, never `requireAdmin()`.
- **Window validation:** reuse `reportQuerySchema` from `lib/validators/bookkeeping.ts` verbatim (`from`/`to` `YYYY-MM-DD`, `from<=to`, ≤5-year window). The insights GET takes the same two params as the reports GET and returns all books in one payload (per-book slicing in the route via `entries.filter`).
- **`system_settings`:** jsonb values; `getSetting<T>(key, fallback)` returns fallback on missing row; `setSetting(key, value, updatedBy)` upserts. String/number/boolean all precedented (`bookkeeping_accountant_email` is a string).
- **PostgREST ~1000-row cap:** every ledger read via `fetchAllRows` (`lib/db/paginate.ts`), ordered `occurred_on asc, id asc`.
- **`formatCents`** from `@/lib/bookkeeping/money` at display edges only (NOT the analytics one). All finder math in integer cents.
- **Prod ledger may still be EMPTY** — every finder returns a well-shaped empty result; the page renders intentional zero-states; the live proof uses the Phase-4 sentinel-insert→aggregate→delete pattern.

---

## 3. The five decisions, resolved

### 3.1 Findings persistence → NONE (pure recompute)
Options: (a) pure recompute like reports; (b) a `bookkeeping_findings` table with accept/dismiss state.
**Resolved: (a).** D4 explicitly avoids snapshot/cached-finding rows; the reports precedent recomputes every request and the Phase-6 immutable close layers on cleanly. Dismissed-noise state is a real future need only if the vendor sweep proves chatty in practice → Phase-5b (§11), where a small table (next migration 00188) is already sketched. **Consequence: with §3.2, the phase has zero migrations.**

### 3.2 Home-office % storage → `system_settings` key, no seed migration, dedicated audited PATCH
Options: (a) `system_settings` key `bookkeeping_home_office_percent`; (b) a `bookkeeping_settings` table.
**Resolved: (a).** One number does not justify a table (b). Key absent → `getSetting<number | null>("bookkeeping_home_office_percent", null)` returns `null` → the card shows "Enter your office share % — your CPA confirms the method" instead of a number; the first PATCH upserts the row, so **no seed migration is needed** (unlike the 4b flags, which had to exist for the /admin/automation toggle — this value is written by its own route).
- Value contract: jsonb **number**, `0.01 ≤ p ≤ 100`, server-rounded to 2 decimals (`Math.round(p * 100) / 100`); `null` clears (back to unset). Reads defend against hand-edited junk: `typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100 ? v : null`.
- NOT registered in `FEATURE_FLAG_CATALOG` and NOT writable via the toggle-cron route (its allowlist rejects it by design) — it is coach-entered data the CPA validates, not a toggle. The product never derives the %.
- Audit: new slug `bookkeeping.home_office_percent_set` (category `commerce`) in `lib/audit/actions.ts`, recorded inline with `{ previous_value, new_value }` metadata.

### 3.3 Cost attribution → direct assignment + "shared / overhead" bucket; proportional deferred
Options: (a) direct-assignment only + shared bucket; (b) proportional allocation of shared costs by income share; (c) both, labeled.
**Resolved: (a).** Verified: `service_line` is editable free-text (max 60) on accounts in AccountsManager for BOTH account types, so Darren can tag e.g. Equipment → `performance_training` today. Every seeded expense account currently has `service_line=NULL`, so on day one everything lands in the honest "shared / overhead" bucket with an in-card hint ("Tag expense categories with a service line to attribute costs"). That sparse-but-true picture beats an estimate-on-estimate; (b) is a labeled Phase-5b toggle if wanted (§11). Uncategorized expenses (`account_id IS NULL`) are reported as their own line, separate from shared — two different problems (untagged category vs no category at all).

### 3.4 AI narrative → heuristics-only core
**Resolved: heuristics-only.** Deterministic, zero-mock testable, free, and honest (a model narrating money invites confident wrongness). The optional Sonnet "explain these findings in plain words" tail is specced as Phase-5b (§11) — it would be the phase's only AI spend and must ride lib-side `callAgent` with `structuredOutputMode "jsonTool"` + `withTimeout` if built.

### 3.5 Recurring-vendor thresholds → pinned (tests assert these exact numbers)
- **Normalization** (`normalizeCounterparty`): trim → lowercase → collapse internal whitespace runs to one space. Empty/null → `null` (excluded from vendor grouping; counted as "unattributed").
- **Charge events:** same vendor + same `occurred_on` day collapse into ONE event (amounts summed) before cadence math — multi-line same-day orders are one purchase, and 0-day gaps would break cadence detection.
- **Monthly:** ≥3 events AND median consecutive-gap ∈ **[25, 35] days** AND every event amount within **±20% of the median amount**. Median (not every-gap) so one billing hiccup doesn't hide a real subscription; ±20% absorbs tax/price changes.
- **Annual:** ≥2 events AND median gap ∈ **[330, 400] days** AND same ±20% amount rule.
- **Median:** odd n → middle element; even n → `Math.round((a + b) / 2)` of the two middle elements (gaps compared as exact day integers; the rounded-average rule applies to both gaps and amounts for determinism).
- Median amount 0 → vendor skipped (zero-cost noise).
- `typical_amount_cents` = median amount; `annualized_cents` = median×12 (monthly) or median (annual). Sorted `annualized_cents` desc, tie-break display name.
- **Duplicate-tool flag:** among MONTHLY recurring vendors only, group by dominant account (the account carrying the vendor's largest total; tie-break account name asc); any non-null account with ≥2 such vendors marks each member with `duplicate_group = account_id`.
- Gap math: day difference via `Date.UTC` on the two `YYYY-MM-DD` strings / 86_400_000 — exact integers, no TZ drift.

---

## 4. Structural decisions forced by the code sweep

### 4.1 Widened input types + new DAL readers (don't touch Phase-4 interfaces)
`ReportEntry` lacks the entry `id` (needed to key substantiation-gap rows), `business_purpose`, and `document_id`; `ReportAccount` lacks `is_deductible_candidate`, `requires_business_purpose`, `archived_at`. Widening them would break every Phase-4 test fixture factory. Instead:

```ts
// lib/bookkeeping/insight-types.ts (pure, zero IO)
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
export function normalizeCounterparty(raw: string | null): string | null
```

New DAL readers in `lib/db/bookkeeping.ts`, mirroring the ForReports discipline exactly (fetchAllRows, `occurred_on asc, id asc`, archived accounts INCLUDED):
- `listEntriesForInsights(from, to): Promise<InsightEntry[]>` — selects the 8 ReportEntry columns + `id, business_purpose, document_id`.
- `listAccountsForInsights(): Promise<InsightAccount[]>` — the 7 ReportAccount columns + `is_deductible_candidate, requires_business_purpose, archived_at`.

`lib/bookkeeping/insight-data.ts` mirrors `report-data.ts`:
```ts
export interface InsightsBundle { books: BookkeepingBook[]; accounts: InsightAccount[]; entries: InsightEntry[] }
export async function loadInsightsBundle(from: string, to: string): Promise<InsightsBundle>
// Promise.all([listBooks(), listAccountsForInsights(), listEntriesForInsights(from, to)])
```

Because `InsightEntry extends ReportEntry`, the existing pure aggregators (`incomeByServiceLine` etc.) accept insight rows directly — no re-mapping.

### 4.2 Household tenancy accounts identified by pinned name allowlist (zero-migration)
Options: (a) name allowlist; (b) flip `is_deductible_candidate=true` on the 5 household accounts (migration 00188); (c) new `is_home_office_input` column.
**Resolved: (a).** (b) abuses the flag's meaning ("business deduction watch list") on a household book and would drag those accounts into any future flag-driven logic; (c) is a migration for one derived candidate. The allowlist is exported and pinned:

```ts
export const HOME_OFFICE_ACCOUNT_NAMES = [
  "rent", "utilities", "internet", "renter's insurance", "home repairs & maintenance",
] as const
```

Matching = normalized (trim + lowercase + collapse whitespace) account name ∈ allowlist, scoped to accounts of books with `book_kind === "household"`. Fragility is made VISIBLE, not hidden: the card itemizes exactly which accounts matched (with per-account totals) AND shows the total household expense money that did NOT match ("excluded from this proposal"), so a renamed "Rent" account is immediately conspicuous. All five seeded tenancy categories are included (the CONTEXT list, not the four-item SCOPE list) because the actual-expense method covers whole-home repairs — each is itemized so the CPA can strike any line; the simplified-vs-actual choice is explicitly the CPA's.

### 4.3 Home-office card renders on the PRIMARY business book tab only
The % is a single global setting and the proposal targets "the business". Rendering it per-business-book would double-suggest the same deduction. Target book = `books.find(b => b.is_primary && b.book_kind === "business") ?? first business book ?? none` — primary-book logic, not spouse-special-casing (the spouse tab simply has no home-office card, same as any non-primary book).

### 4.4 Substantiation-gap "links back to the ledger"
BooksClient holds its filters in `useState` (no URL hydration), so a true deep-link to one entry doesn't exist today. Gap rows therefore carry the full detail inline (date, amount, counterparty, memo, account, has-receipt) plus a plain link to `/admin/books`; URL-param filter hydration is Phase-5b polish (§11). No new scope in Phase-4 UI files beyond the two toolbar links.

---

## 5. Pure finders — signatures and pinned semantics

All finders: pure, zero IO, integer cents, callers pass entries **pre-filtered to one book** (route slices like reports/route.ts) — except `homeOfficeCandidate` and `yearEndFlags`, which are cross-book by nature and take the full entry set.

### 5.1 `lib/bookkeeping/deduction-finder.ts`

```ts
export interface WatchlistCounterparty { counterparty: string | null; total_cents: number; entry_count: number }
export interface WatchlistRow {
  account_id: string; name: string; tax_category: string | null; archived: boolean
  total_cents: number; entry_count: number
  top_counterparties: WatchlistCounterparty[]   // top 3 by total desc, tie-break name asc; null counterparty groups as ONE bucket (counterparty: null) which tie-breaks last
}
export interface SubstantiationGap {
  entry_id: string; account_id: string; account_name: string
  occurred_on: string; direction: LedgerDirection; amount_cents: number
  counterparty: string | null; memo: string | null; source: LedgerSource
  has_document: boolean                          // document_id !== null — a receipt without a purpose is still a gap
}
export interface UncategorizedEntry {
  entry_id: string; occurred_on: string; amount_cents: number
  counterparty: string | null; memo: string | null; source: LedgerSource
}
export interface UncategorizedSweep { total_cents: number; entry_count: number; entries: UncategorizedEntry[] }  // entries sorted occurred_on desc then entry_id
export interface DeductionFindings {
  watchlist: WatchlistRow[]                      // one row per is_deductible_candidate account (incl. archived, badged), sorted total desc then name; zero-entry watch accounts still listed (total 0)
  watchlist_total_cents: number
  substantiation_gaps: SubstantiationGap[]       // sorted occurred_on desc then entry_id — newest problems first
  gap_total_cents: number
  uncategorized: UncategorizedSweep
}
export function deductionFindings(bookId: string, entries: InsightEntry[], accounts: InsightAccount[]): DeductionFindings
// bookId explicit (not derived from entries): zero-entry watch accounts must still be listed,
// so the finder filters BOTH entries and accounts to the book itself (defensive re-filter of entries).
```

Pinned semantics:
- **Watchlist:** expense-direction entries on this book's `is_deductible_candidate` accounts. Income-direction entries on a watch account SUBTRACT (a refund reduces the deductible total) — net per account, can go negative, displayed honestly.
- **Gaps:** ALL entries (any direction) on this book's `requires_business_purpose` accounts where `business_purpose` is `null` OR `trim() === ""` (whitespace-only counts as blank — pinned test).
- **Uncategorized:** `direction === "expense" && account_id === null` (the reports "Uncategorized" bucket, surfaced as money not yet working as a deduction). Full count + total always reported; UI caps the visible list at 25 with an explicit "and N more" (no silent truncation).

### 5.2 Home-office candidate (same file — it IS part of the deduction finder)

```ts
export interface HomeOfficeInput {
  account_id: string; name: string; entry_count: number
  total_cents: number                            // net: expense − income on the matched account (a utility credit reduces the input)
  proposed_cents: number | null                  // Math.round(total_cents * percent / 100); null when percent unset
}
export interface HomeOfficeCandidate {
  percent: number | null
  target_book_id: string | null                  // primary business book (§4.3); null if no business book exists
  household_books: { id: string; name: string }[]
  inputs: HomeOfficeInput[]                      // every matched allowlist account, even zero-entry ones (visible inclusion)
  input_total_cents: number
  proposed_total_cents: number | null            // SUM of per-input rounded shares (itemization always sums exactly to the total shown)
  excluded_household_expense_cents: number       // household expense money on NON-matched accounts — transparency
}
export function homeOfficeCandidate(
  entries: InsightEntry[], accounts: InsightAccount[], books: BookkeepingBook[], percent: number | null
): HomeOfficeCandidate
```

Pinned semantics:
- Reads ONLY household-book (`book_kind === "household"`) entries; **writes nothing, proposes only** (D1). There is no code path in this phase that inserts a ledger entry — structurally impossible, not just avoided.
- Rounding: per-input `Math.round` (JS half-up toward +∞, including for negatives — pinned test at 33.33% of odd cents); the proposal total is the sum of rounded inputs, never a separately-rounded grand total.
- `percent === null` → inputs itemized with `proposed_cents: null`, card prompts for the %.

### 5.3 `lib/bookkeeping/service-line-profit.ts`

```ts
export interface ServiceLineProfitRow {
  service_line: string | null; label: string     // same labeling as incomeByServiceLine (SERVICE_LINE_LABELS ?? raw; null = "Uncategorized")
  income_cents: number; direct_cost_cents: number; net_estimate_cents: number
}
export interface ServiceLineProfit {
  rows: ServiceLineProfitRow[]                   // union of lines with income OR direct costs; sorted income desc, tie label
  income_total_cents: number
  direct_cost_total_cents: number
  shared_cost_cents: number                      // expense entries on accounts with service_line NULL
  uncategorized_expense_cents: number            // expense entries with account_id NULL — separate from shared
}
export function serviceLineProfit(entries: InsightEntry[], accounts: InsightAccount[]): ServiceLineProfit
```

Income side delegates to `incomeByServiceLine` (identical bucketing — account's line ?? "other"; unknown/absent account → the null "Uncategorized" row). Costs: expense entries whose account carries a `service_line` → that line's `direct_cost_cents` (a line with costs but no income still gets a row); accounts without → shared; no account → uncategorized. `net_estimate_cents = income − direct` per row. Every rendering is labeled ESTIMATE.

### 5.4 `lib/bookkeeping/vendor-sweep.ts`

```ts
export type VendorCadence = "monthly" | "annual"
export interface RecurringVendor {
  key: string                                    // normalized counterparty
  display_name: string                           // first-seen original casing
  account_id: string | null; account_name: string  // dominant account by total; "(uncategorized)" when null
  cadence: VendorCadence
  charge_count: number                           // events after same-day collapse
  typical_amount_cents: number; annualized_cents: number; total_cents: number
  first_seen: string; last_seen: string
  duplicate_group: string | null                 // §3.5
}
export interface VendorSweep {
  recurring: RecurringVendor[]                   // sorted annualized desc, tie display_name
  vendor_count: number                           // distinct normalized counterparties with ≥1 expense entry in window
  unattributed_expense_count: number; unattributed_expense_cents: number  // null/empty counterparty
}
export function vendorSweep(entries: InsightEntry[], accounts: InsightAccount[]): VendorSweep
```

Expense-direction entries only; thresholds exactly per §3.5. UI phrasing: "you pay ~$X/mo to Y (≈$Z/yr)".

### 5.5 `lib/bookkeeping/year-end-flags.ts`

```ts
export interface YearEndFlag { id: "q4_timing" | "substantiation_gaps" | "uncategorized_expenses" | "home_office_unset"; title: string; detail: string }
export interface YearEndInputs {
  today: string; from: string; to: string        // today injected — never new Date() inside the pure fn
  gap_count: number; uncategorized_expense_count: number   // summed across BUSINESS books
  home_office_percent_set: boolean; home_office_input_total_cents: number
}
export function yearEndFlags(input: YearEndInputs): YearEndFlag[]
```

Exactly four possible flags, all generic timing considerations, never tax advice:
1. `q4_timing` — fires when `today`'s month ∈ {10, 11, 12} AND `to`'s year === `today`'s year: "Year-end is approaching — if you're planning deductible purchases (equipment, software), buying before Dec 31 may place the deduction in this tax year. Your CPA confirms what applies."
2. `substantiation_gaps` — `gap_count > 0`: gaps risk disallowal; fill purposes before filing.
3. `uncategorized_expenses` — `count > 0`: uncategorized money can't be matched to a deduction.
4. `home_office_unset` — percent unset AND `home_office_input_total_cents > 0`: household tenancy spend is recorded but no office share % is set.

The kickoff's "large uninvoiced income patterns" example is OMITTED — the platform has no invoice concept, so any such flag would be invented. Documented deviation.

---

## 6. Routes

### 6.1 `GET /api/admin/bookkeeping/insights?from&to` — the JSON data route
Auth self-gate 403 → `reportQuerySchema.safeParse({ from, to })` 400 → `Promise.all([loadInsightsBundle(from, to), getSetting<number | null>("bookkeeping_home_office_percent", null)])` (guarded number coercion §3.2) → compute → 200. try/catch → 500 `{ error: "Failed to build insights" }`. **No audit (JSON screen-read precedent), no flag (D10).**

```jsonc
{
  "from": "…", "to": "…",
  "home_office_percent": 12.5,                    // or null
  "books": [{
    "book": { "id", "name", "book_kind", "is_primary", "currency" },
    "deductions": { /* DeductionFindings */ },
    "profit": { /* ServiceLineProfit */ },
    "vendors": { /* VendorSweep */ },
    "row_count": 123
  }],                                             // one per listBooks() book, in sort order — every book treated identically
  "home_office": { /* HomeOfficeCandidate */ },   // top-level: cross-book by nature
  "year_end_flags": [ /* YearEndFlag[] */ ]       // today = server new Date().toISOString().slice(0,10)
}
```

### 6.2 `PATCH /api/admin/bookkeeping/insights/home-office` — the only write
Auth self-gate 403 → body via `homeOfficePercentSchema` (new, in `lib/validators/bookkeeping.ts`): `z.object({ percent: z.number().min(0.01).max(100).nullable() })`, `safeParse(await request.json().catch(() => null))` 400 → round to 2dp → read previous via `getSetting` → `setSetting("bookkeeping_home_office_percent", value, session.user.id)` → `void recordAudit({ action: "bookkeeping.home_office_percent_set", category: "commerce", target: { type: "system_setting", id: "bookkeeping_home_office_percent" }, metadata: { previous_value, new_value }, request })` → 200 `{ percent }`. try/catch → 500.

New row in `lib/audit/actions.ts` bookkeeping block: `{ slug: "bookkeeping.home_office_percent_set", category: "commerce", description: "Home-office share percentage set for the deduction proposal" }`.

---

## 7. UI — `/admin/books/insights`

**Server page** `app/(admin)/admin/books/insights/page.tsx` (mirrors reports/page.tsx; layout supplies auth): `Promise.all([listBooks(), getSetting<number | null>("bookkeeping_home_office_percent", null)])` → `<InsightsClient books={books} initialHomeOfficePercent={…} />`. `metadata.title = "Insights — Books — Admin"`.

**Client** `components/admin/bookkeeping/InsightsClient.tsx` — the ReportsClient skeleton verbatim: `preset` (`"this_year"` default) + from/to date inputs + `presetRange(preset, todayIso())`; `fetchRequestIdRef` stale guard (positive-check variant); fetch `/api/admin/bookkeeping/insights?from&to`; per-book shadcn Tabs (value = book UUID, single `TabsContent`).

Page composition, top to bottom:
1. Header: title "Insights" + right-aligned links "Reports" (`/admin/books/reports`) and "Back to ledger" (`/admin/books`).
2. **Honesty strip** (always visible, the Reports gross-strip pattern): "Every finding on this page is a candidate for your accountant to confirm — never a filed decision. Dollar figures are estimates; your CPA files."
3. **Year-end flags strip** (global, above tabs) — one row per flag, info tone.
4. Per-book tab content, cards in order: **Deduction watchlist** (table: category / total / entries / top counterparties; archived badge) → **Substantiation gaps** (count + total headline; rows with date, amount, counterparty, memo, account, receipt-attached dot; capped at 25 with visible "and N more"; link to `/admin/books`) → **Uncategorized expenses** → **Profit by service line** (ESTIMATE badge; income / direct costs / net per line; "Shared / overhead" and "Uncategorized" rows beneath; hint to tag accounts in Manage categories when shared > 0 and no lines carry costs) → **Vendors & subscriptions** ("~$X/mo to Y (≈$Z/yr)", annual rows "$Z/yr", duplicate-tool badge when `duplicate_group`).
5. **Home-office allocation card** — PRIMARY business book tab only (§4.3): itemized inputs table (matched household accounts + per-account proposed share), input total, proposed total, the inline % editor (number input + Save → PATCH → refetch; Clear resets to unset), excluded-household note, and the pinned honesty copy: **"This is a proposal on the business book's screen, not an entry — business and household books stay separate. Your CPA sets the method (simplified vs actual) and the final percentage."** When percent is null: no proposal number, prompt "Enter your office share % — your CPA confirms the method."
6. **Empty states:** no books → `EmptyState` (icon Lightbulb). Zero entries across all books in the window → `EmptyState` "No posted entries in this period" + the home-office card still renders below it (the % setter must stay reachable; with zero household spend it shows zero inputs honestly). Loading → the Reports "Loading…" line.

**Toolbar links (only Phase-4 UI edits):** BooksClient right-group gains `Insights` → `/admin/books/insights` (same classes as "Manage categories", NO `ml-auto` — only the group's first link carries it); ReportsClient header gains an `Insights` link beside "Back to ledger".

Design system: semantic classes only (`text-success`/`text-error`/`bg-warning/10` precedents), `formatCents` everywhere, Lucide icons, no hex, no inline fonts.

---

## 8. Testing (zero-mock pure core; DAL-mocked routes)

**Pure — `__tests__/lib/bookkeeping/` (local `entry(over)` factories, RFC-4122 mnemonic UUIDs `b…/a…/e…`, no shared fixture helpers — file-local per precedent):**
- `deduction-finder.test.ts` — watchlist net (income subtracts), zero-entry watch account listed, archived watch account badged+counted, top-counterparty top-3 + null bucket + tie-break, gap edges (null vs `""` vs `"   "` vs filled), gap any-direction, uncategorized expense-only, cross-book isolation ($999.99 in book B absent from book A's findings).
- Home-office (same file): percent null → null proposals; 33.33% of odd cents pins `Math.round` (e.g. 10001¢ → 3333¢; negative-net input rounds toward +∞); itemization sums exactly to `proposed_total_cents`; name matching case/whitespace variants + `Renter's Insurance` apostrophe; net expense−income; excluded-household total; `Vehicles` (household) never collides with business `Vehicle`; multiple household books summed; no business book → `target_book_id: null`.
- `vendor-sweep.test.ts` — monthly happy path (28-31d), gap boundaries 25/35 inclusive + 24/36 exclusive, one-outlier-gap tolerated via median, ±20% boundary exact (amount = 1.2×median passes; +1¢ fails), same-day collapse, annual [330,400] with 2 events, 2-event monthly rejected, zero-median skipped, duplicate grouping (same dominant account) + non-grouping (different accounts), unattributed counts, annualized sort, income-direction ignored.
- `service-line-profit.test.ts` — direct assignment, shared vs uncategorized separation, costs-without-income line, income bucketing parity with `incomeByServiceLine` (account null-line → "other" vs missing-account → null "Uncategorized"), sort, totals.
- `year-end-flags.test.ts` — each flag's on/off boundary (Sep 30 vs Oct 1 today; `to`-year mismatch suppresses q4; zero counts suppress; percent-set suppresses #4 even with spend).
- `insight-types` normalization cases fold into `deduction-finder.test.ts` / `vendor-sweep.test.ts`.
- `report-validators.test.ts` gains `homeOfficePercentSchema` cases (0 / negative / >100 / non-number / null-ok / 12.345 accepted pre-rounding).

**Routes — `__tests__/app/api/admin/bookkeeping/` (the Phase-3/4 root, NOT `__tests__/api/...`):** `insights.test.ts` (403 both unauthenticated + non-admin, 400 bad window, 200 shape, per-book split cross-book regression, home_office top-level + percent passthrough, `loadInsightsBundle` called with from/to, **`recordAudit` NOT called**), `insights-home-office.test.ts` (403, 400 invalid bodies, 2dp rounding, `setSetting` called with key + user id, audit slug/category/metadata asserted, null clears, `setSetting` NOT called on 400/403). Mock idiom: top-of-file `vi.mock` factories + `;(fn as ReturnType<typeof vi.fn>).mockResolvedValue(…)`, duck-typed Request. NEVER `__tests__/db/`.

---

## 9. Verification plan
1. Scoped green: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/lib/validators` (plus the Phase-1/2 root untouched-still-green).
2. Full suite vs the known-red baseline (uploads/shop, import-excel-route, admin-nav, webhook-external, events — load-flaky): snapshot before/after; stash-test any suspicious red.
3. `npm run build` as its OWN command after the last fix — never chained behind `test:run` with `&&`. (Silent exit-4 at "Running TypeScript" with no diagnostic = memory flake; re-run once.)
4. **Live-DB proof (prod ledger may be empty):** sentinel-insert → aggregate-through-the-real-path (real paginated DAL + real finders via a script) → delete, in a far-future window (2031-02), fixed-prefix ids (`f5…`), SQL-verified 0 leftovers. Proof must trace **one Household dollar**: a sentinel Rent expense → home-office input → ×% → proposed_cents on the API shape, plus a watchlist + gap + recurring-vendor sentinel each.
5. Grep-proof: no finder path references `payments|client_packages|event_signups|shop_orders|client_memberships`; no new code writes to `bookkeeping_ledger_entries` (the D1 trace the Opus review will re-verify).

## 10. Risks / landmines (carried into the plan)
- The name allowlist is the one deliberate fragility — mitigated by visible itemization + excluded-total (§4.2); revisit as a column only if renaming actually happens.
- `getSetting` blind-casts jsonb — both readers guard the number (§3.2).
- Insights GET returns ~5 finder payloads per book; with 3 books and an empty-to-small prod ledger this is trivially small today. No caching, no snapshots (D4).
- Two stale-guard variants exist in the family; InsightsClient uses the ReportsClient positive-check variant. Don't mix.
- `withinFiveYears` is year-substring math (coarse) — reused as-is; not tightened this phase.
- Phase-4 files touched: BooksClient.tsx + ReportsClient.tsx (one link each) — nothing else; keep their tests green unmodified (admin-nav is a known-red — do not chase it).

## 11. Phase-5b (deferred, cleanly specced)
- **AI narrative tail:** one Sonnet call "explain these findings in plain words" over the computed JSON (lib `callAgent`, `structuredOutputMode "jsonTool"`, `withTimeout` race, output labeled AI-generated). The phase's only AI spend if built.
- **Findings dismissal:** `bookkeeping_finding_dismissals` (migration 00188): `(finding_kind, finding_key, dismissed_at, dismissed_by)`; vendor-sweep noise is the expected first customer. Pure recompute stays; dismissals only filter display.
- **Proportional shared-cost allocation:** optional labeled toggle distributing `shared_cost_cents` across lines by income share.
- **Gap deep-links:** URL-param filter hydration in BooksClient (`?book_id&account_id&direction`) so gap rows land on the filtered ledger.
