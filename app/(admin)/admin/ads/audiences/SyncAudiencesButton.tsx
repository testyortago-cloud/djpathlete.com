"use client"

import { useState } from "react"
import { toast } from "sonner"

export function SyncAudiencesButton() {
  const [pending, setPending] = useState(false)

  async function trigger() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch("/api/admin/ads/sync-audiences", { method: "POST" })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        lists_processed?: number
        lists_failed?: number
        lists_skipped_no_token?: number
        total_added?: number
        total_removed?: number
        error?: string
      }
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const skipped = body.lists_skipped_no_token ?? 0
      const failed = body.lists_failed ?? 0
      const added = body.total_added ?? 0
      const removed = body.total_removed ?? 0
      if (skipped > 0 && (body.lists_processed ?? 0) === 0) {
        toast.message(`Token missing — ${skipped} list${skipped === 1 ? "" : "s"} skipped.`)
      } else if (failed > 0) {
        toast.error(`Sync finished with ${failed} failure${failed === 1 ? "" : "s"}.`)
      } else {
        toast.success(`Synced. +${added} / −${removed} members.`)
      }
      // Refresh after a moment so the table reflects new state
      setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      toast.error(`Sync failed: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={pending}
      className="inline-flex items-center px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
    >
      {pending ? "Syncing..." : "Sync now"}
    </button>
  )
}
