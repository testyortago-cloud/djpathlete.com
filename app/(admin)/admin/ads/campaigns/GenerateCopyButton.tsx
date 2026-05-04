"use client"

import { useState } from "react"
import { toast } from "sonner"

interface Props {
  campaignId: string
  /** Performance Max ad assets are managed by Plan 1.5g — disable here. */
  disabled?: boolean
}

export function GenerateCopyButton({ campaignId, disabled }: Props) {
  const [pending, setPending] = useState(false)

  async function trigger() {
    if (pending || disabled) return
    setPending(true)
    try {
      const res = await fetch(`/api/admin/ads/campaigns/${campaignId}/generate-copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        variants_generated?: number
        variants_persisted?: number
        ad_groups_skipped?: number
        error?: string
      }
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const persisted = body.variants_persisted ?? 0
      const skipped = body.ad_groups_skipped ?? 0
      if (persisted === 0) {
        toast.message(`No variants generated${skipped > 0 ? ` (${skipped} ad groups skipped)` : ""}.`)
      } else {
        toast.success(`${persisted} variant${persisted === 1 ? "" : "s"} queued for review.`)
      }
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
      disabled={pending || disabled}
      title={disabled ? "Performance Max ad assets are managed by the AI Agent (Plan 1.5g)" : "Generate brand-voiced ad copy variants for this campaign"}
      className="text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-accent hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? "Generating..." : "Generate copy"}
    </button>
  )
}
