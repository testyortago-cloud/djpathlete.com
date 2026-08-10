"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { CheckCircle2 } from "lucide-react"

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * Marks the day's workout session complete and captures the ONE session RPE
 * (replacing per-set RPE). Find-or-creates the session, then finishes it.
 * Completing a session is what feeds the streak (see lib/db/progress.ts).
 */
export function FinishSessionButton({
  assignmentId,
  weekNumber,
  dayOfWeek,
  volumeLoadKg,
  allLogged,
  missingVideoCount = 0,
}: {
  assignmentId: string
  weekNumber: number
  dayOfWeek: number
  volumeLoadKg: number | null
  allLogged: boolean
  missingVideoCount?: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function finish(rpe: number) {
    setSubmitting(true)
    try {
      const ensureRes = await fetch("/api/client/workouts/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: assignmentId,
          week_number: weekNumber,
          day_of_week: dayOfWeek,
          session_date: localToday(),
        }),
      })
      const ensureData = await ensureRes.json().catch(() => ({}))
      if (!ensureRes.ok || !ensureData.session?.id) {
        throw new Error(ensureData.error || "Couldn't start the session")
      }

      const res = await fetch("/api/client/workouts/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: ensureData.session.id,
          session_rpe: rpe,
          volume_load_kg: volumeLoadKg,
          // The row may have been opened on an earlier date (a repeated week, or a
          // set logged days ago) — stamp the date it was actually finished.
          session_date: localToday(),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || "Couldn't finish the session")
      }
      toast.success("Workout complete! 💪")
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't finish the session")
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <div className="mt-6">
        <Button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full gap-2"
          variant={allLogged ? "default" : "outline"}
        >
          <CheckCircle2 className="size-4" />
          Finish session
        </Button>
        {missingVideoCount > 0 && (
          <p className="mt-1 text-center text-[11px] text-accent">
            {missingVideoCount} exercise{missingVideoCount > 1 ? "s" : ""} still need a recording — you can finish anyway.
          </p>
        )}
        {!allLogged && (
          <p className="mt-1 text-center text-[11px] text-muted-foreground">
            You can finish early — or log the rest first.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <p className="text-sm font-semibold text-foreground">How hard was this session overall?</p>
      <p className="mb-3 text-[11px] text-muted-foreground">
        One rating for the whole workout (1 = easy, 10 = max effort).
      </p>
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            disabled={submitting}
            onClick={() => finish(n)}
            className={cn(
              "rounded-md border border-border bg-background py-2 text-xs font-semibold transition-colors",
              "hover:border-primary hover:bg-primary/10 disabled:opacity-50",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={submitting}
        className="mt-3 text-xs text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  )
}
