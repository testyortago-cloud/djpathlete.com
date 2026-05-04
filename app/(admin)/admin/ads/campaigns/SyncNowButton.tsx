"use client"

import { useState } from "react"
import { toast } from "sonner"

export function SyncNowButton() {
  const [pending, setPending] = useState(false)

  async function trigger() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch("/api/admin/ads/sync", { method: "POST" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { jobId: string }
      toast.success(`Sync queued (job ${body.jobId.slice(0, 8)}…)`)
    } catch (err) {
      toast.error(`Sync failed to queue: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={pending}
      className="inline-flex items-center px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
    >
      {pending ? "Queuing..." : "Sync now"}
    </button>
  )
}
