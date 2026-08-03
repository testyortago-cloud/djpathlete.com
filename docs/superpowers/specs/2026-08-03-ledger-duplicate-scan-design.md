# Ledger Duplicate Scan — Design

**Date:** 2026-08-03
**Status:** Approved (placement + review actions confirmed by owner; autonomous build authorized)

## Goal

A **"Find duplicates"** button in the `/admin/books` toolbar. Clicking it scans the active
book's posted ledger, uses AI to judge which same-amount entry pairs are the same
real-world transaction recorded twice (receipt scan + statement import, double import,
manual + import, etc.), and opens a review dialog where the coach resolves each pair:
**delete one side** or **mark "not a duplicate"** (never resurfaces).

This is distinct from the existing import-time dedupe
(`lib/bookkeeping/statement-dedupe.ts`), which compares *incoming* rows against the
posted ledger. This feature is a **post-hoc scan of the posted ledger against itself**.

## Money-critical invariants

- The scan **never mutates anything**. Every deletion is an explicit per-entry click
  that goes through the existing audited `DELETE /api/admin/bookkeeping/entries/[id]`
  route (closed-period guard → 409 with `PERIOD_CLOSED_MESSAGE` intact).
- An AI verdict the model *omits* is treated as "needs human review" (pair kept,
  verdict null) — never silently dropped, never guessed
  (lesson: ai_tool_omitted_field_becomes_a_guess).
- AI failure/timeout degrades honestly: candidate pairs are still shown, badged
  "AI unavailable — heuristic match only" (insights-narrative fallback precedent).
- No feature flag: read-only compute + explicit manual deletes carries no
  money/mass-email risk (no_default_feature_flags).

## Architecture (mirrors insights pattern)

### 1. Pure module — `lib/bookkeeping/duplicate-scan.ts` (zero IO)

- `DuplicateScanEntry`: `{ id, occurred_on, amount_cents, direction, memo, source, account_id }`.
- `findCandidatePairs(entries, dismissedFingerprints, opts?)` →
  `{ pairs: CandidatePair[], truncated: boolean }`
  - Pair rule: **same direction + exact `amount_cents` + date gap ≤ 7 days** (window
    looser than import-time's 4 because post-hoc dupes can drift further apart).
  - Both directions scanned (double-counted income overstates tax).
  - Overlapping pairs allowed (A–B and A–C can both surface).
  - Pairs whose fingerprint is in the dismissed set are filtered **before** the AI
    call (dismissals gate display *and* spend).
  - Deterministic ordering `(occurred_on, id)`; capped at **40 pairs**, `truncated: true`
    beyond that.
  - Each pair annotated with `day_gap`, `same_source`, and
    `memo_similarity: "exact" | "similar" | "different" | "missing"` (reuses
    `normalizeDescription` from statement-parse; substring or token-Jaccard ≥ 0.5 —
    same thresholds as statement-dedupe). These annotations feed the AI prompt and
    the UI; they do NOT gate candidacy (the AI judges, the heuristic only pairs).
- `pairId(a, b)`: stable id for AI round-tripping = sorted entry-uuid join.

### 2. Fingerprint — extend `lib/bookkeeping/finding-fingerprint.ts`

- Add `"duplicate"` to `FinderKind`.
- Add `duplicatePairFingerprint(idA, idB)` → `duplicate:<sortedIdA>|<sortedIdB>`
  (identity only, no amounts — same rule as every other finder).
- Dismissals persist through the **existing** generic
  `POST /api/admin/bookkeeping/insights/dismissals` route +
  `bookkeeping_finding_dismissals` table (fingerprint is opaque there). **No migration.**

### 3. DAL — `listEntriesForDuplicateScan(bookId)` in `lib/db/bookkeeping.ts`

Selects only the scan columns for the whole book via the existing fetch-all pagination
helper (postgrest_1000_row_cap).

### 4. API route — `POST /api/admin/bookkeeping/duplicates/scan`

Body `{ book_id: uuid }` (zod). Admin self-gated (`/api/*` not in middleware). Flow:

1. Load entries + dismissed fingerprints → `findCandidatePairs`.
2. **Zero candidates → return immediately, no AI call, no spend.**
3. Otherwise: `callAgent` (Sonnet, `structuredOutputMode` already jsonTool in lib
   callAgent — ai_sdk_jsontool_mode), `withTimeout` 25s, compact pair JSON in, schema out:
   `{ verdicts: [{ pair_id, is_duplicate, confidence: "low"|"medium"|"high", reason }] }`.
   System prompt: duplicate-bookkeeping judge for a solo coach; two entries are
   duplicates only if they plausibly record the SAME transaction; differing sources
   with matching memos is the classic case; recurring same-amount charges
   (subscriptions) 5+ days apart with matching memos are usually NOT duplicates;
   output labeled AI-generated.
4. Spend logged to `ai_generation_log`
   (`input_params.feature: "bookkeeping_duplicate_scan"`, **no `generation_trigger`
   column** — narrative-route precedent).
5. Response `{ pairs, ai: "ok" | "skipped" | "unavailable", truncated }`, each pair
   `{ pair_id, a, b, day_gap, same_source, memo_similarity, verdict | null }`.
   - `ai: "ok"` → pairs the model cleared (`is_duplicate: false`) are filtered out;
     model-omitted pairs kept with `verdict: null`; unknown pair_ids ignored.
   - AI throw/timeout → `ai: "unavailable"`, ALL candidate pairs returned, verdicts null.
     Never a 500 for the AI leg.

### 5. UI — `components/admin/bookkeeping/DuplicateScanDialog.tsx` + BooksClient wiring

- Toolbar: `Find duplicates` button (ScanSearch icon) after the Amazon button;
  `dupScanOpen` state; dialog receives `bookId`, `accounts`, `onEntriesChanged={fetchEntries}`.
- On open → POST scan, loading state. Pairs sorted confidence (high→low, null last),
  then date.
- Pair card: two entry columns (date, formatted amount, memo, source badge, account
  name resolved from `accounts`), AI reason + confidence badge, day-gap note.
- Actions per pair:
  - **Delete** (one per side, confirm step) → existing DELETE entries route.
    Success: remove EVERY pair containing that entry id + `onEntriesChanged()`.
    409 → toast the closed-period message.
  - **Not a duplicate** → POST dismissals with `duplicatePairFingerprint`; remove pair.
- Empty scan → "No duplicate candidates found." `truncated` → note to re-scan after
  resolving. `ai: "unavailable"` → amber heuristic-only banner.

## Testing

- **Pure module** (`__tests__/lib/bookkeeping/duplicate-scan.test.ts`): pairs within
  window / rejects cross-direction, cross-amount, >7-day; overlapping pairs; dismissed
  filtering; deterministic order; 40-cap + truncated; memo-similarity levels;
  fingerprint stable under id order swap. Fixtures must discriminate mutations
  (distinct amounts/dates per case — tests_that_cannot_fail).
- **Route** (`__tests__/api/admin/bookkeeping/duplicates-scan.test.ts`, mocked
  callAgent, node env if needed): 403 non-admin; 400 bad body; zero-candidate
  short-circuit asserts callAgent NOT called; verdict mapping filters cleared pairs;
  omitted-pair → null verdict kept; AI throw → `unavailable` + all pairs; generation
  log written on both paths.
- **Dialog** (`__tests__/components/admin/bookkeeping/DuplicateScanDialog.test.tsx`):
  renders pairs; delete calls route, removes all pairs with that entry, fires
  `onEntriesChanged`; 409 shows period-closed toast; dismiss posts correct fingerprint;
  unavailable banner renders.

## Footprint

No migration. No `functions/` changes (Vercel-only deploy). No new flags. New: 1 pure
module, 1 DAL function, 1 API route, 1 dialog component, FinderKind extension,
BooksClient toolbar wiring, 3 test files.
