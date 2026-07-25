# AI Bookkeeper completion — design (2026-07-25)

Four tracks finishing the AI Bookkeeper: **A** = 6e Stripe payout ingestion + net revenue + exact payout dedupe; **B** = 5b insights polish; **C** = 3b Gmail receipt poller; **D** = engineering-debt cleanups. Owner away — all open decisions resolved autonomously per the kickoff prompt's authority; each decision below carries its rationale. Commit on main as tasks land; **push held** until the owner says go.

Seeds: umbrella design `2026-07-17-ai-bookkeeper-design.md` (decisions D3 gross-primary, D10 read-surfaces-unflagged); Phase-6 §8 (6e), Phase-5 §11 (5b), Phase-3 §12 (3b). Everything through Phase 6 + income-sync cron is live on main (`c66e5b22`). Next migration: **00191**.

## 0. Context corrections found in brainstorming (vs the kickoff/seeds)

1. **Track C's credential seam mostly dissolves.** Since Phase-3 was specced, a full Gmail OAuth integration shipped for `/admin/inbox`: refresh token in `platform_connections` row `"gmail"`, client `lib/gmail/client.ts`, scopes `gmail.modify` + `gmail.send` (covers attachment reads and label listing). The poller reuses that connection Vercel-side (gscSyncCron precedent — zero new Firebase secrets). No service-account/DWD question remains. What IS missing: four client helpers — `listLabels`, `listMessages` (`users.messages.list`; only `listThreads` exists), a **full-format `getMessage`** (`getMessageMetadata` is `format=metadata` and returns no payload parts/attachment ids), `getAttachment` — and a durable home for scan results (the photo flow's review state is browser-memory only).
2. **D(i) is partially stale.** Statement commit and Amazon commit already call `assertAccountsInBook` (with tests). The live gaps: `import-platform/commit` (zero account validation) and manual `entries` POST (`createEntry` with unchecked `account_id`). Receipts commit + cash use inline single-account equivalents (`receipts/commit/route.ts:34-37` — book match + expense-type; `receipts/cash/route.ts:18-20` same) — left as-is.
3. **D(ii) is already done.** `reconcileControlTotals` AND `applyRowCap` both have direct tests (`functions/src/__tests__/statement-reconcile.test.ts` — applyRowCap at :28-44 covers cap boundary, truncation warning, small-set no-op); the 500-row route cap is pinned (`__tests__/api/admin/bookkeeping/statement-import.test.ts:195`). Remaining: spot-check reconcile's three branches (all-null, per-side >100¢ drift, within-drift silence) and fill only if a hole is found.
4. **stripe-node 20.3.1's bundled API version is `2026-01-28.clover`** (`node_modules/stripe/cjs/apiVersion.js`). stripe-node sends its bundled version when unpinned, so pinning that literal is behavior-neutral today and upgrade-stable tomorrow.
5. **No fee data exists anywhere in the report path** (`ReportEntry`, the DAL select, the table). Net revenue must be fed from the new payouts tables as a **separate aggregator input** — deliberately NOT a change to `incomeByServiceLine`/`perBookSummary`, so the functions twin (`functions/src/lib/bookkeeping-aggregate.ts`, pinned by `chat-tools-parity.test.ts`) stays untouched.

---

## 1. Track A — 6e Stripe payout ingestion, net revenue, exact dedupe

### 1.1 Data model (migration 00191)

Two tables + flag seed, additive/inert-without-code:

- **`bookkeeping_payouts`**: `id uuid PK default gen_random_uuid()`, `stripe_payout_id text NOT NULL UNIQUE` (**plain unique** — upsert key), `book_id uuid NOT NULL FK bookkeeping_books ON DELETE CASCADE`, `amount_cents integer NOT NULL` (Stripe payout `amount` = **net**), `gross_cents integer NOT NULL DEFAULT 0`, `fee_cents integer NOT NULL DEFAULT 0` (both derived from lines; see 1.3), `arrival_date date NOT NULL`, `status text NOT NULL CHECK (status IN ('in_transit','paid','failed','canceled','pending'))`, `currency text NOT NULL DEFAULT 'usd'`, `raw jsonb`, `created_at/updated_at`. Index `(book_id, arrival_date)`.
- **`bookkeeping_payout_lines`**: `id uuid PK`, `payout_id uuid NOT NULL FK bookkeeping_payouts ON DELETE CASCADE`, `stripe_balance_txn_id text NOT NULL UNIQUE` (plain), `type text NOT NULL` (charge/refund/adjustment/…), `amount_cents integer NOT NULL` (signed gross), `fee_cents integer NOT NULL`, `net_cents integer NOT NULL`, `txn_date date NOT NULL` (from balance-txn `created`, UTC), `description text`, `source_ref text` (Stripe source id hint, e.g. `ch_…`), timestamps. Index `(txn_date)`.
- Flag seed: `cron_bookkeeping_payout_sync_enabled` `'false'::jsonb`, `on conflict (key) do nothing` (00190 template).

**Decision A-2 — lines table: YES** (§8 left it optional). Rationale: (a) fee attribution by charge date for reports (1.4); (b) the gross−fee−net verification trace demanded by the kickoff needs per-txn data; (c) refunds/disputes visible without re-calling Stripe. Amounts are integer cents straight off the API — no float math anywhere.

**Decision A-1 — fee model: report-layer only, zero ledger writes.** Fees never post as ledger entries. Rationale: posting would need the 00183 `source` CHECK ALTER + `LedgerSource`/validator/types widening + close-guard interaction + fees mutating already-closed months as payouts trickle in. Report-layer keeps closes byte-identical to today and the ledger stays the single source of truth for *posted* money; fees are a parallel read-model. This is §8's "lean" option and preserves umbrella D3 (gross primary).

### 1.2 apiVersion pin (own commit, first in the track)

`lib/stripe.ts:5` → `new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-01-28.clover" })`. **Decision A-5**: pin the SDK's bundled literal — that is the version every existing call already sends, so the pin is a no-op today; it exists to keep behavior fixed across future `npm update stripe`. The three one-off scripts (`scripts/check-stripe-price.ts`, `backfill-stripe-payments.ts`, `backfill-events-stripe-live.ts`) construct their own clients and are historical backfills — left unpinned, noted for the owner. Regression check: full suite + build after the pin commit, before any payout code.

### 1.3 Sync cron

Byte-for-byte the income-sync pattern (freshest template):

- **Delegator** `bookkeepingPayoutSyncCron` at the tail of `functions/src/index.ts`: `onSchedule({ schedule: "15 5 * * *", timeZone: "Etc/UTC", timeoutSeconds: 120, memory: "256MiB", region: "us-central1", secrets: [internalCronToken, appUrl] })` → POST `/api/admin/internal/bookkeeping-payout-sync`. Console-only error handling, never logs `cron_runs`. **Decision A-7**: 05:15 UTC — free slot, after income-sync (04:30). Stripe key stays Vercel-side; NO new functions secrets (quarterly-pack over-declaration not copied).
- **Route** `app/api/admin/internal/bookkeeping-payout-sync/route.ts` (`runtime nodejs`, `maxDuration 120`): Bearer triple-clause → `isCronSkipped({ enabledKey: "cron_bookkeeping_payout_sync_enabled", defaultEnabled: false })` → 200 success-skip; route is the single `logCronStart/logCronEnd` owner under `"bookkeepingPayoutSyncCron"`; failures throw → `failed` + 500 (fail-closed; the watchdog is the alarm).
- **Watermark**: pure helper `lib/bookkeeping/payout-sync-window.ts` — `computePayoutSyncWindow(latestArrivalDate: string | null, today: string)`. Steady state: `arrival_date >= latestArrivalDate − 14d` (late arrivals + the realistic status flips — `in_transit → paid`, and `paid → failed` bank bounces, which Stripe reverses within ~5 business days — live inside the overlap). **Eligibility arm** (the income-sync watermark lesson — key on eligibility, not creation time): every run ALSO re-pulls by id (`payouts.retrieve`) any stored payout whose local status is non-terminal (`pending`/`in_transit`) regardless of arrival date, so a flip can never strand outside the window. **Decision A-4 — cold start = full history** (no lower bound), deviating from §8's 90d: the YTD report preset needs fees back to January, and a solo-coach account's full payout list is tiny. No settings cursor — watermark derives from `max(arrival_date)` in `bookkeeping_payouts` (new DAL read `latestPayoutArrivalDate(bookId)`).
- **Pull**: `stripe.payouts.list({ arrival_date: { gte: epoch(from) }, limit: 100 })` auto-paginated (`autoPagingToArray({ limit: 10000 })`); for each payout, `stripe.balanceTransactions.list({ payout: id, limit: 100 })` auto-paginated. **Landmine**: the payout's own `type:'payout'` balance txn appears in that listing — filter it out of lines. `gross_cents = Σ line.amount`, `fee_cents = Σ line.fee`; if `gross − fee ≠ payout.amount`, push a warning into `detail` (never fail the run) — this reconciliation IS the gross−fee−net trace hook. **Backlog discipline**: route `maxDuration 300`; process payouts **oldest-first** with a per-run cap (`MAX_PAYOUTS_PER_RUN = 200` line-fetches), report `more_pending` in `detail` — because the watermark derives from stored `max(arrival_date)`, a capped cold start resumes exactly where it stopped on the next run.
- **Write**: `upsertPayouts` / `upsertPayoutLines` DAL fns, `onConflict: "stripe_payout_id"` / `"stripe_balance_txn_id"`, **merge mode (not ignoreDuplicates)** so status flips update (**Decision A-6**). `book_id` = primary business book (same resolution as income-sync).
- **Audit**: `bookkeeping.payout_synced` (category `commerce`, system actor) only when `upserted > 0`; slug registered in `lib/audit/actions.ts`. `EXPECTED_CRONS` += `{ name: "bookkeepingPayoutSyncCron", sla_hours: 30 }`.
- **Never touches**: the shared Stripe webhook, `payments`, or any ledger table. Reconcile-by-read only.

### 1.4 Net revenue (labeled second line; gross stays primary — D3)

New pure fn `stripeFeesInWindow(lines: PayoutLineRef[], from, to): number` in a new `lib/bookkeeping/payout-fees.ts` — sums `fee_cents` over lines with `txn_date` in window (type `'payout'` rows never stored). **Decision A-3 — fees attribute by balance-txn date**, not payout arrival date, so the fee sum aligns with the same window as gross income (a January charge paid out in February counts against January). Honest caveat rendered with the number: fees appear only after their payout is ingested.

Surfaces — everywhere "Total gross income" renders today gets two sibling lines, *"Stripe processing fees"* and *"Net income after Stripe fees (est.)"*, business book only:
- Reports JSON route: fetch window lines via new DAL `listPayoutLinesForWindow(from, to)`, add `stripe_fee_cents` + `net_income_cents` per book (0/absent for books without payouts) to the payload; **blanket rule: every new DAL read over a growth table (`listPayoutLinesForWindow`, `listPayoutsForDedupe`, dismissals join, email-receipts pending list) is `fetchAllRows`-paginated — no bare `.select()`**; `ReportsClient` renders the second lines under the Income-by-service total and updates the header disclaimer (`:101`).
- Accountant pack: Read-Me line `:133` amended (it currently asserts fees are never netted); Summary sheet gains fee + net-after-fees columns; Income-by-Service sheet gains the two rows under "Total gross income".
- Print view: same two rows under its "Total gross income".
- Email pack: html bullet + subject "(gross, estimates)" copy amended to mention the net line.
- **QBO CSV: unchanged** — transaction-level 4-column format has no legal slot for a summary row (documented).
- P&L blocks unchanged (category-level; fees aren't an account — avoids two competing "net" figures beyond the labeled income-side line).

The membership-revenue warning in `income-adapter.ts` **stays** (Decision A-9): payouts are a mirror/read model — membership invoice income still never posts to the ledger, so killing the warning would be dishonest. Owner-action item.

### 1.5 Exact payout dedupe layer

`lib/bookkeeping/statement-dedupe.ts` — new layer between layer-1 exact-posted and layer-2 aggregate, inserted at the `:141` boundary inside `annotateIncome`:

- New input: `opts.payouts?: PayoutRef[]` where `PayoutRef = { id, stripe_payout_id, net_cents, arrival_date, status }`. Threaded through `flagStatementDuplicates` → `annotateRow` → `annotateIncome`.
- Match rule: bank income line where `amount_cents === payout.net_cents` AND `|dayDiff(occurred_on, arrival_date)| <= 2` AND `status === 'paid'`. Nearest-date unconsumed payout wins.
- **Consumed-set contract**: a separate `consumedPayouts: Set<string>` per call — one bank line consumes one payout; the payout layer does NOT consume posted-entry ids (layers 1/2 keep their existing pool untouched for other rows).
- Verdict: `possibleDuplicate: true, defaultInclude: false, newCandidate: false, matchedEntry: null`, new optional field `matchedPayoutId` on `AnnotatedStatementRow`, `reason: "Stripe payout deposit — net $X arriving <date> (po_…)"`. Flags, never drops — coach can still include the row (that is the membership-revenue escape hatch).
- Layer-2 aggregate stays as fallback for pre-ingestion history.
- Dedupe route (`statement-import/dedupe/route.ts`): fetch `listPayoutsForDedupe(bookId, from−4d, to+4d)` alongside `listPostedForDedupe`, pass through. Still exactly one `flagStatementDuplicates` call per batch.

### 1.6 D(i) fold-in (commit-route account scope)

In the same track (touching the commit-route family): add `assertAccountsInBook` to **`import-platform/commit`** and the inline equivalent (`assertAccountInBook` on non-null `account_id`) to **`entries` POST**, both mapping `AccountScopeError` → 404/409 exactly like statement commit. Tests mirror `statement-commit-scope.test.ts`.

---

## 2. Track B — 5b insights polish

### 2.1 Findings dismissals (migration 00192)

- **Table `bookkeeping_finding_dismissals`**: `id uuid PK`, `book_id uuid NOT NULL FK ON DELETE CASCADE`, `fingerprint text NOT NULL`, `dismissed_by uuid FK users ON DELETE SET NULL`, `dismissed_at timestamptz default now()`, **plain `UNIQUE (book_id, fingerprint)`**.
- **Decision B-1 — identity-based fingerprint, not amount-bearing content hash.** The kickoff sketched "book_id + finder + content hash", but every aggregate finding's amounts change nightly (income-sync grows totals) — an amount-bearing hash would resurface every dismissal within a day, making the feature useless. Fingerprint = pure fn `findingFingerprint(finder, key)` → `"<finder>:<key>"` in new `lib/bookkeeping/finding-fingerprint.ts`, where key is the finding's stable identity: watchlist/home-office → `account:<uuid>`; substantiation-gap/uncategorized/watchdog → `entry:<uuid>`; vendor → `vendor:<normalizeCounterparty(key)>`; year-end → `flag:<id>`. Pinned with mutation-discriminating fixtures (case/whitespace vendor normalization; distinct finders over the same key must not collide).
- **API**: `POST /api/admin/bookkeeping/insights/dismissals` `{ book_id, fingerprint }` and `DELETE` (same body) — admin-gated, audited `bookkeeping.finding_dismissed` / `bookkeeping.finding_undismissed` (commerce; both slugs registered). Insights GET joins the table and returns `dismissed_fingerprints: string[]` per book — pure recompute stays (D4); dismissals only filter display.
- **UI**: dismiss (X) button per card row; dismissed rows collapse into an "N dismissed — show" reveal per card with undismiss buttons inside.

### 2.2 Gap deep-links

- `app/(admin)/admin/books/page.tsx` parses `searchParams` (Next 16 async `Promise` convention, per `reports/print/page.tsx:71`) — `book_id, account_id, direction, from, to, source, q` — and passes `initialFilters` (+ resolves `initialBookId` from `book_id` when valid) to `BooksClient`, which hydrates via its `useState` initializers. No reset-guard needed: the `:168` accountId reset lives only in `handleBookChange` (user-driven select), which never fires on mount.
- Uncategorized entries have `account_id = null`, which the entries API can't filter today — add sentinel **`account_id=none`** to the GET route + `listEntries` (`.is("account_id", null)`) + an "Uncategorized" option in BooksClient's account select. (Params otherwise exactly match what the API already parses — nothing invented.)
- Insights links: substantiation-gap rows → `/admin/books?book_id&account_id&from&to` (window = the insights range); uncategorized rows → `/admin/books?book_id&account_id=none&direction=expense&from&to`. Replaces the bare "Open ledger" link at `InsightsClient:474`.

### 2.3 Proportional shared-cost allocation

Pure fn `allocateSharedCosts(profit: ServiceLineProfit): AllocatedRow[]` in `service-line-profit.ts`: distributes `shared_cost_cents` across lines by income share (`row.income_cents / income_total_cents`) using **largest-remainder** so allocated cents sum exactly to `shared_cost_cents`; zero-income lines get 0; `income_total_cents === 0` → no allocation (all stays shared). Deterministic tie-break: larger fractional remainder first, then row order. Pinned with a fixture that discriminates largest-remainder vs naive per-row rounding (e.g. 100¢ over three equal lines → 34/33/33, where naive rounding loses/creates a cent). UI: a labeled toggle on the profit card ("Allocate shared costs by revenue share — estimate"), rendering `net after allocated share` per line.

### 2.4 AI narrative tail

- New shared helper `lib/with-timeout.ts` (the inquiry-route `withTimeout` promoted verbatim; the inquiry route itself is NOT touched — out of scope).
- New route `POST /api/admin/bookkeeping/insights/narrative` (admin, `maxDuration 45`): body `{ from, to }` (validated by `reportQuerySchema`); server recomputes the bundle (reuse `loadInsightsBundle` + finders — never trusts client-posted numbers), **filters out dismissed findings before compaction** (dismissals gate display, and the narrative is display — a dismissed finding must not resurface in the AI summary), compacts the rest to a small JSON summary, then `withTimeout(callAgent(...), 20_000)` — lib-side `callAgent` (which forces `structuredOutputMode: "jsonTool"`; Zod `.min()/.max()` are fine THROUGH it, per `anthropic-schema.test.ts`), `{ model: MODEL_SONNET, maxTokens: 1200 }`, schema `z.object({ observations: z.array(z.string()).min(3).max(5) })`. System prompt: plain-English, cite real numbers, no advice-of-record, label as AI-generated. `ai_generation_log` pending→completed/failed rows (lead-analysis precedent). Failure/timeout → 200 with `{ observations: null, fallback: "AI summary unavailable — the live numbers above are unaffected." }` (honest fallback; request never 500s for AI reasons).
- **Decision B-5 — explicit button, session cache, no persistence.** "Explain these findings" button on the insights page; result cached in client state per `(from, to)`. Rationale: auto-on-load would spend per view against a zero-cache GET (D4); button = owner-initiated spend, matching the read-surfaces-unflagged rule (D10 — no flag). Accepted cost (vs the kickoff's "cached on the response" phrasing): a page reload + re-click is a fresh Sonnet call — fine for a button-gated, low-volume owner tool; persisting would need a cache table for a feature with one user.

---

## 3. Track C — 3b Gmail receipt poller

### 3.1 Credentials + degraded mode (Decision C-1)

Reuse the **shipped Gmail OAuth connection**: `platform_connections` row `"gmail"` via the existing `/admin/inbox` connect flow (`GMAIL_CLIENT_ID/SECRET/REDIRECT_URI` already in env; `gmail.modify` scope covers everything the poller reads). No new Google Cloud provisioning, no Firebase secrets, no DWD. Degraded path (GHL/inbox-SLA precedent): `GmailNotConnectedError` or label not found → cron run **succeeds** with `detail.fetch_status = 'degraded'` + reason, zero alerts; UI empty state says "Connect Gmail in Admin → Inbox, then apply the '<label>' label to receipt emails."

### 3.2 Migration 00193

- `bookkeeping_documents` + `external_ref text` (**plain UNIQUE**, nullable — Postgres treats NULLs as distinct, so existing rows are unaffected) — value `gmail:<messageId>:<attachmentIndex>`. **Constraint discipline**: this column is check-then-insert only and must NEVER become a PostgREST `onConflict` target (nullable + NULLS-distinct makes it unusable as an upsert key — memory `postgrest_onconflict_plain_unique`); the DB unique is the belt behind the poller's skip check, not an upsert seam.
- `bookkeeping_documents` + `scan_result jsonb` (nullable) — durable home for the vision result (3.4).
- Seeds: flag `cron_bookkeeping_gmail_receipts_enabled` `'false'` + setting `bookkeeping_gmail_receipt_label` `'"DJP Receipts"'::jsonb`.

### 3.3 Poller cron

- Delegator `bookkeepingGmailReceiptsCron` (`onSchedule "20 * * * *"` hourly, `secrets: [internalCronToken, appUrl]` only) → route `app/api/admin/internal/bookkeeping-gmail-receipts/route.ts` (Bearer triple-clause, flag gate, single `cron_runs` owner, `EXPECTED_CRONS` += `{ name: "bookkeepingGmailReceiptsCron", sla_hours: 6 }` — hourly cadence but delay-tolerant, so 6h before warning rather than the 1h sub-hourly convention; a Gmail blip should not page).
- **Read-only Gmail** (Decision C-3): never marks read, never modifies labels — idempotency comes entirely from `external_ref`. New client helpers in `lib/gmail/client.ts`: `listLabels` (resolve the configured label name → id), `listMessages` (`users.messages.list` with `labelIds`, paginated), `getMessage` (**`format=full`** — the existing `getMessageMetadata` returns no payload parts/attachment ids), `getAttachment` (`users.messages.attachments.get`, base64url → Buffer).
- Flow per run: resolve label id → `listMessages(labelIds:[id])` — **label-only, no date bound** (Decision C-8): the label is the coach's explicit opt-in set, so backlog labeling (likely first real use — prod has zero expenses) Just Works; volume is solo-coach tiny and the per-message skip makes re-polls cheap → for each message id, skip if any document exists with `external_ref LIKE 'gmail:<id>:%'` (new DAL check) → fetch full message → for each attachment with mime `image/*` or `application/pdf` (and size ≤ 10MB): download → `storeStatementFile` under `bookkeeping/receipts/<bookId>/<documentId>/…` → `createDocument({ kind:'receipt', external_ref, retain_until: UTCyear+7-12-31, … })` → `createGenerationLog` → Firestore `ai_jobs` `receipt_scan` job + RTDB seed (the exact upload-route recipe). Book = primary business book. Route `runtime nodejs`, `maxDuration 300`; per-run cap `MAX_MESSAGES_PER_RUN = 25` new messages (remainder picked up next hour; `more_pending` in `detail`). Audit `bookkeeping.gmail_receipt_ingested` (commerce, system actor) only when documents > 0; slug registered.
- The ingest recipe (storage + document + log + job + RTDB) is **extracted into `lib/bookkeeping/receipt-ingest.ts`** and the existing upload route delegates to it — one implementation, behavior-diffed against the current route (its tests must pass unchanged).
- **Decision C-7**: attachments only, v1 — no body-rendered PDF (needs a headless renderer; not worth the money-path risk). Messages without usable attachments produce nothing and are cheaply re-listed each poll (no-op).

### 3.4 Durable scan results + review surface

- `functions/src/receipt-scan.ts` additionally writes the coalesced scan result to `bookkeeping_documents.scan_result` (it already writes that table for `period_start/end` — same client, one more column; photo flow unaffected, RTDB path unchanged).
- New admin surface **`/admin/books/email-receipts`** (linked from BooksClient): lists pending email receipts — documents `kind='receipt'`, `external_ref LIKE 'gmail:%'`, **`posted_count IS NULL OR posted_count = 0`** (`posted_count` is nullable with no default and only ever written by `linkDocumentBatch` after a commit — a bare `= 0` filter would match nothing, permanently emptying the page) — via a new admin GET route; renders each with the existing `ReceiptRowEditor` fed from `scan_result`, per-row commit through the **existing** `receipts/commit` route (`source_ref receipt:<documentId>` convention unchanged, close guard + business-purpose gates ride along free). This is a deliberate deviation from the kickoff's "rows appear in the existing receipt review flow": the photo flow's review state is browser-memory tied to the uploading session, so cron output needs its own durable list — but the row editor and the commit route ARE the existing flow's. Empty states: not connected → connect-Gmail hint; connected but empty → "No email receipts pending. Label a receipt email with an attached PDF or image '<label>' and it appears within the hour. **Body-only emails (no attachment) aren't imported** — forward them to yourself with the receipt attached, or use photo upload."
- Retention: polled docs carry `retain_until` like any other → the shipped retention cron prunes them with zero new code. Commit re-stamps `retain_until` via the existing `receiptRetainUntil` path.
- Ships dark: flag OFF **and** (independently) Gmail possibly unconnected — doubly inert on arrival.

---

## 4. Track D — remaining debt

- **D(i)** — folded into Track A (§1.6).
- **D(ii)** — verify `functions/src/statement-import.ts:applyRowCap` has a direct unit test; add one if missing (cap boundary + truncation warning). `reconcileControlTotals` coverage confirmed existing — spot-check its branches (all-null, per-side drift >100¢, within-drift silence) and fill any hole.
- **D(iii)** — Playwright-MCP authed click-through against local dev (`npm run dev`, real admin login): the 3 receipt flows (photo batch, cash, Amazon CSV), statement import end-to-end (upload → review → commit), and reports (page, print). Screenshots land in the final report. Pure verification — no code. Run LAST, after all tracks, so it also exercises the new surfaces (net-revenue line, dismissals, email-receipts page empty state, deep-links).

---

## 5. Decision register (all autonomous — owner review welcome)

| # | Decision | Choice | Key rationale |
|---|---|---|---|
| A-1 | Fee model | Report-layer only; fees never post to ledger | No CHECK ALTER, closes stay frozen, ledger stays source of truth for posted money |
| A-2 | Payout lines table | Build it | Fee-by-charge-date, gross−fee−net trace, refund visibility |
| A-3 | Fee window attribution | Balance-txn date | Aligns fees with the gross-income window |
| A-4 | Cold-start lookback | Full history (dev. from §8's 90d) | YTD preset needs Jan fees; volume tiny |
| A-5 | apiVersion pin | `2026-01-28.clover` (SDK bundled literal) | Behavior-neutral now, upgrade-stable later; own commit |
| A-6 | Payout upsert mode | Merge (not ignoreDuplicates) | `in_transit → paid` status flips must land |
| A-7 | Schedule | Daily 05:15 UTC | Free slot, after income-sync |
| A-8 | Dedupe match rule | net ±0¢, arrival ±2d, `paid` only, separate consumed-payout set | Exact layer must not loosen into layer-2's fuzz or steal layer-1's pool |
| A-9 | Membership warning | Stays | Payouts don't post membership income; killing it would lie |
| B-1 | Dismissal fingerprint | Identity-based `<finder>:<key>` (dev. from kickoff's content-hash wording) | Amount-bearing hashes resurface nightly as totals grow |
| B-2 | Dismissal API shape | POST/DELETE `/insights/dismissals`, audited both ways; GET returns fingerprints, client filters | Pure recompute stays (D4); dismissals gate display only — incl. the AI narrative |
| B-3 | Uncategorized deep-link | `account_id=none` sentinel in entries GET + DAL + filter UI | NULL account isn't filterable today; sentinel doubles as a useful coach filter |
| B-4 | Allocation algorithm | Largest-remainder on income shares; zero-income lines get 0; zero-total → no allocation | Cents must sum exactly; naive rounding loses/creates cents |
| B-5 | Narrative trigger | Explicit button, session cache, no flag; reload = fresh spend accepted | Owner-initiated spend; D4 zero-cache GET; D10 |
| C-1 | Gmail creds | Reuse shipped OAuth connection (`platform_connections`) | Already provisioned; degraded-skip when absent |
| C-2 | Cron shape | Hourly :20 delegator → internal route, `sla_hours: 6` | Delay-tolerant poller; a Gmail blip must not page |
| C-3 | Mail mutation | Strictly read-only; idempotency via `external_ref` (check-then-insert; never an onConflict target) | Kickoff landmine; least surprise for the coach |
| C-4 | Scan persistence | `scan_result jsonb` on documents, written by the functions vision handler | Handler already writes this table; durable + photo flow unaffected |
| C-5 | Review surface | `scan_result` + `/admin/books/email-receipts` page reusing `ReceiptRowEditor` + existing commit route (deviation from "existing flow", documented) | Photo-flow review is browser-memory; cron output needs a durable home |
| C-6 | Label config | Setting `bookkeeping_gmail_receipt_label`, seeded `"DJP Receipts"` | Coach-renamable without code |
| C-7 | Body-rendered PDF | Not in v1; attachments only — empty-state + owner docs say so explicitly | Headless-render dependency on the money path; honesty over silent no-op |
| C-8 | Poll window | Label-only listing, no date bound, per-run cap 25 messages | Backlog labeling is the likely first real use; label = explicit opt-in set |
| D-1 | Commit-route guards | `import-platform/commit` + `entries` POST only; receipts' inline checks left as-is | Statement/Amazon already guarded; receipts' inline checks are equivalent (cited §0.2) |
| D-2 | Scope shrink | D(ii) fully covered already; reconcile branch spot-check only | `applyRowCap` tests found at statement-reconcile.test.ts:28-44 |

## 6. Testing + verification

- Pure fns (`payout-sync-window`, `payout-fees`, dedupe payout layer, `finding-fingerprint`, `allocateSharedCosts`, ingest helpers) → `__tests__/lib/bookkeeping/` zero-mock, mutation-discriminating fixtures (12.555 house style; largest-remainder discriminator; fee-sum window boundaries).
- Routes (payout sync, dismissals, narrative, gmail poller, email-receipts list, guarded commits) → `__tests__/api/admin/...` with the established mock style; internal routes test the Bearer triple-clause + flag skip + fail-closed paths; multipart tests `@vitest-environment node`; RFC-4122 fixture UUIDs.
- Functions-side: `applyRowCap` test; receipt-scan `scan_result` write test in `functions/`.
- Gates per task: suite green vs baseline (3118/3118 on 2026-07-19; stripe-webhook wall-clock flake pair is the known-red family — stash-isolate before blaming a change), `npm run build` as its OWN command (never `&&`-chained behind tests). `functions/` build + suite when functions touched. No root↔functions import seams are planned; if one appears, run the Vercel-condition build (mv functions/node_modules) and say so.
- Migrations applied live via `mcp__supabase__apply_migration` as each track lands (additive, inert while flags are OFF).
- Live-proof (sentinel insert → aggregate → delete) for: payout row + lines → net-revenue line on the reports JSON **and** pack/print builders (same sentinel window); dismissal row → finding filtered from GET and from the narrative input; document row with `external_ref` → poller skip + email-receipts pending list.
- Honest empty-states on every new surface over the income-only prod ledger: allocation toggle disabled with "No shared costs to allocate yet" when `shared_cost_cents = 0`; narrative prompt handles a near-empty ledger without inventing trends; net-revenue line reads "$0.00 fees recorded" (not blank) before the first payout sync; email-receipts empty states per §3.4.
- Subagent discipline (Phase-6 trap): every reviewer subagent prompt says "never mutate, reason instead"; `git status`-diff the tree after any interrupted subagent before continuing.
- Final whole-branch review by the strongest available reviewer — **Fable** (the kickoff says "Opus", written before Fable existed; strongest-model intent honored) — must trace: (i) one payout gross−fee−net from Stripe API shape → `bookkeeping_payouts`/lines → report line; (ii) a statement line flagged "Stripe payout deposit" through layer 1 → payout layer → consumed sets; (iii) a dismissed finding staying dismissed across recompute AND across a nightly total change.

## 7. Out of scope / owner actions (report, don't build)

Spouse book W-2 question (unchanged, per-book treatment); tax rate 6% (flagged — Florida federal-only, ~25% typical; never changed by us); `bookkeeping_accountant_email` empty; `bookkeeping_home_office_percent` unset; first statement upload (zero expenses in prod); membership invoice revenue still not in the ledger (A-9 — warning stays honest); Gmail: coach must be connected in `/admin/inbox` and apply the "DJP Receipts" label, then flip `cron_bookkeeping_gmail_receipts_enabled` — and know that **body-only receipt emails don't import** (attach or photo-upload those); payout cron arrives with flag OFF — owner flips when ready; backfill scripts' Stripe clients left unpinned; confirm the Stripe **dashboard** default API version at leisure — the code pin governs request shapes and is behavior-neutral, but webhook event shapes follow the dashboard/endpoint setting, which we don't touch.

## 8. Build order + migrations

A (00191, apiVersion pin first commit) → B (00192) → C (00193) → D(ii) → D(iii) click-through last. Defer-from-the-back rule stands (C then B) but nothing currently blocks any track. Push held until the owner's go.

Process deliverables (kickoff contract, restated so the plan carries them): implementation plan(s) under `docs/superpowers/plans/`; subagent-driven development with a per-task adversarial review; the final whole-branch review per §6; JOURNAL + memory updates; a final report listing every autonomous decision (§5) + the owner-action list (§7).
