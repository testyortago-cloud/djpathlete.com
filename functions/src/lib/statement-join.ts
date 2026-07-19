/**
 * Money-critical statement join — PURE LEAF module.
 *
 * Lives apart from statement-import.ts so the Next.js-side test
 * (__tests__/lib/bookkeeping/statement-join.test.ts) can import it without
 * dragging the Firebase job module (firestore/RTDB/anthropic → functions-only
 * deps like `jsonrepair`) into the ROOT TypeScript program. Next's Vercel
 * build type-checks everything the root program imports, and functions-only
 * packages are not installed there — importing the job module from a root
 * test breaks the production deploy (proven 2026-07-19).
 *
 * RULE: this file may import ONLY zod-backed schema types (statement-schema)
 * or nothing at all. No firebase, no anthropic, no functions-internal deps.
 */
import type { StatementImportResult } from "../ai/statement-schema.js"

export type StatementDirection = "income" | "expense"
export type StatementConfidence = "low" | "medium" | "high"

export interface StatementImportInputRow {
  ref: string
  occurred_on: string
  description: string
  amount_cents: number
  direction: StatementDirection
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
