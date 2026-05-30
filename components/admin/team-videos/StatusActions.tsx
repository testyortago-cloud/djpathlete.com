"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { TeamVideoSubmission, VideoUpload } from "@/types/database"
import {
  generateVideoThumbnailFromUrl,
  uploadThumbnailFor,
} from "@/lib/firebase-client-thumbnail"
import { useAiJob } from "@/hooks/use-ai-job"

interface Props {
  submission: TeamVideoSubmission
  /** Signed read URL for the current version, used to grab a thumbnail frame
   *  in the browser when promoting to Content Studio. */
  videoUrl: string | null
  /** When true (DB feature flag on), show "Generate Captioned Cut" on
   *  approved/locked submissions. */
  captionedCutEnabled?: boolean
}

export function StatusActions({ submission, videoUrl, captionedCutEnabled = false }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<
    null | "request_revision" | "approve" | "reopen" | "send" | "caption"
  >(null)
  const [captionJobId, setCaptionJobId] = useState<string | null>(null)
  const { status: capStatus, result: capResult, error: capError } = useAiJob(captionJobId)

  useEffect(() => {
    if (capStatus === "completed" && capResult) {
      const postIds = (capResult.postIds as string[] | undefined) ?? []
      toast.success(
        postIds.length
          ? `Captioned cut ready — ${postIds.length} draft post${postIds.length > 1 ? "s" : ""}`
          : "Captioned cut ready",
      )
      if (postIds[0]) router.push(`/admin/content/post/${postIds[0]}`)
      setCaptionJobId(null)
    } else if (capStatus === "failed") {
      toast.error(capError || "Captioned cut failed")
      setCaptionJobId(null)
    }
  }, [capStatus, capResult, capError, router])

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
      const { videoUpload } = (await res.json()) as { videoUpload?: VideoUpload }
      toast.success("Sent to Content Studio")

      // Best-effort thumbnail — same browser-canvas pattern as the regular
      // Content Studio uploader. A failure here (no CORS, unsupported codec,
      // tainted canvas) leaves thumbnail_path null and the kanban falls back
      // to the generic Film icon — same as before this fix.
      if (videoUpload?.id && videoUrl) {
        void (async () => {
          const blob = await generateVideoThumbnailFromUrl(videoUrl)
          if (blob) await uploadThumbnailFor(videoUpload.id, blob)
        })()
      }

      router.push("/admin/content?tab=videos")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Handoff failed")
    } finally {
      setBusy(null)
    }
  }

  async function generateCaptionedCut() {
    setBusy("caption")
    try {
      const res = await fetch("/api/admin/content-studio/captioned-cut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId: submission.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        // Freshly promoted — transcription still running, or not yet eligible.
        toast.message(data.error ?? "Still transcribing — try again shortly.")
        router.refresh()
        return
      }
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`)
      const newJobId = data?.jobId
      if (typeof newJobId !== "string" || !newJobId) {
        throw new Error("Server returned no job id")
      }
      setCaptionJobId(newJobId)
      toast.message("Rendering captioned cut…")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start render")
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
  const canCaption =
    captionedCutEnabled &&
    (submission.status === "approved" || submission.status === "locked")
  // Guard on captionJobId: useAiJob(null) defaults status to "pending", so
  // without this the button would be permanently disabled before any render.
  const captionRunning =
    busy === "caption" ||
    (captionJobId !== null && (capStatus === "pending" || capStatus === "processing"))

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
      {canCaption && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null || captionRunning}
          onClick={generateCaptionedCut}
        >
          {captionRunning ? "Rendering…" : "Generate Captioned Cut"}
        </Button>
      )}
    </div>
  )
}
