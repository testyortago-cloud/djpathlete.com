"use client"

// Phase 6a (D-1/D-5/D-7): per-book close list + close/reopen actions.
// The close freezes TOTALS, not documents — retention may still prune links.
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Lock, Unlock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { closableMonthOptions, formatPeriodLabel } from "@/lib/bookkeeping/period-close"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import type { BookkeepingPeriodClose } from "@/types/database"

export function CloseMonthCard({
  bookId,
  closes,
  onChanged,
}: {
  bookId: string
  closes: BookkeepingPeriodClose[]
  onChanged: () => void
}) {
  const router = useRouter()
  const [selectedPeriod, setSelectedPeriod] = useState("")
  const [busy, setBusy] = useState(false)

  const closedSet = new Set(closes.map((c) => c.period))
  const options = closableMonthOptions(new Date().toISOString().slice(0, 10), closedSet)

  async function closeMonth() {
    if (!selectedPeriod) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/closes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, period: selectedPeriod }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Failed to close the month")
        return
      }
      const c = data.close as BookkeepingPeriodClose
      toast.success(
        `${formatPeriodLabel(c.period)} closed — income ${formatCents(c.income_cents)}, expenses ${formatCents(c.expense_cents)}, net ${formatCents(c.net_cents)} (${c.entry_count} entries).`,
      )
      setSelectedPeriod("")
      onChanged()
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  async function reopen(close: BookkeepingPeriodClose) {
    const confirmed = window.confirm(
      `Reopen ${formatPeriodLabel(close.period)}? Its frozen totals are preserved in the audit log; re-closing will re-snapshot.`,
    )
    if (!confirmed) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/bookkeeping/closes/${close.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Failed to reopen")
        return
      }
      toast.success(`${formatPeriodLabel(close.period)} reopened`)
      onChanged()
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-heading text-primary flex items-center gap-2">
          <Lock className="size-4" />
          Monthly close
        </h2>
        <div className="flex items-center gap-2">
          <Select value={selectedPeriod || "none"} onValueChange={(v) => setSelectedPeriod(v === "none" ? "" : v)}>
            <SelectTrigger className="w-44" aria-label="Month to close">
              <SelectValue placeholder="Pick a month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Pick a month…</SelectItem>
              {options.map((p) => (
                <SelectItem key={p} value={p}>
                  {formatPeriodLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={closeMonth} disabled={busy || !selectedPeriod}>
            Close month
          </Button>
        </div>
      </div>

      {closes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No months closed yet for this book. Close a finished month to freeze its totals.
        </p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {closes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-medium">{formatPeriodLabel(c.period)}</span>
              <span className={c.net_cents >= 0 ? "text-success font-mono" : "text-error font-mono"}>
                {formatCents(c.net_cents)} net
              </span>
              <span className="text-xs text-muted-foreground">
                {c.entry_count} entries · closed {formatOccurredOn(c.closed_at.slice(0, 10))}
              </span>
              <Button variant="ghost" size="sm" onClick={() => reopen(c)} disabled={busy} title="Reopen this month">
                <Unlock className="size-3.5" />
                Reopen
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Closing freezes this book&apos;s totals for the month — new entries, edits, deletes, and imports into it are
        blocked; post adjustment entries in an open month instead. Attached document links may still be pruned by the
        receipt-retention policy; the frozen totals are unaffected. Record-keeping only — your CPA files.
      </p>
    </div>
  )
}
