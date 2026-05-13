"use client"

import { useState } from "react"
import { RefreshCw, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

interface RefreshPostButtonProps {
  postId: string
  /** Display only — shown in the confirm toast. */
  postTitle: string
  /** Optional: how many times this post has been refreshed before. */
  refreshCount?: number
}

export function RefreshPostButton({ postId, postTitle, refreshCount }: RefreshPostButtonProps) {
  const [submitting, setSubmitting] = useState(false)

  async function onRefresh() {
    const confirmMessage =
      refreshCount && refreshCount > 0
        ? `Refresh "${postTitle}"? This is refresh #${refreshCount + 1}. The post will become a draft until you publish it again.`
        : `Refresh "${postTitle}"? The post will become a draft until you publish it again.`
    if (!window.confirm(confirmMessage)) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/blog/${postId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerReason: "manual" }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      toast.success("Refresh queued. The AI is regenerating — check back in a minute.")
    } catch (err) {
      toast.error(`Could not start refresh: ${(err as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Button type="button" variant="outline" onClick={onRefresh} disabled={submitting}>
      {submitting ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      Refresh with AI
    </Button>
  )
}
