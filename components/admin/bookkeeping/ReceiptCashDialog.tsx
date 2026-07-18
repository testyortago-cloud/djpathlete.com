"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { accountRequiresBusinessPurpose } from "@/lib/bookkeeping/receipts"
import { summarizeApiError } from "@/lib/errors/humanize"
import type { BookkeepingAccount } from "@/types/database"

/**
 * AI Bookkeeper Phase 3, Task 16 — cash receipt dialog. Clones
 * ManualEntryDialog's form shell, but is expense-only end to end: no
 * income/expense toggle (receipts/cash always writes direction:"expense"),
 * and no "Uncategorized" escape hatch — the route requires a concrete
 * expense account_id. Gates submission on business_purpose when the
 * selected account's requires_business_purpose flag is set, mirroring the
 * server's businessPurposeMissing() check (lib/bookkeeping/receipts.ts) so
 * the 422 it would otherwise return is caught client-side first.
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface FormState {
  amount: string // dollars, as typed
  occurredOn: string
  accountId: string
  memo: string
  counterparty: string
  businessPurpose: string
}

function emptyForm(): FormState {
  return {
    amount: "",
    occurredOn: todayIso(),
    accountId: "",
    memo: "",
    counterparty: "",
    businessPurpose: "",
  }
}

export function ReceiptCashDialog({
  bookId,
  accounts,
  open,
  onOpenChange,
  onSaved,
}: {
  bookId: string
  accounts: BookkeepingAccount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [businessPurposeError, setBusinessPurposeError] = useState<string | null>(null)

  // Reset on OPEN (not close) so the form doesn't visibly reset to blank
  // mid fade-out while Radix keeps the content mounted — matches
  // ManualEntryDialog's convention.
  useEffect(() => {
    if (!open) return
    setForm(emptyForm())
    setBusinessPurposeError(null)
  }, [open])

  const expenseAccounts = accounts.filter((a) => a.account_type === "expense")
  const selectedAccount = expenseAccounts.find((a) => a.id === form.accountId) ?? null
  const purposeRequired = selectedAccount ? accountRequiresBusinessPurpose(selectedAccount) : false
  const purposeMissing = purposeRequired && form.businessPurpose.trim().length === 0

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
    if (!form.accountId) {
      toast.error("Choose an expense category")
      return
    }
    if (purposeMissing) {
      setBusinessPurposeError("Business purpose required for this category")
      return
    }
    setSubmitting(true)
    setBusinessPurposeError(null)
    try {
      const res = await fetch("/api/admin/bookkeeping/receipts/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          account_id: form.accountId,
          amount_cents: cents,
          occurred_on: form.occurredOn,
          counterparty: form.counterparty.trim() || null,
          business_purpose: form.businessPurpose.trim() || null,
          memo: form.memo.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 422) {
          setBusinessPurposeError(
            typeof data.error === "string" ? data.error : "Business purpose required for this category",
          )
          return
        }
        const { message } = summarizeApiError(res, data, "Failed to record receipt")
        toast.error(message)
        return
      }
      toast.success("Cash receipt recorded")
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
          <DialogTitle>Add cash receipt</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rc-amount">Amount ($)</Label>
              <Input
                id="rc-amount"
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-date">Date</Label>
              <Input
                id="rc-date"
                type="date"
                value={form.occurredOn}
                onChange={(e) => setForm((f) => ({ ...f, occurredOn: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={form.accountId} onValueChange={(v) => setForm((f) => ({ ...f, accountId: v }))}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select an expense category" />
              </SelectTrigger>
              <SelectContent>
                {expenseAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rc-memo">Memo</Label>
              <Input
                id="rc-memo"
                value={form.memo}
                onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                placeholder="What was this for?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-counterparty">Counterparty</Label>
              <Input
                id="rc-counterparty"
                value={form.counterparty}
                onChange={(e) => setForm((f) => ({ ...f, counterparty: e.target.value }))}
                placeholder="Who was paid"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rc-purpose">
              Business purpose (who/what for)
              {purposeRequired && <span className="text-error ml-1">*</span>}
            </Label>
            <Textarea
              id="rc-purpose"
              value={form.businessPurpose}
              onChange={(e) => {
                setForm((f) => ({ ...f, businessPurpose: e.target.value }))
                setBusinessPurposeError(null)
              }}
              placeholder="e.g. Client dinner with Jane re: Q3 program renewal"
            />
            {businessPurposeError && <p className="text-xs text-error">{businessPurposeError}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || purposeMissing}>
            Add receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
