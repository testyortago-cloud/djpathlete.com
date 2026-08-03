"use client"

// Accounting setup checklist surfaces (plan: 2026-08-03-books-setup-checklist-tour).
// Two exports over one shared status hook:
//   <SetupBanner/> — slim progress strip above the ledger filters; hidden once
//     every item is done, on GET failure, or after an explicit dismiss
//     (localStorage — a nudge must never be un-dismissable).
//   <SetupPanel/>  — the full checklist dialog. Auto-detected items link to
//     their fix page; the manual item is an optimistic checkbox that PATCHes
//     and reverts (+ toast) on failure. Footer offers the cross-page tour.
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Circle, CircleCheck, TriangleAlert, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import type { SetupItem } from "@/lib/bookkeeping/setup-status"

const STATUS_URL = "/api/admin/bookkeeping/setup-status"
const DISMISS_KEY = "books_setup_banner_dismissed"

interface SetupStatus {
  items: SetupItem[]
  doneCount: number
  totalCount: number
  tourCompletedAt: string | null
}

// Shape-check the GET payload instead of trusting the cast — a malformed body
// must read as "failed" (banner hidden, panel retry row), never NaN counts.
function parseStatus(data: unknown): SetupStatus | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.items) || typeof d.doneCount !== "number" || typeof d.totalCount !== "number") return null
  return {
    items: d.items as SetupItem[],
    doneCount: d.doneCount,
    totalCount: d.totalCount,
    tourCompletedAt: typeof d.tourCompletedAt === "string" ? d.tourCompletedAt : null,
  }
}

function useSetupStatus(active: boolean) {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [failed, setFailed] = useState(false)
  // Request-id guard against stale-response state clobbering — mirrors
  // scanRequestIdRef in DuplicateScanDialog.tsx: bump the ref per invocation,
  // bail before applying state if a newer invocation superseded this one.
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    try {
      const res = await fetch(STATUS_URL)
      const data = await res.json().catch(() => null)
      if (requestId !== requestIdRef.current) return // a newer load superseded this one
      const parsed = res.ok ? parseStatus(data) : null
      if (!parsed) {
        setFailed(true)
        return
      }
      setFailed(false)
      setStatus(parsed)
    } catch {
      if (requestId !== requestIdRef.current) return
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    if (active) void load()
  }, [active, load])

  return { status, setStatus, failed, load }
}

function readDismissed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(DISMISS_KEY) === "1"
  } catch {
    return false
  }
}

export function SetupBanner({ onOpen }: { onOpen: () => void }) {
  const [dismissed, setDismissed] = useState(readDismissed)
  const { status, failed } = useSetupStatus(!dismissed)

  if (dismissed || failed || !status) return null
  if (status.doneCount >= status.totalCount) return null

  const pct = status.totalCount > 0 ? (status.doneCount / status.totalCount) * 100 : 0
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left"
      >
        <span className="text-foreground">
          Accounting setup —{" "}
          <span className="font-medium tabular-nums">
            {status.doneCount} of {status.totalCount}
          </span>{" "}
          steps done
        </span>
        <Progress value={pct} className="w-32 shrink-0" aria-label="Setup progress" />
        <span className="text-xs text-muted-foreground">See what’s left</span>
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try {
            window.localStorage.setItem(DISMISS_KEY, "1")
          } catch {
            // storage unavailable — the dismissal just won't persist across visits
          }
          setDismissed(true)
        }}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

function StatusIcon({ status }: { status: SetupItem["status"] }) {
  if (status === "done") return <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
  if (status === "attention") return <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
  return <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
}

export function SetupPanel({
  open,
  onOpenChange,
  onStartTour,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStartTour: () => void
}) {
  const { status, setStatus, failed, load } = useSetupStatus(open)

  const applyManualStatus = useCallback(
    (key: string, itemStatus: SetupItem["status"]) => {
      setStatus((prev) => {
        if (!prev) return prev
        const items = prev.items.map((i) => (i.key === key ? { ...i, status: itemStatus } : i))
        return { ...prev, items, doneCount: items.filter((i) => i.status === "done").length }
      })
    },
    [setStatus],
  )

  async function toggleManual(item: SetupItem, checked: boolean) {
    applyManualStatus(item.key, checked ? "done" : "todo") // optimistic
    try {
      const res = await fetch(STATUS_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key, checked }),
      })
      if (!res.ok) throw new Error("save failed")
    } catch {
      applyManualStatus(item.key, checked ? "todo" : "done") // revert
      toast.error("Failed to save — try again")
    }
  }

  const items = status?.items ?? []
  // "To do" before "Needs attention": actionable gaps first, unverifiable ones
  // (e.g. a cron that has never run) after, finished items last.
  const groups = [
    { label: "To do", items: items.filter((i) => i.status === "todo") },
    { label: "Needs attention", items: items.filter((i) => i.status === "attention") },
    { label: "Done", items: items.filter((i) => i.status === "done") },
  ].filter((g) => g.items.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Accounting setup</DialogTitle>
        </DialogHeader>

        {failed && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <span className="text-foreground">Couldn’t load the setup status.</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!failed && !status && <p className="text-sm text-muted-foreground">Loading setup status…</p>}

        {status && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">
                  {status.doneCount} of {status.totalCount}
                </span>{" "}
                steps done. Detected automatically from your settings — nothing here blocks the ledger.
              </p>
              <Progress value={status.totalCount > 0 ? (status.doneCount / status.totalCount) * 100 : 0} />
            </div>

            {groups.map((group) => (
              <div key={group.label} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{group.label}</p>
                <ul className="space-y-2">
                  {group.items.map((item) => (
                    <li key={item.key} className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
                      <StatusIcon status={item.status} />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-medium text-foreground">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.why}</p>
                        {item.detail && (
                          <p className={`text-xs ${item.status === "attention" ? "text-warning" : "text-muted-foreground"}`}>
                            {item.detail}
                          </p>
                        )}
                      </div>
                      {item.manual ? (
                        <Checkbox
                          aria-label={`Mark “${item.title}” ${item.status === "done" ? "not done" : "done"}`}
                          checked={item.status === "done"}
                          onCheckedChange={(checked) => void toggleManual(item, checked === true)}
                          className="mt-0.5"
                        />
                      ) : item.status !== "done" ? (
                        <Link
                          href={item.href}
                          aria-label={`Fix: ${item.title}`}
                          onClick={() => onOpenChange(false)}
                          className="mt-0.5 shrink-0 text-xs text-primary underline underline-offset-2"
                        >
                          Fix this
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={onStartTour}>{status?.tourCompletedAt ? "Retake the tour" : "Take the tour"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
