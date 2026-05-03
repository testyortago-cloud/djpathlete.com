"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { TeamVideoSubmission } from "@/types/database"

interface Props {
  submission: TeamVideoSubmission
}

export function StatusActions({ submission }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<
    null | "request_revision" | "approve" | "reopen" | "send"
  >(null)

  async function callStatus(action: "request_revision" | "approve" | "reopen") {
    setBusy(action)
    try {
      const res = await fetch(
        `/api/admin/team-videos/${submission.id}/status`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? "Status update failed")
      }
      const labels = {
        request_revision: "Revision requested",
        approve: "Submission approved",
        reopen: "Reopened for revision",
      }
      toast.success(labels[action])
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed")
    } finally {
      setBusy(null)
    }
  }

  async function callSend() {
    setBusy("send")
    try {
      const res = await fetch(
        `/api/admin/team-videos/${submission.id}/send-to-content-studio`,
        { method: "POST" },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? "Handoff failed")
      }
      toast.success("Sent to Content Studio")
      router.push("/admin/content?tab=videos")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Handoff failed")
    } finally {
      setBusy(null)
    }
  }

  const canRequestRevision =
    submission.status === "submitted" || submission.status === "in_review"
  const canApprove =
    submission.status === "submitted" || submission.status === "in_review"
  const canReopen = submission.status === "approved"
  const canSend = submission.status === "approved"

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRequestRevision && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => callStatus("request_revision")}
        >
          {busy === "request_revision" ? "..." : "Request revision"}
        </Button>
      )}
      {canApprove && (
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() => callStatus("approve")}
        >
          {busy === "approve" ? "..." : "Approve"}
        </Button>
      )}
      {canReopen && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => callStatus("reopen")}
        >
          {busy === "reopen" ? "..." : "Reopen"}
        </Button>
      )}
      {canSend && (
        <Button size="sm" disabled={busy !== null} onClick={callSend}>
          {busy === "send" ? "..." : "Send to Content Studio"}
        </Button>
      )}
    </div>
  )
}
