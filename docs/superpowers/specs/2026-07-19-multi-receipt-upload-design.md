# Multi-Receipt Upload with Batch Review — Design

**Date:** 2026-07-19
**Status:** Approved (owner: "lgtm")
**Extends:** AI Bookkeeper Phase 3 photo-receipt flow (`docs/superpowers/specs/2026-07-18-ai-bookkeeper-phase-3-design.md`)

## 1. Context and goal

Today the Upload-receipt dialog (`components/admin/bookkeeping/ReceiptUploadDialog.tsx`) accepts exactly one photo → one `receipt_scan` Firebase job → a single review card → one call to `/api/admin/bookkeeping/receipts/commit`. Filing a stack of receipts means repeating the whole dialog N times.

**Goal:** pick many receipt photos at once; AI reads them all; one consolidated, editable summary (sorted by date, with totals and duplicate flags) is shown **before anything posts**; one click posts the approved rows.

**Owner decisions (2026-07-19):**
- "Arrange" = each photo is one expense; sort by date, show totals, flag duplicates. NO multi-photo-receipt merging.
- Architecture = client-orchestrated fan-out of N existing `receipt_scan` jobs. NO new Firebase function, NO server batch job.

## 2. Non-goals

- Merging multiple photos of one long receipt into a single expense.
- Income receipts (flow stays expense-only, as today).
- New routes, migrations, feature flags, or `functions/` changes. Deploy is Vercel-only.
- Shared `import_batch_id` across the batch — each receipt keeps its own per-commit batch id exactly as today (YAGNI).
- PDF receipts (input stays JPG/PNG/WEBP).

## 3. UX flow — one path, not two

The dialog keeps its three phases (upload → scanning → review) but every phase becomes batch-aware. A single photo travels the same path and lands on a one-row review with the row auto-expanded — the current single-receipt review card is **absorbed** into the row editor, not kept as a second code path.

### 3.1 Upload phase
- File input gains `multiple`; same accept types (`image/jpeg,image/png,image/webp`), per-file 10 MB (existing route limit, unchanged).
- **Batch cap: 15 photos.** Selecting more keeps the first 15 and toasts which were dropped.
- After selection: thumbnail list with per-file remove (✕) and an "Add more" affordance (re-opens the picker, appends, dedupes by name+size).
- Primary button: "Upload & Scan" (label shows count when N>1, e.g. "Upload & Scan 7 receipts").

### 3.2 Scanning phase
- Files upload **sequentially** (concurrency 1) to the existing `POST /api/admin/bookkeeping/receipts/upload`. Sequential upload is load-bearing: it guarantees the route's `findDocumentBySha256` duplicate hint also catches identical files *within* the batch (file k's document exists before file k+1 is hashed).
- Each 202 response yields `{ jobId, documentId, duplicateUploadHint }`; the dialog attaches one RTDB listener per job (`ai_jobs/<jobId>`), exactly the listener logic used today. Scans run server-side in parallel while later uploads continue.
- Progress UI: aggregate header "Scanned 3 of 7" + per-receipt status list (queued → uploading → scanning → done / failed). The two-step per-job progress detail is dropped in batch view; only per-receipt status chips are shown.
- Each job is added to the AI-jobs dock as today, labeled "Receipt scan (3/7)".
- "Cancel remaining" cancels every in-flight job via the existing `POST /api/admin/programs/generate/cancel` (looped). Receipts already scanned proceed to review; cancelled/failed ones appear as manual-entry rows (§3.3). If nothing completed, the dialog resets to the upload phase.
- Dialog dismissal stays blocked while uploads/scans/posting are in flight (existing convention).

### 3.3 Batch review phase (the summary before approving)
- **Header strip:** receipt count, total $ of ticked rows, date range (min–max `occurred_on`), and badge counts for warnings and duplicates. Total recomputes live as rows are edited/ticked.
- **Rows, sorted by date ascending** (missing date defaults to today, as the single flow does; stable sort). Each collapsed row shows: include-checkbox, thumbnail, vendor, date, amount, category select value, confidence badge (low/medium/high), and warning/duplicate/error badges.
- **Expanding a row** reveals the full editor: signed-URL image preview (existing `documents/<id>/download` fetch, lazy per row on first expand) + the same editable fields and validation as today's card — amount, date, counterparty, expense-category select, business-purpose textarea with the `accountRequiresBusinessPurpose` requirement, AI-scanned reference values, per-result warnings, low-confidence banner. `safeReceiptResult` (RTDB null-drop coalescer) is applied per row at the listener boundary, unchanged.
- **When N=1** the single row starts expanded; the summary header still renders (harmless, shows the one total).
- **Duplicate flags (badged, never blocked):**
  1. *Already-uploaded / identical-in-batch:* the upload route's `duplicateUploadHint` (sha256 match against stored documents).
  2. *Within-batch lookalike:* client-side pure check — same normalized vendor (trim/case-insensitive) + same amount_cents + same occurred_on as an earlier row.
  Flagged rows start **unticked**; the badge states why ("Possible duplicate — uploaded 12 Jul" / "Matches receipt #3 in this batch").
- **Failed rows** (upload error, scan failed, scan cancelled): kept in the list as manual-entry rows — blank fields, error badge, image preview if the upload succeeded. Start unticked; user can fill fields by hand and tick, or leave them.
- **Footer:** "Post N receipts ($X.XX)" (N = ticked rows) + Cancel. Post is disabled while any ticked row is invalid (amount ≤ 0, no date, or missing required business purpose — the offending rows badge the reason).

### 3.4 Posting
- Sequential loop over ticked rows against the existing `POST /api/admin/bookkeeping/receipts/commit`, one call per row (same body as today, incl. `receiptSourceRef(documentId)`), with per-row status: spinner → posted ✓ (row locks) / inline error.
- Per-row failures (409 closed month, 422 missing purpose, 5xx) never block other rows. After a partial run the button becomes "Retry remaining (N)".
- When every ticked row has posted: success toast ("7 receipts posted — $312.40"), dialog closes, `onSaved()` fires.
- If the user closes after a partial post (some rows posted, some failed/unticked): posted entries persist; `onSaved()` fires if ≥1 row posted so the ledger refreshes. Unposted uploads remain as stored `kind:"receipt"` documents — the same abandoned-review state the single flow can already produce; the Phase-6 receipt watchdog covers unfiled receipts.

## 4. Architecture — what changes and what doesn't

**Unchanged (load-bearing constraint):** `receipts/upload` route, `receipts/commit` route, `functions/src/receipt-scan.ts`, RTDB/Firestore job plumbing, retention stamping, per-receipt audit rows, validators. All existing route tests stand.

**Changed/new (all client-side or pure lib):**

| Unit | Responsibility |
| --- | --- |
| `components/admin/bookkeeping/ReceiptUploadDialog.tsx` (rework) | Orchestration shell: file selection state, sequential upload loop, N RTDB listeners + teardown, per-receipt state machine, phase switching, cancel-remaining, post loop. |
| `components/admin/bookkeeping/ReceiptBatchReview.tsx` (new) | Presentational: summary header, row list, footer button states. Emits edit/tick/expand/post events; owns no server I/O. |
| `components/admin/bookkeeping/ReceiptRowEditor.tsx` (new) | Expanded row editor — absorbs today's single review card (fields, validation messages, warnings, confidence banner). Owns the lazy signed-URL preview fetch on first expand. |
| `lib/bookkeeping/receipt-batch.ts` (new, pure) | `detectWithinBatchDuplicates(rows)`, `batchTotals(rows)`, `sortReceiptRows(rows)`, `initialRowFromResult(result, accounts)` (wraps existing `reviewFormFromResult` + `resolveExpenseAccount` semantics). No React, no I/O. |

**Per-receipt state machine (client):** `queued → uploading → scanning → scanned | scan_failed | cancelled`, then in review `ready | posting | posted | post_failed`. One array of row objects keyed by a client-generated id; RTDB listeners write into it by jobId.

## 5. Error handling summary

| Failure | Behavior |
| --- | --- |
| File rejected by route (type/size/empty) | Row → `scan_failed` with the route's message; remaining files continue. |
| Upload network error | Same as above. |
| Scan job `failed` / RTDB listener error | Row → `scan_failed` ("Scan failed — enter details manually or leave unticked"); listener torn down. |
| RTDB null-dropped result fields | `safeReceiptResult` coalesces per row (existing helper, unchanged). |
| Commit 409 (closed month) / 422 (purpose) / 5xx | Inline on that row; other rows unaffected; "Retry remaining". |
| Cancel during scanning | In-flight jobs cancelled via existing cancel route; completed rows proceed to review; none completed → back to upload phase. |
| Dialog unmount | All listeners torn down (existing `stopListening` generalized to a map of refs). |

## 6. Testing

- **`__tests__/lib/bookkeeping/receipt-batch.test.ts` (new):** duplicate detection (vendor normalization, amount/date match, earlier-row attribution), totals (ticked-only, live edits), date sort incl. missing-date-defaults-today and stability, `initialRowFromResult` mapping incl. null-heavy results.
- **Component tests (new) for the dialog family:** multi-file selection + cap-at-15 + remove/add-more; sequential upload orchestration (mocked fetch) with a mid-batch upload failure; progress aggregation from mocked RTDB events; review rendering — sorted rows, header totals, dupe rows unticked with badges, N=1 auto-expand; post loop with one 422 row (others post, retry state); required-purpose gating disables Post. RTDB module mocked as in existing patterns; no real Firebase in tests.
- **Existing tests:** upload/commit route tests untouched (routes unchanged). There is no existing ReceiptUploadDialog component test to migrate.
- Suite baseline is fully green (3118/3118) — the gate is zero regressions plus the new files green, `npm run build` green. No root-side imports from `functions/src` are added, so the Vercel-condition build check is not triggered by this feature.

## 7. Open items

None — all decisions resolved above.
