"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { PRS_SCALE, PRS_TITLE, PRS_HELP } from "@/lib/workout/prs-scale"
import { X } from "lucide-react"

/** Client-local YYYY-MM-DD (not UTC) so "today" matches the client's calendar. */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * Perceived Recovery Status check at the start of a session. Skippable, shown
 * once per day (dismissal remembered in sessionStorage). Submitting create-or-
 * finds the day's workout_session and records PRS at its start. Non-blocking:
 * any failure (e.g. before the migration is applied) just dismisses quietly.
 */
export function SessionPrsPrompt({
  assignmentId,
  weekNumber,
  dayOfWeek,
}: {
  assignmentId: string
  weekNumber: number
  dayOfWeek: number
}) {
  const storageKey = `prs:${assignmentId}:${weekNumber}:${dayOfWeek}:${localToday()}`
  const [done, setDone] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return window.sessionStorage.getItem(storageKey) != null
    } catch {
      return false
    }
  })
  const [submitting, setSubmitting] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)

  if (done) return null

  async function submit(prs: number | null) {
    setSubmitting(true)
    setPicked(prs)
    try {
      await fetch("/api/client/workouts/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: assignmentId,
          week_number: weekNumber,
          day_of_week: dayOfWeek,
          session_date: localToday(),
          prs,
        }),
      })
    } catch {
      // Recovery check is optional — never block the workout on it.
    } finally {
      try {
        window.sessionStorage.setItem(storageKey, prs == null ? "skipped" : String(prs))
      } catch {
        // ignore storage failures
      }
      setDone(true)
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{PRS_TITLE}</p>
          <p className="text-[11px] text-muted-foreground">{PRS_HELP}</p>
        </div>
        <button
          type="button"
          onClick={() => submit(null)}
          disabled={submitting}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Skip recovery check"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRS_SCALE.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={submitting}
            onClick={() => submit(opt.value)}
            title={opt.label}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              picked === opt.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:border-primary/40",
            )}
          >
            {opt.value}
          </button>
        ))}
      </div>
    </div>
  )
}
