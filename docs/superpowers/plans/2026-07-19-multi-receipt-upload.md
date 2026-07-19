# Multi-Receipt Upload with Batch Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the coach upload up to 15 receipt photos at once; each fans out to an existing `receipt_scan` job; a consolidated, date-sorted, duplicate-flagged batch review with live totals gates posting; per-row posting through the existing commit route.

**Architecture:** Client-orchestrated fan-out (spec: `docs/superpowers/specs/2026-07-19-multi-receipt-upload-design.md`). Zero server changes — no new routes, no `functions/` changes, no migrations, no flags. New pure lib (`lib/bookkeeping/receipt-batch.ts`), new orchestration hook (`hooks/use-receipt-batch.ts`), two new components (`ReceiptBatchReview`, `ReceiptRowEditor`), and a rework of `ReceiptUploadDialog.tsx` that absorbs today's single-receipt card into the same batch path (N=1 auto-expands its one row).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, shadcn/ui, Firebase RTDB listeners (`firebase/database`), Vitest + Testing Library (jsdom default env).

## Global Constraints

- Semantic Tailwind classes only (`text-primary`, `bg-accent`, `--success`/`--error`/`--warning`); no hex, no inline `fontFamily`.
- No new npm dependencies.
- No root-side imports from `functions/src` (this feature adds none, keeping the Vercel-condition build irrelevant).
- Batch cap **15 photos**; per-file limit stays 10 MB (route-enforced, unchanged).
- Sequential uploads (concurrency 1) are **load-bearing**: they make the upload route's sha256 `duplicateUploadHint` catch identical files within the batch.
- Existing routes (`receipts/upload`, `receipts/commit`), `functions/src/receipt-scan.ts`, and all existing tests stay untouched.
- Commit directly to `main` (solo-dev convention). Never chain `npm run build` behind tests with `&&`.
- All tests run with `npx vitest run <paths>`; full gates in Task 6.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `lib/bookkeeping/receipt-batch.ts` | Create | Row model + pure helpers (zero IO, zero React): result coalescing, dupe detection, sorting, totals, validation. Receives `safeReceiptResult`/`resolveExpenseAccount`/`todayIso`/`ReceiptResult` moved out of the dialog. |
| `hooks/use-receipt-batch.ts` | Create | Orchestration state machine: file selection, sequential upload loop, N RTDB listeners + teardown, review transition, cancel-remaining, sequential post loop. |
| `components/admin/bookkeeping/ReceiptRowEditor.tsx` | Create | Expanded row editor (absorbs today's review card): fields, warnings, low-confidence banner, lazy signed-URL preview. |
| `components/admin/bookkeeping/ReceiptBatchReview.tsx` | Create | Presentational summary: header totals strip, row list with badges/checkboxes, footer post/retry button. No server IO. |
| `components/admin/bookkeeping/ReceiptUploadDialog.tsx` | Rework (Task 1 trims, Task 5 rewrites) | Dialog shell: phase rendering (select / scanning / review), file picker UI, dismissal blocking, toasts, `onSaved` semantics. Props unchanged → `BooksClient.tsx` untouched. |
| `__tests__/lib/bookkeeping/receipt-batch.test.ts` | Create | Unit tests for every pure helper. |
| `__tests__/hooks/use-receipt-batch.test.tsx` | Create | renderHook tests for the orchestration (mocked fetch + RTDB). |
| `__tests__/components/receipt-row-editor.test.tsx` | Create | Editor rendering/validation/preview tests. |
| `__tests__/components/receipt-batch-review.test.tsx` | Create | Summary/badges/footer-gating tests. |
| `__tests__/components/receipt-upload-dialog.test.tsx` | Create | Dialog phase-flow tests. |

Interfaces between tasks are pinned in each task's **Interfaces** block — implementers see only their own task.

---

### Task 1: Pure lib `lib/bookkeeping/receipt-batch.ts` + move shared helpers out of the dialog

**Files:**
- Create: `lib/bookkeeping/receipt-batch.ts`
- Test: `__tests__/lib/bookkeeping/receipt-batch.test.ts`
- Modify: `components/admin/bookkeeping/ReceiptUploadDialog.tsx` (delete local copies of moved helpers, import from the new lib — zero behavior change)

**Interfaces:**
- Consumes: `businessPurposeMissing` from `@/lib/bookkeeping/receipts` (exists), `BookkeepingAccount` from `@/types/database` (exists; helpers only read `id`, `name`, `account_type`, `requires_business_purpose`).
- Produces (later tasks import all of these from `@/lib/bookkeeping/receipt-batch`):
  - `MAX_BATCH_SIZE = 15`
  - `interface ReceiptResult` (exact shape currently private in the dialog)
  - `type ReceiptRowStatus = "queued" | "uploading" | "scanning" | "scanned" | "scan_failed" | "cancelled" | "posting" | "posted" | "post_failed"`
  - `interface ReceiptBatchRow` (see code)
  - `todayIso(): string`
  - `safeReceiptResult(v: unknown): ReceiptResult`
  - `resolveExpenseAccount(suggestedCategory: string | null, accounts: BookkeepingAccount[]): string`
  - `parseAmountCents(amount: string): number | null`
  - `newReceiptRow(clientId: string, fileName: string, thumbUrl: string | null): ReceiptBatchRow`
  - `applyScanResult(row: ReceiptBatchRow, raw: unknown, accounts: BookkeepingAccount[]): ReceiptBatchRow`
  - `detectWithinBatchDuplicates(rows: Pick<ReceiptBatchRow, "counterparty" | "amount" | "occurredOn">[]): (number | null)[]`
  - `sortReceiptRows<T extends Pick<ReceiptBatchRow, "occurredOn">>(rows: T[]): T[]`
  - `rowValidationError(row: ReceiptBatchRow, accounts: BookkeepingAccount[]): string | null`
  - `interface BatchTotals` + `batchTotals(rows: ReceiptBatchRow[]): BatchTotals`

- [ ] **Step 1: Write the failing test** — `__tests__/lib/bookkeeping/receipt-batch.test.ts`:

```tsx
import { describe, it, expect } from "vitest"
import {
  MAX_BATCH_SIZE,
  applyScanResult,
  batchTotals,
  detectWithinBatchDuplicates,
  newReceiptRow,
  parseAmountCents,
  resolveExpenseAccount,
  rowValidationError,
  safeReceiptResult,
  sortReceiptRows,
  type ReceiptBatchRow,
} from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

// Helpers only read id/name/account_type/requires_business_purpose — cast the rest away.
function acct(over: Partial<BookkeepingAccount>): BookkeepingAccount {
  return {
    id: "a1",
    name: "Meals",
    account_type: "expense",
    requires_business_purpose: false,
    ...over,
  } as BookkeepingAccount
}

function row(over: Partial<ReceiptBatchRow>): ReceiptBatchRow {
  return { ...newReceiptRow("c1", "r.jpg", null), ...over }
}

describe("MAX_BATCH_SIZE", () => {
  it("is 15 per the spec", () => {
    expect(MAX_BATCH_SIZE).toBe(15)
  })
})

describe("safeReceiptResult", () => {
  it("coalesces a fully null-dropped RTDB payload to explicit nulls", () => {
    expect(safeReceiptResult(undefined)).toEqual({
      vendor: null,
      amount_cents: null,
      occurred_on: null,
      suggested_category: null,
      business_purpose_hint: null,
      currency: null,
      confidence: "low",
      warnings: [],
    })
  })

  it("passes through a complete result and clamps bad confidence", () => {
    const r = safeReceiptResult({
      vendor: "Chevron",
      amount_cents: 4512,
      occurred_on: "2026-07-01",
      suggested_category: "Fuel",
      business_purpose_hint: "Drive to facility",
      currency: "usd",
      confidence: "bogus",
      warnings: ["glare"],
    })
    expect(r.vendor).toBe("Chevron")
    expect(r.amount_cents).toBe(4512)
    expect(r.confidence).toBe("low")
    expect(r.warnings).toEqual(["glare"])
  })
})

describe("resolveExpenseAccount", () => {
  const accounts = [
    acct({ id: "inc1", name: "Fuel", account_type: "income" }),
    acct({ id: "exp1", name: "Fuel" }),
  ]
  it("matches case-insensitively against expense accounts only", () => {
    expect(resolveExpenseAccount("  fUeL ", accounts)).toBe("exp1")
  })
  it("returns empty string (Uncategorized) with no match or null input", () => {
    expect(resolveExpenseAccount("Travel", accounts)).toBe("")
    expect(resolveExpenseAccount(null, accounts)).toBe("")
  })
})

describe("parseAmountCents", () => {
  it("parses dollars to positive cents", () => {
    expect(parseAmountCents("12.34")).toBe(1234)
    expect(parseAmountCents("0.5")).toBe(50)
  })
  it("rejects blank, zero, negative, and garbage", () => {
    expect(parseAmountCents("")).toBeNull()
    expect(parseAmountCents("  ")).toBeNull()
    expect(parseAmountCents("0")).toBeNull()
    expect(parseAmountCents("-3")).toBeNull()
    expect(parseAmountCents("abc")).toBeNull()
  })
})

describe("applyScanResult", () => {
  const accounts = [acct({ id: "exp1", name: "Fuel" })]
  it("maps a full result into form fields and marks the row scanned", () => {
    const out = applyScanResult(row({}), {
      vendor: "Chevron",
      amount_cents: 4512,
      occurred_on: "2026-07-01",
      suggested_category: "Fuel",
      business_purpose_hint: "Drive to facility",
      currency: "usd",
      confidence: "high",
      warnings: [],
    }, accounts)
    expect(out.status).toBe("scanned")
    expect(out.counterparty).toBe("Chevron")
    expect(out.amount).toBe("45.12")
    expect(out.occurredOn).toBe("2026-07-01")
    expect(out.accountId).toBe("exp1")
    expect(out.businessPurpose).toBe("Drive to facility")
    expect(out.result?.confidence).toBe("high")
  })
  it("defaults a null-heavy result to blank fields and today's date", () => {
    const out = applyScanResult(row({}), {}, accounts)
    expect(out.status).toBe("scanned")
    expect(out.counterparty).toBe("")
    expect(out.amount).toBe("")
    expect(out.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(out.accountId).toBe("")
  })
})

describe("detectWithinBatchDuplicates", () => {
  it("flags a later row matching an earlier row's vendor+amount+date, normalized", () => {
    const flags = detectWithinBatchDuplicates([
      { counterparty: "Chevron", amount: "45.12", occurredOn: "2026-07-01" },
      { counterparty: " chevron ", amount: "45.12", occurredOn: "2026-07-01" },
      { counterparty: "Chevron", amount: "45.12", occurredOn: "2026-07-02" },
    ])
    expect(flags).toEqual([null, 0, null])
  })
  it("never matches on blank vendor or invalid amount", () => {
    const flags = detectWithinBatchDuplicates([
      { counterparty: "", amount: "45.12", occurredOn: "2026-07-01" },
      { counterparty: "", amount: "45.12", occurredOn: "2026-07-01" },
      { counterparty: "Chevron", amount: "", occurredOn: "2026-07-01" },
      { counterparty: "Chevron", amount: "", occurredOn: "2026-07-01" },
    ])
    expect(flags).toEqual([null, null, null, null])
  })
})

describe("sortReceiptRows", () => {
  it("sorts by occurredOn ascending, stable on ties", () => {
    const rows = [
      { occurredOn: "2026-07-03", tag: "a" },
      { occurredOn: "2026-07-01", tag: "b" },
      { occurredOn: "2026-07-03", tag: "c" },
    ]
    expect(sortReceiptRows(rows).map((r) => (r as { tag: string }).tag)).toEqual(["b", "a", "c"])
  })
})

describe("rowValidationError", () => {
  const purposeAcct = acct({ id: "meals", name: "Meals", requires_business_purpose: true })
  it("requires a valid amount, then a date", () => {
    expect(rowValidationError(row({ amount: "" }), [])).toBe("Enter a valid amount")
    expect(rowValidationError(row({ amount: "10", occurredOn: "" }), [])).toBe("Pick a date")
  })
  it("requires business purpose only for flagged accounts", () => {
    const base = row({ amount: "10", occurredOn: "2026-07-01", accountId: "meals", businessPurpose: " " })
    expect(rowValidationError(base, [purposeAcct])).toBe("Business purpose required for this category")
    expect(rowValidationError({ ...base, businessPurpose: "Client dinner" }, [purposeAcct])).toBeNull()
    expect(rowValidationError({ ...base, accountId: "" }, [purposeAcct])).toBeNull()
  })
})

describe("batchTotals", () => {
  it("sums only included rows, tracks date range over all rows, counts warnings/dupes/posted", () => {
    const rows: ReceiptBatchRow[] = [
      row({ clientId: "1", included: true, amount: "10.00", occurredOn: "2026-07-02", status: "scanned" }),
      row({
        clientId: "2",
        included: false,
        amount: "5.00",
        occurredOn: "2026-07-01",
        duplicateUploadHint: "2026-07-10T00:00:00Z",
        status: "scanned",
      }),
      row({
        clientId: "3",
        included: true,
        amount: "2.50",
        occurredOn: "2026-07-05",
        status: "posted",
        result: {
          vendor: null,
          amount_cents: null,
          occurred_on: null,
          suggested_category: null,
          business_purpose_hint: null,
          currency: null,
          confidence: "low",
          warnings: ["glare", "crumpled"],
        },
      }),
    ]
    const t = batchTotals(rows)
    expect(t.rowCount).toBe(3)
    expect(t.includedCount).toBe(2)
    expect(t.includedTotalCents).toBe(1250)
    expect(t.minDate).toBe("2026-07-01")
    expect(t.maxDate).toBe("2026-07-05")
    expect(t.warningCount).toBe(2)
    expect(t.duplicateCount).toBe(1)
    expect(t.postedCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-batch.test.ts`
Expected: FAIL — cannot resolve `@/lib/bookkeeping/receipt-batch`.

- [ ] **Step 3: Implement `lib/bookkeeping/receipt-batch.ts`**

```ts
// Pure helpers + row model for the multi-receipt batch upload flow.
// Zero IO, zero React — everything here is unit-testable in isolation.
// safeReceiptResult / resolveExpenseAccount / todayIso / ReceiptResult moved
// here from ReceiptUploadDialog.tsx so the batch hook and components share
// one source of truth.
import { businessPurposeMissing } from "@/lib/bookkeeping/receipts"
import type { BookkeepingAccount } from "@/types/database"

export const MAX_BATCH_SIZE = 15

/** Shape of the completed job's `result` — mirrors ReceiptScanResult
 *  (functions/src/ai/receipt-schema.ts) field-for-field. */
export interface ReceiptResult {
  vendor: string | null
  amount_cents: number | null
  occurred_on: string | null
  suggested_category: string | null
  business_purpose_hint: string | null
  currency: string | null
  confidence: "low" | "medium" | "high"
  warnings: string[]
}

export type ReceiptRowStatus =
  | "queued"
  | "uploading"
  | "scanning"
  | "scanned"
  | "scan_failed"
  | "cancelled"
  | "posting"
  | "posted"
  | "post_failed"

export interface ReceiptBatchRow {
  /** Client-generated id — stable across sorting; RTDB listeners key on it. */
  clientId: string
  fileName: string
  status: ReceiptRowStatus
  jobId: string | null
  documentId: string | null
  /** ISO created_at of a same-sha256 document already in the book (upload route hint). */
  duplicateUploadHint: string | null
  /** Display index of the earlier batch row this one duplicates, else null. */
  withinBatchDupOf: number | null
  result: ReceiptResult | null
  included: boolean
  counterparty: string
  /** Dollars as typed, e.g. "45.12". */
  amount: string
  /** yyyy-mm-dd. Defaults to today when the scan found no date. */
  occurredOn: string
  /** "" = Uncategorized. */
  accountId: string
  businessPurpose: string
  error: string | null
  /** Signed download URL, cached after the row editor's first fetch. */
  previewUrl: string | null
  /** Local object URL of the picked file (thumbnail; preview fallback). */
  thumbUrl: string | null
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Firebase RTDB drops empty arrays AND `null` leaf values, so a blurry-photo
 *  result with every field null may come back missing those keys entirely.
 *  Coalesce it back to an explicit-null shape — the single boundary where
 *  RTDB-shaped data enters the client. */
export function safeReceiptResult(v: unknown): ReceiptResult {
  const r = (v ?? {}) as Partial<ReceiptResult>
  return {
    vendor: r.vendor ?? null,
    amount_cents: typeof r.amount_cents === "number" ? r.amount_cents : null,
    occurred_on: r.occurred_on ?? null,
    suggested_category: r.suggested_category ?? null,
    business_purpose_hint: r.business_purpose_hint ?? null,
    currency: r.currency ?? null,
    confidence: r.confidence === "medium" || r.confidence === "high" ? r.confidence : "low",
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
  }
}

/** Case-insensitive match against an expense account — receipts always post
 *  as direction:"expense". Falls back to "" (Uncategorized) with no match. */
export function resolveExpenseAccount(suggestedCategory: string | null, accounts: BookkeepingAccount[]): string {
  if (!suggestedCategory) return ""
  const needle = suggestedCategory.trim().toLowerCase()
  const match = accounts.find((a) => a.account_type === "expense" && a.name.trim().toLowerCase() === needle)
  return match?.id ?? ""
}

/** "45.12" → 4512; null for blank/zero/negative/garbage. */
export function parseAmountCents(amount: string): number | null {
  if (!amount.trim()) return null
  const cents = Math.round(parseFloat(amount) * 100)
  return Number.isFinite(cents) && cents > 0 ? cents : null
}

export function newReceiptRow(clientId: string, fileName: string, thumbUrl: string | null): ReceiptBatchRow {
  return {
    clientId,
    fileName,
    status: "queued",
    jobId: null,
    documentId: null,
    duplicateUploadHint: null,
    withinBatchDupOf: null,
    result: null,
    included: false,
    counterparty: "",
    amount: "",
    occurredOn: todayIso(),
    accountId: "",
    businessPurpose: "",
    error: null,
    previewUrl: null,
    thumbUrl,
  }
}

/** Fold a completed scan's raw RTDB result into the row's editable fields. */
export function applyScanResult(
  row: ReceiptBatchRow,
  raw: unknown,
  accounts: BookkeepingAccount[],
): ReceiptBatchRow {
  const result = safeReceiptResult(raw)
  return {
    ...row,
    status: "scanned",
    result,
    counterparty: result.vendor ?? "",
    amount: result.amount_cents != null ? (result.amount_cents / 100).toString() : "",
    occurredOn: result.occurred_on ?? todayIso(),
    accountId: resolveExpenseAccount(result.suggested_category, accounts),
    businessPurpose: result.business_purpose_hint ?? "",
    error: null,
  }
}

/** For each row, the index of the EARLIER row it duplicates (normalized
 *  vendor + cents + date), else null. Blank vendor / invalid amount never match. */
export function detectWithinBatchDuplicates(
  rows: Pick<ReceiptBatchRow, "counterparty" | "amount" | "occurredOn">[],
): (number | null)[] {
  const seen = new Map<string, number>()
  return rows.map((row, i) => {
    const vendor = row.counterparty.trim().toLowerCase()
    const cents = parseAmountCents(row.amount)
    if (!vendor || cents == null || !row.occurredOn) return null
    const key = `${vendor}|${cents}|${row.occurredOn}`
    const earlier = seen.get(key)
    if (earlier != null) return earlier
    seen.set(key, i)
    return null
  })
}

/** occurredOn ascending; Array.prototype.sort is stable so ties keep upload order. */
export function sortReceiptRows<T extends Pick<ReceiptBatchRow, "occurredOn">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))
}

export function rowValidationError(row: ReceiptBatchRow, accounts: BookkeepingAccount[]): string | null {
  if (parseAmountCents(row.amount) == null) return "Enter a valid amount"
  if (!row.occurredOn) return "Pick a date"
  const account = accounts.find((a) => a.id === row.accountId)
  if (account && businessPurposeMissing(account, row.businessPurpose)) {
    return "Business purpose required for this category"
  }
  return null
}

export interface BatchTotals {
  rowCount: number
  includedCount: number
  includedTotalCents: number
  minDate: string | null
  maxDate: string | null
  warningCount: number
  duplicateCount: number
  postedCount: number
}

export function batchTotals(rows: ReceiptBatchRow[]): BatchTotals {
  let includedCount = 0
  let includedTotalCents = 0
  let warningCount = 0
  let duplicateCount = 0
  let postedCount = 0
  let minDate: string | null = null
  let maxDate: string | null = null
  for (const row of rows) {
    if (row.included) {
      includedCount++
      includedTotalCents += parseAmountCents(row.amount) ?? 0
    }
    if (row.status === "posted") postedCount++
    warningCount += row.result?.warnings.length ?? 0
    if (row.duplicateUploadHint != null || row.withinBatchDupOf != null) duplicateCount++
    if (row.occurredOn) {
      if (minDate == null || row.occurredOn < minDate) minDate = row.occurredOn
      if (maxDate == null || row.occurredOn > maxDate) maxDate = row.occurredOn
    }
  }
  return { rowCount: rows.length, includedCount, includedTotalCents, minDate, maxDate, warningCount, duplicateCount, postedCount }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-batch.test.ts`
Expected: PASS (all describes green).

- [ ] **Step 5: De-duplicate the dialog.** In `components/admin/bookkeeping/ReceiptUploadDialog.tsx`: delete the local `interface ReceiptResult` (lines ~49-58), `todayIso` (~81-83), `safeReceiptResult` (~96-113), and `resolveExpenseAccount` (~115-122) definitions, and add:

```ts
import {
  safeReceiptResult,
  resolveExpenseAccount,
  todayIso,
  type ReceiptResult,
} from "@/lib/bookkeeping/receipt-batch"
```

Leave `reviewFormFromResult`, `mapProgressToStep`, and everything else untouched — identical behavior, one source of truth. (Task 5 rewrites this file wholesale; this step just keeps the interim tree DRY.)

- [ ] **Step 6: Verify types + existing receipts tests**

Run: `npx tsc --noEmit 2>&1 | grep -E "receipt-batch|ReceiptUploadDialog"`
Expected: no output (no errors in these files).
Run: `npx vitest run __tests__/lib/bookkeeping/receipts.test.ts __tests__/lib/bookkeeping/receipt-batch.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/bookkeeping/receipt-batch.ts __tests__/lib/bookkeeping/receipt-batch.test.ts components/admin/bookkeeping/ReceiptUploadDialog.tsx
git commit -m "feat(bookkeeper): receipt-batch pure lib — row model, dupe detection, totals, validation"
```

---

### Task 2: Orchestration hook `hooks/use-receipt-batch.ts`

**Files:**
- Create: `hooks/use-receipt-batch.ts`
- Test: `__tests__/hooks/use-receipt-batch.test.tsx`

**Interfaces:**
- Consumes (from Task 1, all via `@/lib/bookkeeping/receipt-batch`): `MAX_BATCH_SIZE`, `ReceiptBatchRow`, `newReceiptRow`, `applyScanResult`, `detectWithinBatchDuplicates`, `sortReceiptRows`, `parseAmountCents`, `rowValidationError`. Also `receiptSourceRef` from `@/lib/bookkeeping/receipts`, `summarizeApiError` from `@/lib/errors/humanize`, `useAiJobsDock` from `@/hooks/use-ai-jobs-dock`, `rtdb` from `@/lib/firebase`, `ref`/`onValue`/`off` from `firebase/database`.
- Produces (Task 5 consumes):

```ts
export type BatchPhase = "select" | "scanning" | "review"
export interface UseReceiptBatchArgs {
  bookId: string
  accounts: BookkeepingAccount[]
  onAllPosted: (postedCount: number, totalCents: number) => void
}
export function useReceiptBatch(args: UseReceiptBatchArgs): {
  phase: BatchPhase
  files: File[]
  rows: ReceiptBatchRow[]
  uploading: boolean
  posting: boolean
  cancelling: boolean
  postedCount: number
  busy: boolean
  addFiles: (incoming: FileList | File[]) => { dropped: string[] }
  removeFile: (index: number) => void
  startScan: () => Promise<void>
  cancelRemaining: () => Promise<void>
  updateRow: (clientId: string, patch: Partial<ReceiptBatchRow>) => void
  postIncluded: () => Promise<void>
  reset: () => void
}
```

Behavioral contract (all tested below):
- `addFiles` appends, dedupes by name+size, caps at `MAX_BATCH_SIZE`, returns dropped names.
- `startScan` uploads **sequentially** to `POST /api/admin/bookkeeping/receipts/upload` (FormData `file` + `book_id`); per row: 202 → status `scanning` + jobId/documentId/duplicateUploadHint + dock `addJob({kind:"receipt_scan", label})` (label `Receipt scan` when N=1, else `Receipt scan (k/N)`) + RTDB `onValue` on `ai_jobs/<jobId>`; non-OK/network → `scan_failed` with message, loop continues.
- Listener: `completed` → `applyScanResult`; `failed` → `scan_failed`; `cancelled` → `cancelled`; listener error → `scan_failed` "Lost connection to scan updates". Listener detaches on any terminal event.
- When the upload loop is done and every row is terminal (`scanned | scan_failed | cancelled`): if any row scanned OR any scan_failed row has a stored document → rows are sorted by date, within-batch dupes stamped, `included` defaulted to `scanned && no dupe flags`, phase → `review`. Otherwise phase → `select` (files kept).
- `cancelRemaining` sets a flag that makes still-queued uploads skip to `cancelled` and POSTs `/api/admin/programs/generate/cancel` per in-flight jobId.
- `postIncluded` loops included non-posted rows **sequentially** against `POST /api/admin/bookkeeping/receipts/commit` (same body as the single flow, `source_ref: receiptSourceRef(documentId)`); no documentId → `post_failed` "Upload failed — nothing stored to post"; client validation failure → `post_failed` with the validation message; 422 → `post_failed` with the server's error string; other non-OK → `post_failed` with `summarizeApiError` message. Zero failures and ≥1 newly posted → `onAllPosted(totalPostedCount, totalPostedCents)` (cumulative across retries).
- `reset` tears down listeners, revokes thumb object URLs, restores initial state.
- `busy` = uploading || posting || cancelling || (phase "scanning" with any non-terminal row).

- [ ] **Step 1: Write the failing test** — `__tests__/hooks/use-receipt-batch.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"

const listeners = new Map<string, { cb: (snap: { val: () => unknown }) => void; err: (e: unknown) => void }>()
const offSpy = vi.fn()
vi.mock("@/lib/firebase", () => ({ rtdb: {} }))
vi.mock("firebase/database", () => ({
  ref: vi.fn((_db: unknown, path: string) => ({ path })),
  onValue: vi.fn(
    (r: { path: string }, cb: (snap: { val: () => unknown }) => void, err: (e: unknown) => void) => {
      listeners.set(r.path, { cb, err })
    },
  ),
  off: (...args: unknown[]) => offSpy(...args),
}))
const addJobSpy = vi.fn()
vi.mock("@/hooks/use-ai-jobs-dock", () => ({ useAiJobsDock: () => ({ addJob: addJobSpy }) }))

import { useReceiptBatch } from "@/hooks/use-receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

const accounts = [
  { id: "exp1", name: "Fuel", account_type: "expense", requires_business_purpose: false },
] as BookkeepingAccount[]

function makeFile(name: string, bytes = [1, 2, 3]): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" })
}

function fireJob(jobId: string, payload: unknown) {
  const l = listeners.get(`ai_jobs/${jobId}`)
  if (!l) throw new Error(`no listener for ${jobId}`)
  act(() => l.cb({ val: () => payload }))
}

const fetchMock = vi.fn()

beforeEach(() => {
  listeners.clear()
  offSpy.mockClear()
  addJobSpy.mockClear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  URL.createObjectURL = vi.fn(() => "blob:mock") as never
  URL.revokeObjectURL = vi.fn() as never
})

function uploadOk(jobId: string, documentId: string, duplicateUploadHint: string | null = null) {
  return { ok: true, status: 202, json: async () => ({ jobId, documentId, duplicateUploadHint }) }
}

function renderBatch(onAllPosted = vi.fn()) {
  const hook = renderHook(() => useReceiptBatch({ bookId: "b1", accounts, onAllPosted }))
  return { hook, onAllPosted }
}

describe("addFiles", () => {
  it("dedupes by name+size and caps at 15, reporting dropped names", () => {
    const { hook } = renderBatch()
    const sixteen = Array.from({ length: 16 }, (_, i) => makeFile(`r${i}.jpg`))
    let dropped: string[] = []
    act(() => {
      dropped = hook.result.current.addFiles(sixteen).dropped
    })
    expect(hook.result.current.files).toHaveLength(15)
    expect(dropped).toEqual(["r15.jpg"])
    act(() => {
      dropped = hook.result.current.addFiles([makeFile("r0.jpg")]).dropped
    })
    expect(hook.result.current.files).toHaveLength(15) // duplicate silently skipped
  })
})

describe("startScan + review transition", () => {
  it("uploads sequentially, listens per job, and enters review sorted with dupes unticked", async () => {
    const { hook } = renderBatch()
    fetchMock
      .mockResolvedValueOnce(uploadOk("j1", "d1"))
      .mockResolvedValueOnce(uploadOk("j2", "d2", "2026-07-10T00:00:00Z"))
    act(() => {
      hook.result.current.addFiles([makeFile("late.jpg"), makeFile("early.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    expect(hook.result.current.phase).toBe("scanning")
    expect(addJobSpy).toHaveBeenCalledTimes(2)
    expect(addJobSpy.mock.calls[0][0].label).toBe("Receipt scan (1/2)")

    fireJob("j1", {
      status: "completed",
      result: { vendor: "Chevron", amount_cents: 4512, occurred_on: "2026-07-05", confidence: "high" },
    })
    fireJob("j2", {
      status: "completed",
      result: { vendor: "HEB", amount_cents: 2000, occurred_on: "2026-07-01", confidence: "high" },
    })

    await waitFor(() => expect(hook.result.current.phase).toBe("review"))
    const rows = hook.result.current.rows
    expect(rows.map((r) => r.counterparty)).toEqual(["HEB", "Chevron"]) // date-ascending
    expect(rows[0].included).toBe(false) // duplicateUploadHint → starts unticked
    expect(rows[1].included).toBe(true)
    expect(hook.result.current.busy).toBe(false)
  })

  it("keeps going past a failed upload and marks that row scan_failed", async () => {
    const { hook } = renderBatch()
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "Invalid file type" }) })
      .mockResolvedValueOnce(uploadOk("j2", "d2"))
    act(() => {
      hook.result.current.addFiles([makeFile("bad.txt"), makeFile("good.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    fireJob("j2", { status: "completed", result: { vendor: "HEB", amount_cents: 2000, occurred_on: "2026-07-01" } })
    await waitFor(() => expect(hook.result.current.phase).toBe("review"))
    const failed = hook.result.current.rows.find((r) => r.fileName === "bad.txt")
    expect(failed?.status).toBe("scan_failed")
    expect(failed?.included).toBe(false)
  })

  it("falls back to select when nothing scanned and nothing stored", async () => {
    const { hook } = renderBatch()
    fetchMock.mockRejectedValueOnce(new Error("network"))
    act(() => {
      hook.result.current.addFiles([makeFile("a.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    await waitFor(() => expect(hook.result.current.phase).toBe("select"))
    expect(hook.result.current.files).toHaveLength(1) // kept for retry
  })

  it("routes scan failure and listener error to scan_failed", async () => {
    const { hook } = renderBatch()
    fetchMock.mockResolvedValueOnce(uploadOk("j1", "d1")).mockResolvedValueOnce(uploadOk("j2", "d2"))
    act(() => {
      hook.result.current.addFiles([makeFile("a.jpg"), makeFile("b.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    fireJob("j1", { status: "failed", error: "Model refused" })
    act(() => listeners.get("ai_jobs/j2")!.err(new Error("boom")))
    await waitFor(() => expect(hook.result.current.phase).toBe("review")) // d1/d2 stored → manual rows
    const [a, b] = hook.result.current.rows
    expect(a.status).toBe("scan_failed")
    expect(a.error).toBe("Model refused")
    expect(b.status).toBe("scan_failed")
    expect(b.error).toBe("Lost connection to scan updates")
  })
})

describe("cancelRemaining", () => {
  it("cancels in-flight jobs via the cancel route", async () => {
    const { hook } = renderBatch()
    fetchMock.mockResolvedValueOnce(uploadOk("j1", "d1"))
    act(() => {
      hook.result.current.addFiles([makeFile("a.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    await act(async () => {
      await hook.result.current.cancelRemaining()
    })
    const cancelCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/generate/cancel"))
    expect(cancelCall).toBeTruthy()
    expect(JSON.parse((cancelCall![1] as RequestInit).body as string)).toEqual({ jobId: "j1" })
    fireJob("j1", { status: "cancelled" })
    await waitFor(() => expect(hook.result.current.phase).toBe("review")) // d1 stored → manual row
    expect(hook.result.current.rows[0].status).toBe("cancelled")
  })
})

describe("postIncluded", () => {
  async function toReview(hook: ReturnType<typeof renderBatch>["hook"]) {
    fetchMock.mockResolvedValueOnce(uploadOk("j1", "d1")).mockResolvedValueOnce(uploadOk("j2", "d2"))
    act(() => {
      hook.result.current.addFiles([makeFile("a.jpg"), makeFile("b.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    fireJob("j1", {
      status: "completed",
      result: { vendor: "Chevron", amount_cents: 4512, occurred_on: "2026-07-01", suggested_category: "Fuel" },
    })
    fireJob("j2", {
      status: "completed",
      result: { vendor: "HEB", amount_cents: 2000, occurred_on: "2026-07-02", suggested_category: "Fuel" },
    })
    await waitFor(() => expect(hook.result.current.phase).toBe("review"))
  }

  it("posts included rows sequentially and fires onAllPosted with count + cents", async () => {
    const { hook, onAllPosted } = renderBatch()
    await toReview(hook)
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
    await act(async () => {
      await hook.result.current.postIncluded()
    })
    const commits = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/receipts/commit"))
    expect(commits).toHaveLength(2)
    const firstBody = JSON.parse((commits[0][1] as RequestInit).body as string)
    expect(firstBody.document_id).toBe("d1")
    expect(firstBody.amount_cents).toBe(4512)
    expect(firstBody.source_ref).toBe("receipt:d1")
    expect(firstBody.account_id).toBe("exp1")
    expect(hook.result.current.rows.every((r) => r.status === "posted")).toBe(true)
    expect(onAllPosted).toHaveBeenCalledWith(2, 6512)
    expect(hook.result.current.postedCount).toBe(2)
  })

  it("a 422 row fails inline without blocking others; retry completes and fires onAllPosted cumulatively", async () => {
    const { hook, onAllPosted } = renderBatch()
    await toReview(hook)
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: "business_purpose required for this category" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
    await act(async () => {
      await hook.result.current.postIncluded()
    })
    expect(onAllPosted).not.toHaveBeenCalled()
    const failed = hook.result.current.rows.find((r) => r.status === "post_failed")
    expect(failed?.error).toBe("business_purpose required for this category")
    expect(hook.result.current.rows.filter((r) => r.status === "posted")).toHaveLength(1)
    expect(hook.result.current.postedCount).toBe(1)

    act(() => {
      hook.result.current.updateRow(failed!.clientId, { businessPurpose: "Team fuel" })
    })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
    await act(async () => {
      await hook.result.current.postIncluded()
    })
    expect(onAllPosted).toHaveBeenCalledWith(2, 6512)
  })

  it("client-invalid rows fail without hitting the network", async () => {
    const { hook } = renderBatch()
    await toReview(hook)
    const target = hook.result.current.rows[0]
    act(() => {
      hook.result.current.updateRow(target.clientId, { amount: "" })
    })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
    await act(async () => {
      await hook.result.current.postIncluded()
    })
    const commits = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/receipts/commit"))
    expect(commits).toHaveLength(1) // only the valid row
    expect(hook.result.current.rows.find((r) => r.clientId === target.clientId)?.error).toBe("Enter a valid amount")
  })
})

describe("reset", () => {
  it("detaches listeners and revokes thumbnails", async () => {
    const { hook } = renderBatch()
    fetchMock.mockResolvedValueOnce(uploadOk("j1", "d1"))
    act(() => {
      hook.result.current.addFiles([makeFile("a.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    act(() => {
      hook.result.current.reset()
    })
    expect(offSpy).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock")
    expect(hook.result.current.phase).toBe("select")
    expect(hook.result.current.files).toHaveLength(0)
    expect(hook.result.current.rows).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/hooks/use-receipt-batch.test.tsx`
Expected: FAIL — cannot resolve `@/hooks/use-receipt-batch`.

- [ ] **Step 3: Implement `hooks/use-receipt-batch.ts`**

```ts
"use client"

// Orchestration state machine for the multi-receipt batch flow. All server
// contracts here are the EXISTING single-receipt routes — this hook only
// fans them out and aggregates state. Pure decisions (dupes, sorting,
// validation, totals) live in lib/bookkeeping/receipt-batch.ts.
import { useCallback, useEffect, useRef, useState } from "react"
import { ref, onValue, off } from "firebase/database"
import { rtdb } from "@/lib/firebase"
import { useAiJobsDock } from "@/hooks/use-ai-jobs-dock"
import { summarizeApiError } from "@/lib/errors/humanize"
import { receiptSourceRef } from "@/lib/bookkeeping/receipts"
import {
  MAX_BATCH_SIZE,
  applyScanResult,
  detectWithinBatchDuplicates,
  newReceiptRow,
  parseAmountCents,
  rowValidationError,
  sortReceiptRows,
  type ReceiptBatchRow,
} from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

export type BatchPhase = "select" | "scanning" | "review"

export interface UseReceiptBatchArgs {
  bookId: string
  accounts: BookkeepingAccount[]
  /** Fired once when every included row has posted (cumulative count + cents). */
  onAllPosted: (postedCount: number, totalCents: number) => void
}

const TERMINAL_SCAN: ReceiptBatchRow["status"][] = ["scanned", "scan_failed", "cancelled"]

function makeThumbUrl(file: File): string | null {
  try {
    return typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : null
  } catch {
    return null
  }
}

export function useReceiptBatch({ bookId, accounts, onAllPosted }: UseReceiptBatchArgs) {
  const { addJob } = useAiJobsDock()

  const [phase, setPhase] = useState<BatchPhase>("select")
  const [files, setFiles] = useState<File[]>([])
  const [rows, setRows] = useState<ReceiptBatchRow[]>([])
  const [uploading, setUploading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [postedCount, setPostedCount] = useState(0)

  // Refs so RTDB callbacks and the post loop never read stale closures.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const accountsRef = useRef(accounts)
  accountsRef.current = accounts
  const listenersRef = useRef(new Map<string, ReturnType<typeof ref>>())
  const cancelRequestedRef = useRef(false)

  function patchRow(clientId: string, patch: Partial<ReceiptBatchRow>) {
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)))
  }

  function stopJob(jobId: string) {
    const jobRef = listenersRef.current.get(jobId)
    if (jobRef) {
      off(jobRef)
      listenersRef.current.delete(jobId)
    }
  }

  function stopAllListeners() {
    for (const jobRef of listenersRef.current.values()) off(jobRef)
    listenersRef.current.clear()
  }

  useEffect(() => () => stopAllListeners(), [])

  const addFiles = useCallback(
    (incoming: FileList | File[]): { dropped: string[] } => {
      const dropped: string[] = []
      const next = [...files]
      for (const f of Array.from(incoming)) {
        if (next.some((e) => e.name === f.name && e.size === f.size)) continue
        if (next.length >= MAX_BATCH_SIZE) {
          dropped.push(f.name)
          continue
        }
        next.push(f)
      }
      setFiles(next)
      return { dropped }
    },
    [files],
  )

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  function listenToJob(clientId: string, jobId: string) {
    const jobRef = ref(rtdb, `ai_jobs/${jobId}`)
    listenersRef.current.set(jobId, jobRef)
    onValue(
      jobRef,
      (snapshot) => {
        const jobData = snapshot.val() as
          | { status?: string; result?: unknown; error?: string }
          | null
        if (!jobData) return
        if (jobData.status === "completed") {
          stopJob(jobId)
          setRows((prev) =>
            prev.map((r) =>
              r.clientId === clientId ? applyScanResult(r, jobData.result, accountsRef.current) : r,
            ),
          )
        } else if (jobData.status === "failed") {
          stopJob(jobId)
          patchRow(clientId, {
            status: "scan_failed",
            error: typeof jobData.error === "string" && jobData.error ? jobData.error : "Scan failed",
          })
        } else if (jobData.status === "cancelled") {
          stopJob(jobId)
          patchRow(clientId, { status: "cancelled", error: "Scan cancelled" })
        }
      },
      () => {
        stopJob(jobId)
        patchRow(clientId, { status: "scan_failed", error: "Lost connection to scan updates" })
      },
    )
  }

  const startScan = useCallback(
    async () => {
      if (files.length === 0) return
      cancelRequestedRef.current = false
      const initial = files.map((f) => newReceiptRow(crypto.randomUUID(), f.name, makeThumbUrl(f)))
      setRows(initial)
      setPhase("scanning")
      setUploading(true)
      // Sequential on purpose: file k's document exists before file k+1 is
      // hashed, so the route's sha256 hint also catches within-batch dupes.
      for (let i = 0; i < files.length; i++) {
        const { clientId } = initial[i]
        if (cancelRequestedRef.current) {
          patchRow(clientId, { status: "cancelled", error: "Scan cancelled" })
          continue
        }
        patchRow(clientId, { status: "uploading" })
        try {
          const fd = new FormData()
          fd.append("file", files[i])
          fd.append("book_id", bookId)
          const res = await fetch("/api/admin/bookkeeping/receipts/upload", { method: "POST", body: fd })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data.jobId) {
            const { message } = summarizeApiError(res, data, "Upload failed")
            patchRow(clientId, { status: "scan_failed", error: message })
            continue
          }
          const jobId = String(data.jobId)
          patchRow(clientId, {
            status: "scanning",
            jobId,
            documentId: typeof data.documentId === "string" ? data.documentId : null,
            duplicateUploadHint: data.duplicateUploadHint ? String(data.duplicateUploadHint) : null,
          })
          addJob({
            jobId,
            kind: "receipt_scan",
            label: files.length === 1 ? "Receipt scan" : `Receipt scan (${i + 1}/${files.length})`,
          })
          listenToJob(clientId, jobId)
        } catch {
          patchRow(clientId, { status: "scan_failed", error: "Upload failed — network error" })
        }
      }
      setUploading(false)
    },
    // listenToJob/patchRow are stable module-pattern fns using refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, bookId, addJob],
  )

  // When the upload loop is done and every row reached a terminal scan state,
  // enter review — or fall back to select when there is nothing reviewable
  // (nothing scanned AND nothing stored to post manually).
  useEffect(() => {
    if (phase !== "scanning" || uploading || rows.length === 0) return
    if (!rows.every((r) => TERMINAL_SCAN.includes(r.status))) return
    const reviewable =
      rows.some((r) => r.status === "scanned") ||
      rows.some((r) => r.status !== "scanned" && r.documentId != null)
    if (reviewable) {
      setRows((prev) => {
        const sorted = sortReceiptRows(prev)
        const dups = detectWithinBatchDuplicates(sorted)
        return sorted.map((r, i) => ({
          ...r,
          withinBatchDupOf: dups[i],
          included: r.status === "scanned" && dups[i] == null && r.duplicateUploadHint == null,
        }))
      })
      setPhase("review")
    } else {
      setPhase("select")
    }
  }, [phase, uploading, rows])

  const cancelRemaining = useCallback(async () => {
    if (cancelling) return
    setCancelling(true)
    cancelRequestedRef.current = true
    const inFlight = rowsRef.current.filter((r) => r.status === "scanning" && r.jobId)
    for (const row of inFlight) {
      try {
        await fetch("/api/admin/programs/generate/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: row.jobId }),
        })
      } catch {
        // Job keeps running server-side; its listener will still resolve the row.
      }
    }
    setCancelling(false)
  }, [cancelling])

  const updateRow = useCallback((clientId: string, patch: Partial<ReceiptBatchRow>) => {
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)))
  }, [])

  const postIncluded = useCallback(
    async () => {
      if (posting) return
      setPosting(true)
      const alreadyPosted = rowsRef.current.filter((r) => r.status === "posted")
      const target = rowsRef.current.filter((r) => r.included && r.status !== "posted")
      let newlyPosted = 0
      let newlyPostedCents = 0
      let failures = 0
      for (const row of target) {
        if (!row.documentId) {
          patchRow(row.clientId, { status: "post_failed", error: "Upload failed — nothing stored to post" })
          failures++
          continue
        }
        const invalid = rowValidationError(row, accountsRef.current)
        if (invalid) {
          patchRow(row.clientId, { status: "post_failed", error: invalid })
          failures++
          continue
        }
        const cents = parseAmountCents(row.amount) as number
        patchRow(row.clientId, { status: "posting", error: null })
        try {
          const res = await fetch("/api/admin/bookkeeping/receipts/commit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              book_id: bookId,
              document_id: row.documentId,
              account_id: row.accountId || null,
              amount_cents: cents,
              occurred_on: row.occurredOn,
              counterparty: row.counterparty.trim() || null,
              business_purpose: row.businessPurpose.trim() || null,
              memo: null,
              source_ref: receiptSourceRef(row.documentId),
            }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            const { message } = summarizeApiError(res, data, "Failed to post receipt")
            patchRow(row.clientId, {
              status: "post_failed",
              error: res.status === 422 && typeof data.error === "string" ? data.error : message,
            })
            failures++
            continue
          }
          newlyPosted++
          newlyPostedCents += cents
          patchRow(row.clientId, { status: "posted", error: null })
        } catch {
          patchRow(row.clientId, { status: "post_failed", error: "Network error — retry" })
          failures++
        }
      }
      setPosting(false)
      setPostedCount(alreadyPosted.length + newlyPosted)
      if (failures === 0 && newlyPosted > 0) {
        const priorCents = alreadyPosted.reduce((sum, r) => sum + (parseAmountCents(r.amount) ?? 0), 0)
        onAllPosted(alreadyPosted.length + newlyPosted, priorCents + newlyPostedCents)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posting, bookId, onAllPosted],
  )

  const reset = useCallback(() => {
    stopAllListeners()
    cancelRequestedRef.current = false
    for (const row of rowsRef.current) {
      if (row.thumbUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        try {
          URL.revokeObjectURL(row.thumbUrl)
        } catch {
          // noop — object URL may already be gone
        }
      }
    }
    setFiles([])
    setRows([])
    setPhase("select")
    setUploading(false)
    setPosting(false)
    setCancelling(false)
    setPostedCount(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy =
    uploading ||
    posting ||
    cancelling ||
    (phase === "scanning" && rows.some((r) => !TERMINAL_SCAN.includes(r.status)))

  return {
    phase,
    files,
    rows,
    uploading,
    posting,
    cancelling,
    postedCount,
    busy,
    addFiles,
    removeFile,
    startScan,
    cancelRemaining,
    updateRow,
    postIncluded,
    reset,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/hooks/use-receipt-batch.test.tsx`
Expected: PASS. If the review-transition `waitFor` flakes, the bug is real (effect guard or terminal detection) — fix the hook, not the test.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "use-receipt-batch"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add hooks/use-receipt-batch.ts __tests__/hooks/use-receipt-batch.test.tsx
git commit -m "feat(bookkeeper): useReceiptBatch hook — sequential fan-out, RTDB aggregation, per-row post loop"
```

---

### Task 3: `ReceiptRowEditor` component

**Files:**
- Create: `components/admin/bookkeeping/ReceiptRowEditor.tsx`
- Test: `__tests__/components/receipt-row-editor.test.tsx`

**Interfaces:**
- Consumes (Task 1): `ReceiptBatchRow` from `@/lib/bookkeeping/receipt-batch`; `accountRequiresBusinessPurpose`, `businessPurposeMissing` from `@/lib/bookkeeping/receipts`; `formatCents` from `@/lib/bookkeeping/money`.
- Produces (Task 4 consumes):

```ts
export interface ReceiptRowEditorProps {
  row: ReceiptBatchRow
  accounts: BookkeepingAccount[]
  disabled: boolean
  onEdit: (patch: Partial<ReceiptBatchRow>) => void
  onPreviewLoaded: (url: string | null) => void
}
export function ReceiptRowEditor(props: ReceiptRowEditorProps): JSX.Element
```

Contract: on mount, if `row.previewUrl == null && row.documentId != null`, fetch `/api/admin/bookkeeping/documents/<documentId>/download` once and report the signed URL up via `onPreviewLoaded` (parent caches it on the row, so re-expanding never refetches). Preview `<img>` prefers `previewUrl`, falls back to `thumbUrl`, else "Preview unavailable". All field ids are suffixed with `row.clientId` for uniqueness across rows.

- [ ] **Step 1: Write the failing test** — `__tests__/components/receipt-row-editor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { ReceiptRowEditor } from "@/components/admin/bookkeeping/ReceiptRowEditor"
import { newReceiptRow, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

const accounts = [
  { id: "meals", name: "Meals", account_type: "expense", requires_business_purpose: true },
  { id: "fuel", name: "Fuel", account_type: "expense", requires_business_purpose: false },
] as BookkeepingAccount[]

function row(over: Partial<ReceiptBatchRow>): ReceiptBatchRow {
  return {
    ...newReceiptRow("c1", "r.jpg", null),
    status: "scanned",
    documentId: "d1",
    counterparty: "Chevron",
    amount: "45.12",
    occurredOn: "2026-07-01",
    result: {
      vendor: "Chevron",
      amount_cents: 4512,
      occurred_on: "2026-07-01",
      suggested_category: "Fuel",
      business_purpose_hint: null,
      currency: "usd",
      confidence: "high",
      warnings: [],
    },
    ...over,
  }
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

describe("ReceiptRowEditor", () => {
  it("fetches the signed preview once on mount and reports it up", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://signed/img" }) })
    const onPreviewLoaded = vi.fn()
    render(
      <ReceiptRowEditor row={row({})} accounts={accounts} disabled={false} onEdit={() => {}} onPreviewLoaded={onPreviewLoaded} />,
    )
    await waitFor(() => expect(onPreviewLoaded).toHaveBeenCalledWith("https://signed/img"))
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/bookkeeping/documents/d1/download")
  })

  it("skips the fetch when previewUrl is already cached and renders it", () => {
    render(
      <ReceiptRowEditor
        row={row({ previewUrl: "https://signed/cached" })}
        accounts={accounts}
        disabled={false}
        onEdit={() => {}}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByAltText("Receipt")).toHaveAttribute("src", "https://signed/cached")
  })

  it("shows warnings, the low-confidence banner, and the AI-scanned reference amount", () => {
    render(
      <ReceiptRowEditor
        row={row({
          previewUrl: "x",
          result: {
            vendor: "Chevron",
            amount_cents: 4512,
            occurred_on: "2026-07-01",
            suggested_category: null,
            business_purpose_hint: null,
            currency: null,
            confidence: "low",
            warnings: ["Total was glare-obscured"],
          },
        })}
        accounts={accounts}
        disabled={false}
        onEdit={() => {}}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(screen.getByText("Total was glare-obscured")).toBeInTheDocument()
    expect(screen.getByText(/low-confidence read/i)).toBeInTheDocument()
    expect(screen.getByText(/AI scanned: \$45\.12/)).toBeInTheDocument()
  })

  it("marks business purpose required for flagged accounts and emits edits", () => {
    const onEdit = vi.fn()
    render(
      <ReceiptRowEditor
        row={row({ previewUrl: "x", accountId: "meals", businessPurpose: "" })}
        accounts={accounts}
        disabled={false}
        onEdit={onEdit}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(screen.getByText(/business purpose required for this category/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/business purpose/i), { target: { value: "Client dinner" } })
    expect(onEdit).toHaveBeenCalledWith({ businessPurpose: "Client dinner" })
  })

  it("disables every field when disabled (posted rows lock)", () => {
    render(
      <ReceiptRowEditor
        row={row({ previewUrl: "x" })}
        accounts={accounts}
        disabled={true}
        onEdit={() => {}}
        onPreviewLoaded={() => {}}
      />,
    )
    expect(screen.getByLabelText(/amount/i)).toBeDisabled()
    expect(screen.getByLabelText(/date/i)).toBeDisabled()
    expect(screen.getByLabelText(/counterparty/i)).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/receipt-row-editor.test.tsx`
Expected: FAIL — cannot resolve `@/components/admin/bookkeeping/ReceiptRowEditor`.

- [ ] **Step 3: Implement `components/admin/bookkeeping/ReceiptRowEditor.tsx`**

```tsx
"use client"

// Expanded per-row editor for the batch review — absorbs the Phase-3
// single-receipt review card (same fields, warnings, low-confidence banner,
// signed-URL preview). Field ids are suffixed with clientId so several
// expanded rows never collide.
import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCents } from "@/lib/bookkeeping/money"
import { accountRequiresBusinessPurpose, businessPurposeMissing } from "@/lib/bookkeeping/receipts"
import type { ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

export interface ReceiptRowEditorProps {
  row: ReceiptBatchRow
  accounts: BookkeepingAccount[]
  disabled: boolean
  onEdit: (patch: Partial<ReceiptBatchRow>) => void
  onPreviewLoaded: (url: string | null) => void
}

export function ReceiptRowEditor({ row, accounts, disabled, onEdit, onPreviewLoaded }: ReceiptRowEditorProps) {
  const [previewLoading, setPreviewLoading] = useState(false)

  // Lazy signed-URL fetch, once per row — the parent caches the URL on the
  // row so collapsing/re-expanding never refetches.
  useEffect(() => {
    if (row.previewUrl != null || !row.documentId) return
    let cancelled = false
    setPreviewLoading(true)
    fetch(`/api/admin/bookkeeping/documents/${row.documentId}/download`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load preview")
        return res.json()
      })
      .then((data: { url?: string }) => {
        if (!cancelled) onPreviewLoaded(typeof data.url === "string" ? data.url : null)
      })
      .catch(() => {
        if (!cancelled) onPreviewLoaded(null)
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.documentId])

  const expenseAccounts = accounts.filter((a) => a.account_type === "expense")
  const selectedAccount = expenseAccounts.find((a) => a.id === row.accountId) ?? null
  const purposeRequired = selectedAccount ? accountRequiresBusinessPurpose(selectedAccount) : false
  const purposeMissing = selectedAccount ? businessPurposeMissing(selectedAccount, row.businessPurpose) : false
  const result = row.result
  const imageSrc = row.previewUrl ?? row.thumbUrl

  return (
    <div className="space-y-4 pt-3">
      {result && result.warnings.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" />
            {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}
          </div>
          <ul className="text-xs text-warning/90 space-y-1 list-disc pl-5">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {result?.confidence === "low" && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" />
            Low-confidence read
          </div>
          <p className="text-xs text-warning/90">
            The AI wasn&apos;t fully confident reading this receipt — double-check every field against the photo
            before posting.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/30 overflow-hidden flex items-center justify-center min-h-32">
        {previewLoading ? (
          <Loader2 className="size-5 text-muted-foreground animate-spin my-8" />
        ) : imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc} alt="Receipt" className="max-h-80 w-full object-contain" />
        ) : (
          <p className="text-xs text-muted-foreground py-8">Preview unavailable</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`ru-amount-${row.clientId}`}>Amount ($)</Label>
          <Input
            id={`ru-amount-${row.clientId}`}
            type="number"
            min={0}
            step="0.01"
            value={row.amount}
            disabled={disabled}
            onChange={(e) => onEdit({ amount: e.target.value })}
            placeholder="0.00"
          />
          <p className="text-xs text-muted-foreground font-mono">
            AI scanned: {result?.amount_cents != null ? formatCents(result.amount_cents) : "—"}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`ru-date-${row.clientId}`}>Date</Label>
          <Input
            id={`ru-date-${row.clientId}`}
            type="date"
            value={row.occurredOn}
            disabled={disabled}
            onChange={(e) => onEdit({ occurredOn: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`ru-counterparty-${row.clientId}`}>Counterparty</Label>
        <Input
          id={`ru-counterparty-${row.clientId}`}
          value={row.counterparty}
          disabled={disabled}
          onChange={(e) => onEdit({ counterparty: e.target.value })}
          placeholder="Who was paid"
        />
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <Select
          value={row.accountId || "none"}
          disabled={disabled}
          onValueChange={(v) => onEdit({ accountId: v === "none" ? "" : v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Uncategorized" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Uncategorized</SelectItem>
            {expenseAccounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`ru-purpose-${row.clientId}`}>
          Business purpose (who/what for)
          {purposeRequired && <span className="text-error ml-1">*</span>}
        </Label>
        <Textarea
          id={`ru-purpose-${row.clientId}`}
          value={row.businessPurpose}
          disabled={disabled}
          onChange={(e) => onEdit({ businessPurpose: e.target.value })}
          placeholder="e.g. Client dinner with Jane re: Q3 program renewal"
        />
        {purposeMissing && !disabled && (
          <p className="text-xs text-error">Business purpose required for this category</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/components/receipt-row-editor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/bookkeeping/ReceiptRowEditor.tsx __tests__/components/receipt-row-editor.test.tsx
git commit -m "feat(bookkeeper): ReceiptRowEditor — per-row batch editor absorbing the single review card"
```

---

### Task 4: `ReceiptBatchReview` component

**Files:**
- Create: `components/admin/bookkeeping/ReceiptBatchReview.tsx`
- Test: `__tests__/components/receipt-batch-review.test.tsx`

**Interfaces:**
- Consumes: Task 1's `batchTotals`, `rowValidationError`, `ReceiptBatchRow`; Task 3's `ReceiptRowEditor`; `formatCents`, `formatOccurredOn`; shadcn `Badge`, `Button`, `Checkbox`.
- Produces (Task 5 consumes):

```ts
export interface ReceiptBatchReviewProps {
  rows: ReceiptBatchRow[]
  accounts: BookkeepingAccount[]
  expandedId: string | null
  posting: boolean
  onExpand: (clientId: string | null) => void
  onToggleInclude: (clientId: string, included: boolean) => void
  onEditRow: (clientId: string, patch: Partial<ReceiptBatchRow>) => void
  onPost: () => void
  onCancel: () => void
}
export function ReceiptBatchReview(props: ReceiptBatchReviewProps): JSX.Element
```

Contract: header strip (count, ticked total via `batchTotals`, date range via `formatOccurredOn`, warning/dupe badge counts); rows with checkbox / thumbnail / vendor / date / amount / category name / confidence + state badges; checkbox disabled for rows with no `documentId` (nothing stored to post) and for posted/posting rows; expanding toggles `onExpand`; footer button label `Post N receipts ($X)` → `Retry remaining (N)` when any included row is `post_failed` → `Posting…` while posting; disabled when posting, when nothing is ticked, or when any ticked unposted row fails `rowValidationError`.

- [ ] **Step 1: Write the failing test** — `__tests__/components/receipt-batch-review.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ReceiptBatchReview } from "@/components/admin/bookkeeping/ReceiptBatchReview"
import { newReceiptRow, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

const accounts = [
  { id: "fuel", name: "Fuel", account_type: "expense", requires_business_purpose: false },
  { id: "meals", name: "Meals", account_type: "expense", requires_business_purpose: true },
] as BookkeepingAccount[]

function row(over: Partial<ReceiptBatchRow>): ReceiptBatchRow {
  return {
    ...newReceiptRow(over.clientId ?? "c1", "r.jpg", null),
    status: "scanned",
    documentId: "d1",
    included: true,
    counterparty: "Chevron",
    amount: "45.12",
    occurredOn: "2026-07-01",
    accountId: "fuel",
    previewUrl: "x",
    ...over,
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

function renderReview(rows: ReceiptBatchRow[], over: Partial<Parameters<typeof ReceiptBatchReview>[0]> = {}) {
  const props = {
    rows,
    accounts,
    expandedId: null as string | null,
    posting: false,
    onExpand: vi.fn(),
    onToggleInclude: vi.fn(),
    onEditRow: vi.fn(),
    onPost: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  return { ...render(<ReceiptBatchReview {...props} />), props }
}

describe("ReceiptBatchReview", () => {
  it("summarizes count, ticked total, date range, and dupe count in the header", () => {
    renderReview([
      row({ clientId: "c1", amount: "10.00", occurredOn: "2026-07-01" }),
      row({ clientId: "c2", amount: "5.50", occurredOn: "2026-07-03" }),
      row({ clientId: "c3", amount: "99.00", included: false, duplicateUploadHint: "2026-07-10T00:00:00Z" }),
    ])
    expect(screen.getByText(/3 receipts/i)).toBeInTheDocument()
    expect(screen.getByText("$15.50")).toBeInTheDocument()
    expect(screen.getByText(/Jul 1, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Jul 3, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/1 possible duplicate/i)).toBeInTheDocument()
  })

  it("labels the footer with ticked count + total and posts on click", () => {
    const { props } = renderReview([row({ clientId: "c1" }), row({ clientId: "c2", included: false })])
    const btn = screen.getByRole("button", { name: /post 1 receipt \(\$45\.12\)/i })
    fireEvent.click(btn)
    expect(props.onPost).toHaveBeenCalled()
  })

  it("disables posting when a ticked row is invalid and badges the reason", () => {
    renderReview([row({ clientId: "c1", accountId: "meals", businessPurpose: "" })])
    expect(screen.getByRole("button", { name: /post 1 receipt/i })).toBeDisabled()
    expect(screen.getAllByText(/business purpose required/i).length).toBeGreaterThan(0)
  })

  it("switches to retry mode when an included row failed to post", () => {
    renderReview([
      row({ clientId: "c1", status: "posted" }),
      row({ clientId: "c2", status: "post_failed", error: "Month closed" }),
    ])
    expect(screen.getByRole("button", { name: /retry remaining \(1\)/i })).toBeInTheDocument()
    expect(screen.getByText("Month closed")).toBeInTheDocument()
  })

  it("badges duplicates and disables the checkbox on rows with nothing stored", () => {
    renderReview([
      row({ clientId: "c1" }),
      row({ clientId: "c2", included: false, withinBatchDupOf: 0 }),
      row({ clientId: "c3", included: false, status: "scan_failed", documentId: null, error: "Upload failed" }),
    ])
    expect(screen.getByText(/matches receipt #1/i)).toBeInTheDocument()
    const checkboxes = screen.getAllByRole("checkbox")
    expect(checkboxes[2]).toBeDisabled()
  })

  it("expands a row through onExpand", () => {
    const { props } = renderReview([row({ clientId: "c1" }), row({ clientId: "c2" })])
    fireEvent.click(screen.getAllByRole("button", { name: /edit receipt/i })[0])
    expect(props.onExpand).toHaveBeenCalledWith("c1")
  })

  it("renders the row editor for the expanded row", () => {
    renderReview([row({ clientId: "c1" })], { expandedId: "c1" })
    expect(screen.getByLabelText(/counterparty/i)).toHaveValue("Chevron")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/receipt-batch-review.test.tsx`
Expected: FAIL — cannot resolve `@/components/admin/bookkeeping/ReceiptBatchReview`.

- [ ] **Step 3: Implement `components/admin/bookkeeping/ReceiptBatchReview.tsx`**

```tsx
"use client"

// Presentational batch summary — the "summary before approving". All money
// math and validation comes from lib/bookkeeping/receipt-batch helpers; this
// component renders rows and emits events, no server IO.
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import {
  batchTotals,
  parseAmountCents,
  rowValidationError,
  type ReceiptBatchRow,
} from "@/lib/bookkeeping/receipt-batch"
import { ReceiptRowEditor } from "@/components/admin/bookkeeping/ReceiptRowEditor"
import type { BookkeepingAccount } from "@/types/database"

export interface ReceiptBatchReviewProps {
  rows: ReceiptBatchRow[]
  accounts: BookkeepingAccount[]
  expandedId: string | null
  posting: boolean
  onExpand: (clientId: string | null) => void
  onToggleInclude: (clientId: string, included: boolean) => void
  onEditRow: (clientId: string, patch: Partial<ReceiptBatchRow>) => void
  onPost: () => void
  onCancel: () => void
}

function rowStateBadge(row: ReceiptBatchRow): { label: string; tone: "warning" | "error" | "success" } | null {
  if (row.status === "posted") return { label: "Posted", tone: "success" }
  if (row.status === "post_failed") return { label: "Post failed", tone: "error" }
  if (row.status === "scan_failed" && !row.documentId) return { label: "Upload failed", tone: "error" }
  if (row.status === "scan_failed") return { label: "Scan failed — enter manually", tone: "error" }
  if (row.status === "cancelled") return { label: "Scan cancelled", tone: "error" }
  return null
}

export function ReceiptBatchReview({
  rows,
  accounts,
  expandedId,
  posting,
  onExpand,
  onToggleInclude,
  onEditRow,
  onPost,
  onCancel,
}: ReceiptBatchReviewProps) {
  const totals = batchTotals(rows)
  const retryMode = rows.some((r) => r.included && r.status === "post_failed")
  const remaining = rows.filter((r) => r.included && r.status !== "posted").length
  const anyTickedInvalid = rows.some(
    (r) => r.included && r.status !== "posted" && rowValidationError(r, accounts) != null,
  )
  const postDisabled = posting || totals.includedCount === 0 || remaining === 0 || anyTickedInvalid

  const postLabel = posting
    ? "Posting…"
    : retryMode
      ? `Retry remaining (${remaining})`
      : `Post ${totals.includedCount} receipt${totals.includedCount === 1 ? "" : "s"} (${formatCents(totals.includedTotalCents)})`

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="rounded-xl border border-border bg-muted/30 p-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-medium text-foreground">
          {totals.rowCount} receipt{totals.rowCount === 1 ? "" : "s"}
        </span>
        <span className="font-mono text-foreground">{formatCents(totals.includedTotalCents)}</span>
        {totals.minDate && totals.maxDate && (
          <span className="text-muted-foreground">
            {totals.minDate === totals.maxDate
              ? formatOccurredOn(totals.minDate)
              : `${formatOccurredOn(totals.minDate)} – ${formatOccurredOn(totals.maxDate)}`}
          </span>
        )}
        {totals.warningCount > 0 && (
          <Badge variant="outline" className="border-warning/40 text-warning">
            <AlertTriangle className="size-3 mr-1" />
            {totals.warningCount} warning{totals.warningCount === 1 ? "" : "s"}
          </Badge>
        )}
        {totals.duplicateCount > 0 && (
          <Badge variant="outline" className="border-warning/40 text-warning">
            <Copy className="size-3 mr-1" />
            {totals.duplicateCount} possible duplicate{totals.duplicateCount === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {rows.map((row, index) => {
          const expanded = expandedId === row.clientId
          const stateBadge = rowStateBadge(row)
          const locked = row.status === "posted" || row.status === "posting"
          const tickable = row.documentId != null && !locked
          const validation = row.included && !locked ? rowValidationError(row, accounts) : null
          const accountName = accounts.find((a) => a.id === row.accountId)?.name ?? "Uncategorized"
          const cents = parseAmountCents(row.amount)

          return (
            <div key={row.clientId} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={row.included}
                  disabled={!tickable}
                  onCheckedChange={(v) => onToggleInclude(row.clientId, v === true)}
                  aria-label={`Include ${row.fileName}`}
                />
                <div className="size-10 rounded-md border border-border bg-muted/30 overflow-hidden flex items-center justify-center shrink-0">
                  {row.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumbUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <XCircle className="size-4 text-muted-foreground/50" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">
                      {row.counterparty || row.fileName}
                    </span>
                    {row.result && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          row.result.confidence === "high" && "border-success/40 text-success",
                          row.result.confidence === "medium" && "border-warning/40 text-warning",
                          row.result.confidence === "low" && "border-error/40 text-error",
                        )}
                      >
                        {row.result.confidence}
                      </Badge>
                    )}
                    {row.duplicateUploadHint && (
                      <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">
                        <Copy className="size-3 mr-1" />
                        Possible duplicate — uploaded {formatOccurredOn(row.duplicateUploadHint.slice(0, 10))}
                      </Badge>
                    )}
                    {row.withinBatchDupOf != null && (
                      <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">
                        <Copy className="size-3 mr-1" />
                        Matches receipt #{row.withinBatchDupOf + 1} in this batch
                      </Badge>
                    )}
                    {stateBadge && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          stateBadge.tone === "success" && "border-success/40 text-success",
                          stateBadge.tone === "error" && "border-error/40 text-error",
                          stateBadge.tone === "warning" && "border-warning/40 text-warning",
                        )}
                      >
                        {stateBadge.tone === "success" && <CheckCircle2 className="size-3 mr-1" />}
                        {stateBadge.label}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {formatOccurredOn(row.occurredOn)} · {cents != null ? formatCents(cents) : "no amount"} ·{" "}
                    {accountName}
                  </p>
                  {(validation || row.error) && (
                    <p className="text-xs text-error mt-0.5">{validation ?? row.error}</p>
                  )}
                </div>
                {row.status === "posting" ? (
                  <Loader2 className="size-4 text-primary animate-spin shrink-0" />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => onExpand(expanded ? null : row.clientId)}
                    aria-label={`Edit receipt ${index + 1}`}
                  >
                    {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  </Button>
                )}
              </div>
              {expanded && (
                <ReceiptRowEditor
                  row={row}
                  accounts={accounts}
                  disabled={locked}
                  onEdit={(patch) => onEditRow(row.clientId, patch)}
                  onPreviewLoaded={(url) => onEditRow(row.clientId, { previewUrl: url })}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onCancel} disabled={posting}>
          Cancel
        </Button>
        <Button onClick={onPost} disabled={postDisabled}>
          {postLabel}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/components/receipt-batch-review.test.tsx`
Expected: PASS. (If `Checkbox` renders as `role="checkbox"` buttons the `toBeDisabled` assertion still holds — Radix sets `disabled` on the button element.)

- [ ] **Step 5: Commit**

```bash
git add components/admin/bookkeeping/ReceiptBatchReview.tsx __tests__/components/receipt-batch-review.test.tsx
git commit -m "feat(bookkeeper): ReceiptBatchReview — summary strip, badged rows, post/retry footer"
```

---

### Task 5: Rework `ReceiptUploadDialog` onto the batch path

**Files:**
- Modify: `components/admin/bookkeeping/ReceiptUploadDialog.tsx` (full rewrite of the body; exported name + props UNCHANGED so `BooksClient.tsx` needs no edit)
- Test: `__tests__/components/receipt-upload-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 2's `useReceiptBatch` + `BatchPhase`; Task 4's `ReceiptBatchReview`; Task 1's `MAX_BATCH_SIZE`; `formatCents`; existing UI primitives.
- Produces: `export function ReceiptUploadDialog(props: ReceiptUploadDialogProps)` with the EXISTING props (`bookId`, `bookName`, `accounts`, `open`, `onOpenChange`, `onSaved`) — unchanged public contract.

Contract:
- Select phase: hidden multi-file input (`accept="image/jpeg,image/png,image/webp"`, `multiple`), "Choose photos" + "Add more" trigger, thumbnail grid with per-file ✕, helper copy "JPG, PNG, or WEBP. Max 10 MB each, up to 15 photos.", cap-overflow toast, footer `Upload & Scan` (count-labeled when N>1, disabled with 0 files).
- Scanning phase: "Scanned X of N" aggregate header, per-row status chips, "Cancel remaining" button.
- Review phase: `ReceiptBatchReview` inside a wider `sm:max-w-2xl` dialog; single-row batches auto-expand their row.
- `onAllPosted` → success toast (`N receipts posted — $X` / `Receipt posted — $X`), close, `onSaved()`.
- Dismissal blocked while `batch.busy`; closing after a partial post fires `onSaved()` once when `postedCount > 0`.
- Reset on every open.

- [ ] **Step 1: Write the failing test** — `__tests__/components/receipt-upload-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"

const listeners = new Map<string, { cb: (snap: { val: () => unknown }) => void }>()
vi.mock("@/lib/firebase", () => ({ rtdb: {} }))
vi.mock("firebase/database", () => ({
  ref: vi.fn((_db: unknown, path: string) => ({ path })),
  onValue: vi.fn((r: { path: string }, cb: (snap: { val: () => unknown }) => void) => {
    listeners.set(r.path, { cb })
  }),
  off: vi.fn(),
}))
vi.mock("@/hooks/use-ai-jobs-dock", () => ({ useAiJobsDock: () => ({ addJob: vi.fn() }) }))

import { ReceiptUploadDialog } from "@/components/admin/bookkeeping/ReceiptUploadDialog"
import type { BookkeepingAccount } from "@/types/database"

const accounts = [
  { id: "fuel", name: "Fuel", account_type: "expense", requires_business_purpose: false },
] as BookkeepingAccount[]

const fetchMock = vi.fn()
beforeEach(() => {
  listeners.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  URL.createObjectURL = vi.fn(() => "blob:mock") as never
  URL.revokeObjectURL = vi.fn() as never
})

function makeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" })
}

function renderDialog(over: Partial<Parameters<typeof ReceiptUploadDialog>[0]> = {}) {
  const props = {
    bookId: "b1",
    bookName: "DJP Athlete",
    accounts,
    open: true,
    onOpenChange: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  }
  return { ...render(<ReceiptUploadDialog {...props} />), props }
}

function pickFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

describe("ReceiptUploadDialog (batch)", () => {
  it("renders the multi-select upload phase with the batch copy", () => {
    renderDialog()
    expect(screen.getByText(/upload receipt photos/i)).toBeInTheDocument()
    expect(screen.getByText(/up to 15 photos/i)).toBeInTheDocument()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toHaveAttribute("multiple")
    expect(screen.getByRole("button", { name: /upload & scan/i })).toBeDisabled()
  })

  it("lists picked files with remove buttons and counts the scan button", () => {
    renderDialog()
    pickFiles([makeFile("a.jpg"), makeFile("b.jpg")])
    expect(screen.getByText("a.jpg")).toBeInTheDocument()
    expect(screen.getByText("b.jpg")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /upload & scan 2 receipts/i })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: /remove a\.jpg/i }))
    expect(screen.queryByText("a.jpg")).not.toBeInTheDocument()
  })

  it("walks a single receipt through scanning into an auto-expanded one-row review", async () => {
    renderDialog()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ jobId: "j1", documentId: "d1", duplicateUploadHint: null }),
    })
    pickFiles([makeFile("a.jpg")])
    fireEvent.click(screen.getByRole("button", { name: /upload & scan/i }))
    await waitFor(() => expect(listeners.has("ai_jobs/j1")).toBe(true))
    expect(screen.getByText(/scanned 0 of 1/i)).toBeInTheDocument()

    // Preview fetch for the auto-expanded editor
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://signed/img" }) })
    act(() => {
      listeners.get("ai_jobs/j1")!.cb({
        val: () => ({
          status: "completed",
          result: { vendor: "Chevron", amount_cents: 4512, occurred_on: "2026-07-01", suggested_category: "Fuel" },
        }),
      })
    })
    await waitFor(() => expect(screen.getByLabelText(/counterparty/i)).toHaveValue("Chevron"))
    expect(screen.getByRole("button", { name: /post 1 receipt \(\$45\.12\)/i })).toBeEnabled()
  })

  it("blocks dismissal while scanning", async () => {
    const { props } = renderDialog()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ jobId: "j1", documentId: "d1", duplicateUploadHint: null }),
    })
    pickFiles([makeFile("a.jpg")])
    fireEvent.click(screen.getByRole("button", { name: /upload & scan/i }))
    await waitFor(() => expect(listeners.has("ai_jobs/j1")).toBe(true))
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("posts the batch and fires onSaved + close through onAllPosted", async () => {
    const { props } = renderDialog()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ jobId: "j1", documentId: "d1", duplicateUploadHint: null }),
    })
    pickFiles([makeFile("a.jpg")])
    fireEvent.click(screen.getByRole("button", { name: /upload & scan/i }))
    await waitFor(() => expect(listeners.has("ai_jobs/j1")).toBe(true))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://signed/img" }) })
    act(() => {
      listeners.get("ai_jobs/j1")!.cb({
        val: () => ({
          status: "completed",
          result: { vendor: "Chevron", amount_cents: 4512, occurred_on: "2026-07-01", suggested_category: "Fuel" },
        }),
      })
    })
    await waitFor(() => expect(screen.getByRole("button", { name: /post 1 receipt/i })).toBeEnabled())
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
    fireEvent.click(screen.getByRole("button", { name: /post 1 receipt/i }))
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/receipt-upload-dialog.test.tsx`
Expected: FAIL — current dialog renders the single-photo copy ("Upload receipt photo", no `multiple` attribute).

- [ ] **Step 3: Rewrite `components/admin/bookkeeping/ReceiptUploadDialog.tsx`**

Replace the entire file with:

```tsx
"use client"

// AI Bookkeeper — multi-receipt upload dialog (spec:
// docs/superpowers/specs/2026-07-19-multi-receipt-upload-design.md).
// One path for 1..15 photos: select → sequential fan-out of receipt_scan
// jobs → consolidated batch review (ReceiptBatchReview) → per-row posting.
// Orchestration lives in useReceiptBatch; this file is phase markup only.
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Camera, CheckCircle2, ImagePlus, Loader2, XCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatCents } from "@/lib/bookkeeping/money"
import { MAX_BATCH_SIZE, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import { useReceiptBatch } from "@/hooks/use-receipt-batch"
import { ReceiptBatchReview } from "@/components/admin/bookkeeping/ReceiptBatchReview"
import type { BookkeepingAccount } from "@/types/database"

interface ReceiptUploadDialogProps {
  bookId: string
  bookName: string
  accounts: BookkeepingAccount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

const TERMINAL: ReceiptBatchRow["status"][] = ["scanned", "scan_failed", "cancelled"]

function scanChip(row: ReceiptBatchRow): { icon: "spinner" | "check" | "fail" | "idle"; label: string } {
  if (row.status === "queued") return { icon: "idle", label: "Waiting" }
  if (row.status === "uploading") return { icon: "spinner", label: "Uploading" }
  if (row.status === "scanning") return { icon: "spinner", label: "Scanning" }
  if (row.status === "scanned") return { icon: "check", label: "Scanned" }
  if (row.status === "cancelled") return { icon: "fail", label: "Cancelled" }
  return { icon: "fail", label: row.error ?? "Failed" }
}

export function ReceiptUploadDialog({
  bookId,
  bookName,
  accounts,
  open,
  onOpenChange,
  onSaved,
}: ReceiptUploadDialogProps) {
  const batch = useReceiptBatch({
    bookId,
    accounts,
    onAllPosted: (count, totalCents) => {
      toast.success(
        count === 1
          ? `Receipt posted — ${formatCents(totalCents)}`
          : `${count} receipts posted — ${formatCents(totalCents)}`,
      )
      onOpenChange(false)
      onSaved()
    },
  })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const batchRef = useRef(batch)
  batchRef.current = batch

  // Reset every time the dialog is (re)opened so a prior run never leaks in.
  useEffect(() => {
    if (open) {
      batchRef.current.reset()
      setExpandedId(null)
    }
  }, [open])

  // A one-receipt batch lands on review with its single row auto-expanded —
  // this is how the old single-receipt card UX survives on the batch path.
  useEffect(() => {
    if (batch.phase === "review" && batch.rows.length === 1) {
      setExpandedId(batch.rows[0].clientId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.phase])

  function handleOpenChange(newOpen: boolean) {
    // Block dismissal while uploads/scans/posting are in flight — Cancel
    // buttons tear listeners + jobs down cleanly instead of orphaning them.
    if (!newOpen && batch.busy) return
    if (!newOpen && batch.postedCount > 0) onSaved()
    onOpenChange(newOpen)
  }

  function handleFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) return
    const { dropped } = batch.addFiles(list)
    if (dropped.length > 0) {
      toast.info(`Only ${MAX_BATCH_SIZE} receipts per batch — not added: ${dropped.join(", ")}`)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleCancelRemaining() {
    await batch.cancelRemaining()
    toast.info("Cancelling remaining scans…")
  }

  const scannedCount = batch.rows.filter((r) => TERMINAL.includes(r.status)).length

  // ─── Scanning phase ───────────────────────────────────────────────────────
  if (batch.phase === "scanning") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col py-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Camera className="size-4 text-primary animate-pulse" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-sm text-foreground">Scanning receipts</h3>
                <p className="text-xs text-muted-foreground">
                  Scanned {scannedCount} of {batch.rows.length}
                </p>
              </div>
            </div>

            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                style={{ width: `${batch.rows.length ? Math.round((scannedCount / batch.rows.length) * 100) : 0}%` }}
              />
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {batch.rows.map((row) => {
                const chip = scanChip(row)
                return (
                  <div
                    key={row.clientId}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
                      chip.icon === "spinner" && "bg-primary/5",
                    )}
                  >
                    {chip.icon === "check" ? (
                      <CheckCircle2 className="size-4 text-primary shrink-0" />
                    ) : chip.icon === "spinner" ? (
                      <Loader2 className="size-4 text-primary animate-spin shrink-0" />
                    ) : chip.icon === "fail" ? (
                      <XCircle className="size-4 text-error shrink-0" />
                    ) : (
                      <div className="size-4 rounded-full border border-muted-foreground/30 shrink-0" />
                    )}
                    <span className="text-sm text-foreground truncate flex-1">{row.fileName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{chip.label}</span>
                  </div>
                )
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelRemaining}
              disabled={batch.cancelling}
              className="w-full text-muted-foreground hover:text-destructive hover:border-destructive/30"
            >
              {batch.cancelling ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <XCircle className="size-3.5 mr-1.5" />
              )}
              {batch.cancelling ? "Cancelling…" : "Cancel remaining"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // ─── Review phase ─────────────────────────────────────────────────────────
  if (batch.phase === "review") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Review {batch.rows.length === 1 ? "receipt" : `${batch.rows.length} receipts`}
            </DialogTitle>
            <DialogDescription>
              Check the AI-read fields against each photo. Nothing is saved until you post below.
            </DialogDescription>
          </DialogHeader>
          <ReceiptBatchReview
            rows={batch.rows}
            accounts={accounts}
            expandedId={expandedId}
            posting={batch.posting}
            onExpand={setExpandedId}
            onToggleInclude={(clientId, included) => batch.updateRow(clientId, { included })}
            onEditRow={(clientId, patch) => batch.updateRow(clientId, patch)}
            onPost={() => void batch.postIncluded()}
            onCancel={() => handleOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    )
  }

  // ─── Select phase ─────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-heading font-semibold text-foreground">
            <Camera className="size-5 text-accent" />
            Upload receipt photos
          </DialogTitle>
          <DialogDescription>
            Upload photos of paper receipts into &ldquo;{bookName}&rdquo; and AI will read the vendor, amount,
            date, and category of each — you review everything in one summary before anything posts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleFilesPicked(e.target.files)}
          />

          {batch.files.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary/40 bg-muted/20 p-8 flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ImagePlus className="size-6" />
              <span className="text-sm font-medium">Choose photos</span>
            </button>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {batch.files.map((file, index) => (
                  <div key={`${file.name}-${file.size}`} className="relative rounded-lg border border-border overflow-hidden bg-muted/20">
                    <div className="aspect-square flex items-center justify-center">
                      <Camera className="size-5 text-muted-foreground/40" />
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate px-1.5 pb-1">{file.name}</p>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => batch.removeFile(index)}
                      className="absolute top-1 right-1 size-5 rounded-full bg-background/90 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive"
                    >
                      <XCircle className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={batch.files.length >= MAX_BATCH_SIZE}
              >
                <ImagePlus className="size-3.5 mr-1.5" />
                Add more
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            JPG, PNG, or WEBP. Max 10 MB each, up to {MAX_BATCH_SIZE} photos.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void batch.startScan()} disabled={batch.files.length === 0}>
            <Camera className="size-4" />
            {batch.files.length > 1 ? `Upload & Scan ${batch.files.length} receipts` : "Upload & Scan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Note: this rewrite deletes the dialog's remaining private helpers (`mapProgressToStep`, `reviewFormFromResult`, `RECEIPT_STEPS`, the old review card markup) — all absorbed by Task 1's lib, Task 3's editor, and Task 4's review. The old per-job two-step progress UI is replaced by the per-receipt chip list (spec §3.2). Thumbnails in the select grid use a camera glyph, not object URLs — object-URL thumbs appear in scanning/review rows via the hook's `thumbUrl`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/components/receipt-upload-dialog.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + neighbors**

Run: `npx tsc --noEmit 2>&1 | grep -E "ReceiptUploadDialog|ReceiptBatchReview|ReceiptRowEditor|use-receipt-batch|BooksClient"`
Expected: no output. (`BooksClient.tsx` compiles untouched because props didn't change.)

- [ ] **Step 6: Commit**

```bash
git add components/admin/bookkeeping/ReceiptUploadDialog.tsx __tests__/components/receipt-upload-dialog.test.tsx
git commit -m "feat(bookkeeper): multi-receipt upload — batch select/scan/review dialog on the fan-out path"
```

---

### Task 6: Whole-feature verification gate

**Files:** none created — verification only.

- [ ] **Step 1: Scoped feature suite**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-batch.test.ts __tests__/hooks/use-receipt-batch.test.tsx __tests__/components/receipt-row-editor.test.tsx __tests__/components/receipt-batch-review.test.tsx __tests__/components/receipt-upload-dialog.test.tsx __tests__/lib/bookkeeping/receipts.test.ts __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts __tests__/app/api/admin/bookkeeping/receipts-commit.test.ts`
Expected: ALL PASS.

- [ ] **Step 2: Full suite (baseline is 3118/3118 green — zero regressions tolerated)**

Run: `npm run test:run`
Expected: everything passes; new total > 3118. Any failure outside the new files = regression → fix before proceeding.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Production build (separate command — never chained with `&&` after tests)**

Run: `npm run build`
Expected: exit 0, `/admin/books` present in the route output. No new root-side imports of `functions/src` were added, so the Vercel-condition build check does not apply.

- [ ] **Step 5: Commit any straggler fixes**

```bash
git status --short
```
If fixes were needed in Steps 1-4, commit them:
```bash
git add -A -- ':!JOURNAL.md'
git commit -m "fix(bookkeeper): multi-receipt verification fixes"
```

---

## Self-Review (completed at plan time)

1. **Spec coverage:** §3.1 select phase → Task 5; §3.2 sequential fan-out + chips + cancel + dock labels → Tasks 2, 5; §3.3 summary strip/sorting/dupes/unticked defaults/manual rows/validation gating → Tasks 1, 4; §3.4 posting loop/partial failure/retry/onSaved semantics → Tasks 2, 4, 5; §4 unit table → Tasks 1-5 map one-to-one; §5 error table → Tasks 2, 4; §6 testing → each task + Task 6 gates. N=1 auto-expand → Task 5.
2. **Placeholder scan:** clean — every code step contains complete code; no TBD/TODO/"similar to".
3. **Type consistency:** `ReceiptBatchRow`/`ReceiptRowStatus`/`BatchTotals` defined once in Task 1 and imported by name everywhere; `useReceiptBatch`'s return members match Task 5's usage (`phase/files/rows/uploading/posting/cancelling/postedCount/busy/addFiles/removeFile/startScan/cancelRemaining/updateRow/postIncluded/reset`); `ReceiptRowEditorProps`/`ReceiptBatchReviewProps` match their call sites.
