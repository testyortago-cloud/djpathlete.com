"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { useAiJob } from "@/hooks/use-ai-job"
import type { VideoUpload } from "@/types/database"

interface VideoRowActionsProps {
  video: VideoUpload
  /** Number of social_posts already generated from this video. */
  postCount: number
}

type ActiveJobKind = "transcribe" | "fanout"

export function VideoRowActions({ video, postCount }: VideoRowActionsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState<ActiveJobKind | null>(null)
  const [activeJob, setActiveJob] = useState<{ id: string; kind: ActiveJobKind } | null>(null)
  const [optimisticStatus, setOptimisticStatus] = useState<VideoUpload["status"] | null>(null)
  const [fanoutJustQueued, setFanoutJustQueued] = useState(false)
  const aiJob = useAiJob(activeJob?.id ?? null)

  useEffect(() => {
    if (!activeJob) return
    const terminal = ["completed", "failed", "cancelled"]
    if (!terminal.includes(aiJob.status)) return

    const fallbackJobId =
      activeJob.kind === "transcribe" &&
      aiJob.status === "completed" &&
      aiJob.result &&
      typeof (aiJob.result as Record<string, unknown>).fallbackJobId === "string"
        ? ((aiJob.result as Record<string, unknown>).fallbackJobId as string)
        : null

    if (fallbackJobId) {
      toast.info("No speech detected — analyzing video frames with Claude Vision")
      setActiveJob({ id: fallbackJobId, kind: "transcribe" })
      return
    }

    const t = setTimeout(() => {
      const kind = activeJob.kind
      setActiveJob(null)
      setOptimisticStatus(null)
      if (aiJob.status === "failed") {
        toast.error(
          `${kind === "fanout" ? "Fanout" : "Transcription"} failed: ${aiJob.error ?? "unknown error"}`,
        )
      } else if (aiJob.status === "completed") {
        if (kind === "fanout") {
          toast.success("Social captions generated")
          setFanoutJustQueued(false)
        } else {
          const resultSource =
            aiJob.result && typeof (aiJob.result as Record<string, unknown>).source === "string"
              ? ((aiJob.result as Record<string, unknown>).source as string)
              : null
          if (resultSource === "vision") {
            toast.success("Video described via Claude Vision — review the transcript to verify")
          } else {
            toast.success("Transcription complete")
          }
        }
      }
      router.refresh()
    }, 750)
    return () => clearTimeout(t)
  }, [activeJob, aiJob.status, aiJob.error, aiJob.result, router])

  async function transcribe() {
    setBusy("transcribe")
    setOptimisticStatus("transcribing")
    try {
      const res = await fetch("/api/admin/videos/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: video.id }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Transcribe failed")
      const body = (await res.json()) as { jobId: string }
      setActiveJob({ id: body.jobId, kind: "transcribe" })
      toast.success("Transcription queued — this takes 1-5 min")
    } catch (error) {
      setOptimisticStatus(null)
      toast.error(`Transcribe failed: ${(error as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function fanout() {
    setBusy("fanout")
    setFanoutJustQueued(true)
    try {
      const res = await fetch("/api/admin/social/fanout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: video.id }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Fanout failed")
      const body = (await res.json()) as { jobId: string }
      setActiveJob({ id: body.jobId, kind: "fanout" })
      toast.success("Generating 6 social captions — this takes ~1 min")
    } catch (error) {
      setFanoutJustQueued(false)
      toast.error(`Fanout failed: ${(error as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const effectiveStatus = optimisticStatus ?? video.status
  const isTranscribing = effectiveStatus === "transcribing" || activeJob?.kind === "transcribe"
  const isFanningOut = busy === "fanout" || activeJob?.kind === "fanout" || fanoutJustQueued
  const hasFanout = postCount > 0 && !isFanningOut

  const canTranscribe =
    !isTranscribing && (effectiveStatus === "uploaded" || effectiveStatus === "failed")
  const canFanout =
    !hasFanout &&
    !isFanningOut &&
    (effectiveStatus === "transcribed" || effectiveStatus === "analyzed")

  return (
    <div className="flex items-center justify-end gap-1.5">
      {canTranscribe && (
        <button
          type="button"
          onClick={transcribe}
          disabled={busy !== null}
          className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          {busy === "transcribe" ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          {effectiveStatus === "failed" ? "Retry" : "Transcribe"}
        </button>
      )}
      {isTranscribing && (
        <span className="text-xs px-2.5 py-1 rounded-md bg-warning/10 text-warning inline-flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" /> Transcribing
        </span>
      )}
      {canFanout && (
        <button
          type="button"
          onClick={fanout}
          disabled={busy !== null}
          className="text-xs px-2.5 py-1 rounded-md bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          <Sparkles className="size-3" /> Generate Social
        </button>
      )}
      {isFanningOut && (
        <span className="text-xs px-2.5 py-1 rounded-md bg-accent/10 text-accent inline-flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" /> Generating
        </span>
      )}
      {hasFanout && (
        <span
          className="text-xs px-2.5 py-1 rounded-md bg-success/10 text-success inline-flex items-center gap-1"
          title="Social captions already generated — open the video to review or regenerate"
        >
          <CheckCircle className="size-3" /> Generated ({postCount})
        </span>
      )}
    </div>
  )
}
