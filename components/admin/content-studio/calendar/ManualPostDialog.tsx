"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { SocialPlatform } from "@/types/database"
import { defaultPublishTimeForPlatform } from "@/lib/content-studio/calendar-defaults"

interface ManualPostDialogProps {
  dayKey: string // YYYY-MM-DD
  onClose: () => void
  onCreated: (postId: string) => void
}

const PLATFORMS: SocialPlatform[] = ["instagram", "tiktok", "facebook", "youtube", "youtube_shorts", "linkedin"]

export function ManualPostDialog({ dayKey, onClose, onCreated }: ManualPostDialogProps) {
  const [platform, setPlatform] = useState<SocialPlatform>("instagram")
  const [caption, setCaption] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const day = new Date(`${dayKey}T00:00:00Z`)
      const scheduled_at = defaultPublishTimeForPlatform(platform, day).toISOString()
      const res = await fetch("/api/admin/content-studio/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, caption, scheduled_at }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Create failed")
      const data = (await res.json()) as { id: string }
      toast.success("Manual post scheduled")
      onCreated(data.id)
    } catch (err) {
      toast.error((err as Error).message || "Create failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="rounded-lg bg-white border border-border shadow-lg p-4 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-heading text-sm text-primary mb-3">New manual post — {dayKey}</h3>
        <label className="block text-xs text-muted-foreground mb-3">
          Platform
          <select
            aria-label="Platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
            className="mt-1 block w-full rounded border border-border px-2 py-1 text-sm"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted-foreground mb-3">
          Caption
          <textarea
            aria-label="Caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded border border-border px-2 py-1 text-sm"
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  )
}
