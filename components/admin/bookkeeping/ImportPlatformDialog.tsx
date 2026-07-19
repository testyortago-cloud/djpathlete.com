"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import { matchAccountForServiceLine } from "@/lib/bookkeeping/account-match"
import type { BookkeepingAccount, BookKind } from "@/types/database"
import type { LedgerEntryDraft } from "@/lib/bookkeeping/types"

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultFrom(): string {
  return `${new Date().getFullYear()}-01-01`
}

interface DraftRow extends LedgerEntryDraft {
  include: boolean
  accountId: string
}

export function ImportPlatformDialog({
  bookId,
  bookKind,
  bookIsPrimary,
  bookName,
  accounts,
  open,
  onOpenChange,
  onSaved,
}: {
  bookId: string
  bookKind: BookKind
  bookIsPrimary: boolean
  bookName: string
  accounts: BookkeepingAccount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [step, setStep] = useState<"range" | "review">("range")
  const [from, setFrom] = useState(defaultFrom())
  const [to, setTo] = useState(todayIso())
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [rows, setRows] = useState<DraftRow[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [posting, setPosting] = useState(false)
  // D-4 follow-up: closed-month rejections must not vanish with a transient
  // toast. This dialog has no persistent post-commit result screen (it just
  // toasts + closes), so we keep the dialog open and surface a persistent
  // amber line above the action buttons whenever the commit returns
  // rejected_closed > 0.
  const [rejectedClosedCount, setRejectedClosedCount] = useState(0)
  // Platform income (Stripe/packs/camps/shop) is almost always Darren's
  // primary business book — importing into a household/non-primary book is
  // very likely a mis-click, so require an explicit confirmation there.
  const [confirmNonBusiness, setConfirmNonBusiness] = useState(false)
  const isNonBusinessBook = bookKind === "household" || !bookIsPrimary

  // Reset to the range step whenever the dialog is (re)opened — matches the
  // reset-on-open convention used elsewhere so closing mid-review never shows
  // a stale review screen the next time it's opened.
  useEffect(() => {
    if (!open) return
    setStep("range")
    setFrom(defaultFrom())
    setTo(todayIso())
    setRows([])
    setWarnings([])
    setConfirmNonBusiness(false)
    setRejectedClosedCount(0)
  }, [open])

  function defaultAccountFor(draft: LedgerEntryDraft): string {
    return matchAccountForServiceLine(draft.direction, draft.service_line, accounts)?.id ?? ""
  }

  async function loadPreview() {
    if (!from || !to) {
      toast.error("Pick a date range")
      return
    }
    setLoadingPreview(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/import-platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, from, to }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Failed to load platform income")
        return
      }
      const data = (await res.json()) as { drafts: LedgerEntryDraft[]; warnings: string[] }
      setRows(
        data.drafts.map((d) => ({
          ...d,
          include: true,
          accountId: defaultAccountFor(d),
        })),
      )
      setWarnings(data.warnings ?? [])
      setStep("review")
    } catch {
      toast.error("Something went wrong")
    } finally {
      setLoadingPreview(false)
    }
  }

  function updateRow(sourceRef: string, patch: Partial<DraftRow>) {
    setRows((list) => list.map((r) => (r.source_ref === sourceRef ? { ...r, ...patch } : r)))
  }

  const includedRows = rows.filter((r) => r.include)

  async function commit() {
    if (includedRows.length === 0) {
      toast.error("Select at least one entry to post")
      return
    }
    setPosting(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/import-platform/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          entries: includedRows.map((r) => ({
            direction: r.direction,
            amount_cents: r.amount_cents,
            occurred_on: r.occurred_on,
            memo: r.memo,
            counterparty: r.counterparty,
            service_line: r.service_line,
            source: r.source,
            source_ref: r.source_ref,
            alt_ref: r.alt_ref ?? null,
            account_id: r.accountId || null,
          })),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Failed to import entries")
        return
      }
      // Additive server fields: rejected_closed rows are CLOSED-month rejects,
      // never "already imported" — exclude them from the skipped arithmetic (D-4).
      // skipped_alt_ref rows are F1's cross-run dedupe (same sale, posted
      // earlier under the OTHER ref form) — also excluded from the plain
      // same-ref "already imported" count and reported as its own toast suffix.
      const data = (await res.json()) as { inserted: number; batchId: string; rejected_closed?: number; skipped_alt_ref?: number }
      const rejectedClosed = data.rejected_closed ?? 0
      const skippedAltRef = data.skipped_alt_ref ?? 0
      const skipped = includedRows.length - data.inserted - rejectedClosed - skippedAltRef
      setRejectedClosedCount(rejectedClosed)
      if (rejectedClosed > 0) {
        toast.warning(
          `${rejectedClosed} row${rejectedClosed === 1 ? " falls" : "s fall"} in closed months — post them as adjustment entries in an open month.`,
        )
      }
      let successMessage =
        skipped > 0
          ? `Posted ${data.inserted} ${data.inserted === 1 ? "entry" : "entries"} (${skipped} already imported — skipped).`
          : `Posted ${data.inserted} ${data.inserted === 1 ? "entry" : "entries"}.`
      if (skippedAltRef > 0) {
        successMessage += ` (${skippedAltRef} already imported under a previous form — skipped)`
      }
      toast.success(successMessage)
      onSaved()
      // Keep the dialog open when rows were rejected for a closed month so
      // the coach sees the persistent amber line below instead of it
      // vanishing with the transient toast.
      if (rejectedClosed === 0) {
        onOpenChange(false)
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setPosting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import platform income</DialogTitle>
          <DialogDescription>
            Pulls succeeded payments, shop orders, session packs, and paid event signups into reviewable ledger
            drafts. Re-running the same range never double-posts.
          </DialogDescription>
        </DialogHeader>

        {step === "range" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ip-from">From</Label>
                <Input id="ip-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ip-to">To</Label>
                <Input id="ip-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {warnings.length > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  {warnings.length} warning{warnings.length === 1 ? "" : "s"}
                </div>
                <ul className="text-xs text-warning/90 space-y-1 list-disc pl-5">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No platform income found in this date range.</p>
            ) : (
              <div className="overflow-x-auto border border-border rounded-lg max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border">
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground w-8" />
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">Date</th>
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">Memo</th>
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">Counterparty</th>
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">Service line</th>
                      <th className="px-2 py-2 text-right font-medium text-muted-foreground">Amount</th>
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const eligible = accounts.filter((a) => a.account_type === row.direction)
                      return (
                        <tr key={row.source_ref} className="border-b border-border last:border-b-0">
                          <td className="px-2 py-2">
                            <Checkbox
                              checked={row.include}
                              onCheckedChange={(v) => updateRow(row.source_ref, { include: v === true })}
                              aria-label={`Include ${row.memo}`}
                            />
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">{formatOccurredOn(row.occurred_on)}</td>
                          <td className="px-2 py-2">{row.memo}</td>
                          <td className="px-2 py-2 text-muted-foreground">{row.counterparty ?? "—"}</td>
                          <td className="px-2 py-2 text-muted-foreground">{row.service_line ?? "—"}</td>
                          <td className="px-2 py-2 text-right font-mono text-success">
                            +{formatCents(row.amount_cents)}
                          </td>
                          <td className="px-2 py-2">
                            <select
                              value={row.accountId}
                              onChange={(e) => updateRow(row.source_ref, { accountId: e.currentTarget.value })}
                              disabled={!row.include}
                              className="border-border rounded-md border bg-transparent px-1.5 py-1 text-xs"
                              aria-label={`Category for ${row.memo}`}
                            >
                              <option value="">Uncategorized</option>
                              {eligible.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {isNonBusinessBook && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" />
                  Non-business book selected
                </div>
                <p className="text-xs text-warning/90">
                  You&apos;re importing platform business income into the &ldquo;{bookName}&rdquo; book. Platform
                  income (Stripe, packs, camps, shop) normally belongs in your primary business book. Post here only
                  if you&apos;re sure.
                </p>
                <div className="flex items-start gap-2 pt-1">
                  <Checkbox
                    id="ip-confirm-non-business"
                    checked={confirmNonBusiness}
                    onCheckedChange={(v) => setConfirmNonBusiness(v === true)}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="ip-confirm-non-business"
                    className="text-xs text-warning/90 leading-relaxed cursor-pointer"
                  >
                    I understand — post into this non-business book
                  </Label>
                </div>
              </div>
            )}
          </div>
        )}

        {rejectedClosedCount > 0 && (
          <p className="text-sm font-medium text-warning">
            {rejectedClosedCount} row{rejectedClosedCount === 1 ? "" : "s"}{" "}
            {rejectedClosedCount === 1 ? "falls" : "fall"} in closed months — post them as adjustment entries in the
            current open month.
          </p>
        )}

        <DialogFooter>
          {step === "range" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loadingPreview}>
                Cancel
              </Button>
              <Button onClick={loadPreview} disabled={loadingPreview}>
                {loadingPreview ? "Loading…" : "Preview"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("range")} disabled={posting}>
                Back
              </Button>
              <Button
                onClick={commit}
                disabled={posting || includedRows.length === 0 || (isNonBusinessBook && !confirmNonBusiness)}
              >
                {posting ? "Posting…" : `Post ${includedRows.length} ${includedRows.length === 1 ? "entry" : "entries"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
