"use client"

import { useState } from "react"
import { AlertTriangle, Play, Pause } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface PauseToggleProps {
  initialPaused: boolean
}

export function PauseToggle({ initialPaused }: PauseToggleProps) {
  const [paused, setPaused] = useState(initialPaused)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    const nextPaused = !paused
    try {
      const res = await fetch("/api/admin/automation/pause", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: nextPaused }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update")
      setPaused(nextPaused)
      toast.success(
        nextPaused
          ? "Automation paused — no tasks will run until you resume."
          : "Automation resumed — tasks will run on their normal schedule.",
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update pause flag.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl border p-4",
        paused ? "border-warning/40 bg-warning/5" : "border-border bg-white",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            paused ? "bg-warning/15 text-warning" : "bg-success/10 text-success",
          )}
        >
          {paused ? <Pause className="size-5" /> : <Play className="size-5" />}
        </div>
        <div>
          <p className="font-medium text-primary">{paused ? "Automation is paused" : "Automation is running"}</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {paused
              ? "No tasks are running right now — stats won't update, emails won't send, and the AI won't run its weekly checks until you resume."
              : "All tasks are running on their normal schedule. Switch to paused if you want to stop emails or stats updates temporarily."}
          </p>
          {paused && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangle className="size-3.5" /> Remember to resume when you&apos;re done.
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={cn(
          "shrink-0 text-sm font-medium px-4 py-2 rounded-md transition-colors",
          paused
            ? "bg-success text-success-foreground hover:bg-success/90"
            : "bg-warning text-warning-foreground hover:bg-warning/90",
          "disabled:opacity-60 disabled:cursor-not-allowed",
        )}
      >
        {busy ? "Saving…" : paused ? "Resume" : "Pause all"}
      </button>
    </div>
  )
}
