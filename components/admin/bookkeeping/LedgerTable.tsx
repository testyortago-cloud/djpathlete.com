"use client"

import { useState } from "react"
import { Pencil, Trash2, Paperclip } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import { formatPeriodLabel } from "@/lib/bookkeeping/period-close"
import type { BookkeepingAccount, BookkeepingLedgerEntry, LedgerSource } from "@/types/database"

const SOURCE_LABELS: Record<LedgerSource, string> = {
  manual: "Manual",
  platform_import: "Platform",
  statement_import: "Statement",
  receipt: "Receipt",
}

// Long enough to be worth collapsing. Amazon product titles run 100-200 chars
// and, against TableCell's whitespace-nowrap, stretched the memo column until
// the whole ledger scrolled sideways (owner report, 2026-08-04).
const MEMO_CLAMP_CHARS = 90

/** Two-line clamp with a Show more/less toggle. Hoisted to module scope so the
 *  toggle keeps its state across parent re-renders (row edits, refetches). */
function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > MEMO_CLAMP_CHARS
  return (
    <div className={className}>
      <span className={!expanded && long ? "line-clamp-2" : "block"}>{text}</span>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-xs font-medium text-accent underline underline-offset-2 hover:text-primary"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}

const SOURCE_TONE: Record<LedgerSource, string> = {
  manual: "bg-muted text-muted-foreground",
  platform_import: "bg-accent/10 text-accent",
  statement_import: "bg-primary/10 text-primary",
  receipt: "bg-warning/10 text-warning",
}

export function LedgerTable({
  rows,
  accounts,
  onChanged,
  onEdit,
}: {
  rows: BookkeepingLedgerEntry[]
  accounts: BookkeepingAccount[]
  onChanged: () => void
  onEdit: (entry: BookkeepingLedgerEntry) => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [attachmentBusyId, setAttachmentBusyId] = useState<string | null>(null)

  const accountName = (accountId: string | null): string | null =>
    accountId ? (accounts.find((a) => a.id === accountId)?.name ?? null) : null

  async function handleOpenAttachment(documentId: string) {
    setAttachmentBusyId(documentId)
    try {
      const res = await fetch(`/api/admin/bookkeeping/documents/${documentId}/download`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed to sign download")
      if (typeof data.url === "string") window.open(data.url, "_blank")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setAttachmentBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Delete this entry? This cannot be undone.")
    if (!confirmed) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/bookkeeping/entries/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.text()) || "Delete failed")
      toast.success("Entry deleted")
      onChanged()
    } catch (error) {
      toast.error(`Delete failed: ${(error as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function handleRecategorize(id: string, accountId: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/bookkeeping/entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId || null }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Update failed")
      toast.success("Category updated")
      onChanged()
    } catch (error) {
      toast.error(`Update failed: ${(error as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Memo</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{formatOccurredOn(row.occurred_on)}</TableCell>
            {/* whitespace-normal overrides TableCell's nowrap so a long memo
                wraps inside a bounded column instead of widening the table. */}
            <TableCell className="max-w-[22rem] min-w-[12rem] whitespace-normal align-top">
              {/* Receipt-scanned entries pre-memo-field carry only a
                  business_purpose — surface it instead of a bare dash. */}
              {row.memo ? (
                <ExpandableText text={row.memo} className="font-medium" />
              ) : row.business_purpose ? (
                <ExpandableText text={row.business_purpose} className="font-normal italic text-muted-foreground" />
              ) : (
                <div className="font-medium">—</div>
              )}
              {row.counterparty ? (
                <div className="text-xs text-muted-foreground break-words">{row.counterparty}</div>
              ) : null}
              {row.adjusts_period ? (
                <span className="mt-0.5 inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                  adjusts {formatPeriodLabel(row.adjusts_period)}
                </span>
              ) : null}
            </TableCell>
            <TableCell>
              {row.source === "manual" ? (
                accountName(row.account_id) ? (
                  <span>{accountName(row.account_id)}</span>
                ) : (
                  <span className="text-muted-foreground italic">Uncategorized</span>
                )
              ) : (
                <select
                  value={row.account_id ?? ""}
                  onChange={(e) => handleRecategorize(row.id, e.currentTarget.value)}
                  disabled={busyId === row.id}
                  className="border-border rounded-md border bg-transparent px-2 py-1 text-xs"
                  aria-label={`Category for ${row.memo ?? "entry"}`}
                >
                  <option value="">Uncategorized</option>
                  {accounts
                    .filter((a) => a.account_type === row.direction)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              )}
            </TableCell>
            <TableCell>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_TONE[row.source]}`}
              >
                {SOURCE_LABELS[row.source]}
              </span>
            </TableCell>
            <TableCell className="text-right font-mono">
              <span className={row.direction === "income" ? "text-success" : "text-error"}>
                {row.direction === "income" ? "+" : "−"}
                {formatCents(row.amount_cents)}
              </span>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">
                {row.document_id && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleOpenAttachment(row.document_id as string)}
                    disabled={attachmentBusyId === row.document_id}
                    title="View attached receipt/statement"
                  >
                    <Paperclip className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(row)}
                  disabled={busyId === row.id}
                  title={row.source === "manual" ? "Edit entry" : "Edit imported entry"}
                >
                  <Pencil className="size-3.5" />
                </Button>
                {row.source === "manual" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(row.id)}
                    disabled={busyId === row.id}
                    title="Delete entry"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
