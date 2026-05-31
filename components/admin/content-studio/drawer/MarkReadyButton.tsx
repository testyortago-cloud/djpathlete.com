"use client"

import { useState } from "react"
import { CheckCircle2, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

interface MarkReadyButtonProps {
  videoUploadId: string
  needsEdit: boolean
}

export function MarkReadyButton({ videoUploadId, needsEdit }: MarkReadyButtonProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  // Once the video is postable there is nothing to override.
  if (!needsEdit) return null

  async function markReady() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/videos/${videoUploadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ needs_edit: false }),
      })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error ?? "Request failed"
        throw new Error(msg)
      }
      toast.success("Marked as ready — this video can now be posted")
      router.refresh()
    } catch (e) {
      toast.error(`Couldn't mark ready: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      onClick={markReady}
      disabled={saving}
      aria-busy={saving}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted disabled:opacity-60"
    >
      {saving ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          <span className="sr-only">Saving…</span>
        </>
      ) : (
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
      )}
      Mark as ready
    </button>
  )
}
