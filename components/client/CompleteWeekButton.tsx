"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronRight, Loader2, PartyPopper, Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface CompleteWeekButtonProps {
  assignmentId: string
  currentWeek: number
  totalWeeks: number | null
  allExercisesLogged: boolean
}

export function CompleteWeekButton({
  assignmentId,
  currentWeek,
  totalWeeks,
  allExercisesLogged,
}: CompleteWeekButtonProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [programCompleted, setProgramCompleted] = useState(false)

  const isFinalWeek = totalWeeks != null && currentWeek >= totalWeeks

  async function handleCompleteWeek() {
    if (submitting) return
    setSubmitting(true)

    try {
      const res = await fetch("/api/client/workouts/complete-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to complete week")
      }

      if (data.programCompleted) {
        setProgramCompleted(true)
        toast.success("Program complete! Great work!")
      } else {
        const nextWeek = currentWeek + 1
        toast.success(`Week ${currentWeek} complete! Starting Week ${nextWeek}`, {
          description: totalWeeks
            ? `${totalWeeks - nextWeek + 1} week${totalWeeks - nextWeek + 1 !== 1 ? "s" : ""} remaining`
            : undefined,
        })
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to complete week")
    } finally {
      setSubmitting(false)
    }
  }

  // Program completed celebration
  if (programCompleted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
        className="rounded-xl border border-border bg-success/5 p-6 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{
            type: "spring",
            damping: 12,
            stiffness: 200,
            delay: 0.1,
          }}
          className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-primary/20"
        >
          <Trophy className="size-8 text-primary" />
        </motion.div>
        <h4 className="text-lg font-semibold text-foreground">Program Complete!</h4>
        <p className="text-sm text-muted-foreground mt-1">
          You&apos;ve finished all {totalWeeks} weeks. Outstanding work!
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.refresh()}>
          Back to Workouts
        </Button>
      </motion.div>
    )
  }

  return (
    <AnimatePresence>
      {allExercisesLogged && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3 }}
          className="mt-4"
        >
          <Button
            onClick={handleCompleteWeek}
            disabled={submitting}
            className={cn(
              "w-full gap-2 h-12 text-sm font-semibold",
              isFinalWeek ? "bg-success hover:bg-success/90 text-white" : "bg-primary hover:bg-primary/90",
            )}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isFinalWeek ? (
              <PartyPopper className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            {isFinalWeek
              ? `Complete Program (Week ${currentWeek}/${totalWeeks})`
              : `Complete Week ${currentWeek}${totalWeeks ? ` of ${totalWeeks}` : ""}`}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
