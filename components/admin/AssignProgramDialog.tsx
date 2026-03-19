"use client"

import { useState, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Search, Check, UserCheck, UserMinus, DollarSign, Gift, Pencil } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { EditAssignmentDialog } from "@/components/admin/EditAssignmentDialog"
import type { AssignmentDetail } from "@/components/admin/ProgramHeader"
import type { User } from "@/types/database"

interface AssignProgramDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  programId: string
  priceCents: number | null
  clients: User[]
  assignedUserIds: string[]
  assignmentMap?: Record<string, string>
  assignmentDetails?: Record<string, AssignmentDetail>
}

export function AssignProgramDialog({
  open,
  onOpenChange,
  programId,
  priceCents,
  clients,
  assignedUserIds,
  assignmentMap = {},
  assignmentDetails = {},
}: AssignProgramDialogProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [unassigningId, setUnassigningId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [startDate, setStartDate] = useState(
    () => new Date().toISOString().split("T")[0]
  )
  const [notes, setNotes] = useState("")
  const [complimentary, setComplimentary] = useState(false)
  const [editingClient, setEditingClient] = useState<{ userId: string; name: string } | null>(null)
  const isPaid = (priceCents ?? 0) > 0

  const assignedSet = useMemo(() => new Set(assignedUserIds), [assignedUserIds])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return clients
    return clients.filter(
      (c) =>
        c.first_name.toLowerCase().includes(q) ||
        c.last_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    )
  }, [clients, search])

  function toggleClient(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleClose(o: boolean) {
    if (!o) {
      setSelectedIds(new Set())
      setSearch("")
      setNotes("")
      setComplimentary(false)
      setStartDate(new Date().toISOString().split("T")[0])
    }
    onOpenChange(o)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selectedIds.size === 0) return
    setIsSubmitting(true)

    try {
      const response = await fetch(`/api/admin/programs/${programId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_ids: Array.from(selectedIds),
          start_date: startDate,
          notes: notes || null,
          complimentary,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to assign program")
      }

      const data = await response.json()

      if (data.assigned > 0) {
        toast.success(
          `Program assigned to ${data.assigned} client${data.assigned !== 1 ? "s" : ""}!`,
          {
            description: data.skipped > 0
              ? `${data.skipped} already assigned — skipped.`
              : undefined,
          }
        )
      } else if (data.skipped > 0) {
        toast.info("All selected clients are already assigned to this program.")
      }

      handleClose(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign program")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUnassign(userId: string) {
    const assignmentId = assignmentMap[userId]
    if (!assignmentId) return
    setUnassigningId(userId)
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to unassign")
      toast.success("Client unassigned from program")
      handleClose(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unassign")
    } finally {
      setUnassigningId(null)
    }
  }

  const selectedCount = selectedIds.size

  const editDetail = editingClient ? assignmentDetails[editingClient.userId] : null

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent ref={dialogRef} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Program</DialogTitle>
          <DialogDescription>
            Select one or more clients, then set a shared start date.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              disabled={isSubmitting}
            />
          </div>

          {/* Client list */}
          <div className="max-h-[260px] overflow-y-auto rounded-md border border-border divide-y divide-border">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No clients found.
              </p>
            ) : (
              filtered.map((client) => {
                const isAssigned = assignedSet.has(client.id)
                const isSelected = selectedIds.has(client.id)

                if (isAssigned) {
                  return (
                    <div
                      key={client.id}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left bg-muted/30"
                    >
                      <div className="flex items-center justify-center size-5 rounded border shrink-0 border-muted-foreground/30 bg-muted">
                        <Check className="size-3" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate opacity-50">
                          {client.first_name} {client.last_name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {client.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className="gap-1 text-[11px]">
                          <UserCheck className="size-3" />
                          Assigned
                        </Badge>
                        {assignmentDetails[client.id] && (
                          <button
                            type="button"
                            onClick={() => setEditingClient({ userId: client.id, name: `${client.first_name} ${client.last_name}` })}
                            className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
                          >
                            <Pencil className="size-3" />
                            Edit
                          </button>
                        )}
                        {assignmentMap[client.id] && (
                          <button
                            type="button"
                            disabled={unassigningId === client.id}
                            onClick={() => handleUnassign(client.id)}
                            className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                          >
                            <UserMinus className="size-3" />
                            {unassigningId === client.id ? "..." : "Unassign"}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                }

                return (
                  <button
                    key={client.id}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => toggleClient(client.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      isSelected ? "bg-primary/5" : "hover:bg-surface/50"
                    }`}
                  >
                    <div
                      className={`flex items-center justify-center size-5 rounded border shrink-0 transition-colors ${
                        isSelected
                          ? "bg-primary border-primary text-white"
                          : "border-border bg-white"
                      }`}
                    >
                      {isSelected && <Check className="size-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {client.first_name} {client.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {client.email}
                      </p>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* Selected count */}
          {selectedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {selectedCount} client{selectedCount !== 1 ? "s" : ""} selected
            </p>
          )}

          {/* Start date */}
          <div className="space-y-2">
            <Label htmlFor="start_date">Start Date *</Label>
            <Input
              id="start_date"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="assign-notes">Notes</Label>
            <textarea
              id="assign-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes for this assignment..."
              disabled={isSubmitting}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>

          {/* Payment info for paid programs */}
          {isPaid && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  This program costs{" "}
                  <strong className="text-foreground">
                    ${((priceCents ?? 0) / 100).toFixed(2)}
                  </strong>
                  . Clients will need to purchase before accessing workouts.
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={complimentary}
                  onChange={(e) => setComplimentary(e.target.checked)}
                  disabled={isSubmitting}
                  className="size-4 rounded border-border accent-primary"
                />
                <Gift className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  Complimentary — grant free access
                </span>
              </label>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || selectedCount === 0}>
              {isSubmitting
                ? "Assigning..."
                : selectedCount === 0
                  ? "Select Clients"
                  : `Assign to ${selectedCount} Client${selectedCount !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {editingClient && editDetail && (
      <EditAssignmentDialog
        open={!!editingClient}
        onOpenChange={(o) => { if (!o) setEditingClient(null) }}
        assignmentId={editDetail.id}
        clientName={editingClient.name}
        currentStartDate={editDetail.start_date}
        currentNotes={editDetail.notes}
        currentPaymentStatus={editDetail.payment_status}
      />
    )}
    </>
  )
}
