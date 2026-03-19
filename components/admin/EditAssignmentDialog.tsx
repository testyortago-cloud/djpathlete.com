"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
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

import type { AssignmentPaymentStatus } from "@/types/database"

const PAYMENT_STATUS_LABELS: Record<AssignmentPaymentStatus, string> = {
  not_required: "Not Required",
  pending: "Pending",
  paid: "Paid",
  subscription_active: "Subscription Active",
}

interface EditAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  assignmentId: string
  clientName: string
  currentStartDate: string
  currentNotes: string | null
  currentPaymentStatus?: AssignmentPaymentStatus
}

export function EditAssignmentDialog({
  open,
  onOpenChange,
  assignmentId,
  clientName,
  currentStartDate,
  currentNotes,
  currentPaymentStatus,
}: EditAssignmentDialogProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [startDate, setStartDate] = useState(currentStartDate)
  const [notes, setNotes] = useState(currentNotes ?? "")
  const [paymentStatus, setPaymentStatus] = useState<AssignmentPaymentStatus>(
    currentPaymentStatus ?? "not_required"
  )

  function handleClose(o: boolean) {
    if (!o) {
      setStartDate(currentStartDate)
      setNotes(currentNotes ?? "")
      setPaymentStatus(currentPaymentStatus ?? "not_required")
    }
    onOpenChange(o)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: startDate,
          notes: notes || null,
          ...(currentPaymentStatus !== undefined && paymentStatus !== currentPaymentStatus
            ? { payment_status: paymentStatus }
            : {}),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to update assignment")
      }

      toast.success("Assignment updated successfully")
      handleClose(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update assignment")
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasChanges = startDate !== currentStartDate
    || (notes || null) !== currentNotes
    || (currentPaymentStatus !== undefined && paymentStatus !== currentPaymentStatus)

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Assignment</DialogTitle>
          <DialogDescription>
            Update the start date or notes for {clientName}&apos;s assignment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-start-date">Start Date *</Label>
            <Input
              id="edit-start-date"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Changing the start date shifts when Week 1 begins. The client&apos;s
              weekly calendar will recalculate from this date.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <textarea
              id="edit-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes for this assignment..."
              disabled={isSubmitting}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>

          {currentPaymentStatus !== undefined && (
            <div className="space-y-2">
              <Label htmlFor="edit-payment-status">Payment Status</Label>
              <select
                id="edit-payment-status"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as AssignmentPaymentStatus)}
                disabled={isSubmitting}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {(Object.entries(PAYMENT_STATUS_LABELS) as [AssignmentPaymentStatus, string][]).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
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
            <Button type="submit" disabled={isSubmitting || !hasChanges}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
