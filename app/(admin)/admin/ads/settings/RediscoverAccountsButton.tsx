"use client"

import { useState } from "react"
import { toast } from "sonner"

export function RediscoverAccountsButton() {
  const [pending, setPending] = useState(false)

  async function rediscover() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch("/api/admin/ads/rediscover-accounts", { method: "POST" })
      const body = (await res.json().catch(() => ({}))) as {
        count?: number
        customer_ids?: string[]
        error?: string
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      toast.success(`Discovered ${body.count ?? 0} customer ID${body.count === 1 ? "" : "s"}.`)
      window.location.reload()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={rediscover}
      disabled={pending}
      className="inline-flex items-center px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:border-accent/60 hover:text-accent transition-colors disabled:opacity-50"
    >
      {pending ? "Discovering..." : "Re-discover accounts"}
    </button>
  )
}
