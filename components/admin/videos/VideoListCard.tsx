"use client"

import { Film, Loader2, CheckCircle, AlertCircle, Sparkles } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
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
  const [busy, setBusy] = useState<"transcribe" | "fanout" | null>(null)

  async function transcribe() {
    setBusy("transcribe")
    try {
      const res = await fetch("/api/admin/videos/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: video.id }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Transcribe failed")
      toast.success("Transcription queued")
      onAction()
    } catch (error) {
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

  const canTranscribe = video.status === "uploaded"
  const canFanout = video.status === "transcribed" || video.status === "analyzed"

  return (
    <div className="bg-white rounded-xl border border-border p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Film className="size-4 text-primary" />
        </div>
        <div>
          <p className="font-medium text-primary">{video.title ?? video.original_filename}</p>
          <p className="text-xs text-muted-foreground">{video.original_filename}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {statusBadge(video.status)}
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
      </div>
    </div>
  )
}
