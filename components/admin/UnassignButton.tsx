"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { UserMinus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

interface UnassignButtonProps {
  assignmentId: string
  programName: string
}

export function UnassignButton({ assignmentId, programName }: UnassignButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleUnassign() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      })
      if (!res.ok) throw new Error("Failed to unassign")
      router.refresh()
    } catch (err) {
      console.error("Unassign failed:", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
        >
          <UserMinus className="size-3.5" />
          Unassign
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unassign from program?</AlertDialogTitle>
          <AlertDialogDescription>
            This will cancel the client&apos;s assignment to <strong>{programName}</strong>.
            Their workout progress will be preserved, but they will no longer have access to this program.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleUnassign}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? "Unassigning..." : "Unassign"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
