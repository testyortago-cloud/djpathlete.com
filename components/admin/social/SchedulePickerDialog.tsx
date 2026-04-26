"use client"

import { useState } from "react"
import { Calendar as CalendarIcon, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { SocialPost } from "@/types/database"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError } from "@/lib/errors/humanize"

interface SchedulePickerDialogProps {
  post: SocialPost
  open: boolean
  onOpenChange: (open: boolean) => void
  onScheduled: (updated: SocialPost) => void
}

function defaultScheduleTime(): { date: string; time: string } {
  const now = new Date(Date.now() + 60 * 60 * 1000)
  const minutes = now.getMinutes()
  const rounded = Math.ceil(minutes / 15) * 15
  if (rounded === 60) {
    now.setHours(now.getHours() + 1)
    now.setMinutes(0)
  } else {
    now.setMinutes(rounded)
  }
  now.setSeconds(0, 0)

  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const hh = String(now.getHours()).padStart(2, "0")
  const mi = String(now.getMinutes()).padStart(2, "0")
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` }
}

export function SchedulePickerDialog({ post, open, onOpenChange, onScheduled }: SchedulePickerDialogProps) {
  const initial = defaultScheduleTime()
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    const scheduledAt = new Date(`${date}T${time}:00`)
    if (Number.isNaN(scheduledAt.getTime())) {
      const msg = "Please enter a valid date and time"
      setError(msg)
      toast.error(msg)
      return
    }
    if (scheduledAt.getTime() <= Date.now()) {
      const msg = "Scheduled time must be in the future"
      setError(msg)
      toast.error(msg)
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduled_at: scheduledAt.toISOString() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const { message } = summarizeApiError(res, data, "Failed to schedule post")
        setError(message)
        toast.error(message)
        setSaving(false)
        return
      }
      const data = (await res.json()) as Pick<SocialPost, "id" | "approval_status" | "scheduled_at">
      onScheduled({ ...post, approval_status: data.approval_status, scheduled_at: data.scheduled_at })
      toast.success(`Scheduled for ${scheduledAt.toLocaleString()}`)
      onOpenChange(false)
    } catch (e) {
      const message = (e as Error).message || "We couldn't reach the server. Please try again."
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary">
            <CalendarIcon className="size-5" />
            Schedule post
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <FormErrorBanner message={error} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="schedule-date">
                Date
              </label>
              <input
                id="schedule-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-border p-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="schedule-time">
                Time
              </label>
              <input
                id="schedule-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full rounded-md border border-border p-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            The post will publish automatically at this time. You can reschedule later.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            <X className="size-3" /> Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
