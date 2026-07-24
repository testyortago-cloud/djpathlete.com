# Bookkeeping Income Sync Cron — Design

**Date:** 2026-07-24
**Status:** Approved (design walkthrough + notification question answered in session)

## 1. Problem

Platform income only reaches the bookkeeping ledger when the coach manually runs the
platform-income import on `/admin/books`. Nothing is wired to payments as they happen:
the 27 entries in prod are the 2026-07-20 backfill, and every payment since sits in
`payments` / `client_packages` / `event_signups` / `shop_orders` unposted. Reports,
insights, and the tax forecast silently go stale.

## 2. Solution overview

A nightly cron that runs the **exact same pipeline the manual import uses** and posts
the results automatically:

```
bookkeepingIncomeSyncCron (Firebase onSchedule, daily 04:30 UTC)
  → POST /api/admin/internal/bookkeeping-income-sync   (Bearer INTERNAL_CRON_TOKEN)
      1. flag gate  cron_bookkeeping_income_sync_enabled   (skip → 200)
      2. resolve target book: is_primary = true AND book_kind = 'business'
      3. compute watermark window (new pure helper)
      4. listPlatformIncome(from, to) → buildIncomeDrafts()          [existing, untouched]
      5. auto-assign account_id via matchAccountForServiceLine()      [existing, untouched]
      6. insertImportedEntries(bookId, batchId, drafts)               [existing, untouched]
      7. logCronEnd + audit row (only when inserted > 0)
```

Safety rests entirely on machinery that already exists and is prod-proven:
`insertImportedEntries` upserts on `UNIQUE (book_id, source, source_ref)` with
`ignoreDuplicates`, drops cross-run `alt_ref` duplicates, and partitions out
closed-period rows before writing. Re-scanning an overlapping window can never
double-post. The manual import stays untouched; running both is safe.

## 3. Decisions

- **D1 — Cron, not webhook.** A Stripe-webhook hook would cover only Stripe (missing
  offline packs and non-Stripe signups) and would put money-posting logic in the shared
  webhook, which standing policy keeps lean and flag-gated. A nightly sweep over the
  money-of-record tables covers every source through the one adapter.
- **D2 — Watermark window, no settings cursor.** `from` = latest `occurred_on` among
  the target book's `source = 'platform_import'` entries **minus a 14-day overlap
  margin** (late-settling rows, pending→paid flips); if the book has no
  platform-import entries at all, fall back to 90 days back from today. `to` = today
  (UTC date). No cap on the span: if the cron was dark for months, the next run heals
  the whole gap (`fetchAllRows` paginates; idempotent insert makes the re-scan free).
  Same self-derived-watermark principle the Phase-6e payout spec chose. The manual
  preview route's 800-day UX guard does not apply here.
- **D3 — Silent operation** (owner-selected). No email. Evidence trail: entries appear
  in `/admin/books` (with a per-run `import_batch_id`), a `cron_runs` row every night,
  and an audit row **only on nights where `inserted > 0`** — quiet nights leave no
  audit noise.
- **D4 — Reuse, don't fork, the money path.** `listPlatformIncome`,
  `buildIncomeDrafts`, `matchAccountForServiceLine`, and `insertImportedEntries` are
  called as-is. The only new logic anywhere near money is the window computation,
  which is pure and unit-tested. All drafts the adapter emits are posted — including
  orphan-mirror "(record deleted)" drafts — because that is exactly what the manual
  flow posts by default, and dedupe protects every re-examination.
- **D5 — Primary-book resolution by flags, not UUID.** Query
  `bookkeeping_books WHERE is_primary AND book_kind = 'business'` (seeded row exists
  since 00183). No book found → the run **fails** (logCronEnd `failed`, 500) rather
  than silently skipping — a missing primary book is a data problem the health
  watchdog must surface.
- **D6 — Flag arrives dark.** `cron_bookkeeping_income_sync_enabled` seeded `false` by
  migration **00190** (idempotent `ON CONFLICT DO NOTHING`, matching prior seeds).
  Money-posting crons arrive OFF per the established pattern; the owner flips it in
  admin settings after deploy. DB-backed flag, never env-var.
- **D7 — Established cron plumbing, byte-identical contract strings.** Function name
  `bookkeepingIncomeSyncCron` = `cron_runs` name = `EXPECTED_CRONS` name; route dir
  `bookkeeping-income-sync`. The **route** is the single `cron_runs` owner; the
  functions delegator must NOT log (single-owner rule). Functions side declares
  `secrets: [internalCronToken, appUrl]` **only** — the same two the receipt-watchdog
  delegator uses; do not copy the quarterly-pack's over-declared list. The route
  checks the same `INTERNAL_CRON_TOKEN` env var every internal cron route checks
  (no new token or secret is introduced). Schedule `30 4 * * *` Etc/UTC (retention
  owns 04:00), timeout 120s, 256MiB, us-central1. `EXPECTED_CRONS` entry
  `{ name: "bookkeepingIncomeSyncCron", sla_hours: 30 }`.
- **D8 — Account auto-assignment mirrors the manual prefill.**
  `matchAccountForServiceLine(direction, service_line, accounts)` against the book's
  unarchived accounts — the identical helper the ImportPlatformDialog prefills with
  (prod's 27 backfilled entries already follow this mapping). No match →
  `account_id: null`, which lands as Uncategorized and is already flagged by the
  insights uncategorized sweep. No new mapping table.
- **D9 — Warnings and rejects are recorded, not fatal.** Adapter `warnings[]` (capped
  at first 20) plus `inserted / skipped_alt_ref / rejected_closed / draft count /
  window` go into `cron_runs` details and audit metadata. `rejected_closed > 0` is
  expected behavior, not an error: income dated inside a closed period stays unposted
  (and will re-reject nightly) until the owner reopens the period or posts it manually
  with `adjusts_period` — documented, no special handling.

## 4. Components

| Piece | File | New/Changed |
| --- | --- | --- |
| Flag seed | `supabase/migrations/00190_bookkeeping_income_sync.sql` | new |
| Watermark helper (pure) | `lib/bookkeeping/income-sync-window.ts` | new |
| Watermark DAL read | `lib/db/bookkeeping.ts` — `latestPlatformImportDate(bookId)`; primary book found by filtering the existing `listBooks()` in the route | changed |
| Internal route | `app/api/admin/internal/bookkeeping-income-sync/route.ts` | new |
| Cron delegator | `functions/src/index.ts` — `bookkeepingIncomeSyncCron` | changed |
| Health watchdog | `lib/automation/automation-health-scanner.ts` — `EXPECTED_CRONS` entry | changed |
| Audit slug | `lib/audit/actions.ts` — `bookkeeping.income_synced` (category `commerce`) | changed |

The route mirrors `bookkeeping-receipt-watchdog/route.ts` structurally: `runtime
nodejs`, `maxDuration 120`, bearer check → flag gate → `logCronStart` → work →
`logCronEnd` → JSON summary; any throw → `logCronEnd failed` + 500.

Pure helper contract:

```ts
computeSyncWindow(latestPlatformImportDate: string | null, today: string):
  { from: string; to: string }
// null → { from: today − 90d, to: today }
// date → { from: date − 14d,  to: today }
```

## 5. Error handling

- Missing/wrong bearer token → 401, nothing logged.
- Flag off / missing → 200 `{ skipped }` (via `isCronSkipped`), no `cron_runs` row.
- No primary business book → throw → `logCronEnd failed` + 500 (watchdog surfaces).
- Any source-table read failure inside `listPlatformIncome` already degrades to `[]`
  per-table (existing `safeAll`) — the run still completes on the healthy tables.
- Insert failure → throw → `failed` + 500.

## 6. Testing

- `__tests__/lib/bookkeeping/income-sync-window.test.ts` — null fallback (90d),
  watermark minus 14d, `to` = today, month/year boundary math. Pin with
  mutation-discriminating dates (a value that distinguishes 13/14/15-day margins).
- `__tests__/api/admin/internal/bookkeeping-income-sync.test.ts` — mirrors the
  receipt-watchdog route tests: 401 on bad token; flag-off skip (no cron_runs); happy
  path (drafts posted with auto-assigned accounts, cron_runs success details, audit
  row); zero-new-drafts night (success, `inserted: 0`, **no** audit row); adapter
  warnings surface in details; no-primary-book failure path.
- Functions delegator: identical shape to the receipt-watchdog delegator; mirror its
  existing test coverage if any, otherwise the thin fetch-delegator stays untested
  (established precedent).
- Full-suite + build gates per standing rules (never chain build behind test:run
  with `&&`; run the Vercel-condition build if any root↔functions import boundary is
  touched — this design touches none: the route imports only `lib/`, the functions
  change imports nothing from root).

## 7. Out of scope

- Stripe fees / net revenue / payout reconciliation — Phase 6e (unchanged).
- Recurring membership invoice revenue — not in the DB; the adapter's existing
  warning stands until Phase 6e statement/payout ingestion.
- Spouse / Household books — platform income is inherently the primary business's.
- Any change to the manual import UI or `insertImportedEntries`.
