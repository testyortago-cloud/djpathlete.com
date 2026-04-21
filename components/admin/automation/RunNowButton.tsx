"use client"

import { useState } from "react"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import type { CronJobName } from "@/lib/cron-catalog"

interface RunNowButtonProps {
  jobName: CronJobName
  label: string
}

export function RunNowButton({ jobName, label }: RunNowButtonProps) {
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/automation/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobName }),
      })
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) {
        const msg = (body?.error as string | undefined) ?? `HTTP ${res.status}`
        throw new Error(msg)
      }
      const result = body?.result as { paused?: boolean } | undefined
      if (result?.paused) {
        toast.info(`${label} is paused — flip the pause switch above to run it.`)
      } else {
        toast.success(`${label} finished.`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Run failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
      aria-label={`Run ${label} now`}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
      {busy ? "Running…" : "Run now"}
    </button>
  )
}
