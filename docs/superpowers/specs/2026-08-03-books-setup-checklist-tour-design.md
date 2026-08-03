# Accounting Setup Checklist + Cross-Page Tour — Design

**Date:** 2026-08-03
**Status:** Approved (owner picked: auto-detected checklist, cross-page tour, banner + setup panel, approach A — generalize the in-house spotlight). Owner then went to sleep with "do it until the end"; remaining decisions documented here were made autonomously.

## Problem

The accounting area (`/admin/books` + five sibling pages) now has enough moving parts — email-receipt ingestion, income sync, tax forecast inputs, retention, accountant packs — that Darren cannot tell what is configured, what is missing, and what each section does. He asked for (1) a checkbox setup list covering "the tax and any important things that needed to be set up" and (2) a tour that overlays each section.

## Decisions (owner-approved)

1. **Auto-detected completion.** Items tick themselves from real system state; they can never claim "done" while the thing is unconfigured. Judgment-only items get a manual checkbox persisted server-side.
2. **Cross-page tour.** One walkthrough spanning the ledger page and its siblings (Accounts, Reports, Insights, Assets, Email receipts), resuming across navigation.
3. **Banner + setup panel.** A slim progress banner on `/admin/books` while incomplete; a persistent `?` toolbar button that opens the panel forever and hosts "Take the tour".
4. **Approach A.** Generalize the existing in-house spotlight (`components/admin/FormTour.tsx` + `hooks/use-form-tour.ts`) to page scope. No new dependency.

## Part 1 — Setup status aggregator

`lib/bookkeeping/setup-status.ts` — a server-side aggregator returning `SetupItem[]`:

```ts
interface SetupItem {
  key: string                 // stable slug, e.g. "gmail_connected"
  title: string
  why: string                 // one line: why it matters
  status: "done" | "todo" | "attention"  // attention = cannot verify (e.g. cron never ran)
  detail?: string             // e.g. "label_missing on the last cron run"
  href: string                // deep link to fix it
  manual?: boolean            // true for the judgment items
}
```

### Items and their sources (all key names verified in code)

| # | Item | Check (done when…) | href |
|---|------|--------------------|------|
| 1 | Connect Gmail | `getPlatformConnection("gmail")` exists with a refresh token | `/admin/inbox` (hosts the connect flow; OAuth at `/api/integrations/gmail/connect`) |
| 2 | Create the receipt label in Gmail | latest `cron_runs` row for the gmail-receipts cron has NO `detail.label_missing` key (the cron writes `label_missing: true` only when the label lookup fails; a clean run omits it); no runs yet → `attention` | `/admin/books/email-receipts` |
| 3 | Add receipt forwarder addresses | `system_settings.bookkeeping_gmail_receipt_forwarders` is a non-empty array | `/admin/books/email-receipts` |
| 4 | Turn on email-receipt ingestion | `cron_bookkeeping_gmail_receipts_enabled` true | `/admin/books/email-receipts` |
| 5 | Turn on platform income sync | `cron_bookkeeping_income_sync_enabled` AND `cron_bookkeeping_payout_sync_enabled` true (detail lists whichever is off) | `/admin/books` |
| 6 | Set your safe-harbor tax rate | `bookkeeping_tax_rate_percent` is not null | `/admin/books/insights` |
| 7 | Set your accountant's email | `bookkeeping_accountant_email` non-empty | `/admin/books/reports` |
| 8 | Turn on the quarterly accountant pack | `cron_bookkeeping_quarterly_pack_enabled` true (listed after #7; works only with it) | `/admin/books/reports` |
| 9 | Turn on receipt housekeeping | `cron_bookkeeping_retention_enabled` AND `cron_bookkeeping_receipt_watchdog_enabled` true | `/admin/books` |
| 10 | Import your first bank statement | any ledger entry with `source = 'statement_import'` exists | `/admin/books` |
| 11 | Review expense categories per book | **manual** — checked keys stored in `system_settings.bookkeeping_setup_manual_checks` (jsonb array of item keys) | `/admin/books/accounts` |

Rules:
- The aggregator does **no live Gmail API calls** — item 2 reads the cron's own `label_missing` telemetry (cheap, already recorded every run). `attention` status renders amber with the explanation.
- Read paths reuse existing DAL helpers (`getSetting`, `cron_runs` read, a count query for statement entries). Anything new goes in `lib/db/bookkeeping.ts` / `lib/db/cron-runs.ts` following existing shapes.
- API: `GET /api/admin/bookkeeping/setup-status` (admin-gated, same self-gate pattern as the other bookkeeping routes) returns `{ items, doneCount, totalCount }`. `PATCH` on the same route toggles a manual item (`{ key, checked }`), writing the jsonb array via `setSetting` and recording an audit row (`bookkeeping.setup_manual_check_set`, category `admin_write` — added to `lib/audit/actions.ts`).

## Part 2 — Banner + setup panel

- `SetupBanner` (client, rendered by `BooksClient`): fetches setup-status on mount; hidden when `doneCount === totalCount` or when dismissed this browser (`localStorage` key). Shows "Accounting setup: N of M done" + progress bar; clicking opens the panel.
- `SetupPanel` — a `Dialog` listing items grouped in order, each row: status icon (✓ green / ○ neutral / ⚠ amber), title, why-line, `detail` when present, and a **Fix this** link (`next/link`). Manual items render a checkbox wired to the PATCH.
- A `?` icon button sits at the end of the books toolbar permanently: opens the panel; the panel footer has **Take the tour**.
- The banner/panel live on `/admin/books` only — the tour covers the siblings.

## Part 3 — Cross-page tour

**Engine.** New `hooks/use-page-tour.ts` + `components/admin/bookkeeping/BooksTour.tsx`, modeled on `FormTour` (framer-motion spotlight ring + tooltip card) but page-scoped:
- Targets are located by `data-tour="<step-id>"` attributes added to the section wrappers of each page.
- Fixed-position overlay (`position: fixed`, full viewport) instead of the dialog-container-absolute variant; target rect from `getBoundingClientRect`, re-measured on scroll/resize; the engine scrolls the target into view (`scrollIntoView({block:"center"})`) before measuring.
- Steps definition lives in one module: `lib/bookkeeping/tour-steps.ts` — `{ id, page, title, body }[]`, `page` is the pathname the step lives on. Pure data; unit-testable.

**Cross-page resume.** Tour state (`{ active: true, stepIndex }`) persists in `sessionStorage` (`books_tour_state`). `BooksTour` is rendered by all six pages (small client component added to each page's client root). On mount it reads the state; if the current step's `page` ≠ current pathname it does nothing until navigation completes. "Next" past the last step of a page calls `router.push(nextStep.page)`; the component on the destination page picks the state up and continues. Skip/close clears the state everywhere. Finishing the last step clears state and PATCHes `bookkeeping_tour_completed_at` (ISO string) via the setup-status route so the banner stops suggesting the tour; the `?` button can always restart it.

**Steps (~14).** Ledger page: toolbar imports (one step sweeping the button row), Find duplicates, filters, ledger table (memo column + attachment/edit icons), email-receipts pending chip. Accounts: chart of categories + business-purpose requirement. Reports: report types + accountant pack/email. Insights: tax forecast + safe-harbor rate + dismissable findings. Assets: depreciation schedule. Email receipts: the three columns (Ready to post / Needs a look / Possible duplicates) + book picker + Post/Ignore. Exact copy written at implementation; each step ≤ 2 sentences.

**Reduced motion:** the spotlight uses the same framer-motion springs as `FormTour`; `useReducedMotion` disables animated transitions (jump-cut positioning) — matches app convention.

## Error handling

- Setup-status fetch failure → banner silently hides; panel shows a retry row (no toasts on page load).
- PATCH failures → toast, checkbox reverts.
- Tour target missing on a page (markup drift) → the step is skipped with a `console.warn`; the tour never hard-blocks.

## Testing

1. `lib/bookkeeping/setup-status.test` — each item's done/todo/attention logic from fixture state (mock DAL reads); flag-off, empty-forwarders, no-cron-runs, null-tax-rate cases each flip exactly one item (mutation-discriminating fixtures).
2. Route test — 403 non-admin; GET shape; PATCH toggles manual key and audits; PATCH rejects unknown keys.
3. `tour-steps` test — every step id unique; every `page` is one of the six known pathnames; step order groups by page (no page interleaving — the resume logic depends on it).
4. Component tests — `SetupBanner` renders count and hides when complete/dismissed; `SetupPanel` renders statuses + manual checkbox PATCH; `BooksTour` renders a step, Next advances, close clears sessionStorage. (jsdom: rect-measurement mocked, as the FormTour tests presumably do — follow their pattern.)

## Out of scope (YAGNI)

- No per-client or multi-user tour state (solo admin).
- No tour on non-books admin pages.
- No live Gmail label verification button (the cron telemetry is the source of truth).
- No confetti.
