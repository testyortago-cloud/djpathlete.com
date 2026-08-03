// Pure helpers + row model for the multi-receipt batch upload flow.
// Zero IO, zero React — everything here is unit-testable in isolation.
// safeReceiptResult / resolveExpenseAccount / todayIso / ReceiptResult moved
// here from ReceiptUploadDialog.tsx so the batch hook and components share
// one source of truth.
import { businessPurposeMissing } from "@/lib/bookkeeping/receipts"
import type { BookkeepingAccount } from "@/types/database"

export const MAX_BATCH_SIZE = 15

/** Mime-or-extension accept list, client side.
 *
 *  The click path is filtered by the file input's `accept` attribute, but
 *  DROPPED files bypass it entirely — a drag-and-drop of anything at all hands
 *  us the raw File. So the real gate lives here and both paths run through it.
 *
 *  Deliberately separate from lib/bookkeeping/receipt-pdf.ts, which does the
 *  server-side equivalent: that module requires `pdf-parse` and must never
 *  reach the browser bundle. */
const ACCEPTED_RECEIPT_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
const ACCEPTED_RECEIPT_EXTENSIONS = /\.(jpe?g|png|webp|pdf)$/i

export function isAcceptedReceiptFile(file: File): boolean {
  return (
    ACCEPTED_RECEIPT_MIMES.includes(file.type.trim().toLowerCase()) ||
    ACCEPTED_RECEIPT_EXTENSIONS.test(file.name)
  )
}

export function isPdfFile(file: File): boolean {
  return file.type.trim().toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name)
}

/** Shape of the completed job's `result` — mirrors ReceiptScanResult
 *  (functions/src/ai/receipt-schema.ts) field-for-field. */
export interface ReceiptResult {
  vendor: string | null
  amount_cents: number | null
  occurred_on: string | null
  suggested_category: string | null
  business_purpose_hint: string | null
  /** Short "what was bought" line (item summary / plan name / invoice period). */
  memo: string | null
  /** "paid" = document proves a completed payment; "due" = it only requests
   *  one (invoice). Vendors email BOTH for a single charge — posting the due
   *  twin double-counts the expense. */
  payment_status: "paid" | "due" | null
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
  /** Ledger memo — what was bought. Scan-prefilled, reviewer-editable. */
  memo: string
  error: string | null
  /** Signed download URL, cached after the row editor's first fetch. */
  previewUrl: string | null
  /** Local object URL of the picked file (thumbnail; preview fallback). */
  thumbUrl: string | null
  /** PDF rows cannot render in an <img> — a blob URL of a PDF is a
   *  broken-image box. The review surfaces swap in a file tile and an iframe. */
  isPdf: boolean
  /** Email-body document (text/html | text/plain). Renders in a SANDBOXED
   *  iframe — never in <img> (broken image) and never unsandboxed (third-party
   *  email HTML must not script). */
  isBody: boolean
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
    memo: r.memo ?? null,
    payment_status: r.payment_status === "paid" || r.payment_status === "due" ? r.payment_status : null,
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

export function newReceiptRow(
  clientId: string,
  fileName: string,
  thumbUrl: string | null,
  isPdf = false,
): ReceiptBatchRow {
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
    memo: "",
    error: null,
    previewUrl: null,
    thumbUrl,
    isPdf,
    isBody: false,
  }
}

/** Synthesized client-side from payment_status — a deterministic field beats
 *  hoping the model volunteers a warning. Rides the existing warnings plumbing:
 *  count badges, the row editor's warning list, and the email board's
 *  "Needs a look" bucket all light up with zero extra wiring. */
export const DUE_INVOICE_WARNING =
  "This looks like an invoice that is DUE — not proof of payment. The paid receipt usually arrives separately; post only one."

/** Fold a completed scan's raw RTDB result into the row's editable fields. */
export function applyScanResult(
  row: ReceiptBatchRow,
  raw: unknown,
  accounts: BookkeepingAccount[],
): ReceiptBatchRow {
  const base = safeReceiptResult(raw)
  const result =
    base.payment_status === "due" ? { ...base, warnings: [...base.warnings, DUE_INVOICE_WARNING] } : base
  return {
    ...row,
    status: "scanned",
    result,
    counterparty: result.vendor ?? "",
    amount: result.amount_cents != null ? (result.amount_cents / 100).toString() : "",
    occurredOn: result.occurred_on ?? todayIso(),
    accountId: resolveExpenseAccount(result.suggested_category, accounts),
    businessPurpose: result.business_purpose_hint ?? "",
    memo: result.memo ?? "",
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
