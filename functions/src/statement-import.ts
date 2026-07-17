import { getFirestore, FieldValue, type DocumentReference } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { statementImportSchema, type StatementImportResult } from "./ai/statement-schema.js"
import { STATEMENT_IMPORT_PROMPT } from "./ai/statement-prompt.js"
import { createJobProgressUpdater, createCancellationChecker } from "./ai/shared-helpers.js"
import { getSupabase } from "./lib/supabase.js"

/**
 * AI Bookkeeper Phase 2, Task 9 — statement_import Firebase job handler.
 *
 * Mirrors program-from-excel.ts's orchestration shape (load job, guard
 * status==="pending", re-check cancelled, mark processing in Firestore+RTDB,
 * createJobProgressUpdater/createCancellationChecker, callAgent, write-back,
 * complete/fail the ai_generation_log) but with money-critical join logic
 * specific to bank/Venmo statement ingestion:
 *
 * - csv_structured: a deterministic parser (lib/bookkeeping/statement-parse.ts,
 *   Next.js side) already produced authoritative rows. The AI ONLY adds
 *   suggested_category/is_transfer/confidence per row, matched back by an
 *   opaque `ref`. The AI can never add, remove, or alter a row — see
 *   `joinCategorizedRows` below, which is the money-critical join and is
 *   exported/tested in isolation.
 * - pdf / csv_raw: the AI performs the full structuring job itself from raw
 *   text. We cap output at MAX_STATEMENT_ROWS and reconcile against any
 *   statement-stated control totals, pushing warnings rather than silently
 *   trusting an unverifiable import.
 */

// ─── Input / output shapes ──────────────────────────────────────────────────
// functions/ cannot import lib/ or types/ (separate rootDir) — these mirror
// the shapes produced by the (Next.js-side) statement-import route + the
// BookkeepingAccount/LedgerDirection types in types/database.ts.

export type StatementImportKind = "csv_structured" | "pdf" | "csv_raw"
export type StatementDirection = "income" | "expense"
export type StatementConfidence = "low" | "medium" | "high"

export interface StatementImportInputRow {
  ref: string
  occurred_on: string
  description: string
  amount_cents: number
  direction: StatementDirection
}

export interface StatementImportAccount {
  name: string
  account_type: "income" | "expense"
}

export interface StatementImportJobInput {
  kind: StatementImportKind
  rows?: StatementImportInputRow[]
  rawText?: string
  accounts: StatementImportAccount[]
  bookName: string
  bookKind: "business" | "household"
  documentId: string
  logId?: string
  requestedBy: string
  /** csv_structured only — parse warnings + hard-truncation notice computed
   *  at upload time by the deterministic parser (Next.js route). Always
   *  merged ahead of the AI's own warnings so a silently over-500-row
   *  statement still surfaces a truncation notice on the review screen. */
  uploadWarnings?: string[]
  uploadTruncated?: boolean
}

export interface StatementImportOutputRow {
  occurred_on: string
  description: string
  amount_cents: number
  direction: StatementDirection
  suggested_category: string | null
  is_transfer: boolean
  confidence: StatementConfidence
}

/** Hard cap on AI-structured rows (pdf/csv_raw only) — csv_structured is
 *  bounded by whatever the deterministic parser already produced. */
export const MAX_STATEMENT_ROWS = 500

// ─── Money-critical join (pure, exported for isolated testing) ─────────────

/**
 * The DETERMINISTIC input rows are authoritative. For each input row, take
 * ONLY suggested_category/is_transfer/confidence from the AI row sharing its
 * `ref`. occurred_on/amount_cents/direction/description come from the input,
 * UNCHANGED, regardless of what the AI echoed back.
 *
 * - An AI row with a ref that doesn't match any input row is ignored.
 * - An input row with no matching AI row is NEVER dropped — it gets
 *   suggested_category:null, is_transfer:false, confidence:"low".
 * - The AI can never add, remove, or reorder a csv_structured row: the
 *   output has exactly one row per input row, in input order.
 */
export function joinCategorizedRows(
  inputRows: StatementImportInputRow[],
  aiRows: StatementImportResult["rows"],
): StatementImportOutputRow[] {
  const aiByRef = new Map<string, StatementImportResult["rows"][number]>()
  for (const row of aiRows) {
    if (row.ref) aiByRef.set(row.ref, row)
  }

  return inputRows.map((input) => {
    const ai = aiByRef.get(input.ref)
    return {
      occurred_on: input.occurred_on,
      description: input.description,
      amount_cents: input.amount_cents,
      direction: input.direction,
      suggested_category: ai?.suggested_category ?? null,
      is_transfer: ai?.is_transfer ?? false,
      confidence: ai?.confidence ?? "low",
    }
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function renderAccountsSection(accounts: StatementImportAccount[]): string {
  const income = accounts.filter((a) => a.account_type === "income").map((a) => a.name)
  const expense = accounts.filter((a) => a.account_type === "expense").map((a) => a.name)
  return (
    `## Chart of accounts\n` +
    `Income accounts: ${income.length ? income.join(", ") : "(none)"}\n` +
    `Expense accounts: ${expense.length ? expense.join(", ") : "(none)"}`
  )
}

/** Write real-time status to RTDB so the client can listen for instant updates */
async function updateRtdb(jobId: string, data: Record<string, unknown>) {
  try {
    const rtdb = getDatabase()
    await rtdb.ref(`ai_jobs/${jobId}`).update({ ...data, updatedAt: Date.now() })
  } catch (e) {
    console.warn(`[statement-import] RTDB update failed:`, e)
  }
}

/** Best-effort: mark the Supabase generation log as cancelled so it doesn't stay stuck "pending" */
async function markLogCancelled(logId: string | undefined) {
  if (!logId) return
  try {
    const supabase = getSupabase()
    await supabase.from("ai_generation_log").update({ status: "cancelled" }).eq("id", logId)
  } catch (e) {
    console.warn(`[statement-import] Failed to mark log ${logId} cancelled:`, e)
  }
}

/**
 * Reconcile the AI-structured rows (pdf/csv_raw only) against any
 * statement-stated control totals, mutating `warnings` in place. csv_structured
 * never reaches here — the AI is told to always return control_totals: null
 * for that shape since there's no statement-level summary text to read.
 */
function reconcileControlTotals(
  rows: StatementImportOutputRow[],
  controlTotals: StatementImportResult["control_totals"] | null | undefined,
  warnings: string[],
): void {
  const allNull =
    !controlTotals ||
    (controlTotals.total_deposits_cents == null &&
      controlTotals.total_withdrawals_cents == null &&
      controlTotals.opening_balance_cents == null &&
      controlTotals.closing_balance_cents == null)

  if (allNull) {
    warnings.push("completeness unverified — no statement totals found; review carefully")
    return
  }

  if (controlTotals.total_deposits_cents != null) {
    const sumDeposits = rows.filter((r) => r.direction === "income").reduce((s, r) => s + r.amount_cents, 0)
    if (Math.abs(sumDeposits - controlTotals.total_deposits_cents) > 100) {
      warnings.push(
        `deposit total mismatch — statement states ${formatCents(controlTotals.total_deposits_cents)} but parsed rows sum to ${formatCents(sumDeposits)}`,
      )
    }
  }
  if (controlTotals.total_withdrawals_cents != null) {
    const sumWithdrawals = rows.filter((r) => r.direction === "expense").reduce((s, r) => s + r.amount_cents, 0)
    if (Math.abs(sumWithdrawals - controlTotals.total_withdrawals_cents) > 100) {
      warnings.push(
        `withdrawal total mismatch — statement states ${formatCents(controlTotals.total_withdrawals_cents)} but parsed rows sum to ${formatCents(sumWithdrawals)}`,
      )
    }
  }
}

/** Back-fill bookkeeping_documents, complete the ai_generation_log, and write
 *  the result to Firestore + RTDB. Shared by both the csv_structured and
 *  pdf/csv_raw branches. */
async function finalizeStatementImport(args: {
  jobId: string
  jobRef: DocumentReference
  input: StatementImportJobInput
  rows: StatementImportOutputRow[]
  controlTotals: StatementImportResult["control_totals"] | null
  warnings: string[]
  truncated: boolean
  tokensUsed: number
}): Promise<void> {
  const { jobId, jobRef, input, rows, controlTotals, warnings, truncated, tokensUsed } = args

  const occurredOnDates = rows.map((r) => r.occurred_on).filter(Boolean)
  const periodStart = occurredOnDates.length ? occurredOnDates.reduce((a, b) => (a < b ? a : b)) : null
  const periodEnd = occurredOnDates.length ? occurredOnDates.reduce((a, b) => (a > b ? a : b)) : null
  const rowCount = rows.length

  const supabase = getSupabase()

  // csv_structured: the route already wrote the TRUE full row count on the
  // document at upload time (before the 500-row cap was applied here) — never
  // overwrite it with the capped `rows.length`. pdf/csv_raw: the document was
  // created with row_count: null, so this is the first and only write.
  const docUpdate: Record<string, unknown> = { period_start: periodStart, period_end: periodEnd }
  if (input.kind !== "csv_structured") {
    docUpdate.row_count = rowCount
  }

  const { error: docError } = await supabase
    .from("bookkeeping_documents")
    .update(docUpdate)
    .eq("id", input.documentId)
  if (docError) {
    console.warn(`[statement-import] Failed to back-fill document ${input.documentId}:`, docError.message)
  }

  if (input.logId) {
    await supabase
      .from("ai_generation_log")
      .update({
        status: "completed",
        output_summary: { row_count: rowCount, warnings, truncated, document_id: input.documentId },
        tokens_used: tokensUsed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.logId)
  }

  const resultPayload = { rows, control_totals: controlTotals, warnings, truncated }

  // Write result to Firestore (permanent record)
  await jobRef.update({
    status: "completed",
    result: resultPayload,
    updatedAt: FieldValue.serverTimestamp(),
  })

  // Write result to RTDB (real-time client updates)
  await updateRtdb(jobId, { status: "completed", result: resultPayload })

  console.log(`[statement-import] Job ${jobId} completed — ${rowCount} row(s), document ${input.documentId}`)
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export async function handleStatementImport(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) {
    console.error(`[statement-import] Job ${jobId} not found`)
    return
  }

  const job = jobSnap.data()!
  if (job.status !== "pending") {
    console.log(`[statement-import] Job ${jobId} already ${job.status}, skipping`)
    return
  }

  // Double-check not cancelled between creation and pickup
  const freshSnap = await jobRef.get()
  if (freshSnap.data()?.status === "cancelled") {
    console.log(`[statement-import] Job ${jobId} was cancelled before processing`)
    return
  }

  // Mark as processing in both Firestore and RTDB
  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })
  await updateRtdb(jobId, { status: "processing" })

  const input = job.input as StatementImportJobInput

  try {
    const checkCancelled = createCancellationChecker(jobId)
    const accountsSection = renderAccountsSection(input.accounts ?? [])

    console.log(`[statement-import] Starting for job ${jobId} (kind=${input.kind})`)

    if (input.kind === "csv_structured") {
      const updateProgress = createJobProgressUpdater(jobId, 2)
      const inputRows = input.rows ?? []
      const rowsJson = JSON.stringify(
        inputRows.map((r) => ({
          ref: r.ref,
          occurred_on: r.occurred_on,
          description: r.description,
          amount_cents: r.amount_cents,
          direction: r.direction,
        })),
      )
      const userMessage = `${accountsSection}\n\n## Transactions (already parsed — categorize only)\n${rowsJson}`

      await updateProgress("categorizing", 1)
      if (await checkCancelled()) {
        await markLogCancelled(input.logId)
        await updateRtdb(jobId, { status: "cancelled" })
        return
      }

      const res = await callAgent<StatementImportResult>(
        STATEMENT_IMPORT_PROMPT.replace("<name>", input.bookName),
        userMessage,
        statementImportSchema,
        { model: MODEL_SONNET, cacheSystemPrompt: true },
      )

      const rows = joinCategorizedRows(inputRows, res.content.rows)
      // Upload-time parse warnings (dropped/ambiguous rows, hard 500-row
      // truncation) are authoritative and must reach the review screen —
      // prepend them ahead of whatever the AI reported.
      const warnings = [...(input.uploadWarnings ?? []), ...res.content.warnings]
      const truncated = (input.uploadTruncated ?? false) || res.content.truncated

      await updateProgress("finalizing", 2)
      await finalizeStatementImport({
        jobId,
        jobRef,
        input,
        rows,
        controlTotals: null,
        warnings,
        truncated,
        tokensUsed: res.tokens_used,
      })
      return
    }

    // ── pdf / csv_raw ──────────────────────────────────────────────────────
    const updateProgress = createJobProgressUpdater(jobId, 3)

    await updateProgress("parsing", 1)
    if (await checkCancelled()) {
      await markLogCancelled(input.logId)
      await updateRtdb(jobId, { status: "cancelled" })
      return
    }

    const userMessage = `${accountsSection}\n\n## Statement text\n${input.rawText ?? ""}`

    await updateProgress("categorizing", 2)
    if (await checkCancelled()) {
      await markLogCancelled(input.logId)
      await updateRtdb(jobId, { status: "cancelled" })
      return
    }

    const res = await callAgent<StatementImportResult>(
      STATEMENT_IMPORT_PROMPT.replace("<name>", input.bookName),
      userMessage,
      statementImportSchema,
      { model: MODEL_SONNET, cacheSystemPrompt: true },
    )

    let rows: StatementImportOutputRow[] = res.content.rows.map((r) => ({
      occurred_on: r.occurred_on,
      description: r.description,
      amount_cents: r.amount_cents,
      direction: r.direction,
      suggested_category: r.suggested_category,
      is_transfer: r.is_transfer,
      confidence: r.confidence,
    }))

    // uploadWarnings/uploadTruncated are always empty/false for pdf/csv_raw
    // (set explicitly by the route) — merged here anyway so the two branches
    // share the same shape/behavior.
    const warnings = [...(input.uploadWarnings ?? []), ...res.content.warnings]
    let truncated = (input.uploadTruncated ?? false) || res.content.truncated
    if (res.content.truncated) {
      warnings.push("the AI reported it could not fully process the statement text — the import may be incomplete")
    }
    if (rows.length > MAX_STATEMENT_ROWS) {
      rows = rows.slice(0, MAX_STATEMENT_ROWS)
      truncated = true
    }
    if (rows.length === MAX_STATEMENT_ROWS) {
      warnings.push("hit the 500-row cap — statement may be truncated")
    }

    const controlTotals = res.content.control_totals ?? null
    reconcileControlTotals(rows, controlTotals, warnings)

    await updateProgress("finalizing", 3)
    await finalizeStatementImport({
      jobId,
      jobRef,
      input,
      rows,
      controlTotals,
      warnings,
      truncated,
      tokensUsed: res.tokens_used,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[statement-import] Job ${jobId} failed:`, errorMessage)

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Write error to RTDB so client sees it instantly
    await updateRtdb(jobId, { status: "failed", error: errorMessage })

    if (input.logId) {
      try {
        const supabase = getSupabase()
        await supabase
          .from("ai_generation_log")
          .update({ status: "failed", error_message: errorMessage })
          .eq("id", input.logId)
      } catch (e) {
        console.warn(`[statement-import] Failed to update log ${input.logId} to failed:`, e)
      }
    }
  }
}
