# AI Bookkeeper completion — final report (session of 2026-07-25 → 26)

**Status: COMPLETE, green, committed on local `main`, NOT PUSHED.** 49 commits sitting on top of `c66e5b22`. A one-word go-ahead ships them.

Owner was away for the whole build; every open decision was resolved autonomously per the kickoff's standing authority. All 20 decisions and their rationale live in the design doc; the ones that deviate from the kickoff's own wording are called out in §3 below.

---

## 1. What shipped

All four tracks, 24 implementation tasks, each with an adversarial review and a fix pass where warranted.

### Track A — 6e Stripe payouts, net revenue, exact dedupe (10 tasks)
- **Stripe `apiVersion` pinned** to `2026-01-28.clover` (the SDK 20.3.1 bundled literal — behaviour-neutral today, upgrade-stable tomorrow), in its own commit.
- **Migration 00191** — `bookkeeping_payouts` + `bookkeeping_payout_lines`, both with PLAIN uniques (valid `onConflict` targets), status CHECK covering all five Stripe values, flag `cron_bookkeeping_payout_sync_enabled` seeded **false**. Verified live, not just by commit message.
- **Migration 00194** — `fees_reconciled` + `reconcile_delta_cents` on payouts (added by the final fix wave; see §2).
- **`bookkeepingPayoutSyncCron`** — daily 05:15 UTC delegator → `/api/admin/internal/bookkeeping-payout-sync`. Route owns `cron_runs`; delegator declares only `[internalCronToken, appUrl]`; registered in `EXPECTED_CRONS` (sla 30h). Watermark derives from `max(arrival_date)` in the payouts table itself (−14d overlap, full-history cold start) **plus an eligibility re-pull of non-terminal payouts**, so a late status flip can never strand outside the window.
- **Net revenue** as a labeled second line on the reports page, accountant pack, print view and email copy. Gross stays primary (umbrella D3). QBO CSV deliberately untouched — a 4-column transaction format has no legal slot for a summary row.
- **Exact payout-deposit dedupe layer** between the existing source_ref and fuzzy layers: net ±0¢, arrival ±2d, `paid` only, with its own consumed set.
- **Fees never post to the ledger** (decision A-1) — report-layer only, so the close guard and the 00183 `source` CHECK are untouched.

### Track B — 5b insights polish (7 tasks)
- **Migration 00192** — `bookkeeping_finding_dismissals`, plain `UNIQUE (book_id, fingerprint)`.
- **Identity-based fingerprints** (`<finder>:<key>`) — deliberately NOT the kickoff's "content hash", because every finding's amounts change nightly as income syncs, so an amount-bearing hash would resurface every dismissal within a day.
- Dismiss / undismiss with an "N dismissed" reveal; dismissals filter **display only** — the pure recompute is untouched, and dismissed findings are also excluded from the AI narrative's input.
- **Insights → ledger deep-links**, including a new `account_id=none` sentinel so uncategorized rows (which have a NULL account) are actually filterable.
- **Largest-remainder shared-cost allocation** — cents sum exactly; pinned with a fixture that discriminates it from naive rounding.
- **AI narrative tail** — one button-triggered, `withTimeout`-bounded Sonnet call via lib `callAgent` (jsonTool mode preserved), honest fallback string, `ai_generation_log` rows.

### Track C — 3b Gmail receipt poller (6 tasks)
- **Migration 00193** — `external_ref` (nullable plain UNIQUE, check-then-insert only, never an upsert key) + `scan_result` jsonb on `bookkeeping_documents`; flag + label seeds, both dark.
- **Credential seam dissolved**: reuses the already-shipped `/admin/inbox` Gmail OAuth connection (`platform_connections` row `gmail`, `gmail.modify` scope). No new Google Cloud provisioning, no Firebase secrets, no domain-wide delegation — creds stay Vercel-side exactly like `gscSyncCron`.
- Four new Gmail client helpers; **strictly read-only** (never marks read, never modifies labels).
- **`ingestReceiptDocument` extracted** from the upload route so photo upload and email ingest share ONE recipe; the existing upload tests pass unchanged.
- Vision handler now persists `scan_result`, giving cron output a durable home (the photo flow's review state is browser-memory only).
- **`/admin/books/email-receipts`** review surface, committing through the existing receipts route so the close guard and business-purpose gates ride along free.
- Ships **doubly inert**: flag OFF *and* degraded success-skip when Gmail isn't connected.

### Track D — debt + verification (2 tasks)
- `reconcileControlTotals` branch gaps filled; `applyRowCap` was already covered.
- **e2e click-through spec** committed. Auth-gate suite (no creds needed) **ran green: 6/6** — all six `/admin/books` routes compile, render server-side and redirect to `/login` with no 5xx.
- Kickoff item D(i) folded into A10: account-scope guards on `import-platform/commit` and manual entry create.

---

## 2. Bugs caught before they shipped

The per-task reviews forced a fix on **13 of 24 tasks**; the final whole-branch review (8 agents, 3 mandated traces + 4 audit lenses) found **33 more — 0 Critical, 8 Important, 25 Minor** — all fixed in a 4-group wave. The ones worth knowing about:

| # | Defect | Why it mattered |
|---|---|---|
| 1 | **Manual payouts contributed zero fees.** `balanceTransactions.list({payout})` returns lines for *automatic* payouts only. | A dashboard "Pay out now" left fees invisible, and the pack then printed a clean-but-wrong net to the CPA. Now tracked per payout (`fees_reconciled`) and surfaced as "fees incomplete for N of M payouts". |
| 2 | **Dedupe payout layer didn't consume its constituent income.** | A matched payout left its `platform_import` entries re-spendable, so a genuine unrelated deposit of the same amount could be flagged "probable Stripe payout" and default to excluded — **real income silently dropped from the books**. |
| 3 | **"Net after fees" column actually computed income − fees**, beside a "Net" column meaning income − expenses. | Two different quantities under near-identical labels in the workbook emailed to the accountant. The test couldn't see it: the fixture had zero primary-book expenses, so both formulas produced the same number. |
| 4 | **`reconcileControlTotals` gave statements a clean bill of health while verifying nothing** (pre-existing, not ours). | A PDF stating only opening/closing balances skipped the "completeness unverified" warning *and* both reconciliation branches. Real bank PDFs commonly do exactly this. |
| 5 | **Gmail poller starvation.** Per-run cap applied *before* the already-ingested skip filter. | Once 25 processed messages sat at the head of the label, new receipts would never be reached — while `cron_runs` stayed green forever. |
| 6 | **A transient Gmail refresh failure wrote permanent `status='error'`** that only a full OAuth re-consent could clear, and 500'd the run. | One Google blip would have marked the integration broken and paged the watchdog. |
| 7 | **Empty state instructed the coach to label PDFs** that `SCANNABLE_MIMES` excludes — then permanently settled the message. | Follow the instructions, lose the receipt. |
| 8 | **Unscanned documents rendered as "scanned"**, contradicting migration 00193's own written requirement. | Ingested-but-unscanned receipts were indistinguishable from scanned ones with nothing found. |
| 9 | **A route wrote a `generation_trigger` column that doesn't exist.** | Guaranteed runtime insert failure; `tsc` was blind because the DAL takes a loose object. |
| 10 | **Per-book fee scoping was pinned by no assertion** despite being named in the test title. | Deleting the guard kept every test green; a later widening would have subtracted the coach's entire fee bill from the spouse's book. |

The recurring theme, worth carrying into future sessions: **tests that pass without verifying what they claim** — a fixture where two formulas collapse to one number, a scoping guarantee asserted nowhere, a migration test that reads the `.sql` file instead of the database, e2e tests wrapped in `if (visible)` so they can't fail. All fixed.

---

## 3. Decisions that deviate from the kickoff's wording

1. **Dismissal fingerprint = identity, not content hash** (B-1). Amount-bearing hashes would resurface nightly as income syncs.
2. **Cold-start payout lookback = full history**, not §8's 90 days. The YTD report needs January fees and the payout volume is tiny.
3. **Fees are report-layer only** (A-1). Posting them would need a `source` CHECK ALTER plus close-guard interaction, and fees would mutate already-closed months as payouts trickle in.
4. **Email receipts get their own review page** rather than "the existing receipt review flow". The photo flow's review state is browser-memory tied to the uploading session; cron output needs a durable list. The row editor and commit route *are* the existing flow's.
5. **Gmail body-rendered PDFs are out of v1** (C-7). Needs a headless renderer on the money path. The empty state says so explicitly rather than silently ingesting nothing.
6. **Final review used Fable**, not the kickoff's "Opus" (written before Fable existed) — strongest-available-reviewer intent honoured.

---

## 4. Verification evidence

| Gate | Result |
|---|---|
| Full suite (pre-change baseline) | 3237 passed / 4 failed (3241) |
| Full suite (final) | **3490 passed / 4 real failures (3500)** — net **+253 tests** |
| The 4 failures | Byte-identical to baseline: the documented Stripe-webhook wall-clock flake pair |
| `npm run build` | **exit 0**, run as its own command (never `&&`-chained behind tests) |
| Bookkeeping subsystem in isolation | **94 files, 756 passed, 0 failed** |
| e2e auth gate | **6/6 passed** against a live dev server |
| Migrations 00191–00194 | Applied live via MCP and **verified against `information_schema`**, not assumed |

Three extra failures appeared in one intermediate run (`events`, `printful`) and passed in isolation — a differing failure set across identical runs is the definitive flake signature; `printful` alone takes 1476ms and blows the 5s timeout only under full-suite CPU contention.

---

## 5. YOUR ACTION LIST

Nothing below was changed for you — these are all owner calls.

1. **Push.** 49 commits are ready on local `main`. Pushing triggers the Vercel deploy *and* the functions GHA deploy (`functions/**` changed). Watch both.
2. **Tax rate is set to 6%** — this looks wrong. You're in Florida, so there's no state income tax and the rate should be federal-only (~25% is typical). I did not change a setting you set. `/admin/books/insights`.
3. **`bookkeeping_accountant_email` is empty** — the quarterly pack cron success-skips until you save it.
4. **`bookkeeping_home_office_percent` is unset** — the insights card prompts for it.
5. **Zero expenses in prod.** The ledger is income-only (~29 entries). Your first statement upload is what makes the expense side, the insights finders and the allocation view meaningful.
6. **Two new crons arrive OFF** — flip when ready: `cron_bookkeeping_payout_sync_enabled` (daily 05:15 UTC) and `cron_bookkeeping_gmail_receipts_enabled` (hourly :20).
7. **Gmail poller also needs you to connect Gmail** at `/admin/inbox` and apply a **"DJP Receipts"** label. Note: **body-only receipt emails with no attachment are not imported** — attach the receipt or use photo upload.
8. **Spouse book W-2-vs-business is still open** (since Phase 1). Both books are still treated identically per-book.
9. **Membership invoice revenue still isn't in the ledger.** Payouts are a read-model mirror, so the income adapter's honest warning stays. If you want membership revenue posted, that's its own piece of work.
10. **`ADMIN_TEST_EMAIL` / `ADMIN_TEST_PASSWORD` are unset**, so every authed e2e spec in this repo skips — including the 6 screenshot tests I wrote. Set them and run `npx playwright test __tests__/e2e/bookkeeping-surfaces.spec.ts` for the full click-through. I did **not** create an admin account in your production Supabase to work around this.
11. **Stripe dashboard API version** — the code pin governs request shapes and is behaviour-neutral; webhook *event* shapes follow the dashboard setting, which I didn't touch. Worth confirming at leisure.

---

## 6. Where things live

- Design + all decisions: `docs/superpowers/specs/2026-07-25-bookkeeper-completion-design.md`
- Plans (25 tasks): `docs/superpowers/plans/2026-07-25-bookkeeper-track-{a,b,c,d}-*.md`
- Running log + lessons: `JOURNAL.md` (gitignored, local only)
