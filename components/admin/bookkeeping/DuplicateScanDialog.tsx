"use client"

// Review UI for the post-hoc AI duplicate scan. The dialog owns NO mutation
// logic of its own: deletes go through the existing audited entries route
// (closed-period 409 surfaces as a toast), "not a duplicate" persists a pair
// fingerprint through the existing dismissals route. Deleting an entry clears
// every pair containing it; dismissing clears only that pair.
import { useCallback, useEffect, useRef, useState } from "react"
import { FileText } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCents } from "@/lib/bookkeeping/money"
import type { DuplicateScanEntry, MemoSimilarity } from "@/lib/bookkeeping/duplicate-scan"
import type { BookkeepingAccount } from "@/types/database"

interface ScanVerdict {
  is_duplicate: boolean
  confidence: "low" | "medium" | "high"
  reason: string
}
interface ScanPair {
  pair_id: string
  fingerprint: string
  a: DuplicateScanEntry
  b: DuplicateScanEntry
  day_gap: number
  same_source: boolean
  memo_similarity: MemoSimilarity
  verdict: ScanVerdict | null
}
type AiStatus = "ok" | "skipped" | "unavailable"

const CONFIDENCE_RANK: Record<"high" | "medium" | "low", number> = { high: 0, medium: 1, low: 2 }
const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  platform_import: "Platform",
  statement_import: "Statement",
  receipt: "Receipt",
}
const DOCUMENT_LINK_LABELS: Record<string, string> = {
  receipt: "View receipt",
  statement_import: "View statement",
}

// Hoisted to module scope (fix, controller-flagged): a component defined
// INSIDE DuplicateScanDialog would be a new function identity on every
// render, so React would tear down and remount every EntryCard on any state
// change (busy, confirming, rescans) — real focus loss for keyboard users
// right at the confirm-delete step. Minimal prop surface, no closures over
// dialog state; `confirmKey` is the same `${pair_id}:${entry_id}` identity
// the dialog used to compute inline.
function EntryCard({
  entry,
  accountName,
  confirmKey,
  confirming,
  busy,
  onConfirmChange,
  onDelete,
}: {
  entry: DuplicateScanEntry
  accountName: string | null
  confirmKey: string
  confirming: string | null
  busy: boolean
  onConfirmChange: (key: string | null) => void
  onDelete: (entryId: string) => void
}) {
  const isConfirming = confirming === confirmKey
  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold">{formatCents(entry.amount_cents)}</span>
        <Badge variant="outline">{SOURCE_LABELS[entry.source] ?? entry.source}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{entry.occurred_on}</p>
      {(entry.counterparty || entry.memo) && (
        <p className="text-sm text-foreground break-words">
          {[entry.counterparty, entry.memo].filter(Boolean).join(" — ")}
        </p>
      )}
      {accountName && <p className="text-xs text-muted-foreground">{accountName}</p>}
      {entry.document_id && (
        // Durable admin route (302 → fresh signature per hit), never a raw
        // signed URL — a kept-open tab must not rot into GCS ExpiredToken XML.
        <a
          href={`/api/admin/bookkeeping/documents/${entry.document_id}/download?redirect=1`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
        >
          <FileText className="size-3" />
          {DOCUMENT_LINK_LABELS[entry.source] ?? "View document"}
        </a>
      )}
      {isConfirming ? (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => onDelete(entry.id)}>
            Confirm delete
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onConfirmChange(null)}>
            Keep
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onConfirmChange(confirmKey)}>
          Delete
        </Button>
      )}
    </div>
  )
}

export function DuplicateScanDialog({
  bookId,
  accounts,
  open,
  onOpenChange,
  onEntriesChanged,
}: {
  bookId: string
  accounts: BookkeepingAccount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onEntriesChanged: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [pairs, setPairs] = useState<ScanPair[]>([])
  const [ai, setAi] = useState<AiStatus>("ok")
  const [truncated, setTruncated] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null) // `${pair_id}:${entry_id}`
  // Request-id guard against stale-response state clobbering (fix,
  // controller-flagged): prevents a superseded invocation from applying
  // response state after a newer scan starts. (React dev-mode double-fire
  // of effects is noted; the spend risk is dev-only.) Mirrors fetchRequestIdRef
  // in BooksClient.tsx — bump the ref per invocation, bail before applying
  // state (or toasting) if a newer invocation superseded this one.
  const scanRequestIdRef = useRef(0)

  const scan = useCallback(async () => {
    const requestId = ++scanRequestIdRef.current
    setLoading(true)
    setScanned(false)
    setConfirming(null)
    try {
      const res = await fetch("/api/admin/bookkeeping/duplicates/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
      })
      const data = await res.json().catch(() => ({}))
      if (requestId !== scanRequestIdRef.current) return // a newer scan superseded this one
      if (!res.ok) {
        toast.error(data.error ?? "Scan failed")
        return
      }
      const sorted = [...(data.pairs as ScanPair[])].sort(
        (p, q) =>
          (p.verdict ? CONFIDENCE_RANK[p.verdict.confidence] : 3) -
            (q.verdict ? CONFIDENCE_RANK[q.verdict.confidence] : 3) ||
          p.a.occurred_on.localeCompare(q.a.occurred_on),
      )
      setPairs(sorted)
      setAi(data.ai as AiStatus)
      setTruncated(Boolean(data.truncated))
      setScanned(true)
    } catch {
      if (requestId !== scanRequestIdRef.current) return
      toast.error("Scan failed")
    } finally {
      if (requestId === scanRequestIdRef.current) setLoading(false)
    }
  }, [bookId])

  useEffect(() => {
    if (open && bookId) void scan()
  }, [open, bookId, scan])

  function accountName(id: string | null): string | null {
    if (!id) return null
    return accounts.find((a) => a.id === id)?.name ?? null
  }

  async function deleteEntry(entryId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/bookkeeping/entries/${entryId}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Failed to delete entry")
        return
      }
      setPairs((ps) => ps.filter((p) => p.a.id !== entryId && p.b.id !== entryId))
      toast.success("Entry deleted")
      onEntriesChanged()
    } catch {
      toast.error("Failed to delete entry")
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  async function dismissPair(p: ScanPair) {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/insights/dismissals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, fingerprint: p.fingerprint }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save")
        return
      }
      setPairs((ps) => ps.filter((x) => x.pair_id !== p.pair_id))
      toast.success("Marked as not a duplicate — it won't be flagged again")
    } catch {
      toast.error("Failed to save")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Duplicate scan</DialogTitle>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Scanning the ledger — AI is reviewing candidate pairs…</p>}

        {!loading && scanned && (
          <div className="space-y-4">
            {ai === "unavailable" && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
                AI unavailable — showing raw heuristic matches (same amount, same direction, within 7 days). Review with extra care.
              </p>
            )}
            {truncated && (
              <p className="text-sm text-muted-foreground">
                Candidate list capped at 40 pairs — resolve these, then scan again for the rest.
              </p>
            )}

            {pairs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No duplicate candidates found. Your ledger looks clean.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {pairs.length} suspected duplicate {pairs.length === 1 ? "pair" : "pairs"}. Deleting an entry removes it from the
                  ledger; “Not a duplicate” hides the pair from every future scan.
                </p>
                <ul className="space-y-3">
                  {pairs.map((p) => (
                    <li key={p.pair_id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {p.verdict ? (
                          <>
                            <Badge>{p.verdict.confidence} confidence</Badge>
                            <span className="text-sm text-foreground">{p.verdict.reason}</span>
                            <span className="text-xs text-muted-foreground">(AI-generated)</span>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Heuristic match — same amount, {p.day_gap === 0 ? "same day" : `${p.day_gap} day${p.day_gap === 1 ? "" : "s"} apart`}
                          </span>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <EntryCard
                          entry={p.a}
                          accountName={accountName(p.a.account_id)}
                          confirmKey={`${p.pair_id}:${p.a.id}`}
                          confirming={confirming}
                          busy={busy}
                          onConfirmChange={setConfirming}
                          onDelete={(id) => void deleteEntry(id)}
                        />
                        <EntryCard
                          entry={p.b}
                          accountName={accountName(p.b.account_id)}
                          confirmKey={`${p.pair_id}:${p.b.id}`}
                          confirming={confirming}
                          busy={busy}
                          onConfirmChange={setConfirming}
                          onDelete={(id) => void deleteEntry(id)}
                        />
                      </div>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void dismissPair(p)}>
                        Not a duplicate
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => void scan()} disabled={loading}>
            Scan again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
