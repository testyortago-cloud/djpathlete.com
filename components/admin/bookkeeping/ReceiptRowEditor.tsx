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
        <Label htmlFor={`ru-category-${row.clientId}`}>Category</Label>
        <Select
          value={row.accountId || "none"}
          disabled={disabled}
          onValueChange={(v) => onEdit({ accountId: v === "none" ? "" : v })}
        >
          <SelectTrigger id={`ru-category-${row.clientId}`} className="w-full">
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
