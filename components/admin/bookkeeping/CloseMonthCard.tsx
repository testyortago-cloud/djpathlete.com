"use client"

// Phase 6a (D-1/D-5/D-7): per-book close list + close/reopen actions.
// The close freezes TOTALS, not documents — retention may still prune links.
// The readiness panel below the picker answers "is this month worth freezing?"
// before you freeze it; blockers disable Close but never hide it — the escape
// hatch sits right next to the reason (a gate that hides its control reads as
// broken software).
import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Lock, RefreshCw, Unlock, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { closableMonthOptions, formatPeriodLabel, periodOf } from "@/lib/bookkeeping/period-close"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import type { CloseReadiness } from "@/lib/bookkeeping/close-readiness"
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
  // null = "auto": the most recent closable month (usually last month) is
  // pre-selected so the common case is a single click on "Close month".
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [readiness, setReadiness] = useState<CloseReadiness | null>(null)
  const [checking, setChecking] = useState(false)

  const closedSet = new Set(closes.map((c) => c.period))
  const today = new Date().toISOString().slice(0, 10)
  const options = closableMonthOptions(today, closedSet, 12)
  const effectivePeriod = selectedPeriod ?? options[0] ?? ""

  // Only the newest in-flight check may write state — switching months fast
  // must not let a slow earlier response overwrite the current one.
  const checkSeq = useRef(0)

  const checkReadiness = useCallback(async () => {
    if (!effectivePeriod) {
      setReadiness(null)
      return
    }
    const seq = ++checkSeq.current
    setChecking(true)
    try {
      const res = await fetch(
        `/api/admin/bookkeeping/closes/readiness?book_id=${encodeURIComponent(bookId)}&period=${encodeURIComponent(effectivePeriod)}`,
      )
      const data = await res.json().catch(() => ({}))
      if (seq !== checkSeq.current) return
      setReadiness(res.ok ? (data.readiness as CloseReadiness) : null)
    } catch {
      if (seq === checkSeq.current) setReadiness(null)
    } finally {
      if (seq === checkSeq.current) setChecking(false)
    }
  }, [bookId, effectivePeriod])

  useEffect(() => {
    void checkReadiness()
  }, [checkReadiness])

  async function closeMonth(override: boolean) {
    if (!effectivePeriod) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/closes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, period: effectivePeriod, ...(override ? { override: true } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // A 422 from the gate carries the current readiness — adopt it so the
        // panel explains the refusal instead of showing stale "ready" state.
        if (data.readiness) setReadiness(data.readiness as CloseReadiness)
        toast.error(data.error ?? "Failed to close the month")
        return
      }
      const c = data.close as BookkeepingPeriodClose
      toast.success(
        `${formatPeriodLabel(c.period)} closed — income ${formatCents(c.income_cents)}, expenses ${formatCents(c.expense_cents)}, net ${formatCents(c.net_cents)} (${c.entry_count} entries).`,
      )
      setSelectedPeriod(null) // snap back to auto = next most recent closable month
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

  const blocked = readiness !== null && !readiness.ready

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-heading text-primary flex items-center gap-2">
          <Lock className="size-4" />
          Monthly close
        </h2>
        <div className="flex items-center gap-2">
          <Select value={effectivePeriod} onValueChange={(v) => setSelectedPeriod(v)}>
            <SelectTrigger className="w-44" aria-label="Month to close">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((p, i) => (
                <SelectItem key={p} value={p}>
                  {formatPeriodLabel(p)}
                  {i === 0 ? " · latest" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={() => closeMonth(false)}
            disabled={busy || checking || blocked || !effectivePeriod}
            title={blocked ? "Clear the blockers below, or use Close anyway" : undefined}
          >
            <Lock className="size-3.5" />
            Close {effectivePeriod ? formatPeriodLabel(effectivePeriod) : "month"}
          </Button>
        </div>
      </div>

      {effectivePeriod && (
        <ReadinessPanel
          period={effectivePeriod}
          readiness={readiness}
          checking={checking}
          busy={busy}
          onRecheck={() => void checkReadiness()}
          onOverride={() => void closeMonth(true)}
        />
      )}

      <p className="text-xs text-muted-foreground">
        {formatPeriodLabel(periodOf(today))} is still in progress — a month becomes closable once it ends
        {options[0] ? `, so the latest you can close today is ${formatPeriodLabel(options[0])}` : ""}.
      </p>

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

function ReadinessPanel({
  period,
  readiness,
  checking,
  busy,
  onRecheck,
  onOverride,
}: {
  period: string
  readiness: CloseReadiness | null
  checking: boolean
  busy: boolean
  onRecheck: () => void
  onOverride: () => void
}) {
  if (checking && !readiness) {
    return (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Checking whether {formatPeriodLabel(period)} is ready to close…
      </p>
    )
  }
  if (!readiness) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Couldn&apos;t run the readiness check.</span>
        <Button variant="ghost" size="sm" onClick={onRecheck}>
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      </div>
    )
  }

  const { totals } = readiness
  const blockers = readiness.checks.filter((c) => c.severity === "blocker" && c.status === "flagged")

  return (
    <div className="rounded-md border border-border bg-surface/50 p-3 space-y-2" data-tour="close-readiness">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">
          {readiness.ready ? (
            <span className="text-success">{formatPeriodLabel(period)} is ready to close.</span>
          ) : (
            <span className="text-error">
              {formatPeriodLabel(period)} isn&apos;t ready — {blockers.length}{" "}
              {blockers.length === 1 ? "blocker" : "blockers"}.
            </span>
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={onRecheck} disabled={checking}>
          <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} />
          Re-check
        </Button>
      </div>

      <ul className="space-y-1">
        {readiness.checks.map((c) => {
          const Icon = c.status === "ok" ? CheckCircle2 : c.severity === "blocker" ? XCircle : AlertTriangle
          const tone =
            c.status === "ok" ? "text-success" : c.severity === "blocker" ? "text-error" : "text-warning"
          return (
            <li key={c.key} className="flex items-start gap-2 text-xs">
              <Icon className={`size-3.5 mt-0.5 shrink-0 ${tone}`} aria-hidden />
              <span className="sr-only">
                {c.status === "ok" ? "Passed" : c.severity === "blocker" ? "Blocker" : "Warning"}:
              </span>
              <span className={c.status === "ok" ? "text-muted-foreground" : ""}>
                <span className="font-medium">{c.title}</span> — {c.detail}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Would freeze <span className="font-mono">{formatCents(totals.income_cents)}</span> income ·{" "}
        <span className="font-mono">{formatCents(totals.expense_cents)}</span> expenses ·{" "}
        <span className={`font-mono ${totals.net_cents >= 0 ? "text-success" : "text-error"}`}>
          {formatCents(totals.net_cents)}
        </span>{" "}
        net across {totals.entry_count} {totals.entry_count === 1 ? "entry" : "entries"}.
      </p>

      {!readiness.ready && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onOverride} disabled={busy}>
            <Lock className="size-3.5" />
            Close anyway
          </Button>
          <span className="text-xs text-muted-foreground">
            Records on the audit trail which blockers you closed over.
          </span>
        </div>
      )}
    </div>
  )
}
