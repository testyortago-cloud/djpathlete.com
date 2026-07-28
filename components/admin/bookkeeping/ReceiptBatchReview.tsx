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
  FileText,
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
                  {row.isPdf ? (
                    // A blob URL of a PDF in an <img> is a broken-image box.
                    <FileText className="size-4 text-muted-foreground" aria-label="PDF" />
                  ) : row.thumbUrl ? (
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
