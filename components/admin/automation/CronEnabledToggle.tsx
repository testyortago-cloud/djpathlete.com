"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface CronEnabledToggleProps {
  enabledKey: string
  initialEnabled: boolean
  label: string
}

/**
 * A per-cron on/off switch. Flips the system_settings row identified by
 * enabledKey via /api/admin/automation/toggle-cron. Independent of the
 * global automation_paused kill switch.
 */
export function CronEnabledToggle({ enabledKey, initialEnabled, label }: CronEnabledToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)

  async function handleToggle() {
    if (saving) return
    const next = !enabled
    setSaving(true)
    setEnabled(next) // optimistic
    try {
      const res = await fetch("/api/admin/automation/toggle-cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledKey, enabled: next }),
      })
      if (!res.ok) throw new Error("Failed to save")
      toast.success(next ? `${label}: enabled` : `${label}: disabled`)
    } catch {
      setEnabled(!next) // revert
      toast.error("Failed to save toggle. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${label} — ${enabled ? "enabled" : "disabled"}`}
      onClick={handleToggle}
      disabled={saving}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        enabled ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
          enabled ? "translate-x-5" : "translate-x-0.5",
        )}
      />
      {saving && (
        <Loader2 className="absolute right-1.5 size-3 animate-spin text-white" aria-hidden />
      )}
    </button>
  )
}
