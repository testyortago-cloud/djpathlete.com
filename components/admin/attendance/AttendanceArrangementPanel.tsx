"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Building2, Plus, StopCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DataTable,
  DataTableHeader,
  DataTableHead,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
  DataTableBadge,
} from "@/components/ui/data-table"
import type { AttendanceArrangement, SessionCheckin } from "@/types/database"

function fmtDate(s: string) {
  // Date-only strings are parsed as UTC; render them as UTC too, or a
  // US-timezone browser shows every session one day early.
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

/**
 * The "billed somewhere else" section of Sessions & Billing: a client coached
 * here whose sessions a partner facility invoices through its own system. There
 * is no pack and no money on this side — only the attendance count the coach
 * checks against the facility's number.
 */
export function AttendanceArrangementPanel({
  clientUserId,
  arrangement,
  checkins,
  sessionsThisMonth,
  bare = false,
}: {
  clientUserId: string
  arrangement: AttendanceArrangement | null
  checkins: SessionCheckin[]
  sessionsThisMonth: number
  bare?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [startOpen, setStartOpen] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [label, setLabel] = useState("")
  const [notes, setNotes] = useState("")

  async function start() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/attendance-arrangements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientUserId, label: label.trim() || undefined, notes: notes.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not start the arrangement")
        return
      }
      if (data.warning) toast.warning(data.warning)
      else toast.success("Attendance arrangement started")
      setStartOpen(false)
      setLabel("")
      setNotes("")
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  async function end() {
    if (!arrangement) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/attendance-arrangements/end", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ arrangementId: arrangement.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not end the arrangement")
        return
      }
      toast.success("Arrangement ended")
      setConfirmEnd(false)
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={bare ? "" : "bg-white rounded-xl border border-border p-6"}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-primary flex items-center gap-2">
          <Building2 className="size-5" strokeWidth={1.5} />
          Attendance only
        </h2>
        {arrangement ? (
          <Button size="sm" variant="outline" onClick={() => setConfirmEnd(true)} disabled={busy}>
            <StopCircle className="size-4" />
            End arrangement
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setStartOpen(true)}>
            <Plus className="size-4" />
            Start arrangement
          </Button>
        )}
      </div>

      {!arrangement ? (
        <p className="text-sm text-muted-foreground">
          For a client you coach in person who is billed somewhere else — at a facility that invoices them
          through its own system. Start an arrangement and you can check them in without selling a pack. Nothing
          is charged here and nothing appears in your books.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="font-medium text-primary">{arrangement.label || "Attendance arrangement"}</p>
                <p className="text-sm text-muted-foreground">
                  Billed elsewhere · started {fmtDate(arrangement.started_on)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold text-primary">{sessionsThisMonth}</p>
                <p className="text-xs text-muted-foreground">sessions this month</p>
              </div>
            </div>
            {arrangement.notes && <p className="mt-3 text-sm text-muted-foreground">{arrangement.notes}</p>}
          </div>

          <DataTable>
            <DataTableHeader>
              <DataTableHead>Date</DataTableHead>
              <DataTableHead>Recorded</DataTableHead>
              <DataTableHead>Status</DataTableHead>
            </DataTableHeader>
            <tbody>
              {checkins.length === 0 ? (
                <DataTableEmpty colSpan={3}>
                  No sessions recorded yet. Use Check in at the top of this page.
                </DataTableEmpty>
              ) : (
                checkins.map((c) => (
                  <DataTableRow key={c.id}>
                    <DataTableCell>{fmtDate(c.session_date)}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {c.method === "coach_tap" ? "Coach" : c.method === "qr_self" ? "QR" : "Manual"}
                    </DataTableCell>
                    <DataTableCell>
                      <DataTableBadge tone={c.voided ? "neutral" : "success"}>
                        {c.voided ? "Voided" : "Attended"}
                      </DataTableBadge>
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </tbody>
          </DataTable>
        </div>
      )}

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start an attendance arrangement</DialogTitle>
            <DialogDescription>
              You coach this client, but someone else bills them. You will be able to check them in without a
              pack, and nothing will be charged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="arrangement-label">Who bills this client?</Label>
              <Input
                id="arrangement-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Riverside Tennis Club"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="arrangement-notes">Notes (optional)</Label>
              <Textarea
                id="arrangement-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything you want to remember about this arrangement."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={start} disabled={busy}>
              Start arrangement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this arrangement?</AlertDialogTitle>
            <AlertDialogDescription>
              The sessions already recorded stay on this client&apos;s history and still count on the monthly
              attendance list. You just will not be able to check them in without a pack any more.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={end} disabled={busy}>
              End arrangement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
