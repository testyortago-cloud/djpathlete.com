# Track D — Engineering Debt + Click-Through Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining statement-reconcile test gap and drive every bookkeeping UI in a real authed admin session.

**Architecture:** D1 is a coverage spot-check that adds only genuinely missing branch tests. D2 is pure verification — a Playwright-MCP click-through of the receipt flows, statement import, reports, and the new Track A/B/C surfaces against local dev, producing screenshot evidence for the final report. The commit-route account-scope debt (kickoff item D(i)) is folded into Track A task A10.

**Tech Stack:** Next.js 16 App Router (no src/), TypeScript strict, Supabase PostgreSQL (service-role DAL in `lib/db/`), Zod validators, Vitest + Testing Library, Firebase Functions (`onSchedule` delegators), Stripe SDK 20.3.1, Anthropic via `lib/ai/anthropic.ts`.

## Global Constraints

- **Design doc:** `docs/superpowers/specs/2026-07-25-bookkeeper-completion-design.md` (committed `c445a4d1`) — every decision + rationale lives there. Deviating from it requires recording a new decision.
- **Solo-dev convention:** commit directly on `main` as each task lands. **NEVER push** — the owner holds the push.
- **Money math is integer cents end-to-end.** Stripe `balanceTransactions` amounts are already cents; no float conversion anywhere. Every pinned number needs a mutation-discriminating fixture (the 12.555 house style — a value where round, trunc, sum-of-rounds and round-of-sum all differ).
- **Migrations** apply live via `mcp__supabase__apply_migration` (the Supabase CLI is not linked). Write the identical SQL to `supabase/migrations/<n>_<name>.sql` as well. Additive, reversible, inert without code.
- **PostgREST:** every growth-table read uses `fetchAllRows` (`lib/db/paginate.ts`) — a bare `.select()` silently caps at ~1000 rows. Upsert `onConflict` keys must be PLAIN unique constraints, never expression indexes.
- **Never edit** `app/api/stripe/webhook/route.ts`. Reconcile-by-read on a schedule instead.
- **functions/ ↔ lib/ boundary:** `functions/` cannot import from `lib/`; root code must never import from `functions/src` (it breaks the Vercel deploy). Helpers needed in both runtimes are twin copies.
- **Cron discipline:** three-way byte-identical name contract (functions POST path ↔ route directory ↔ the `cron_runs`/`EXPECTED_CRONS` name). The ROUTE is the single `cron_runs` owner; the functions delegator never logs. Delegator secrets are `[internalCronToken, appUrl]` ONLY. Success-skip (HTTP 200) when the flag is OFF or there is nothing to do.
- **Auth:** `/api/*` self-gates via `auth()` → 403 (middleware does not cover `/api`). Internal cron routes use the Bearer triple-clause. JSON screen-reads stay unaudited; mutations and downloads are audited with slugs registered in `lib/audit/actions.ts`.
- **Feature flags** are DB-backed rows in `system_settings`, never env vars; new crons arrive with their flag seeded `false`.
- **Tests:** pure fns → `__tests__/lib/bookkeeping/` (zero-mock); routes → `__tests__/api/admin/...` or `__tests__/app/api/admin/...` matching siblings; functions-side → `functions/src/__tests__/`; RFC-4122 fixture UUIDs; multipart route tests need `// @vitest-environment node`.
- **Gates run by the orchestrator between tracks, not inside tasks:** the full suite against the known-red baseline (the Stripe-webhook pair wall-clock-flakes under load — stash-isolate before blaming a change), then `npm run build` as its OWN command, never `&&`-chained behind tests.
- **Commit messages:** conventional commits; multi-line messages go through a scratchpad file + `git commit -F <file>` (PowerShell here-strings get mangled by this harness).
- **Task count:** 2.

---

### Task D1: Reconcile branch spot-check — enumerate coverage, fill only the missing branches

**Coverage enumeration (verified against real code, 2026-07-25):** `functions/src/__tests__/statement-reconcile.test.ts` already covers:

- `applyRowCap` — **fully covered** at lines 28-44 (cap+truncation warning at `MAX_STATEMENT_ROWS + 5`, and small-set untouched). D(ii)'s "add one if missing" is satisfied — no `applyRowCap` work needed.
- `reconcileControlTotals` (`functions/src/statement-import.ts:115-148`) — partially covered:
  - all-null branch via a **literal `null`** `controlTotals` (test line 10-13) — covered, but the second half of the `allNull` disjunct (an object whose four fields are all null, lines 122-125) is untested.
  - deposit-side >100¢ drift warning (lines 132-139) — covered (test line 14-19).
  - withdrawal-side within-tolerance **silence** (lines 140-147, 50¢ drift) — covered (test line 20-25).
  - **MISSING #1:** withdrawal-side >100¢ drift **warning** (lines 140-147, warning path never asserted).
  - **MISSING #2:** deposit-side within-tolerance **silence**, including the exact `> 100` boundary (drift of exactly 100¢ must be silent — a mutation to `>=` would flip it).
  - **MISSING #3:** all-null-fields **object** (vs literal null) taking the `allNull` early-return.

Three tests to add; `applyRowCap` untouched. These are coverage-fill tests over existing shipped code, so the TDD "red" step is inverted: they must pass on first run — a failure means a real regression and stops the task.

**Files:**
- Modify: `functions/src/__tests__/statement-reconcile.test.ts` (append inside the existing `describe("reconcileControlTotals")` block, after the test ending at line 25)

**Interfaces:**
- Consumes (existing, no changes): `reconcileControlTotals(rows: StatementImportOutputRow[], controlTotals: StatementImportResult["control_totals"] | null | undefined, warnings: string[]): void` and `type StatementImportOutputRow` from `functions/src/statement-import.ts` (exported at line 115); the file-local `row()` fixture helper at test line 4-7.
- Produces: nothing new — test-only task.

**Steps:**

- [ ] Append the three missing-branch tests inside the `describe("reconcileControlTotals", ...)` block of `functions/src/__tests__/statement-reconcile.test.ts`, immediately before its closing `})` at line 26 (mirroring the file's own style — same `row()` helper, same regex-over-warnings assertions):

```ts
  it("warns on a withdrawal-total mismatch beyond tolerance", () => {
    const w: string[] = []
    reconcileControlTotals([row({ direction: "expense", amount_cents: 7300 })],
      { total_deposits_cents: null, total_withdrawals_cents: 12555, opening_balance_cents: null, closing_balance_cents: null }, w)
    expect(w.some((s) => /withdrawal total mismatch/i.test(s))).toBe(true)
    expect(w.some((s) => /deposit total mismatch/i.test(s))).toBe(false)
  })
  it("stays silent on deposit drift of exactly 100 cents (boundary is strictly >100)", () => {
    const w: string[] = []
    reconcileControlTotals([row({ direction: "income", amount_cents: 12455 })],
      { total_deposits_cents: 12555, total_withdrawals_cents: null, opening_balance_cents: null, closing_balance_cents: null }, w)
    expect(w.some((s) => /mismatch/i.test(s))).toBe(false)
    expect(w.some((s) => /completeness unverified/i.test(s))).toBe(false)
  })
  it("treats an object with all-null fields the same as a null totals object", () => {
    const w: string[] = []
    reconcileControlTotals([row({ direction: "income", amount_cents: 5000 })],
      { total_deposits_cents: null, total_withdrawals_cents: null, opening_balance_cents: null, closing_balance_cents: null }, w)
    expect(w.some((s) => /completeness unverified/i.test(s))).toBe(true)
    expect(w).toHaveLength(1)
  })
```

- [ ] Run the file from the functions workspace: `cd functions` then `npx vitest run src/__tests__/statement-reconcile.test.ts`. **Expected: all 8 tests PASS** (5 existing + 3 new). If any new test fails, that is a live defect in `reconcileControlTotals` — stop, invoke `superpowers:systematic-debugging`, and file a fix task rather than adjusting the assertion to match the code.
- [ ] Sanity-guard against sibling breakage in the same suite: `cd functions` then `npx vitest run src/__tests__/statement-reconcile.test.ts src/__tests__/receipt-scan.test.ts`. Expected: PASS.
- [ ] Commit (multi-line message via `-F` file — PowerShell heredoc trap):
  - Write `C:\Users\tayaw\AppData\Local\Temp\claude\c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete\09812efa-7e7c-44fc-b449-2a6d8f09a5aa\scratchpad\d1-commit-msg.txt` with:

```
test(bookkeeping): fill reconcileControlTotals branch gaps

Adds the three uncovered branches found in the D(ii) spot-check:
withdrawal-side >100c drift warning, deposit-side exact-100c
boundary silence, and the all-null-fields object variant of the
allNull early return. applyRowCap was already fully covered
(statement-reconcile.test.ts:28-44) - no change there.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

  - Then: `git add functions/src/__tests__/statement-reconcile.test.ts` and `git commit -F <scratchpad>\d1-commit-msg.txt`.
- [ ] Record in the plan-execution notes/journal draft: "D(ii) enumeration: applyRowCap fully covered pre-existing; reconcileControlTotals had 3 branch holes, now filled (8/8 green)." If step 1's tests had all turned out pre-existing (they are not — verified missing on 2026-07-25), this task would have been a verification-only record with no commit.

### Task D2: Authed Playwright-MCP click-through of every bookkeeper surface (runs LAST, after Tracks A, B, C and D1 all land)

Pure verification — **no code changes, no commits**. Output is a screenshot set + a per-surface pass/fail table for the final report. Any failure files a fix task (back into the plan queue) — never silently passed over. Note: the dev server talks to the **production** Supabase project, so every posting step uses a clearly-marked sentinel and ends with cleanup (mirrors the §6 live-proof discipline).

**Files:**
- Create (fixtures + evidence only, all under the scratchpad — never in the repo):
  - `<scratchpad>\e2e-fixtures\sentinel-statement.csv` (3-row synthetic bank CSV)
  - `<scratchpad>\e2e-fixtures\sentinel-receipt.jpg` (any small legible receipt-like photo; a phone photo of a printed test receipt or a generated image is fine)
  - `<scratchpad>\e2e-fixtures\sentinel-amazon.csv` (2-row Amazon Order History Reports-shaped CSV)
  - `<scratchpad>\e2e-shots\NN-<surface>.png` (numbered screenshots, one+ per surface)
- Modify: none.

**Interfaces:**
- Consumes: `mcp__playwright__browser_navigate` / `browser_snapshot` / `browser_click` / `browser_type` / `browser_fill_form` / `browser_file_upload` / `browser_take_screenshot` / `browser_wait_for` / `browser_console_messages` (load schemas first via `ToolSearch` query `select:mcp__playwright__browser_navigate,mcp__playwright__browser_click,mcp__playwright__browser_type,mcp__playwright__browser_snapshot,mcp__playwright__browser_take_screenshot,mcp__playwright__browser_file_upload,mcp__playwright__browser_wait_for,mcp__playwright__browser_fill_form,mcp__playwright__browser_console_messages`); Bash `run_in_background` for the dev server; login form fields `input[name='email']` / `input[name='password']` / `button[type='submit']` at `/login` with post-login redirect to `/admin` (selector shape mirrored from `__tests__/e2e/ai-templates.spec.ts:9-15`).
- Produces: a markdown pass/fail table + screenshot paths in the final assistant report (not a committed file).

**Credentials:** admin creds come from the local environment, never from this plan: check, in order, (1) `ADMIN_TEST_EMAIL` / `ADMIN_TEST_PASSWORD` env vars (the repo's own e2e convention, `__tests__/e2e/ai-templates.spec.ts:4-5`), (2) `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` (`__tests__/e2e/athlete-performance.spec.ts:11-12`), (3) `.env.local` (read it locally; it currently contains no admin-credential keys — verified 2026-07-25). **Do NOT print or screenshot credential values anywhere.** If none of the three sources yields creds, STOP this task, mark every surface `BLOCKED (no admin creds)` in the report, and list "provide ADMIN_TEST_EMAIL/ADMIN_TEST_PASSWORD" as an owner action — do not guess passwords or create an admin user.

**Steps:**

- [ ] Preflight: confirm Tracks A, B, C, D1 are committed (`git log --oneline -15` shows their commits) and the orchestrator's inter-track gates were green. If any track is unlanded, defer this task — it must run last.
- [ ] Build fixtures in the scratchpad. `sentinel-statement.csv` (write exactly):

```csv
Date,Description,Amount
2026-07-01,E2E-SENTINEL COFFEE SHOP,-4.50
2026-07-02,E2E-SENTINEL OFFICE SUPPLY,-12.55
2026-07-03,E2E-SENTINEL DEPOSIT,100.00
```

  `sentinel-amazon.csv` (write exactly — matches the Order History Reports columns `AmazonImportDialog.tsx` parses; if upload-time validation rejects it, screenshot the validation error instead: the dialog rejecting a malformed CSV gracefully IS a pass for this surface):

```csv
Order Date,Order ID,Title,Category,Quantity,Item Total
2026-07-01,111-0000000-0000001,E2E-SENTINEL USB Cable,Electronics,1,$9.99
2026-07-02,111-0000000-0000002,E2E-SENTINEL Notebook,Office Product,1,$5.49
```

- [ ] Start the dev server: Bash `run_in_background`, command `cd "c:/Users/tayaw/Desktop/Darren Paul Projects/djpathlete" && npm run dev`. Then poll readiness (foreground): `curl -s -o /dev/null -w "%{http_code}" http://localhost:3050/login` until `200` (retry up to ~60s in a short loop).
- [ ] Load the Playwright MCP tool schemas via `ToolSearch` (query above), then log in: `browser_navigate` → `http://localhost:3050/login`; `browser_type` email into `input[name='email']`, password into `input[name='password']` (values from the creds source — never echoed); `browser_click` `button[type='submit']`; `browser_wait_for` URL containing `/admin`. Screenshot `01-logged-in.png`. **Pass:** admin shell renders. **Fail:** stuck on `/login` or error toast → file fix task "admin login broken on dev", stop the click-through.
- [ ] **Surface 1 — `/admin/books` ledger + net-revenue line.** Navigate, `browser_snapshot`, screenshot `02-books-home.png`. **Pass:** page renders the ledger for the default book with the existing income entries; no console errors (`browser_console_messages` filtered to `error`); the Track-A net-revenue/fees element shows the honest empty-state text "$0.00 fees recorded" (not blank) since no payout sync has run.
- [ ] **Surface 2 — photo receipt dialog.** From `/admin/books`, click the receipt-photo upload trigger (locate via `browser_snapshot`; the dialog copy is "Upload photos of paper receipts…" from `ReceiptUploadDialog.tsx:225`). Screenshot open dialog `03-receipt-photo-dialog.png`. `browser_file_upload` with `sentinel-receipt.jpg`, submit, `browser_wait_for` the AI scan review step (this fires one real `receipt_scan` job — acceptable, single small job), screenshot the review rows `04-receipt-photo-review.png`, then **Cancel/close without posting**. **Pass:** dialog opens, upload accepted, scan reaches review (or a clean, user-readable error state if vision misreads — screenshot it either way); nothing posted to the ledger.
- [ ] **Surface 3 — cash receipt 2-tap.** Open the cash dialog (button copy "Add receipt", `ReceiptCashDialog.tsx:229`). Fill amount `1.23`, vendor/description `E2E-SENTINEL CASH`, pick any expense account, submit. Screenshot `05-cash-posted.png` showing the new ledger row. **Pass:** entry appears in the ledger. **Cleanup:** delete that entry through the UI row action (or, if none, `DELETE`/entries API via `browser_network_request` against the entry id read from the snapshot); screenshot `06-cash-cleaned.png` proving it is gone. A failed cleanup is itself a FAIL — report the orphaned entry id prominently as an owner action.
- [ ] **Surface 4 — Amazon CSV dialog.** Open "Import Amazon orders" (`AmazonImportDialog.tsx:688`), upload `sentinel-amazon.csv`, screenshot the review step (or the validation rejection) `07-amazon-review.png`, then **cancel without posting**. **Pass:** review rows show both sentinel lines categorized (or a graceful rejection of the synthetic CSV); no ledger writes.
- [ ] **Surface 5 — statement import end-to-end (the one flow that commits).** Open the statement import dialog on `/admin/books`, upload `sentinel-statement.csv`, wait for the AI structuring job, screenshot review `08-statement-review.png`, verify the reconcile/warnings strip renders (D1's branches live here — a "completeness unverified" warning on this summary-less CSV is expected and is a PASS signal), then **commit** the import. Screenshot the posted rows `09-statement-committed.png`. **Pass:** 3 rows post (2 expense, 1 income) with the E2E-SENTINEL descriptions. **Cleanup:** delete all three via row actions / entries API (find them by the `E2E-SENTINEL` description), screenshot `10-statement-cleaned.png`; verify the reports page (next step) is run only AFTER cleanup so report figures are unpolluted.
- [ ] **Surface 6 — `/admin/books/reports` + print.** Navigate, screenshot `11-reports.png`. **Pass:** P&L renders real prod income figures (non-zero income, matching pre-click-through values), net-revenue line present with "$0.00 fees recorded", no console errors. Trigger the print view (the page's Print action) and screenshot the print-styled output `12-reports-print.png`. **Pass:** print layout renders without clipped tables.
- [ ] **Surface 7 — `/admin/books/insights` dismissals (Track B).** Navigate, screenshot `13-insights.png`. Pick any visible finding, click its Dismiss control, screenshot the finding gone `14-insights-dismissed.png`, reload the page and confirm it STAYS gone (persistence, not client-only), screenshot `15-insights-dismissed-persists.png`, then Undismiss it to restore state and screenshot `16-insights-restored.png`. **Pass:** dismiss persists across reload AND undismiss restores. If prod data yields zero findings, the honest empty state is the pass condition — screenshot it and note "dismissal untestable live: no findings".
- [ ] **Surface 8 — uncategorized deep-link (Track B).** From an insights uncategorized row (or by direct URL if no such row exists), navigate to `/admin/books?account_id=none&direction=expense` (plus `book_id`/`from`/`to` when following a real link, per spec §2: `InsightsClient` deep-link replacing the bare "Open ledger" at `InsightsClient:474`). Screenshot `17-deeplink-uncategorized.png`. **Pass:** the entries list is filtered to uncategorized (`account_id IS NULL`) rows — over the current prod ledger that is likely an empty filtered list with the filter chip visible, which passes.
- [ ] **Surface 9 — `/admin/books/email-receipts` empty state (Track C).** Navigate, screenshot `18-email-receipts-empty.png`. **Pass:** page renders the honest empty state per spec §3.4 — including the explicit "body-only receipt emails don't import" caveat (C-7) and Gmail-connection guidance — with no console errors and no crash while `cron_bookkeeping_gmail_receipts_enabled` is OFF and no email documents exist.
- [ ] Wrap-up: stop the background dev server (kill the background Bash task), assemble the report table — one row per surface: surface, screenshots, PASS / FAIL / BLOCKED, notes. **Failure protocol (binding):** any FAIL → immediately draft a fix task in the same plan format (files, interfaces, TDD steps) and append it to the orchestrator's queue; this click-through then re-runs for the failed surface after the fix lands. Never mark a failed surface as passed, never "close enough". No commits from this task; the evidence goes verbatim into the final report alongside the §5 decision register and §7 owner actions.