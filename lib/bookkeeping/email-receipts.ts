// Pure adapter: polled Gmail receipt document → editable ReceiptBatchRow.
// scan_result present → the SAME fold-in the photo flow uses (applyScanResult
// over the RTDB-shaped result); absent (vision job still running or failed)
// → an editable blank row so the coach can post manually.
import { applyScanResult, newReceiptRow, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount, BookkeepingDocument } from "@/types/database"

export function rowFromEmailDocument(
  doc: BookkeepingDocument,
  accounts: BookkeepingAccount[],
): ReceiptBatchRow {
  const base: ReceiptBatchRow = {
    ...newReceiptRow(doc.id, doc.original_filename ?? "Email receipt", null),
    documentId: doc.id,
    status: "scanned",
    included: true,
  }
  if (!doc.scan_result) return base
  return { ...applyScanResult(base, doc.scan_result, accounts), included: true }
}
