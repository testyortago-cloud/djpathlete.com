"use client"

import { Copy, RefreshCw, Pencil, Sparkles, Loader2, AlertCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useAiJob } from "@/hooks/use-ai-job"
import type { VideoTranscript, VideoUpload } from "@/types/database"

interface TranscriptTabProps {
  transcript: VideoTranscript | null
  video: VideoUpload | null
}

export function TranscriptTab({ transcript, video }: TranscriptTabProps) {
  if (!transcript) {
    return <TranscriptEmptyState video={video} />
  }

  const isVision = transcript.source === "vision"

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(transcript!.transcript_text)
      toast.success("Transcript copied")
    } catch {
      toast.error("Copy failed")
    }
  }

  function handleStub(label: string) {
    toast.info(`${label} is coming in a later phase — Phase 2 ships the transcript-next-to-video fix only.`)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center flex-wrap gap-2 px-6 py-3 border-b border-border bg-background">
        {isVision && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-medium">
            <Sparkles className="size-3" /> Vision description
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {transcript.transcript_text.length.toLocaleString()} characters · {transcript.language}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10"
          >
            <Copy className="size-3.5" /> Copy
          </button>
          <button
            type="button"
            onClick={() => handleStub("Regenerate")}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <RefreshCw className="size-3.5" /> Regenerate
          </button>
          <button
            type="button"
            onClick={() => handleStub("Edit")}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <p className="text-sm text-primary leading-relaxed whitespace-pre-wrap font-body">
          {transcript.transcript_text}
        </p>
      </div>
    </div>
  )
}

function TranscriptEmptyState({ video }: { video: VideoUpload | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const aiJob = useAiJob(activeJobId)

  // When the tracked job reaches a terminal state, refresh the drawer so the
  // server reloads `data.transcript` and the empty state is replaced by the
  // real transcript view. Chain to the Vision fallback job if the webhook
  // queued one for a silent video.
  useEffect(() => {
    if (!activeJobId) return
    const terminal = ["completed", "failed", "cancelled"]
    if (!terminal.includes(aiJob.status)) return

    const fallbackJobId =
      aiJob.status === "completed" &&
      aiJob.result &&
      typeof (aiJob.result as Record<string, unknown>).fallbackJobId === "string"
        ? ((aiJob.result as Record<string, unknown>).fallbackJobId as string)
        : null

    if (fallbackJobId) {
      toast.info("No speech detected — analyzing video frames with Claude Vision")
      setActiveJobId(fallbackJobId)
      return
    }

    const t = setTimeout(() => {
      setActiveJobId(null)
      if (aiJob.status === "failed") {
        toast.error(`Transcription failed: ${aiJob.error ?? "unknown error"}`)
      } else if (aiJob.status === "completed") {
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
      router.refresh()
    }, 750)
    return () => clearTimeout(t)
  }, [activeJobId, aiJob.status, aiJob.error, aiJob.result, router])

  async function transcribe() {
    if (!video) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/videos/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: video.id }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Transcribe failed")
      const body = (await res.json()) as { jobId: string }
      setActiveJobId(body.jobId)
      toast.success("Transcription queued — this takes 1-5 min")
    } catch (error) {
      toast.error(`Transcribe failed: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const isTranscribing = video?.status === "transcribing" || activeJobId !== null
  const isFailed = video?.status === "failed"
  const canTranscribe = video && (video.status === "uploaded" || video.status === "failed")

  return (
    <div className="py-12 text-center px-6">
      {isTranscribing ? (
        <>
          <Loader2 className="size-8 text-warning mx-auto mb-2 animate-spin" strokeWidth={1.5} />
          <p className="text-sm text-primary">Transcribing…</p>
          <p className="text-xs text-muted-foreground mt-1">This usually takes 1-5 minutes.</p>
        </>
      ) : (
        <>
          {isFailed ? (
            <AlertCircle className="size-8 text-error mx-auto mb-2" strokeWidth={1.5} />
          ) : (
            <Sparkles className="size-8 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
          )}
          <p className="text-sm text-muted-foreground">
            {isFailed ? "Last transcription failed." : "No transcript yet."}
          </p>
          {canTranscribe ? (
            <button
              type="button"
              onClick={transcribe}
              disabled={busy}
              className="mt-4 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/10 disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Queueing…
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" /> {isFailed ? "Retry transcription" : "Transcribe"}
                </>
              )}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">
              {video ? "This video isn't ready to transcribe yet." : "Open this video from the pipeline to transcribe."}
            </p>
          )}
        </>
      )}
    </div>
  )
}
