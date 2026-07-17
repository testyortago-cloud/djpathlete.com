import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listPostedForDedupe, listDocuments } from "@/lib/db/bookkeeping"
import { assignOccurrenceIndexes, computeStatementSourceRef, transferSuspicion } from "@/lib/bookkeeping/statement-parse"
import { flagStatementDuplicates, type DedupeInputRow } from "@/lib/bookkeeping/statement-dedupe"
import { statementDedupeSchema } from "@/lib/validators/bookkeeping"

/**
 * AI Bookkeeper Phase 2, Task 11 — statement dedupe route (money-critical).
 * Computes source_ref + occurrence indexes over the FULL row set, runs the
 * pure 3-layer flagger exactly once (its `consumed` set is per-call — never
 * split across pages or a posted entry could be matched more than once), and
 * returns annotated rows + the excluded-transfer total + a document-overlap
 * caution. Read-only: no audit log entry.
 */

const WINDOW_DAYS = 4

/** `YYYY-MM-DD` → whole UTC days since epoch (tz-independent, never local `Date` math). */
function toUtcDays(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Whole UTC days since epoch → `YYYY-MM-DD`. */
function fromUtcDays(days: number): string {
  return new Date(days * 86_400_000).toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const parsed = statementDedupeSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    const { book_id, rows } = parsed.data

    if (rows.length === 0) {
      return NextResponse.json({ rows: [], excludedTransferTotalCents: 0, documentOverlapWarning: null })
    }

    // source_ref + occurrence indexes must be computed over the FULL row set so
    // re-checking a subset reproduces identical refs.
    const occ = assignOccurrenceIndexes(rows)
    const dedupeRows: DedupeInputRow[] = rows.map((row, i) => {
      const suspicion = transferSuspicion(row)
      return {
        ...row,
        source_ref: computeStatementSourceRef(row, occ[i]),
        is_transfer: row.is_transfer || suspicion === "hard",
        transferSuspect: suspicion === "soft",
      }
    })

    let minOccurred = rows[0].occurred_on
    let maxOccurred = rows[0].occurred_on
    for (const row of rows) {
      if (row.occurred_on < minOccurred) minOccurred = row.occurred_on
      if (row.occurred_on > maxOccurred) maxOccurred = row.occurred_on
    }
    // Widen the fetch span by the window so a genuine duplicate up to
    // WINDOW_DAYS outside the row span is still loaded and matched.
    const fromWide = fromUtcDays(toUtcDays(minOccurred) - WINDOW_DAYS)
    const toWide = fromUtcDays(toUtcDays(maxOccurred) + WINDOW_DAYS)

    const posted = await listPostedForDedupe(book_id, fromWide, toWide)
    // Exactly ONE call — `consumed` inside is per-call, so a posted entry can
    // only be matched once across this whole batch.
    const annotated = flagStatementDuplicates(dedupeRows, posted, {})

    const excludedTransferTotalCents = annotated.reduce(
      (sum, r) => (r.row.is_transfer || r.row.transferSuspect ? sum + r.row.amount_cents : sum),
      0,
    )

    const docs = await listDocuments(book_id)
    let documentOverlapWarning: string | null = null
    for (const doc of docs) {
      if (!doc.period_start || !doc.period_end) continue
      if (doc.period_start <= maxOccurred && doc.period_end >= minOccurred) {
        documentOverlapWarning = `This statement's date range overlaps a previously imported document (${doc.original_filename ?? "untitled"}, ${doc.period_start} to ${doc.period_end}) — check for duplicate transactions.`
        break
      }
    }

    return NextResponse.json({ rows: annotated, excludedTransferTotalCents, documentOverlapWarning })
  } catch (error) {
    console.error("[statement-import/dedupe] Failed to dedupe statement rows:", error)
    return NextResponse.json({ error: "Failed to dedupe statement rows" }, { status: 500 })
  }
}
