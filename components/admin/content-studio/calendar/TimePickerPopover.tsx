"use client"

import { useState } from "react"
import type { SocialPlatform } from "@/types/database"
import { defaultPublishTimeForPlatform } from "@/lib/content-studio/calendar-defaults"

interface TimePickerPopoverProps {
  platform: SocialPlatform
  dayKey: string
  onConfirm: (scheduledAtIso: string) => Promise<void> | void
  onCancel: () => void
}

function toLocalInputValue(iso: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${iso.getFullYear()}-${pad(iso.getMonth() + 1)}-${pad(iso.getDate())}T${pad(
    iso.getHours(),
  )}:${pad(iso.getMinutes())}`
}

export function TimePickerPopover({
  platform,
  dayKey,
  onConfirm,
  onCancel,
}: TimePickerPopoverProps) {
  const day = new Date(`${dayKey}T00:00:00Z`)
  const defaultTime = defaultPublishTimeForPlatform(platform, day)
  const [value, setValue] = useState(() => toLocalInputValue(defaultTime))
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm(new Date(value).toISOString())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="rounded-lg bg-white border border-border shadow-lg p-4 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-sm text-primary mb-2">Schedule on {dayKey}</h3>
        <label className="block text-xs text-muted-foreground">
          Time
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded border border-border px-2 py-1 text-sm"
          />
        </label>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Defaulted to {platform}&apos;s best-time preset — you can override.
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  )
}
