"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

interface Props {
  submissionId: string
  /** Copy from unsentFeedback().message — already counts and pluralises. */
  message: string
}

/**
 * Nag strip for notes Darren wrote but never sent.
 *
 * Commenting deliberately doesn't email the editor (he leaves several notes per
 * cut), so "Request revision" is the send action — but nothing used to say so.
 * A note could sit unread for weeks while both sides waited on each other.
 */
export function UnsentFeedbackBanner({ submissionId, message }: Props) {
  const router = useRouter()
  const [sending, setSending] = useState(false)

  async function send() {
    setSending(true)
    try {
      const res = await fetch(`/api/admin/team-videos/${submissionId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_revision" }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? "Failed to send")
      }
      toast.success("Notes sent — your editor has been emailed")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
      <div className="min-w-0">
        <p className="font-body text-sm font-medium text-warning">{message}</p>
        <p className="font-body text-xs text-muted-foreground">
          Send them so a new version can land — commenting on its own doesn&apos;t
          notify anyone.
        </p>
      </div>
      <Button size="sm" disabled={sending} onClick={send}>
        <Send className="mr-1.5 size-3.5" />
        {sending ? "Sending…" : "Send notes to editor"}
      </Button>
    </div>
  )
}
