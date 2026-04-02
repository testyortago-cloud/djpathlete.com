"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Lock,
  Unlock,
  DollarSign,
  Gift,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react"
import type { ProgramWeekAccess } from "@/types/database"

interface AssignmentInfo {
  id: string
  user_id: string
  start_date: string
  notes: string | null
  payment_status: string
  expires_at: string | null
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
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Lock week dialog
  const [lockTarget, setLockTarget] = useState<{ assignmentId: string; weekNumber: number; clientName: string } | null>(null)
  const [lockPrice, setLockPrice] = useState("")

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
  }, [expanded, fetchData])

  async function handleGrantFree(assignmentId: string, weekNumber: number) {
    setActionLoading(`${assignmentId}-${weekNumber}-free`)
    try {
      const res = await fetch(`/api/admin/programs/${programId}/week-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, weekNumber, action: "grant_free" }),
      })
      if (!res.ok) throw new Error("Failed to grant access")
      toast.success(`Week ${weekNumber} access granted`)
      await fetchData()
    } catch {
      toast.error("Failed to grant access")
    } finally {
      setActionLoading(null)
    }
  }

  async function handleMarkPaid(assignmentId: string, weekNumber: number) {
    setActionLoading(`${assignmentId}-${weekNumber}-paid`)
    try {
      const res = await fetch(`/api/admin/programs/${programId}/week-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, weekNumber, action: "mark_paid" }),
      })
      if (!res.ok) throw new Error("Failed to mark as paid")
      toast.success(`Week ${weekNumber} marked as paid`)
      await fetchData()
    } catch {
      toast.error("Failed to mark as paid")
    } finally {
      setActionLoading(null)
    }
  }

  async function handleLockWeek() {
    if (!lockTarget || !lockPrice) return
    const priceCents = Math.round(parseFloat(lockPrice) * 100)
    if (priceCents <= 0) {
      toast.error("Price must be greater than $0")
      return
    }

    setActionLoading(`${lockTarget.assignmentId}-${lockTarget.weekNumber}-lock`)
    try {
      const res = await fetch(`/api/admin/programs/${programId}/week-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: lockTarget.assignmentId,
          weekNumber: lockTarget.weekNumber,
          action: "lock_week",
          price_cents: priceCents,
        }),
      })
      if (!res.ok) throw new Error("Failed to lock week")
      toast.success(`Week ${lockTarget.weekNumber} locked at $${lockPrice}`)
      setLockTarget(null)
      setLockPrice("")
      await fetchData()
    } catch {
      toast.error("Failed to lock week")
    } finally {
      setActionLoading(null)
    }
  }

  function getAccessForWeek(assignmentId: string, weekNumber: number): ProgramWeekAccess | undefined {
    return accessByAssignment[assignmentId]?.find((a) => a.week_number === weekNumber)
  }

  if (assignments.length === 0 && !loading && expanded) {
    return (
      <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <Lock className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-heading font-semibold">Week Access Control</h3>
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
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-heading font-semibold">Week Access Control</h3>
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
              Manage week access for assigned clients. New weeks added with a charge will show as pending here.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchData}
              disabled={loading}
              className="shrink-0"
            >
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
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-medium">{clientName}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {assignment.payment_status}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((week) => {
                        const access = getAccessForWeek(assignment.id, week)
                        const isAccessible = !access || access.payment_status === "not_required" || access.payment_status === "paid"
                        const isPending = access?.payment_status === "pending"
                        const isPaidAccess = access?.payment_status === "paid" && access.access_type === "paid"
                        const isFreeOrNoRecord = !access || (access.access_type === "included" && access.payment_status === "not_required")
                        const isLoading = actionLoading?.startsWith(`${assignment.id}-${week}`)

                        return (
                          <div key={week} className="relative group">
                            <div
                              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition-colors ${
                                isPending
                                  ? "border-warning/40 bg-warning/5 text-warning"
                                  : isPaidAccess
                                    ? "border-success/40 bg-success/5 text-success"
                                    : isAccessible
                                      ? "border-border bg-background text-muted-foreground"
                                      : "border-destructive/40 bg-destructive/5 text-destructive"
                              }`}
                            >
                              {isPending ? (
                                <Clock className="size-3" />
                              ) : isAccessible ? (
                                <Unlock className="size-3" />
                              ) : (
                                <Lock className="size-3" />
                              )}
                              W{week}
                              {access?.price_cents != null && access.price_cents > 0 && (
                                <span className="text-[10px] opacity-70">${(access.price_cents / 100).toFixed(0)}</span>
                              )}
                            </div>

                            {/* Actions for free/unlocked weeks — lock & charge */}
                            {isFreeOrNoRecord && (
                              <div className="absolute top-full left-0 mt-1 z-10 hidden group-hover:flex flex-col gap-1 bg-white border border-border rounded-lg p-1.5 shadow-lg min-w-[130px]">
                                <button
                                  onClick={() => {
                                    setLockTarget({ assignmentId: assignment.id, weekNumber: week, clientName })
                                    setLockPrice("")
                                  }}
                                  disabled={!!isLoading}
                                  className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-muted rounded transition-colors"
                                >
                                  <DollarSign className="size-3" />
                                  Lock & Charge
                                </button>
                              </div>
                            )}

                            {/* Actions for pending weeks — grant free or mark paid */}
                            {isPending && (
                              <div className="absolute top-full left-0 mt-1 z-10 hidden group-hover:flex flex-col gap-1 bg-white border border-border rounded-lg p-1.5 shadow-lg min-w-[130px]">
                                <button
                                  onClick={() => handleGrantFree(assignment.id, week)}
                                  disabled={!!isLoading}
                                  className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-muted rounded transition-colors"
                                >
                                  <Gift className="size-3" />
                                  Grant Free
                                </button>
                                <button
                                  onClick={() => handleMarkPaid(assignment.id, week)}
                                  disabled={!!isLoading}
                                  className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-muted rounded transition-colors"
                                >
                                  <CheckCircle2 className="size-3" />
                                  Mark Paid
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Legend */}
                    <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-0.5"><Unlock className="size-2.5" /> Free (hover to lock)</span>
                      <span className="flex items-center gap-0.5"><Clock className="size-2.5 text-warning" /> Pending payment</span>
                      <span className="flex items-center gap-0.5"><CheckCircle2 className="size-2.5 text-success" /> Paid</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Lock Week Dialog */}
      <Dialog open={!!lockTarget} onOpenChange={(open) => !open && setLockTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Lock Week {lockTarget?.weekNumber}</DialogTitle>
            <DialogDescription>
              Set a price for {lockTarget?.clientName} to access Week {lockTarget?.weekNumber}. They&apos;ll need to pay before viewing the workouts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="lockWeekPrice">Price (USD) *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="lockWeekPrice"
                  type="number"
                  min="0.50"
                  step="0.01"
                  placeholder="25.00"
                  value={lockPrice}
                  onChange={(e) => setLockPrice(e.target.value)}
                  className="pl-7"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleLockWeek}
              disabled={!lockPrice || parseFloat(lockPrice) <= 0 || !!actionLoading}
            >
              {actionLoading ? "Locking..." : "Lock Week"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
