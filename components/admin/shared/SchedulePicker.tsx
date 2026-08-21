"use client"

import { useState, useEffect } from "react"

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Default: tomorrow at 07:00 local — the coach's usual publishing hour. */
function defaultWhen(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(7, 0, 0, 0)
  return d
}

export function SchedulePicker({
  open,
  title,
  initial,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  initial?: string | null
  busy?: boolean
  onConfirm: (isoUtc: string) => void | Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(() => toLocalInputValue(initial ? new Date(initial) : defaultWhen()))

  useEffect(() => {
    if (open) setValue(toLocalInputValue(initial ? new Date(initial) : defaultWhen()))
  }, [open, initial])

  if (!open) return null

  const parsed = new Date(value)
  const invalid = Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="rounded-xl bg-white border border-border shadow-lg p-4 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-sm text-primary mb-2">{title}</h3>
        <label className="block text-xs text-muted-foreground">
          Date and time
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded border border-border px-2 py-1 text-sm"
          />
        </label>
        <p className="mt-2 text-[11px] text-muted-foreground">
          This is your own local time. {invalid ? "Pick a time in the future." : ""}
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
            onClick={() => onConfirm(parsed.toISOString())}
            disabled={busy || invalid}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  )
}
