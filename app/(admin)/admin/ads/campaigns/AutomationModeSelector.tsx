"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { GoogleAdsAutomationMode } from "@/types/database"

const MODE_OPTIONS: Array<{ value: GoogleAdsAutomationMode; label: string }> = [
  { value: "auto_pilot", label: "Auto-pilot" },
  { value: "co_pilot", label: "Co-pilot" },
  { value: "advisory", label: "Advisory" },
]

interface Props {
  campaignId: string
  initialMode: GoogleAdsAutomationMode
  /**
   * Performance Max gets locked to advisory by spec D7 — Google's optimizer
   * is opaque enough that external recs frequently conflict with it.
   */
  locked?: boolean
}

export function AutomationModeSelector({ campaignId, initialMode, locked = false }: Props) {
  const [mode, setMode] = useState<GoogleAdsAutomationMode>(initialMode)
  const [pending, setPending] = useState(false)

  async function update(next: GoogleAdsAutomationMode) {
    if (pending || next === mode) return
    setPending(true)
    const previous = mode
    setMode(next)
    try {
      const res = await fetch(`/api/admin/ads/campaigns/${campaignId}/automation-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(`Mode set to ${next.replace("_", "-")}.`)
    } catch (err) {
      setMode(previous)
      toast.error(`Update failed: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  if (locked) {
    return (
      <span className="text-xs text-muted-foreground" title="Performance Max defaults to advisory mode">
        Advisory (locked)
      </span>
    )
  }

  return (
    <select
      value={mode}
      onChange={(e) => update(e.target.value as GoogleAdsAutomationMode)}
      disabled={pending}
      aria-label="Automation mode"
      className="text-xs border border-border rounded-md px-2 py-1 bg-card disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {MODE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
