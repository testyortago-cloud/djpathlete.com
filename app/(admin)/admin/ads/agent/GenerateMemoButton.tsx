"use client"

import { useState } from "react"
import { toast } from "sonner"

export function GenerateMemoButton() {
  const [pending, setPending] = useState(false)

  async function trigger() {
    if (pending) return
    if (!confirm("Generate a fresh strategist memo now? Takes ~30 seconds.")) return
    setPending(true)
    try {
      const res = await fetch("/api/admin/ads/agent/run-strategist", { method: "POST" })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string }
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      toast.success("Memo generated.")
      setTimeout(() => window.location.reload(), 600)
    } catch (err) {
      toast.error(`Generate failed: ${(err as Error).message}`)
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
      {pending ? "Generating..." : "Generate now"}
    </button>
  )
}
