"use client"

import { useState } from "react"
import { Network, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

interface SweepInboundLinksButtonProps {
  postId: string
  postTitle: string
}

export function SweepInboundLinksButton({ postId, postTitle }: SweepInboundLinksButtonProps) {
  const [submitting, setSubmitting] = useState(false)

  async function onSweep() {
    if (
      !window.confirm(
        `Sweep older posts and insert up to 2 inbound links to "${postTitle}"? The edits will go live immediately.`,
      )
    )
      return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/blog/${postId}/sweep-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { candidateCount: number }
      toast.success(
        `Sweep queued against ${body.candidateCount} candidate post${body.candidateCount === 1 ? "" : "s"}. The AI is scanning each — check back in a minute.`,
      )
    } catch (err) {
      toast.error(`Could not start sweep: ${(err as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Button type="button" variant="outline" onClick={onSweep} disabled={submitting}>
      {submitting ? <Loader2 className="size-4 animate-spin" /> : <Network className="size-4" />}
      Sweep inbound links
    </Button>
  )
}
