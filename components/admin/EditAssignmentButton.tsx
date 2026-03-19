"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EditAssignmentDialog } from "@/components/admin/EditAssignmentDialog"

import type { AssignmentPaymentStatus } from "@/types/database"

interface EditAssignmentButtonProps {
  assignmentId: string
  clientName: string
  currentStartDate: string
  currentNotes: string | null
  currentPaymentStatus?: AssignmentPaymentStatus
}

export function EditAssignmentButton({
  assignmentId,
  clientName,
  currentStartDate,
  currentNotes,
  currentPaymentStatus,
}: EditAssignmentButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-primary hover:text-primary hover:bg-primary/10 gap-1"
        onClick={() => setOpen(true)}
      >
        <Pencil className="size-3.5" />
        Edit
      </Button>

      <EditAssignmentDialog
        open={open}
        onOpenChange={setOpen}
        assignmentId={assignmentId}
        clientName={clientName}
        currentStartDate={currentStartDate}
        currentNotes={currentNotes}
        currentPaymentStatus={currentPaymentStatus}
      />
    </>
  )
}
