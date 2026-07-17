"use client"

import { useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCents } from "@/lib/bookkeeping/money"
import type { BookkeepingAccount, BookkeepingLedgerEntry, LedgerSource } from "@/types/database"

const SOURCE_LABELS: Record<LedgerSource, string> = {
  manual: "Manual",
  platform_import: "Platform",
  statement_import: "Statement",
  receipt: "Receipt",
}

const SOURCE_TONE: Record<LedgerSource, string> = {
  manual: "bg-muted text-muted-foreground",
  platform_import: "bg-accent/10 text-accent",
  statement_import: "bg-primary/10 text-primary",
  receipt: "bg-warning/10 text-warning",
}

/** occurred_on is a plain YYYY-MM-DD date (no time). Parse as local y/m/d parts
 * to avoid the UTC-midnight-rolls-back-a-day bug from `new Date(dateString)`. */
function formatOccurredOn(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  if (!y || !m || !d) return dateStr
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
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

  const accountName = (accountId: string | null): string | null =>
    accountId ? (accounts.find((a) => a.id === accountId)?.name ?? null) : null

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
            <TableCell>
              <div className="font-medium">{row.memo || "—"}</div>
              {row.counterparty ? (
                <div className="text-xs text-muted-foreground">{row.counterparty}</div>
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
              {row.source === "manual" ? (
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onEdit(row)}
                    disabled={busyId === row.id}
                    title="Edit entry"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(row.id)}
                    disabled={busyId === row.id}
                    title="Delete entry"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
