# AI Bookkeeper — "Whole Picture" ($750) — Umbrella Design

**Date:** 2026-07-17
**For:** Darren Paul (solo owner, US taxpayer, files once a year)
**Status:** Design approved under autonomous-mode delegation ("just do it"). Decisions below were made by Claude with documented defaults; Darren reviews on return.
**Sources:** Sales proposal "AI Bookkeeper Proposal (Final)" (`1OC0qHP0…`), the July 11 + July 14 journal entries, and a 12-subsystem codebase reuse map (`scratchpad/brief.md`, verified against the working tree at `7a34a41a`).

---

## 1. What this is, and the one thing that changed

Darren bought the **$750 "Whole Picture"** tier. The package builds bookkeeping directly into the DJP Athlete admin so his books keep themselves all year, and February becomes one button: an Excel workbook (+ QuickBooks export) with a tab per question his accountant asks — total income/expense/net, income by service line, P&L by category, his wife's business kept separate, home & tenancy, household/personal, and a receipt index.

**The one material correction to the sold scope: Darren is a tenant, not a landlord.**

The proposal's property pillar ("rental income, vacancy tracking, building depreciation") is a **landlord** concept (US Schedule E). For a tenant all three are permanently empty. The July 14 journal notes that scope came from Darren's own WhatsApp screenshots — almost certainly a generic chart-of-accounts template he found while researching, not a description of his situation. We reframe the pillar so it delivers real value instead of three blank tabs:

| Sold (landlord) | Built (tenant) | Why it's better |
|---|---|---|
| Rental income | — (removed) | A tenant has none. |
| Vacancy tracking | — (removed) | Meaningless for a tenant. |
| Building depreciation (27.5-yr) | **Equipment/vehicle depreciation** | Gym equipment, laptop, phone, vehicle are real depreciable business assets for a strength coach. The proposal's honesty line — "depreciation is tracked, not decided; the CPA sets basis/method" — holds verbatim, repointed. |
| "Property, properly tracked" | **Home & tenancy** (rent paid, utilities/internet, renter's insurance, repairs he pays) | Real, currently-untracked money. |
| — | **Home-office allocation** (new headline) | A self-employed tenant deducts a share of rent + utilities. This is very likely his single largest unclaimed deduction, and it's exactly what the "AI deduction finder" was sold to find. The Home & tenancy ledger *feeds* that finder — the pillar stops being a passive ledger and starts earning the extra $250. |

This changes the depreciation engine's subject (asset table, not building) and the property pillar's shape. It does **not** shrink the package — the tenant version is more useful. **The proposal doc and the promo's packages scene must be corrected to match** (they are one pitch; the journal already carries a scar from letting them drift). Tracked as a post-build task.

---

## 2. Architecture decisions (the 12 open questions, resolved)

Each was a genuine fork surfaced by the reuse map. Defaults chosen for correctness, honesty to the client, and reuse of proven codebase patterns.

**D1 — Tenancy model → `books` table + `book_id` FK on every bookkeeping row.**
A *book* is a tax context, not a legal entity. Seed three: `Darren — DJP Athlete` (business), `<Wife> — <her business>` (business), `Household & Personal` (household, includes home & tenancy). `book_kind` enum = `business | household`. Home-office allocation is a *derived* candidate that reads Household rent/utilities and proposes a business-book deduction — never an automatic cross-book transfer.
⚠️ **RLS is decorative here** (constraint #15: all DALs are service-role). Book isolation is application-level discipline: every DAL takes `bookId`, every route resolves it, every AI tool scopes to it. There is no client-facing seam — the whole feature is admin-only, which is the only thing between household finances and the open internet. Documented as the top standing risk.

**D2 — Ledger shape → categorized single-entry cash flow with a chart of accounts.** Not double-entry. A solo coach + QuickBooks import wants categories, not journal debits/credits. `ledger_entries` carries `amount_cents` (signed by `direction`), `account_id` (chart of accounts), `book_id`, `occurred_on`, `source`, `memo`, `business_purpose`, `counterparty`. If the accountant later needs true journal entries, that's an export adapter, not a schema change.

**D3 — Authoritative platform income → read-only adapter that unions the money-of-record tables; never treat `payments` as the ledger.** The map proved `payments` is a Stripe-only side-effect table missing three income streams (offline/cash packs, shop orders, membership renewals) and carrying wrong-shaped columns (no `paid_at`, no `method`, in-place refund mutation, nullable `user_id`, ids buried in jsonb). We do **not** backfill the webhook writers (constraint #11: shared-webhook edits break unrelated billing). Instead a pure **income adapter** reads the 5 money-of-record tables → normalized `LedgerEntryDraft[]` the coach reviews and posts into `ledger_entries`. **Gross first**; net (Stripe fees) requires new payout ingestion → deferred to Phase 6. A household-billed session fee is **Darren's** business income (he earned it) regardless of who paid (`resolveBillingUserId` decides the payer; the ledger decides the earner).

**D4 — Retroactive refunds → immutable monthly close + period-adjustment entries.** "Books closed" implies freeze. A month, once closed, is a frozen snapshot; a later refund posts an explicit adjusting entry into the current open period, never rewrites a closed one. **Phase 1 keeps entries recompute-able (no close yet); the freeze lands with the monthly-close phase (Phase 6).** Phase 1 just must not design anything that blocks it (e.g. entries carry `occurred_on` distinct from `created_at`).

**D5 — Receipt intake ranking → cash 2-tap + admin photo upload first; forwarded-email + Amazon later.** Cash 2-tap (no file) and admin photo upload (reuse the existing admin signed-URL mint → `getPrivateBucket()`) are cheap. Forwarded email is the single hardest gap (no inbound path exists at all) → its own phase via a Gmail-label poller, not a real MX/inbound webhook. Amazon CSV needs a real parser (`lib/csv-parser.ts` splits on newlines before quotes — unsafe). Vision→structured needs `callAgent` widened to accept image content blocks (Phase 3).

**D6 — Payouts / Stripe-vs-bank dedupe → OUT of v1.** Stripe payouts are 100% unmodeled (zero `payouts.list`/`balanceTransactions` anywhere). Real dedupe requires net-new Stripe surface + a payouts table + a fee model → Phase 6. v1 dedupe = fuzzy `amount + date (± window)` matching a bank/Venmo line against already-known platform income, flagged for the coach to confirm — honest and useful without the payout subsystem.

**D7 — Depreciation authority → accountant sets, AI applies.** The asset schedule (basis, method, in-service date, convention, recovery period) is **data the accountant supplies once**; the engine only computes and applies it consistently. The AI never invents a MACRS method (an AI-invented schedule is a wrong tax return). Repointed to equipment/vehicles. Phase 6.

**D8 — QuickBooks export → journal/transaction CSV in a QuickBooks-importable shape.** Not the QBO OAuth API (a whole integration → out of scope at this price). CSV built on the `lib/ads/campaign-blueprint-csv.ts` serializer pattern, hardened with CSV-injection defense (constraint #14). Phase 4. Flag-gated (D10).

**D9 — Accountant pack → exceljs workbook + browser Save-as-PDF print page.** No PDF library exists and none is added. The Excel workbook rides the proven `lib/excel-templates.ts` writer (already styled/multi-sheet); the "on paper" view rides the existing `@media print` page pattern. Emailing the workbook (Resend `attachments` — never used in-repo) is a Phase 4 sub-task, flag-gated.

**D10 — Flags → none on read surfaces; DB-backed flags on outward actions.** Standing rule is always-on. Books, ledger, reports UI, and chat only *read* money — no flag. QuickBooks **export** and any **outbound accountant email** get DB-backed `system_settings` flags (default OFF) because they emit data outward. Seeded via `INSERT … ON CONFLICT DO NOTHING`, raw `'false'::jsonb`.

**D11 — AI chat → add tools to `ADMIN_TOOLS`, cap every tool's rows.** "Ask your books" is the cleanest seam in the feature: add bookkeeping tools to `functions/src/ai/admin-tools.ts` + `executeAdminTool` + `TOOL_LABELS`, riding the existing `AdminAiChat`/`ai-chat`/`useAiJob` stack. Every tool returns **aggregates, or paginated+capped rows** — the 1000-row PostgREST cap must never silently truncate the AI's view (it would answer confidently with wrong numbers). Phase 6.

**D12 — Retention → 7-year window, explicit deletion path, private bucket only.** Receipt images + statements are the most sensitive data the platform holds. They go to `getPrivateBucket()` (signed-URL only; never the world-writable `storage.rules` prefixes). A `bookkeeping_documents` row carries `retain_until` (occurred year + 7). A deletion path exists from day one (the repo's only delete helper today is `deleteAvatar` — we add ours). Retention pruning cron is Phase 3 (ships with receipts).

---

## 3. Phase breakdown (each phase = its own spec → plan → build → review cycle)

The $750 package is unambiguously multiple independent subsystems (the brainstorming skill's decomposition trigger). It is **not** responsibly buildable end-to-end in one unsupervised pass — two pillars (inbound email, Stripe payout ingestion) are genuinely hard net-new infrastructure. We build the foundation to completion now and spec the rest so a later session (or a one-word go-ahead) continues.

| Phase | Name | Contents | Build risk |
|---|---|---|---|
| **1** | **Foundation & ledger** *(this session)* | `books`, `accounts` (chart of accounts), `ledger_entries` tables; shared money formatter, CSV serializer w/ injection defense, full-table paginator; **income adapter** (read-only union → review drafts); **manual entry** (record arbitrary income/expense — none exists today); `/admin/books` UI (book switcher, ledger table + filters, category manager, manual-entry dialog, import-from-platform review); audit slugs. | LOW–MOD |
| **2** | **Statement import** | Venmo/bank CSV + PDF upload → AI categorization job → fuzzy dedupe vs platform income (D6) → review → post. Rides `import-excel` job chain. | MODERATE |
| **3** | **Receipts** | Cash 2-tap + admin photo upload → vision→structured (widen `callAgent`) → **business-purpose capture** (the beat Darren named) → link to ledger entry; private-bucket storage + retention cron; then Gmail-label poller for forwarded email; Amazon CSV. | HARD (email) |
| **4** | **Reports & accountant pack** | Income-by-service, P&L-by-category, per-book summaries; exceljs workbook; QuickBooks CSV export (flagged); print page; quarterly pack; emailed workbook (flagged). | LOW–MOD |
| **5** | **AI intelligence suite** | Deduction finder (incl. home-office allocation), profit-by-service-line (after costs), vendor/subscription sweep, year-end timing flags — mostly pure aggregators + read routes. The $750 differentiators. | LOW–MOD |
| **6** | **Close, forecast, chat, depreciation, net** | Immutable monthly close + books-closed email; rolling tax forecast (estimate, labeled); missing-receipt watchdog; ask-your-books chat tools; equipment depreciation engine; Stripe payout ingestion + net revenue + real dedupe. | MOD–HARD |

**This session delivers Phase 1 complete** (committed on a branch, tested against the known-red baseline, reviewed) plus this umbrella design and a Phase 1 spec. Later phases are specced at outline level here and will each get a full spec when built.

---

## 4. Phase 1 — Foundation & ledger (detailed spec)

### 4.1 Goal
A working, admin-only **Books** section where Darren can: switch between his three books; see a paginated, filterable ledger; add manual income/expense entries; manage a chart of accounts; and pull his platform income (Stripe + packs + shop + events + memberships) in as reviewable draft entries he posts to the ledger. This is the spine every later phase attaches to. It is useful on its own — it already answers "what did I earn from performance training this quarter" once income is posted.

### 4.2 Data model (migration `00183_bookkeeping_foundation.sql`)

All money is `integer` cents (`amount_cents`), never numeric/float (convention from `00008`). All tables get `created_at`/`updated_at`. RLS policies included for ceremony but **not relied upon** (D1). Uses `UNIQUE NULLS NOT DISTINCT` for any nullable upsert key (constraint #6). Next number confirmed `00183`.

**`bookkeeping_books`**
- `id uuid pk default gen_random_uuid()`
- `name text not null` (e.g. "Darren — DJP Athlete")
- `book_kind text not null check (book_kind in ('business','household'))`
- `owner_label text` (free text: "Darren", wife's name)
- `is_primary boolean not null default false` (Darren's own business = the default view)
- `currency text not null default 'usd'`
- `sort_order integer not null default 0`
- `archived_at timestamptz`
- Seed 3 rows in the migration (wife's book name a placeholder the coach edits).

**`bookkeeping_accounts`** (chart of accounts — categories)
- `id uuid pk`
- `book_id uuid not null references bookkeeping_books(id) on delete cascade`
- `name text not null` (e.g. "Performance Training — Sports", "Equipment", "Rent")
- `account_type text not null check (account_type in ('income','expense'))`
- `service_line text` (nullable tag for income-by-service: `performance_training | session_packs | camps | teams_center | memberships | shop | other`)
- `is_deductible_candidate boolean not null default false` (expense accounts the deduction finder should watch)
- `tax_category text` (free-text hint for the accountant, e.g. "Schedule C Line 22")
- `sort_order integer`, `archived_at timestamptz`
- `unique (book_id, name)` (plain unique — safe for `onConflict`, constraint #6)
- Migration seeds a starter chart per book from Darren's real Excel categories (PERFORMANCE TRAINING SPORTS/STRIPE/TEAMS-CENTER + standard expense buckets).

**`bookkeeping_ledger_entries`** (the core)
- `id uuid pk`
- `book_id uuid not null references bookkeeping_books(id)`
- `account_id uuid references bookkeeping_accounts(id)` (nullable = uncategorized, surfaced for review)
- `direction text not null check (direction in ('income','expense'))`
- `amount_cents integer not null check (amount_cents >= 0)` (magnitude; `direction` carries sign)
- `currency text not null default 'usd'`
- `occurred_on date not null` (the accounting date — distinct from `created_at`, enables D4 close)
- `memo text`
- `business_purpose text` (the purpose-capture field; populated in Phase 3 for receipts, manual now)
- `counterparty text` (vendor / payer name)
- `source text not null check (source in ('manual','platform_import','statement_import','receipt'))` default `'manual'`
- `source_ref text` (dedupe key back to origin: `payments:<id>`, `shop_orders:<id>`, `client_packages:<id>`, `event_signups:<id>`, `client_memberships:<id>`; null for manual)
- `import_batch_id uuid` (groups one import run; nullable)
- `unique (book_id, source, source_ref)` — **plain** UNIQUE (SQL-standard NULL-distinct). Corrected in migration 00184: the original 00183 used `NULLS NOT DISTINCT`, which made every NULL `source_ref` collide and so allowed only ONE manual entry (source_ref = NULL) per book — a bug. Plain UNIQUE allows unlimited manual entries (NULLs distinct) while still deduping the non-null platform `source_ref`s so re-running the import never double-posts.
- Indexes: `(book_id, occurred_on)`, `(book_id, account_id)`, `(source, source_ref)`.

### 4.3 Income adapter (`lib/bookkeeping/income-adapter.ts` — pure)
`export function buildIncomeDrafts(input: IncomeSourceRows): LedgerEntryDraft[]` — pure, zero IO, unit-tested with zero mocks (the `revenue-aggregator` pattern). Caller (a route) does the reads and passes plain arrays for the 5 money-of-record sources; the adapter normalizes each into a `LedgerEntryDraft { direction:'income', amount_cents, occurred_on, memo, counterparty, service_line, source:'platform_import', source_ref }`. Encodes the D3 rules: gross amounts, refund-aware (skip/flag `status='refunded'`), household-billed fee → earner's book, service-line mapping per source table. Emits `warnings[]` for rows it can't confidently place (nullable `user_id`, unknown type) rather than guessing.

**Reads live in `lib/db/bookkeeping.ts` DAL**, each `.range()`-paginated or `count:exact,head:true` (constraint #5 — the single highest risk; a ledger is a growth table). A `listPlatformIncomeBetween(from, to)` reads `payments` with pagination (the existing `getPayments` has none) plus the four other sources.

### 4.4 Shared utilities (net-new, small, reused by all phases)
- `lib/bookkeeping/money.ts` — canonical `formatCents(cents, currency='usd')` (none exists repo-wide; components inline their own).
- `lib/csv/serialize.ts` — promote the `campaign-blueprint-csv` serializer to shared, **with injection defense** (prefix leading `= + - @` with `'`). Constraint #14.
- `lib/db/paginate.ts` — promote `newsletter.ts`'s private `fetchAllRows<T>` to a shared, exported paginator. Constraint #5.

### 4.5 Routes (all self-gate — `/api/*` is NOT protected, constraint #3)
Every route starts with the explicit `auth()` + `role !== 'admin'` → 403 check (never `requireAdmin()`, which throws `NEXT_REDIRECT`). All wrapped with `withAudit()` or inline `recordAudit()` under existing `commerce`/`billing` categories (new category = a migration, avoided).
- `GET /api/admin/bookkeeping/entries` — paginated ledger (clone `listAuditLogs` filter/range pattern).
- `POST /api/admin/bookkeeping/entries` — manual entry (Zod-validated).
- `PATCH /api/admin/bookkeeping/entries/[id]` — recategorize / edit.
- `DELETE /api/admin/bookkeeping/entries/[id]` — delete manual entry.
- `GET/POST/PATCH /api/admin/bookkeeping/accounts` — chart of accounts CRUD.
- `POST /api/admin/bookkeeping/import-platform` — run the income adapter for a date range + book, return drafts (does not post).
- `POST /api/admin/bookkeeping/import-platform/commit` — post reviewed drafts (idempotent via the `source_ref` unique).

### 4.6 UI (`app/(admin)/admin/books/…`, server components)
- Nav: one `NavItem` push — `{ label: "Books", href: "/admin/books", icon: BookOpen }` into the **Business** section (icon already imported). (Insights pages are invisible for lack of a nav entry — do not repeat.)
- `/admin/books` — book switcher (tabs or combobox), ledger table (clone `ClientRiskTable` + `audit-log-filters`: date range, account, direction, source, text search; always `params.delete("page")` on filter change), running totals (income/expense/net for the filtered view), manual-entry dialog (clone `SellPackDialog` + `router.refresh()`), "Import platform income" flow (date range → review drafts → post).
- `/admin/books/accounts` — chart-of-accounts manager per book.
- Design system: semantic colors + font classes only; `formatCents` for every amount; `EmptyState` before first entry.

### 4.7 Testing (constraint #16)
- `__tests__/lib/bookkeeping/income-adapter.test.ts` — pure, zero mocks; fixtures for each of the 5 sources incl. refund, household-billed fee, nullable-user warning, dedupe `source_ref` shape. RFC-4122 UUIDs (`…-4NNN-8NNN-…`).
- `__tests__/lib/bookkeeping/money.test.ts` and `__tests__/lib/csv/serialize.test.ts` — pure, incl. the CSV-injection cases.
- Route tests mock the **DAL module** (`vi.mock('@/lib/db/bookkeeping')`), import handler after mocks, cast `Request as never`, async `params` Promise. The 403-self-gate case for each route.
- **Do not** put anything in `__tests__/db/` (hits real prod DB). Snapshot the known-red baseline before/after (~8-9 pre-existing reds; flaky under load).

### 4.8 Explicitly out of Phase 1
Statement/receipt/email intake, reports/exports, AI suite, monthly close/freeze, tax forecast, depreciation, net revenue/payouts, chat tools. Phase 1 is the ledger spine + platform income + manual entry + UI, nothing that reaches outward.

---

## 5. Standing risks carried forward
1. **Book isolation is application-only** (RLS decorative). Every DAL/route/tool must scope `book_id`. (D1)
2. **PostgREST 1000-row cap** silently truncates growth-table reads — every ledger read paginates. (constraint #5)
3. **Never edit the shared Stripe webhook** for income — reconcile by reading, on a schedule. (constraint #11, D3)
4. **Financial docs → private bucket only**, never the world-writable storage rules. (constraint #8, D12)
5. **functions/ ↔ lib/ twin-copy** for any shared helper (e.g. when Phase 3/6 add vision/chat). (constraint #4)
6. **Proposal doc + promo scene** must be corrected for the tenant reframe or the pitch self-contradicts.

---

## 6. Honesty guardrails (inherited from the sale, non-negotiable in the build)
- Every tax/forecast number is labeled an **estimate**; the CPA files.
- Every AI finding (deduction, timing flag) is a **candidate for the accountant to confirm**, never a filed decision.
- Depreciation is **tracked, not decided** — accountant sets basis/method (D7).
- Business and personal **stay apart** (separate books, D1) — household categories exist to capture, not to claim.
- Venmo/bank = **statement-file import**, never implied live sync (no Venmo API; no Plaid).
- Receipts retained **7 years**, with a deletion path (D12).
