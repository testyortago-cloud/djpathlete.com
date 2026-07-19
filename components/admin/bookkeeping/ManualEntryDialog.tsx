"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatPeriodLabel } from "@/lib/bookkeeping/period-close"
import type { BookkeepingAccount, BookkeepingLedgerEntry, LedgerDirection } from "@/types/database"

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface FormState {
  direction: LedgerDirection
  amount: string // dollars, as typed
  occurredOn: string
  accountId: string // "" = uncategorized
  memo: string
  counterparty: string
  businessPurpose: string
  adjustsPeriod: string // "" = none
}

function emptyForm(): FormState {
  return {
    direction: "expense",
    amount: "",
    occurredOn: todayIso(),
    accountId: "",
    memo: "",
    counterparty: "",
    businessPurpose: "",
    adjustsPeriod: "",
  }
}

function formFromEntry(entry: BookkeepingLedgerEntry): FormState {
  return {
    direction: entry.direction,
    amount: (entry.amount_cents / 100).toString(),
    occurredOn: entry.occurred_on,
    accountId: entry.account_id ?? "",
    memo: entry.memo ?? "",
    counterparty: entry.counterparty ?? "",
    businessPurpose: entry.business_purpose ?? "",
    adjustsPeriod: entry.adjusts_period ?? "",
  }
}

export function ManualEntryDialog({
  bookId,
  accounts,
  entry,
  open,
  onOpenChange,
  onSaved,
  closedPeriods = [],
}: {
  bookId: string
  accounts: BookkeepingAccount[]
  entry?: BookkeepingLedgerEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  closedPeriods?: string[]
}) {
  const isEdit = Boolean(entry)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [submitting, setSubmitting] = useState(false)

  // Reset/prefill on OPEN (not close) so the edit form doesn't visibly reset
  // to blank mid fade-out while Radix keeps the content mounted.
  useEffect(() => {
    if (!open) return
    setForm(entry ? formFromEntry(entry) : emptyForm())
  }, [open, entry])

  const eligibleAccounts = accounts.filter((a) => a.account_type === form.direction)

  async function submit() {
    const cents = Math.round(parseFloat(form.amount || "0") * 100)
    if (!form.amount || !Number.isFinite(cents) || cents <= 0) {
      toast.error("Enter a valid amount")
      return
    }
    if (!form.occurredOn) {
      toast.error("Pick a date")
      return
    }
    setSubmitting(true)
    try {
      const body = {
        book_id: bookId,
        account_id: form.accountId || null,
        direction: form.direction,
        amount_cents: cents,
        occurred_on: form.occurredOn,
        memo: form.memo.trim() || null,
        counterparty: form.counterparty.trim() || null,
        business_purpose: form.businessPurpose.trim() || null,
        adjusts_period: form.adjustsPeriod || null,
      }
      const res = isEdit
        ? await fetch(`/api/admin/bookkeeping/entries/${entry!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/bookkeeping/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? `Failed to ${isEdit ? "update" : "add"} entry`)
        return
      }
      toast.success(isEdit ? "Entry updated" : "Entry added")
      onOpenChange(false)
      onSaved()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit entry" : "Add entry"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={form.direction === "income" ? "default" : "outline"}
              size="sm"
              onClick={() => setForm((f) => ({ ...f, direction: "income", accountId: "" }))}
            >
              Income
            </Button>
            <Button
              type="button"
              variant={form.direction === "expense" ? "default" : "outline"}
              size="sm"
              onClick={() => setForm((f) => ({ ...f, direction: "expense", accountId: "" }))}
            >
              Expense
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="me-amount">Amount ($)</Label>
              <Input
                id="me-amount"
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="me-date">Date</Label>
              <Input
                id="me-date"
                type="date"
                value={form.occurredOn}
                onChange={(e) => setForm((f) => ({ ...f, occurredOn: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={form.accountId || "none"}
              onValueChange={(v) => setForm((f) => ({ ...f, accountId: v === "none" ? "" : v }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Uncategorized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Uncategorized</SelectItem>
                {eligibleAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {closedPeriods.length > 0 && (
            <div className="space-y-2">
              <Label>Adjusts closed month</Label>
              <Select
                value={form.adjustsPeriod || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, adjustsPeriod: v === "none" ? "" : v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {closedPeriods.map((p) => (
                    <SelectItem key={p} value={p}>
                      {formatPeriodLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Posts in this entry&apos;s own (open) month but is labeled as a correction to the closed month.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="me-memo">Memo</Label>
              <Input
                id="me-memo"
                value={form.memo}
                onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                placeholder="What was this for?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="me-counterparty">Counterparty</Label>
              <Input
                id="me-counterparty"
                value={form.counterparty}
                onChange={(e) => setForm((f) => ({ ...f, counterparty: e.target.value }))}
                placeholder="Who was paid / who paid"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="me-purpose">Business purpose (who/what for)</Label>
            <Textarea
              id="me-purpose"
              value={form.businessPurpose}
              onChange={(e) => setForm((f) => ({ ...f, businessPurpose: e.target.value }))}
              placeholder="e.g. Client dinner with Jane re: Q3 program renewal"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {isEdit ? "Save changes" : "Add entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
