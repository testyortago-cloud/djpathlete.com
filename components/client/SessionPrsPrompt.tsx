"use client"

import { useState } from "react"
import { PRS_MIN, PRS_MAX, PRS_TITLE, PRS_HELP, prsBand } from "@/lib/workout/prs-scale"
import { X } from "lucide-react"

/** Client-local YYYY-MM-DD (not UTC) so "today" matches the client's calendar. */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * Perceived Recovery Status check at the start of a session — a 0–10 slider,
 * colour-coded green→red, showing the recovery label + performance expectation
 * for the picked number. Skippable, shown once per day (remembered in
 * sessionStorage). Submitting creates-or-finds the day's workout_session and
 * records PRS. Non-blocking: any failure just dismisses quietly.
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
  const [value, setValue] = useState(7)

  if (done) return null

  async function submit(prs: number | null) {
    setSubmitting(true)
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

  const band = prsBand(value)

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

      <div className="mt-3">
        <div className="flex items-end justify-between gap-2">
          <span className="text-3xl font-bold leading-none tabular-nums" style={{ color: band.color }}>
            {value}
            <span className="text-base font-medium text-muted-foreground">/{PRS_MAX}</span>
          </span>
          <span className="text-right text-xs font-semibold" style={{ color: band.color }}>
            {band.expectation}
          </span>
        </div>

        <input
          type="range"
          min={PRS_MIN}
          max={PRS_MAX}
          step={1}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          disabled={submitting}
          aria-label="Perceived recovery 0 to 10"
          className="mt-2 w-full"
          style={{ accentColor: band.color }}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>0 · Extremely tired</span>
          <span>10 · Highly energetic</span>
        </div>

        <p className="mt-1 text-xs text-foreground/70">{band.label}</p>
      </div>

      <button
        type="button"
        onClick={() => submit(value)}
        disabled={submitting}
        className="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? "Saving..." : "Start session"}
      </button>
    </div>
  )
}
