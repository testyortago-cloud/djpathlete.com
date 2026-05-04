"use client"

import { useState } from "react"
import { toast } from "sonner"

interface Props {
  isConnected: boolean
}

export function ConnectGoogleAdsButton({ isConnected }: Props) {
  const [pending, setPending] = useState(false)

  async function disconnect() {
    if (pending) return
    if (!confirm("Disconnect Google Ads? Synced data is preserved but no further updates will run.")) return
    setPending(true)
    try {
      const res = await fetch("/api/integrations/google-ads/disconnect", { method: "POST" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success("Disconnected.")
      window.location.reload()
    } catch (err) {
      toast.error(`Disconnect failed: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  if (isConnected) {
    return (
      <button
        type="button"
        onClick={disconnect}
        disabled={pending}
        className="inline-flex items-center px-4 py-2 rounded-md border border-error/40 text-error bg-error/5 text-sm font-medium hover:bg-error/10 transition-colors disabled:opacity-50"
      >
        {pending ? "Disconnecting..." : "Disconnect Google Ads"}
      </button>
    )
  }

  return (
    <a
      href="/api/integrations/google-ads/connect"
      className="inline-flex items-center px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
    >
      Connect Google Ads
    </a>
  )
}
