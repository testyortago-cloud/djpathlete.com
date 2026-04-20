"use client"

import { Film, Loader2, CheckCircle, AlertCircle, Sparkles, Play, Trash2, X } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useAiJob } from "@/hooks/use-ai-job"
import type { VideoUpload } from "@/types/database"

interface VideoListCardProps {
  video: VideoUpload
  onAction: () => void
}

function statusBadge(status: VideoUpload["status"]) {
  if (status === "uploaded") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Film className="size-3.5" /> Ready to transcribe
      </span>
    )
  }
  if (status === "transcribing") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
        <Loader2 className="size-3.5 animate-spin" /> Transcribing
      </span>
    )
  }
  if (status === "transcribed" || status === "analyzed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <CheckCircle className="size-3.5" /> Transcribed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-error">
      <AlertCircle className="size-3.5" /> Failed
    </span>
  )
}

export function VideoListCard({ video, onAction }: VideoListCardProps) {
  const [busy, setBusy] = useState<"transcribe" | "fanout" | "delete" | "preview" | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Optimistic status override — flips instantly when the user clicks
  // Transcribe so the spinner badge shows without waiting for the page
  // to refresh with the real value from Supabase.
  const [optimisticStatus, setOptimisticStatus] = useState<VideoUpload["status"] | null>(null)

  // Firestore ai_jobs doc id — when set, useAiJob subscribes in real time.
  // Set after the Transcribe POST returns, cleared when the Function completes.
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const aiJob = useAiJob(activeJobId)

  // When the tracked job reaches a terminal state, refresh the page to pick
  // up the final video_uploads.status (either "transcribed" from the webhook
  // or "failed" if AssemblyAI / the Function errored).
  useEffect(() => {
    if (!activeJobId) return
    const terminal = ["completed", "failed", "cancelled"]
    if (!terminal.includes(aiJob.status)) return
    // Small delay so the webhook's video_uploads UPDATE lands before we re-read.
    const t = setTimeout(() => {
      setActiveJobId(null)
      setOptimisticStatus(null)
      if (aiJob.status === "failed") {
        toast.error(`Transcription failed: ${aiJob.error ?? "unknown error"}`)
      } else if (aiJob.status === "completed") {
        toast.success("Transcription complete")
      }
      onAction()
    }, 750)
    return () => clearTimeout(t)
  }, [activeJobId, aiJob.status, aiJob.error, onAction])

  async function transcribe() {
    setBusy("transcribe")
    setOptimisticStatus("transcribing") // instant visual flip
    try {
      const res = await fetch("/api/admin/videos/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: video.id }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Transcribe failed")
      const body = (await res.json()) as { jobId: string }
      setActiveJobId(body.jobId) // start listening for completion
      toast.success("Transcription queued — this takes 1-5 min")
    } catch (error) {
      setOptimisticStatus(null) // revert optimistic flip
      toast.error(`Transcribe failed: ${(error as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function fanout() {
    setBusy("fanout")
    try {
      const res = await fetch("/api/admin/social/fanout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: video.id }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Fanout failed")
      toast.success("Generating 6 social captions — check the Social tab in ~1 minute")
      onAction()
    } catch (error) {
      toast.error(`Fanout failed: ${(error as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function openPreview() {
    setBusy("preview")
    try {
      const res = await fetch(`/api/admin/videos/${video.id}`)
      if (!res.ok) throw new Error((await res.text()) || "Preview unavailable")
      const body = (await res.json()) as { previewUrl: string }
      setPreviewUrl(body.previewUrl)
    } catch (error) {
      toast.error(`Preview failed: ${(error as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function deleteVideo() {
    const confirmed = window.confirm(
      `Delete "${video.title ?? video.original_filename}"?\n\nThis removes the video file from storage and the database row. Cannot be undone.`,
    )
    if (!confirmed) return
    setBusy("delete")
    try {
      const res = await fetch(`/api/admin/videos/${video.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.text()) || "Delete failed")
      toast.success("Video deleted")
      onAction()
    } catch (error) {
      toast.error(`Delete failed: ${(error as Error).message}`)
      setBusy(null)
    }
  }

  const effectiveStatus = optimisticStatus ?? video.status
  const canTranscribe = effectiveStatus === "uploaded"
  const canFanout = effectiveStatus === "transcribed" || effectiveStatus === "analyzed"

  return (
    <>
      <div className="bg-white rounded-xl border border-border p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={openPreview}
            disabled={busy !== null}
            className={cn(
              "group relative flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 hover:bg-primary/15",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
            aria-label="Preview video"
            title="Preview video"
          >
            {busy === "preview" ? (
              <Loader2 className="size-5 text-primary animate-spin" />
            ) : (
              <>
                <Film className="size-5 text-primary group-hover:opacity-0 transition-opacity" />
                <Play className="size-5 text-primary absolute opacity-0 group-hover:opacity-100 transition-opacity" />
              </>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-primary truncate">{video.title ?? video.original_filename}</p>
            <p className="text-xs text-muted-foreground truncate">{video.original_filename}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {statusBadge(effectiveStatus)}
          <button
            type="button"
            onClick={transcribe}
            disabled={!canTranscribe || busy !== null}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/10 disabled:text-muted-foreground disabled:cursor-not-allowed"
          >
            {busy === "transcribe" ? "Queueing..." : "Transcribe"}
          </button>
          <button
            type="button"
            onClick={fanout}
            disabled={!canFanout || busy !== null}
            className="text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground hover:bg-accent/90 disabled:bg-accent/10 disabled:text-muted-foreground disabled:cursor-not-allowed inline-flex items-center gap-1"
          >
            <Sparkles className="size-3" />
            {busy === "fanout" ? "Queueing..." : "Generate Social"}
          </button>
          <button
            type="button"
            onClick={deleteVideo}
            disabled={busy !== null}
            className="text-xs p-1.5 rounded-md text-muted-foreground hover:bg-error/10 hover:text-error disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Delete video"
            title="Delete video"
          >
            {busy === "delete" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </button>
        </div>
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Video preview"
        >
          <div
            className="relative w-full max-w-4xl bg-black rounded-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewUrl(null)}
              className="absolute top-2 right-2 z-10 rounded-full bg-black/60 hover:bg-black/80 text-white p-2"
              aria-label="Close preview"
            >
              <X className="size-5" />
            </button>
            <video
              src={previewUrl}
              controls
              autoPlay
              className="w-full h-auto max-h-[80vh]"
              preload="metadata"
            >
              Your browser does not support the video element.
            </video>
            <div className="bg-surface px-4 py-2 text-sm text-primary">
              {video.title ?? video.original_filename}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
