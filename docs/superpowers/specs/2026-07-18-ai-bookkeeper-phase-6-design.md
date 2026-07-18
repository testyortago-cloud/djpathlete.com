# AI Bookkeeper — Phase 6: Close, Forecast, Chat, Depreciation, Net — Design

**Date:** 2026-07-18
**Status:** Approved under autonomous-mode delegation (kickoff: "sign off autonomously if I'm away, document in the spec"). Darren reviews on return.
**Branch:** `feat/ai-bookkeeper-phase-6` — push HELD.
**Sources:** Umbrella design `2026-07-17-ai-bookkeeper-design.md` (D3, D4, D6, D7, D10, D11), Phase-6 kickoff prompt, and a 9-agent context sweep over the real code (8 readers + gap critic; reports in session scratchpad `sweep/`). Every file:line below was verified against the working tree at `9c98a299`.

---

## 1. Decomposition and ordering (the kickoff's first job)

Phase 6 is five subsystems. They build in this order, each with its own plan + build + review:

| Sub-phase | Contents | Migration | functions/? | Risk |
|---|---|---|---|---|
| **6a** | Monthly close: `bookkeeping_period_closes`, DAL write guard, adjustment entries (`adjusts_period`), close/reopen routes + UI, books-closed email (flag OFF) | **00188** | no | MOD |
| **6b** | Missing-receipt watchdog (pure finder + weekly cron + email, flag OFF + insights card) and rolling tax forecast (pure fn + `bookkeeping_tax_rate_percent` + insights card) | none | **yes** (1 cron) | LOW–MOD |
| **6c** | Ask-your-books chat tools: 4 tools in `ADMIN_TOOLS`, functions-side twins + fixture-parity tests | none | **yes** | MOD |
| **6d** | Equipment depreciation: `bookkeeping_assets`, pure straight-line schedule, CRUD UI at `/admin/books/assets`, pack sheet + print section | **00189** | no | LOW–MOD |
| **6e** | Stripe payout ingestion + net revenue + real dedupe | 00190 (sketch) | yes | HARD — **SPEC-ONLY, §8** |

**6e is spec-only this session (decision).** The kickoff leaned this way and the sweep confirmed it: 6e needs a net-new Stripe API surface (zero `payouts.list`/`balanceTransactions` usage exists), an unpinned `apiVersion` problem (`lib/stripe.ts:5`), a fee model, and a dedupe-layer change under the consumed-set contract — a full session's worth of money-critical work. Phase-4→4b precedent: build the front pillars completely, leave 6e cleanly specced for its own kickoff (§8 is that spec).

Dependency notes: 6b/6c/6d do not depend on 6a's guard (none of them writes ledger rows — depreciation is report-layer only, §7). 6a goes first anyway because it is the D4 freeze everything else must not contradict, and because its migration renumbers nothing later.

Ordering within the session: 6a → 6b → 6c → 6d, verification gate after each.

---

## 2. Decisions resolved (kickoff's open list; options weighed, autonomous sign-off)

| # | Decision | Chosen | Why (evidence) |
|---|---|---|---|
| D-1 | Close granularity + reopen | **Per-book-per-month; reopen allowed, audited** (`bookkeeping.period_reopened`). Reopen = DELETE the close row (audit metadata carries the snapshot); re-close re-snapshots. | Solo coach, mistakes happen; the freeze is the guard, not a vault. Books are independent tax contexts (D1) — all-books-at-once would let the household book block a business close. Audit log is append-only history, so deleting the row loses nothing. |
| D-2 | Guard placement | **One DAL choke point**: `assertPeriodOpen` logic inside the 6 writer functions in `lib/db/bookkeeping.ts`; coded `PeriodClosedError` (`code: "PERIOD_CLOSED"`) mapped to **409** in routes per the `assertAccountInBook` precedent (`entries/[id]/route.ts:19-26`). | (a) All 6 writers live in one file — a future route cannot forget the guard. (b) A route-level guard would be a **new import that breaks every existing route-test mock factory** (both `__tests__/api/...` and `__tests__/app/api/...` dirs `vi.mock("@/lib/db/bookkeeping")` enumerating only used exports → `undefined` → TypeError → false reds). DAL-internal placement is invisible to those mocks. (c) PATCH fetches the old row only when `account_id` is present (`entries/[id]/route.ts:15`) and DELETE never fetches — the guard needs its own unconditional fetch, which belongs in the DAL. |
| D-3 | Adjustment linkage | **Nullable `adjusts_period` column** (`text`, `YYYY-MM`, CHECK regex) on `bookkeeping_ledger_entries`. | `source_ref` participates in `UNIQUE (book_id, source, source_ref)` — packing linkage there makes a second adjustment to the same month collide. A memo convention is invisible to the slim report/insight selects. Zero-migration savings are nil since 00188 exists regardless. Queryable for the accountant. |
| D-4 | Batch UX for closed-period rows | **Reject-per-row, additive response field.** Batch writers partition drafts; open-period rows post, closed-period rows return in `rejected_closed` (count + capped row list). The three dialogs render a distinct "closed period" line. Single-row paths (manual entry, cash receipt, receipt commit, entry PATCH/DELETE) → 409 with a message pointing at adjustment entries. | No per-row rejection mechanism exists today (sweep contradiction #2: all three commits return only `{inserted, batchId}`) — this is a NEW contract, kept additive so the dialogs' existing reads don't break. Critical: closed-period rows must NOT ride the silent upsert duplicate-skip, or the dialogs' `skipped = requested − inserted` arithmetic (`ImportPlatformDialog.tsx:149-150`) misreports them as "already imported". |
| D-5 | Cascade vs freeze | **The close is a totals freeze, not a document freeze.** `document_id ON DELETE SET NULL` (00186:8-10) may null links on closed-period entries via document delete or the retention cron — allowed by design. | The snapshot totals (amount/direction/account/occurred_on/book) are untouched by the cascade. Blocking doc deletes against closed periods would fight the 7-year retention cron (D12), which outlives any close. Documented honestly in the close UI copy. |
| D-6 | Recategorization in closed months | **Frozen too.** Any UPDATE to a row whose `occurred_on` is closed → 409 (even account-only changes). | Recategorizing moves money between P&L categories inside a reported month — exactly what "books closed" promises the accountant cannot happen. The adjustment path covers corrections. |
| D-7 | Which months closable | **Any month strictly before the current UTC calendar month**, per book, independent (non-contiguous closes allowed). Closing an empty month is allowed (0-totals snapshot). | Closing the in-progress month invites immediate adjustment churn; "complete month" is the honest unit. Contiguity enforcement adds rules with no accountant benefit. |
| D-8 | Forecast model | **Flat coach/CPA-entered effective rate** (`bookkeeping_tax_rate_percent`, no-seed setting, 2dp rounding — the `bookkeeping_home_office_percent` pattern verbatim) × YTD net, + generic quarterly safe-harbor copy (next date from Apr 15 / Jun 15 / Sep 15 / Jan 15). Absent rate → card prompts "ask your CPA for a safe-harbor rate", **no dollar figure**. Negative YTD net → estimated tax floors at $0 (net still shown). | Anything cleverer (brackets, SE/QBI) is fake precision the honesty guardrails forbid. Junk-defense mirrors `coerceHomeOfficePercent` (`insight-types.ts:26-30`). |
| D-9 | Forecast window | **Pinned to calendar YTD (Jan 1 → today), independent of the insights page's selected window.** One dedicated `listEntriesForInsights(ytdFrom, today)` read; per-business-book totals + the home-office proposal (reusing `homeOfficeCandidate`) computed from it. | "Rolling tax forecast" is a YTD concept; an arbitrary page window × an annual rate is a misleading number. One extra read on a single-admin page is cheap. |
| D-10 | Watchdog delivery + threshold | **Insights card (no flag) + weekly cron email to the COACH (flag OFF).** Predicate: expense entries on accounts with `is_deductible_candidate` OR `requires_business_purpose`, where `document_id IS NULL` (deductible-candidate accounts) or blank `business_purpose` (purpose-required accounts), aged ≥ **14 days** (pinned constant). Cron window: trailing 365 days. Empty findings → success-skip, no email. | Sweep contradiction #3: this is a superset of Phase-5's substantiation-gap predicate (`document_id` plays no role there) — extract a shared pure module, don't twin it (the cron work runs in the internal Next route, lib-side, per the quarterly-pack precedent, so no functions twin is needed). Email goes to the coach, not the accountant — it is a chore list, not a filing artifact. |
| D-11 | Chat tool set + caps | **4 tools** (§6): `bookkeeping_summary`, `bookkeeping_income_by_service`, `bookkeeping_top_vendors`, `bookkeeping_find_entries`. `find_entries`: limit ≤ 50 + `offset` + `total_count` (`count:"exact", head:true` precedent at `admin-tools.ts:1308`). Aggregate tools: paginated fetch-all with a 20k-row hard stop that sets `partial: true`. Every result JSON carries `book_name(s)` + `from`/`to` so answers self-cite. No tool writes. | No global truncation exists on tool outputs and a bare select caps at ~1000 rows silently (sweep 6c risk). Kickoff's RTDB-null landmine is **inapplicable** — the stack is Firestore `onSnapshot` (`hooks/use-ai-job.ts:5`), `executeAdminTool` returns `Promise<string>`; no null-drop fixtures needed (sweep contradiction #1). |
| D-12 | Depreciation posting | **Report-layer only.** No ledger rows. The `source` CHECK (`00183:49-50`) rejects any new source value at the DB — posting would need an ALTER plus `LedgerSource` + `listPostedForDedupe` widening, and would leak into every aggregator and the close guard. `source='depreciation'` entries deferred until the CPA asks. | Sweep gap #1. Keeps D4 interactions trivial: the close snapshots cash-basis ledger totals; book depreciation lives on the pack/print for the CPA. |
| D-13 | Depreciation methods | **`straight_line` only**, convention `full_month` or `half_year`, `recovery_years` 1–50, salvage supported — all accountant-supplied via CRUD; a fixed enum, no AI anywhere. Final schedule year absorbs rounding remainder so the schedule sums exactly to basis − salvage. | D7: tracked, not decided. Straight-line is the only method computable without pretending to be MACRS software; the CPA can map it. |
| D-14 | 6e build-now vs spec-only | **Spec-only** (§1 rationale, §8 spec). | Honest capacity call made up front, not after fatigue; the kickoff names it the safest deferral. |
| D-15 | Close email recipient | To stored `bookkeeping_accountant_email` when non-empty (cc coach), else coach alone. Flag `bookkeeping_close_email_enabled` default OFF. Send is fire-and-forget AFTER the close persists — email failure never fails the close (audited as failure outcome). | 4b precedent for recipient + cc; the close action is the primary record, the email is a courtesy statement of record-keeping. |

Standing: the spouse W-2-vs-business question remains OPEN — every 6a–6e surface treats her book identically per-book, never special-cased.

---

## 3. 6a — Monthly close

### 3.1 Migration `00188_bookkeeping_period_closes.sql` (additive, reversible, inert without code)

```sql
create table if not exists bookkeeping_period_closes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references bookkeeping_books(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closed_at timestamptz not null default now(),
  closed_by uuid references users(id) on delete set null,
  income_cents integer not null,
  expense_cents integer not null,
  net_cents integer not null,
  entry_count integer not null,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, period)          -- PLAIN unique (00184 lesson)
);
-- RLS ceremony per 00183 admin-policy style; index on (book_id, period) via the unique.

alter table bookkeeping_ledger_entries
  add column if not exists adjusts_period text
  check (adjusts_period is null or adjusts_period ~ '^\d{4}-(0[1-9]|1[0-2])$');

insert into system_settings (key, value, description) values
  ('bookkeeping_close_email_enabled', 'false'::jsonb, 'Send the books-closed email when a month is closed'),
  ('cron_bookkeeping_receipt_watchdog_enabled', 'false'::jsonb, 'Enable the weekly missing-receipt watchdog email cron')
on conflict (key) do nothing;
```
(The watchdog flag rides 00188 because 6a+6b build back-to-back this session; 6c needs no migration.)

### 3.2 Pure logic — `lib/bookkeeping/period-close.ts` (zero IO)

- `periodOf(dateStr: string): string` — `"2026-03-15" → "2026-03"` (slice; input already regex-validated at every boundary).
- `monthBounds(period: string): { from: string; to: string }` — first/last day, real calendar (leap-safe).
- `isClosablePeriod(period: string, todayIso: string): boolean` — strictly before the current UTC month.
- `snapshotTotals(entries: Array<{direction, amount_cents}>): { income_cents; expense_cents; net_cents; entry_count }` — integer cents; net = income − expense, the only subtraction.
- Mutation-discriminating fixtures: a Dec→Jan boundary, a leap February, an entry ON the month's first/last day (inclusive), and a mixed-direction total whose net differs under sign-flip.

### 3.3 The write guard (DAL choke point — the heart of D4)

New in `lib/db/bookkeeping.ts`:
- `export class PeriodClosedError extends Error { code = "PERIOD_CLOSED" as const; constructor(public book_id: string, public period: string) {...} }`
- `listClosedPeriods(bookId: string): Promise<string[]>` (one indexed select).
- Internal `assertOpen(closedSet, occurredOn)` using the pure `periodOf`.

**Canonical write-path table (pinned; the Opus review traces every row).** All ledger writes flow through exactly these 6 DAL functions, reached by 8 method+path pairs:

| # | Writer (lib/db/bookkeeping.ts) | Route(s) | Guard behavior |
|---|---|---|---|
| 1 | `createEntry` (:109) | `POST /api/admin/bookkeeping/entries` (route.ts:53); `POST .../receipts/cash` (cash/route.ts:24) | throw `PeriodClosedError` if `periodOf(occurred_on)` closed for `book_id` |
| 2 | `updateEntry` (:115) | `PATCH .../entries/[id]` ([id]/route.ts:28) | **unconditional fetch of the old row** (today `getEntry` runs only when `account_id` is in the payload — :15); throw if OLD row's period closed, OR if `updates.occurred_on` present and NEW period closed. `book_id` cannot change via the route (Zod strips it) — guard re-derives book from the row, never from input |
| 3 | `deleteEntry` (:121) | `DELETE .../entries/[id]` (:43) | fetch row first (today it never fetches); throw if its period closed |
| 4 | `insertImportedEntries` (:126) | `POST .../statement-import/commit` (:30); `POST .../import-platform/commit` (:15) | fetch closed periods ONCE for the batch book; partition; upsert only open-period drafts; return `{ inserted, rejected_closed, rejected_closed_rows }` — rejection happens **before** the upsert so it is never conflated with the silent duplicate-skip |
| 5 | `insertReceiptEntry` (:248) | `POST .../receipts/commit` (:43) | throw (single-row) |
| 6 | `insertAmazonEntries` (:268) | `POST .../receipts/amazon/commit` (:57) | partition + `rejected_closed` like #4 |

Indirect, **allowed by design (D-5)**: `deleteDocument` / retention cron → `document_id ON DELETE SET NULL` on closed-period rows (column-only; totals untouched). Dormant schema paths (book/account deletes) have no code path — unchanged.

Route mapping: catch `.code === "PERIOD_CLOSED"` → **409** `{ error: "That month is closed for this book. Post an adjustment entry in the current open month instead (it can reference the closed month)." }`.

Batch response addition (additive — dialogs currently read only `inserted`/`batchId`):
`rejected_closed: number` + `rejected_closed_rows: Array<{ occurred_on, amount_cents, memo | counterparty, source_ref | null }>` capped at 50. All three dialogs (`ImportPlatformDialog`, `StatementImportDialog`, Amazon dialog) render a distinct amber "N rows fall in closed months — post them as adjustments" line and EXCLUDE `rejected_closed` from the "already imported" arithmetic.

### 3.4 Close DAL + routes

DAL: `listCloses(bookId?)`, `getClose(bookId, period)`, `insertClose(row)`, `deleteClose(id)`, plus `listClosedPeriods` above.

- `GET /api/admin/bookkeeping/closes?book_id=` — list (unaudited JSON read; standard `auth()`→403 single-branch gate).
- `POST /api/admin/bookkeeping/closes` `{ book_id, period }` — validate (Zod `closePeriodSchema`: uuid + period regex), `isClosablePeriod` → 422 if not past, `getClose` → 409 if already closed (DB unique as backstop), compute totals via `listEntriesForReports(monthBounds…, bookId)` + `snapshotTotals`, insert, `void recordAudit("bookkeeping.period_closed", commerce, metadata: totals)`. Then, if `bookkeeping_close_email_enabled` and after the row persists: fire-and-forget `sendBooksClosedEmail` (§3.5); stamp `email_sent_at` on success; audit `bookkeeping.close_emailed` success/failure. Response: the close row.
- `DELETE /api/admin/bookkeeping/closes/[id]` — fetch row → 404 if absent; delete; `void recordAudit("bookkeeping.period_reopened", commerce, metadata: full snapshot)`. Response `{ reopened: true }`.

New audit slugs (register in `lib/audit/actions.ts` bookkeeping block): `bookkeeping.period_closed`, `bookkeeping.period_reopened`, `bookkeeping.close_emailed` — all `commerce`.

### 3.5 Books-closed email — `lib/bookkeeping/email-close.ts`

Small sibling of `email-pack.ts` (same Resend init, fail-LOUD without `RESEND_API_KEY`, coach-cc): subject "Books closed — {book} {Month YYYY}", body = the snapshot table (income/expense/net, entry count, closed-by/at) + honesty line: *"This confirms the month's record-keeping is closed in DJP Athlete's books. It is not a filing; your CPA files."* Recipient per D-15.

### 3.6 UI (on `/admin/books`)

- `CloseMonthCard` (client) on the Books page, scoped to the active book tab: lists that book's closed months (period, net, closed date — from close rows), a "Close a month" action (select any closable past month → POST → toast with totals), and per-row "Reopen" (confirm dialog → DELETE). Copy states D-5 honestly ("closing freezes totals; document links may still be pruned by retention").
- Manual-entry dialog + entry edit: optional **"Adjusts closed month"** select (visible only when the book has ≥1 closed month; options = that book's closed periods). Ledger table shows a small `adjusts 2026-03` badge when set.
- `createEntrySchema`/`updateEntrySchema` gain optional/nullable `adjusts_period` (regex-validated).

### 3.7 6a tests

- Pure: `__tests__/lib/bookkeeping/period-close.test.ts` — §3.2 fixtures.
- DAL guard: the guard's decision logic is pure (`periodOf` + set membership) and tested there; DAL wiring is exercised via route tests: for EACH of the 8 method+path pairs, a test where the DAL mock throws `PeriodClosedError` → asserts 409 + message (single-row) or asserts the `rejected_closed` passthrough (batch). Existing route tests stay green untouched — no new route-level imports (D-2), DAL mock shapes unchanged, response fields additive.
- Close routes: close/reopen happy path, 422 current-month, 409 double-close, audit fire, email flag OFF → no send / ON → send + `email_sent_at`.
- Existing-suite invariant: no closes exist by default → guard no-ops; the known-red baseline must not move.

---

## 4. 6b — Missing-receipt watchdog + rolling tax forecast

### 4.1 Watchdog pure finder — `lib/bookkeeping/receipt-watchdog.ts`

`receiptWatchdogFindings(entries: InsightEntry[], accounts: InsightAccount[], opts: { today: string; minAgeDays: number }): WatchdogFinding[]`
- Expense entries on watched accounts (`is_deductible_candidate || requires_business_purpose`), `occurred_on ≤ today − minAgeDays`, flagged with reasons: `no_document` (deductible-candidate account, `document_id === null`) and/or `no_purpose` (purpose-required account, blank/whitespace `business_purpose` — the Phase-5 predicate, **extracted**: `isBlankPurpose` moves to a shared export both `deduction-finder.ts` and this file import; deduction-finder's behavior byte-identical, its tests untouched).
- Sort `amount_cents` desc; each finding carries book_id, account name, occurred_on, amount, counterparty, reasons.
- `MIN_AGE_DAYS = 14` pinned constant. Mutation fixtures: 13-vs-14-day boundary, doc-null-but-purpose-present on each account type (discriminates the two reasons), income entry excluded, unwatched account excluded.

### 4.2 Watchdog cron (the quarterly-pack template, byte-identical names three ways)

- functions: `bookkeepingReceiptWatchdogCron` — `onSchedule("0 7 * * 2")` (Tue 07:00 UTC; clear of Mon inbox-SLA/revenue and daily 03/04/05/08 crons), secrets `[internalCronToken, appUrl]` only (sweep note: quarterly-pack over-declares supabase secrets it never uses — don't copy that), pure fetch-delegator POSTing `/api/admin/internal/bookkeeping-receipt-watchdog`.
- Route `app/api/admin/internal/bookkeeping-receipt-watchdog/route.ts`: Bearer `INTERNAL_CRON_TOKEN` triple-clause → `isCronSkipped({ enabledKey: "cron_bookkeeping_receipt_watchdog_enabled", defaultEnabled: false })` → 200 `{skipped}` (success-skip) → `logCronStart` (route is the SINGLE cron_runs owner) → trailing-365d `listEntriesForInsights` + `listAccountsForInsights` → findings → empty ⇒ `logCronEnd success {findings: 0}` no email; else email COACH (top 25 by amount + total count + total cents + link to `/admin/books/insights`), audit `bookkeeping.receipt_watchdog_emailed` (commerce, `actor: {role: "system"}` override), `logCronEnd success {findings, emailed}`. Failures: `logCronEnd failed` + 500.
- `EXPECTED_CRONS` append: `{ name: "bookkeepingReceiptWatchdogCron", sla_hours: 204 }` (weekly + slack; the scanner test derives from the array — append-safe, sweep gap #2).
- Email builder in `lib/bookkeeping/email-watchdog.ts` (Resend, fail-loud, coach-only recipient).

### 4.3 Tax forecast pure fn — `lib/bookkeeping/tax-forecast.ts`

`taxForecast(input: { ytd_income_cents; ytd_expense_cents; home_office_deduction_cents: number | null; rate_percent: number | null; today: string }): TaxForecast`
- `estimated_net_cents = income − expense − (home_office ?? 0)`; `rate_percent === null` → `estimated_tax_cents: null`; else `Math.round(max(0, net) * rate / 100)` — the ONLY rounding point. Also returns `next_safe_harbor: { label, date }` from the fixed generic list (Apr 15 / Jun 15 / Sep 15 / Jan 15, next strictly-after `today`, Jan rolls year).
- Mutation fixtures: odd-cents × 12.34% (discriminates round/trunc), negative net → tax 0 but net negative preserved, null rate → null tax, home-office subtraction present vs absent, safe-harbor boundary on Apr 15 itself (→ Jun 15).

### 4.4 Surfaces + setting

- Insights route (`/api/admin/bookkeeping/insights`): in the existing `Promise.all`, add `getSetting<number|null>("bookkeeping_tax_rate_percent", null)` (coerced via a `coerceHomeOfficePercent`-style junk-defense) + one dedicated YTD `listEntriesForInsights(Jan 1 → today)` read (D-9). Per BUSINESS book: YTD totals (pure sum) + `homeOfficeCandidate` (primary book only, % set) → `taxForecast`. Household book: no forecast. Response gains `forecast` + `watchdog` sections (watchdog computed over the page's selected window with the §4.1 finder).
- `PATCH /api/admin/bookkeeping/insights/tax-rate` — the home-office PATCH verbatim (`{ percent: z.number().min(0.01).max(100).nullable() }`, 2dp `Math.round(x*100)/100`, `setSetting`, audit `bookkeeping.tax_rate_percent_set` commerce, previous/new in metadata).
- Insights page: **Forecast card** per business book (YTD net, home-office line when included, rate, estimated tax OR the no-rate prompt with an inline rate editor like the home-office card; honesty copy inline: *"Estimate only — gross, cash-basis, flat rate you/your CPA entered; no entity/SE/QBI nuance. Your CPA files."* + next safe-harbor date, generic). **Watchdog card** (no flag): count, total cents, top rows, reasons badges.
- New audit slugs: `bookkeeping.tax_rate_percent_set`, `bookkeeping.receipt_watchdog_emailed` (both commerce).

### 4.5 6b tests

Pure finder + forecast fixtures (§4.1/§4.3); internal-route tests (auth 401 triple-clause, flag-off success-skip, empty-findings skip, email path with mocked Resend + cron_runs single-owner assertions — clone `bookkeeping-quarterly-pack.test.ts`); insights route extension test (rate absent → null tax + no dollar string; YTD read invoked with Jan-1 window); tax-rate PATCH clone of home-office tests.

---

## 5. 6c — Ask-your-books chat tools

Stack facts (sweep-verified): tools live in `functions/src/ai/admin-tools.ts` as raw JSON-Schema declarations + a switch in `executeAdminTool` returning `Promise<string>`; `TOOL_LABELS` (:250) feeds the UI's tool-activity line; transport is **Firestore** `onSnapshot` (`hooks/use-ai-job.ts`) — nulls survive; results feed further rounds (`streamWithTools`, `maxToolRounds: 5`). functions cannot import `lib/`.

### 5.1 The 4 tools (read-only; every result self-cites)

| Tool | Input (all optional unless noted) | Returns (JSON string) |
|---|---|---|
| `bookkeeping_summary` | `book` (name), `from`, `to` (default YTD) | per-book `{ book_name, income_cents, expense_cents, net_cents, entry_count }` + window; all books when `book` omitted |
| `bookkeeping_income_by_service` | `book`, `from`, `to` | per-service-line income rollup (the `reports.ts` semantics) |
| `bookkeeping_top_vendors` | `book`, `from`, `to`, `direction` (default expense), `limit ≤ 20` | counterparty rollup by total cents desc + entry counts |
| `bookkeeping_find_entries` | `book`, `from`, `to`, `query` (memo/counterparty ilike), `direction`, `limit ≤ 50` (default 20), `offset` | rows (date, amount, direction, account, counterparty, memo, source) + **`total_count`** + `"showing X of Y"` note |

Shared rules: `book` resolves against `bookkeeping_books` by case-insensitive name match — unknown name returns the available book names instead of guessing; every result carries `book_name`(s) + `from`/`to`; money stays integer cents with a note that values are cents; aggregate tools read via a paginated fetch-all loop (new `functions/src/lib/paginate.ts` twin of `lib/db/paginate.ts`) with a 20,000-row hard stop that sets `partial: true` + a "totals cover the first 20,000 entries" note (no silent truncation — D11); `find_entries` uses `count: "exact"` for `total_count`. No tool writes anything. System-prompt addendum: answers about money must cite the book + window the tool returned and never invent rows.

### 5.2 Twins + parity

- `functions/src/lib/bookkeeping-aggregate.ts`: pure aggregation math (summary totals, service-line rollup, counterparty rollup) over plain row arrays.
- Lib-side siblings: reuse `lib/bookkeeping/reports.ts` where the math already exists; add pure `topCounterparties(entries, opts)` to reports.ts (reusable by future UI).
- **Fixture-parity test** (root `__tests__/lib/bookkeeping/chat-tools-parity.test.ts`, the `statement-schema-parity` cross-import precedent): identical fixtures through lib fns and functions twins → deep-equal outputs. This is stronger than schema parity and pins the twins together.
- `TOOL_LABELS` entries for all 4 (e.g. "Reading your books"). Executor tests live with the existing functions test suite (mock supabase client; cap + partial-flag + unknown-book + total_count cases).

---

## 6. 6d — Equipment depreciation engine

### 6.1 Migration `00189_bookkeeping_assets.sql`

`bookkeeping_assets`: `id`, `book_id` FK cascade, `name text not null`, `basis_cents integer not null check (basis_cents >= 0)`, `salvage_cents integer not null default 0 check (salvage_cents >= 0)`, check `salvage_cents <= basis_cents`, `in_service_on date not null`, `method text not null check (method in ('straight_line'))`, `convention text not null check (convention in ('full_month','half_year'))`, `recovery_years integer not null check (recovery_years between 1 and 50)`, `accountant_note text`, timestamps, index `(book_id)`, RLS ceremony (00183 admin style). No ledger changes (D-12).

### 6.2 Pure schedule — `lib/bookkeeping/depreciation.ts`

`depreciationSchedule(asset, throughYear: number): { years: Array<{ year, depreciation_cents, accumulated_cents, remaining_cents }>, fully_depreciated_in: number }`
- Depreciable base = basis − salvage. Annual = base / recovery_years, `Math.round` per year at ONE defined point; `full_month`: year 1 gets `monthsInService/12` of annual (in-service month counts, December in-service = 1/12), tail year completes the base; `half_year`: 6/12 in year 1 and the balance finishing in year `recovery + 1`. **The final year is the remainder** (base − accumulated), so the schedule sums to base EXACTLY.
- Mutation fixtures: 10000¢/3yr full-month Jan (3333/3333/3334 — discriminates final-year-remainder from naive rounding), a mid-year in-service month (discriminates month-proration from half-year), salvage > 0, `throughYear` before/at/after exhaustion, single-year recovery.

### 6.3 DAL, routes, UI

- DAL: `listAssets(bookId?)`, `getAsset`, `createAsset`, `updateAsset`, `deleteAsset` (hard delete — accountant-supplied rows, audited).
- Routes: `GET/POST /api/admin/bookkeeping/assets`, `PATCH/DELETE /api/admin/bookkeeping/assets/[id]` — standard gate, `assetSchema` Zod (enums pinned to the DB CHECKs), audit slugs `bookkeeping.asset_created` / `asset_updated` / `asset_deleted` (commerce), asset must belong to an existing book (404 otherwise).
- Page `/admin/books/assets` (server page + `AssetsClient`, the AccountsManager pattern): per-book asset table, add/edit dialog (all fields accountant-supplied; method/convention fixed selects), per-asset schedule preview (pure fn imported client-side), delete with confirm. Honesty header: *"Depreciation is tracked, not decided — enter the basis, method, and life your accountant supplies. Book depreciation for your CPA, not a filing."* Toolbar link from `/admin/books`.

### 6.4 Pack + print

- `addDepreciationSheet` in `lib/bookkeeping/accountant-pack.ts`, after the per-book P&L loop, before Documents (sweep-verified attach point): per-asset rows (name, book, in-service, basis, salvage, method, convention, recovery, **this-year depreciation**, accumulated-through-year, note) for the report window's end year + the honesty line; sheet omitted when no assets exist (honest empty-state).
- Print page: matching section after the `PnlBlock` loop, same data, `.print-document` styling.
- Assets are read directly (asset lifetimes cross report windows — `ReportEntry` is windowed and has no `id`; sweep 6d risk).

---

## 7. Honesty guardrails (in-product copy, non-negotiable)

- Forecast card: estimate label + assumptions inline + "Your CPA files" (§4.4). No rate → no dollar figure.
- Depreciation: "tracked, not decided" on the assets page, the pack sheet, and print (§6.3/6.4).
- Close email: statement of record-keeping, not a filing (§3.5).
- Chat: every answer cites book + window from the tool result; capped results say "showing X of Y"; partial aggregates say so (§5.1).
- Business and household stay separate books on every surface; the spouse book is treated identically per-book.

---

## 8. 6e — Stripe payout ingestion + net revenue + real dedupe (SPEC-ONLY; its own kickoff)

**Goal.** Ingest Stripe payouts + their balance transactions by READING the API on a schedule (never the webhook — `app/api/stripe/webhook/route.ts` is untouchable; its tests sit in the known-red family and any edit muddies baseline attribution). Derive net revenue (gross − Stripe fees) as a labeled second line (gross stays primary, D3), and upgrade statement-import dedupe with exact payout-net matching.

**Migration 00190 sketch.** `bookkeeping_payouts`: `id`, `stripe_payout_id text UNIQUE` (**PLAIN unique** — upsert key), `book_id` FK (default: primary business book), `amount_cents` (net), `gross_cents`, `fee_cents`, `arrival_date date`, `status text` (`in_transit|paid|failed|canceled`), `currency`, `raw jsonb`, timestamps. Optional `bookkeeping_payout_lines` (per balance-transaction: `stripe_balance_txn_id` PLAIN unique, payout FK, `type`, `gross_cents`, `fee_cents`, `net_cents`, `source_ref` hint) — decide in that session whether lines are needed for the fee model or the payout roll-up suffices.

**Sync cron.** `bookkeepingPayoutSyncCron` (daily, flag `cron_bookkeeping_payout_sync_enabled` OFF) → `/api/admin/internal/bookkeeping-payout-sync` (Bearer triple-clause, single-owner cron_runs, EXPECTED_CRONS append). **Watermark decision (from sweep):** no `system_settings` cursor — derive resume from `bookkeeping_payouts` itself (max `arrival_date` minus a 14-day overlap window) and re-pull the trailing window every run; payout status transitions (`in_transit → paid/failed`) force re-pulls anyway; idempotent via the PLAIN-unique upserts; Stripe-native `starting_after` pagination. **Pin `apiVersion` in `lib/stripe.ts`** (currently unpinned — `new Stripe(key)` at :5) or parse payout fields defensively; decide there (a pin affects every existing Stripe call — needs its own regression check).

**Fee-model questions for that session (open):** (1) fees from `balance_transaction.fee` per charge vs the payout's aggregate — which does the CPA want on the P&L? (2) refunds/disputes inside a payout — negative lines vs adjustment entries; (3) non-charge balance transactions (payout reversals, top-ups); (4) does net revenue ever POST to the ledger (would require the `source` CHECK ALTER + `LedgerSource` + `listPostedForDedupe` widening — same blocker class as D-12) or stay report-layer (lean report-layer: a `net_cents_after_fees` sibling beside `net_cents` in `reports.ts`, its only subtraction, + a labeled pack line).

**Real dedupe.** New exact layer between layer 1 (source_ref) and layer 2 (fuzzy) of `annotateIncome` (`lib/bookkeeping/statement-dedupe.ts:140-142` boundary): bank line matches a payout when `amount_cents === payout.net` and date within ±2 days of `arrival_date`; consumed-set contract extends to payout matches (one bank line consumes one payout); flags (never drops) as `payout_match` with the payout id. Phase-2's fuzzy layer stays as the fallback.

**Verification demands (that session):** live trace of one payout's gross − fee − net against the Stripe dashboard; sentinel bank line matching a sentinel payout; the consumed-set double-match test.

---

## 9. Test + verification gates (whole phase)

- Test roots: pure → `__tests__/lib/bookkeeping/`; routes → `__tests__/app/api/admin/bookkeeping/` (+ internal routes beside the quarterly-pack test); functions executor tests in `functions/`; parity tests at root. NEVER `__tests__/db/`. RFC-4122 fixture UUIDs.
- Per sub-phase: scoped tests green; after 6d: full suite vs the known-red baseline (admin-nav ± the load-flaky family; snapshot before/after; stash-test any suspicious red), **`npm run build` as its own command** (never chained behind `test:run` with `&&`), functions build + suite when 6b/6c land.
- Live prod proof (sentinel pattern, `f6`-prefix ids; **far-PAST window, e.g. 2019-01** — D-7 makes future months unclosable, and a pre-business past month is just as collision-proof on a near-empty ledger): (i) close a sentinel month for a sentinel-populated book → write into it through EVERY one of the 8 paths → all 409/rejected → adjustment entry posts in the open period → reopen → delete sentinels, SQL-verified 0 rows; (ii) forecast card exact-cents check with a set rate; (iii) one chat tool round-trip if a test harness for `executeAdminTool` is feasible functions-side (else executor tests stand).
- Final Opus whole-branch review must trace: a closed-month write through every row of the §3.3 table; the extracted `isBlankPurpose` refactor (Phase-5 behavior unchanged); one chat tool's cents from DB to self-cited answer; one depreciation schedule's sum === basis − salvage.
- Migrations applied live via `mcp__supabase__apply_migration` as each lands (additive/inert precedent).
- Push HELD; 6b/6c touch `functions/**` → the eventual push deploys via GHA (state in the final report).

## 10. Out of scope

Gmail poller (3b), findings dismissals/AI narrative (5b), 6e build (§8), any `source` CHECK widening, posting depreciation, spouse-book special-casing, proposal-doc/promo corrections (tracked post-build umbrella task).
