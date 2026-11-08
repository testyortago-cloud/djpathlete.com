"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, PenLine } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Starts the AI draft for the topic the agent queued — the same call as "Generate draft" on Topic Suggestions. */
export function WriteDraftButton({ calendarId }: { calendarId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onClick() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/blog/generate-from-suggestion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendarId }),
      })
      const json = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string }
      if (!res.ok || !json.jobId) {
        toast.error(json.error ?? "Could not start the draft. Please try again.")
        setBusy(false)
        return
      }
      router.push(`/admin/blog?just_queued=${encodeURIComponent(json.jobId)}`)
    } catch {
      toast.error("Could not reach the server. Please try again.")
      setBusy(false)
    }
  }

  return (
    <Button size="sm" onClick={onClick} disabled={busy}>
      <PenLine />
      {busy ? "Starting the draft…" : "Write the draft"}
    </Button>
  )
}

/** Marks the agent's question as handled. The next weekly run reads this. */
export function MarkHandledButton({ notificationId }: { notificationId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onClick() {
    setBusy(true)
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: notificationId }),
      })
      if (!res.ok) {
        toast.error("Could not save that. Please try again.")
        setBusy(false)
        return
      }
      toast.success("Marked as handled.")
      router.refresh()
    } catch {
      toast.error("Could not reach the server. Please try again.")
      setBusy(false)
    }
  }

  return (
    <Button size="sm" onClick={onClick} disabled={busy}>
      <Check />
      {busy ? "Saving…" : "Mark as handled"}
    </Button>
  )
}
