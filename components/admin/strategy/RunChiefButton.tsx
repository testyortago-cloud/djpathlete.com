"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"

interface Props {
  variant?: "primary" | "ghost"
  label?: string
}

export function RunChiefButton({ variant = "primary", label = "Run chief now" }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function run() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/strategy/chief/run", { method: "POST" })
      const body = (await res.json().catch(() => null)) as { error?: string; jobId?: string } | null
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      toast.success("Chief queued. A draft brief will appear when it finishes.")
      startTransition(() => router.refresh())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enqueue chief run")
    } finally {
      setBusy(false)
    }
  }

  if (variant === "ghost") {
    return (
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        {busy ? "Running…" : label}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
      {busy ? "Running…" : label}
    </button>
  )
}
