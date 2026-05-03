"use client"

import { useState } from "react"
import { Loader2, PlayCircle } from "lucide-react"
import { toast } from "sonner"

interface RunResult {
  jobName: string
  ok: boolean
  status: number
  body: unknown
}

interface RunAllResponse {
  total: number
  success: number
  failed: number
  results: RunResult[]
}

/**
 * Triggers every cron job in the catalog sequentially. Disabled jobs return
 * paused: true upstream and don't burn cost.
 */
export function RunAllButton() {
  const [busy, setBusy] = useState(false)

  async function run() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/automation/run-all", {
        method: "POST",
      })
      const body = (await res.json().catch(() => null)) as RunAllResponse | null
      if (!res.ok || !body) {
        throw new Error(`HTTP ${res.status}`)
      }
      if (body.failed === 0) {
        toast.success(`All ${body.total} tasks finished.`)
      } else {
        toast.warning(`${body.success} of ${body.total} succeeded — ${body.failed} failed`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Run-all failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-white text-sm font-medium hover:bg-surface transition-colors disabled:opacity-50"
      aria-label="Run all enabled tasks now"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
      {busy ? "Running all…" : "Run all"}
    </button>
  )
}
