"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import {
  Unlock,
  Gift,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Users,
  Eye,
  EyeOff,
  CalendarClock,
} from "lucide-react"
import type { ProgramWeekAccess } from "@/types/database"
import { weekState, unlockDate, formatUnlockDate } from "@/lib/programs/week-visibility"

interface AssignmentInfo {
  id: string
  user_id: string
  start_date: string
  notes: string | null
  payment_status: string
  expires_at: string | null
  status: string
  current_week: number
  release_base_week: number | null
  release_anchor_at: string | null
}

interface WeekAccessPanelProps {
  programId: string
  totalWeeks: number
  clientNames: Record<string, string>
}

export function WeekAccessPanel({ programId, totalWeeks, clientNames }: WeekAccessPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [assignments, setAssignments] = useState<AssignmentInfo[]>([])
  const [accessByAssignment, setAccessByAssignment] = useState<Record<string, ProgramWeekAccess[]>>({})
  const [actionLoading, setActionLoading] = useState(false)

  // Selected week modal state
  const [selectedWeek, setSelectedWeek] = useState<{
    assignmentId: string
    assignment: AssignmentInfo
    weekNumber: number
    clientName: string
    access: ProgramWeekAccess | null
  } | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/programs/${programId}/week-access`)
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json()
      setAssignments(data.assignments)
      setAccessByAssignment(data.accessByAssignment)
    } catch {
      toast.error("Failed to load week access data")
    } finally {
      setLoading(false)
    }
  }, [programId])

  useEffect(() => {
    if (expanded) fetchData()
  }, [expanded, fetchData, totalWeeks])

  function getAccessForWeek(assignmentId: string, weekNumber: number): ProgramWeekAccess | undefined {
    return accessByAssignment[assignmentId]?.find((a) => a.week_number === weekNumber)
  }

  function openWeekModal(assignment: AssignmentInfo, weekNumber: number, clientName: string) {
    const access = getAccessForWeek(assignment.id, weekNumber) ?? null
    setSelectedWeek({ assignmentId: assignment.id, assignment, weekNumber, clientName, access })
  }

  async function handleAction(action: "grant_free" | "mark_paid") {
    if (!selectedWeek) return
    setActionLoading(true)

    const body: Record<string, unknown> = {
      assignmentId: selectedWeek.assignmentId,
      weekNumber: selectedWeek.weekNumber,
      action,
    }

    try {
      const res = await fetch(`/api/admin/programs/${programId}/week-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error("Failed")

      const messages = {
        grant_free: `Week ${selectedWeek.weekNumber} granted free for ${selectedWeek.clientName}`,
        mark_paid: `Week ${selectedWeek.weekNumber} marked as paid`,
      }
      toast.success(messages[action])
      setSelectedWeek(null)
      await fetchData()
    } catch {
      toast.error("Action failed")
    } finally {
      setActionLoading(false)
    }
  }

  async function setVisibility(visibility: "auto" | "shown" | "hidden") {
    if (!selectedWeek) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/programs/${programId}/week-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: selectedWeek.assignmentId,
          weekNumber: selectedWeek.weekNumber,
          action: "set_visibility",
          visibility,
        }),
      })
      if (!res.ok) throw new Error("Failed")
      const w = selectedWeek.weekNumber
      toast.success(
        visibility === "hidden"
          ? `Week ${w} is hidden from ${selectedWeek.clientName}`
          : visibility === "shown"
            ? `Week ${w} is open for ${selectedWeek.clientName}`
            : `Week ${w} follows the weekly schedule again`,
      )
      setSelectedWeek(null)
      await fetchData()
    } catch {
      toast.error("Couldn't change this week")
    } finally {
      setActionLoading(false)
    }
  }

  async function toggleSchedule(assignmentId: string, on: boolean) {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ release_schedule: on }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success(on ? "One week at a time is on" : "Every week is now visible")
      await fetchData()
    } catch {
      toast.error("Couldn't change the weekly release")
    } finally {
      setActionLoading(false)
    }
  }

  function scheduleSummary(a: AssignmentInfo, now: Date): string {
    if (a.release_base_week == null) return "This client can see every week."
    if (!a.release_anchor_at) return "New weeks are paused until this client's payment is active again."
    for (let w = 1; w <= totalWeeks; w++) {
      if (weekState(w, a, getAccessForWeek(a.id, w)?.visibility, now) === "scheduled") {
        const d = unlockDate(w, a)
        if (d) return `A new week opens every 7 days. Next: week ${w} on ${formatUnlockDate(d.toISOString())}.`
      }
    }
    return "A new week opens every 7 days. Every week is already open."
  }

  // The panel renders only after a client-side fetch, so there is no hydration mismatch.
  const now = new Date()

  // Compute modal state helpers
  const modalAccess = selectedWeek?.access
  const isIncluded = !modalAccess || modalAccess.access_type === "included"
  const isPending = !isIncluded && modalAccess?.payment_status === "pending"
  const isGranted =
    !isIncluded && modalAccess?.access_type === "paid" && modalAccess?.payment_status === "not_required"
  const isPaid = !isIncluded && modalAccess?.payment_status === "paid" && !isGranted

  if (assignments.length === 0 && !loading && expanded) {
    return (
      <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-between w-full text-left">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-heading font-semibold">Client week access</h3>
          </div>
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        {expanded && (
          <p className="text-xs text-muted-foreground mt-3">
            No active client assignments. Week access controls will appear here once clients are assigned.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-between w-full text-left">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-heading font-semibold">Client week access</h3>
          {assignments.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {assignments.length} client{assignments.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Choose which weeks each client can see, and handle paid weeks. Premium prices are set in{" "}
              <strong>Pricing &amp; access</strong>.
            </p>
            <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading} className="shrink-0">
              <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-4">
              <RefreshCw className="size-4 animate-spin mx-auto text-muted-foreground" />
              <p className="text-xs text-muted-foreground mt-1">Loading...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {assignments.map((assignment) => {
                const clientName = clientNames[assignment.user_id] ?? "Unknown Client"
                return (
                  <div key={assignment.id} className="border border-border rounded-lg p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{clientName}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {assignment.payment_status}
                        </Badge>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={assignment.release_base_week != null}
                          disabled={actionLoading}
                          onCheckedChange={(v) => toggleSchedule(assignment.id, v)}
                          aria-label={`Release one week at a time for ${clientName}`}
                        />
                        One week at a time
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">{scheduleSummary(assignment, now)}</p>

                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((week) => {
                        const access = getAccessForWeek(assignment.id, week)
                        const state = weekState(week, assignment, access?.visibility, now)
                        const weekIsIncluded = !access || access.access_type === "included"
                        const weekIsPending = !weekIsIncluded && access?.payment_status === "pending"
                        const weekIsGranted =
                          !weekIsIncluded &&
                          access?.access_type === "paid" &&
                          access?.payment_status === "not_required"
                        const weekIsPaid =
                          !weekIsIncluded && access?.payment_status === "paid" && !weekIsGranted

                        return (
                          <button
                            key={week}
                            onClick={() => openWeekModal(assignment, week, clientName)}
                            title={
                              state === "hidden" ? "Hidden by you" : state === "scheduled" ? "Not out yet" : "Visible"
                            }
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs border transition-colors cursor-pointer${state !== "visible" ? " opacity-60" : ""} ${
                              weekIsPending
                                ? "border-warning/40 bg-warning/5 text-warning hover:bg-warning/10"
                                : weekIsPaid || weekIsGranted
                                  ? "border-success/40 bg-success/5 text-success hover:bg-success/10"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-primary/5"
                            }`}
                          >
                            {state === "hidden" ? (
                              <EyeOff className="size-3" />
                            ) : state === "scheduled" ? (
                              <CalendarClock className="size-3" />
                            ) : weekIsPending ? (
                              <Clock className="size-3" />
                            ) : weekIsPaid ? (
                              <CheckCircle2 className="size-3" />
                            ) : weekIsGranted ? (
                              <Gift className="size-3" />
                            ) : (
                              <Unlock className="size-3" />
                            )}
                            W{week}
                            {access?.price_cents != null && access.price_cents > 0 && (
                              <span className="text-[10px] opacity-70">${(access.price_cents / 100).toFixed(0)}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>

                    <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-0.5">
                        <Unlock className="size-2.5" /> Free
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Clock className="size-2.5 text-warning" /> Pending
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Gift className="size-2.5 text-success" /> Granted
                      </span>
                      <span className="flex items-center gap-0.5">
                        <CheckCircle2 className="size-2.5 text-success" /> Paid
                      </span>
                      <span className="flex items-center gap-0.5">
                        <CalendarClock className="size-2.5" /> Not out yet
                      </span>
                      <span className="flex items-center gap-0.5">
                        <EyeOff className="size-2.5" /> Hidden
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Week Action Modal */}
      <Dialog open={!!selectedWeek} onOpenChange={(open) => !open && setSelectedWeek(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Week {selectedWeek?.weekNumber} — {selectedWeek?.clientName}
            </DialogTitle>
            <DialogDescription>
              {isIncluded && "Included with the program — free."}
              {isPending &&
                `Awaiting payment${modalAccess?.price_cents ? ` ($${(modalAccess.price_cents / 100).toFixed(2)})` : ""}. Grant free access or mark as paid below.`}
              {isGranted && "This week has been granted free for this client."}
              {isPaid && "This week has been paid for."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {/* Current status badge */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Status:</span>
              {isIncluded && (
                <Badge variant="outline" className="gap-1">
                  <Unlock className="size-3" /> Included / Free
                </Badge>
              )}
              {isPending && (
                <Badge className="gap-1 bg-warning/10 text-warning border-warning/30" variant="outline">
                  <Clock className="size-3" /> Pending Payment
                  {modalAccess?.price_cents ? ` — $${(modalAccess.price_cents / 100).toFixed(2)}` : ""}
                </Badge>
              )}
              {isGranted && (
                <Badge className="gap-1 bg-success/10 text-success border-success/30" variant="outline">
                  <Gift className="size-3" /> Granted Free
                </Badge>
              )}
              {isPaid && (
                <Badge className="gap-1 bg-success/10 text-success border-success/30" variant="outline">
                  <CheckCircle2 className="size-3" /> Paid
                </Badge>
              )}
            </div>

            {selectedWeek &&
              (() => {
                const vis = modalAccess?.visibility ?? "auto"
                const state = weekState(selectedWeek.weekNumber, selectedWeek.assignment, vis, new Date())
                const date = unlockDate(selectedWeek.weekNumber, selectedWeek.assignment)
                const label =
                  state === "hidden"
                    ? "No, you hid this week"
                    : state === "scheduled"
                      ? date
                        ? `Not yet. It opens on ${formatUnlockDate(date.toISOString())}`
                        : "Not yet. New weeks are paused"
                      : vis === "shown"
                        ? "Yes, you opened it early"
                        : "Yes"
                return (
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-xs">
                      <span className="text-muted-foreground">Can the client see it? </span>
                      {label}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {state !== "visible" && (
                        <Button size="sm" variant="outline" onClick={() => setVisibility("shown")} disabled={actionLoading}>
                          <Eye className="size-3 mr-1.5" /> Show now
                        </Button>
                      )}
                      {vis !== "hidden" && (
                        <Button size="sm" variant="outline" onClick={() => setVisibility("hidden")} disabled={actionLoading}>
                          <EyeOff className="size-3 mr-1.5" /> Hide
                        </Button>
                      )}
                      {vis !== "auto" && (
                        <Button size="sm" variant="ghost" onClick={() => setVisibility("auto")} disabled={actionLoading}>
                          Back to the weekly schedule
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })()}

            {isIncluded && (
              <p className="text-xs text-muted-foreground">
                To make this a paid week for everyone, use <strong>Pricing &amp; access</strong>.
              </p>
            )}
          </div>

          <DialogFooter className={isPending ? "flex-col sm:flex-col gap-2" : ""}>
            {isPending && (
              <>
                <Button
                  onClick={() => handleAction("grant_free")}
                  disabled={actionLoading}
                  variant="outline"
                  className="w-full"
                >
                  <Gift className="size-3 mr-1.5" />
                  {actionLoading ? "..." : "Grant free access"}
                </Button>
                <Button onClick={() => handleAction("mark_paid")} disabled={actionLoading} className="w-full">
                  <CheckCircle2 className="size-3 mr-1.5" />
                  {actionLoading ? "..." : "Mark as paid (cash/Venmo)"}
                </Button>
              </>
            )}
            {!isPending && (
              <Button variant="outline" onClick={() => setSelectedWeek(null)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
