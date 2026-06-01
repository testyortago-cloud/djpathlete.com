"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Film, AlertCircle, Clock, Loader2, CheckCircle, Clapperboard, Scissors, RefreshCw, Sparkles } from "lucide-react"
import type { VideoUpload } from "@/types/database"
import type { PostCounts } from "@/lib/content-studio/pipeline-data"
import type { VideoColumnWithEdit } from "@/lib/content-studio/pipeline-columns"
import { formatElapsed } from "@/lib/content-studio/render-progress"
import { useRenderProgress } from "@/hooks/use-render-progress"
import { accentStyle } from "@/lib/content-studio/video-accent"
import { cn } from "@/lib/utils"

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function StatusBadge({ status }: { status: VideoUpload["status"] }) {
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-error px-1.5 py-0.5 rounded bg-error/10">
        <AlertCircle className="size-3" /> Error
      </span>
    )
  }
  if (status === "transcribing") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10">
        <Loader2 className="size-3 animate-spin" /> Transcribing
      </span>
    )
  }
  if (status === "transcribed" || status === "analyzed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success px-1.5 py-0.5 rounded bg-success/10">
        <CheckCircle className="size-3" /> Transcribed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded bg-muted/50">
      <Film className="size-3" /> Uploaded
    </span>
  )
}

interface VideoCardProps {
  video: VideoUpload
  counts: PostCounts | null
  thumbnailUrl?: string | null
  hasCut?: boolean
  /** Edit-lane column this card is grouped under. Omit for the legacy 5-column lane. */
  column?: VideoColumnWithEdit
  /** True when this video's latest render failed and it has no cut. */
  renderFailed?: boolean
  /** In-flight render start time (ISO) — anchors the "rendering" timer so it
   *  survives refresh/navigation instead of restarting at 0:00. */
  renderStartedAt?: string | null
  /** In-flight render job id — subscribed to for the live RTDB progress bar. */
  renderJobId?: string | null
}

export function VideoCard({
  video,
  counts,
  thumbnailUrl,
  hasCut = false,
  column,
  renderFailed = false,
  renderStartedAt = null,
  renderJobId = null,
}: VideoCardProps) {
  const title = video.title ?? video.original_filename
  const isFailed = video.status === "failed"

  return (
    <div
      style={accentStyle(video.id)}
      data-video-id={video.id}
      className={cn(
        "group relative block overflow-hidden rounded-lg border border-border bg-white",
        "pl-[11px] pr-3 py-3 space-y-2.5",
        "transition hover:border-primary/40 hover:shadow-[0_2px_8px_-3px_rgba(15,23,42,0.1)]",
        "focus-within:ring-2 focus-within:ring-primary/40",
        isFailed && "border-error/40",
      )}
    >
      {/* Stretched link: whole card opens detail, but sits below interactive buttons. */}
      <Link
        href={`/admin/content/${video.id}`}
        aria-label={title}
        title={title}
        className="absolute inset-0 z-0 rounded-lg"
      />
      {/* color-chip strip — same hue appears on every post from this video */}
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-[color:var(--video-accent)] z-10" />

      <div className="relative z-10 pointer-events-none space-y-2.5">
        <div className="aspect-video rounded-md overflow-hidden ring-1 ring-border/60 bg-muted/40 flex items-center justify-center">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <Film className="size-6 text-muted-foreground/60" strokeWidth={1.5} />
          )}
        </div>
        <div className="space-y-0.5">
          <p className="font-heading text-[13px] font-medium text-primary leading-snug line-clamp-2" title={title}>
            {title}
          </p>
          <p className="font-mono text-[10.5px] text-muted-foreground truncate" title={video.original_filename}>
            {video.original_filename}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground pt-0.5">
          <StatusBadge status={video.status} />
          <div className="inline-flex items-center gap-2">
            {video.needs_edit && !hasCut && column === undefined && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium text-warning px-1.5 py-0.5 rounded bg-warning/10"
                title="This video still needs editing before it can be posted"
              >
                <Scissors className="size-3" /> Needs edit
              </span>
            )}
            {hasCut && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-foreground px-1.5 py-0.5 rounded bg-accent/15"
                title="This video has a rendered captioned cut"
              >
                <Clapperboard className="size-3" /> Cut
              </span>
            )}
            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
              <Clock className="size-3" /> {formatDuration(video.duration_seconds)}
            </span>
          </div>
        </div>
        {counts && counts.total > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border/70 pt-2 text-[10.5px] font-mono tabular-nums text-muted-foreground">
            <span className="font-medium text-primary">{counts.total} posts</span>
            {counts.approved > 0 && (
              <span className="text-success">
                · ✓{counts.approved}
                <span className="sr-only"> approved</span>
              </span>
            )}
            {counts.scheduled > 0 && (
              <span className="text-accent-foreground">
                · ⏱{counts.scheduled}
                <span className="sr-only"> scheduled</span>
              </span>
            )}
            {counts.published > 0 && (
              <span className="text-primary">
                · ●{counts.published}
                <span className="sr-only"> published</span>
              </span>
            )}
            {counts.failed > 0 && (
              <span className="text-error">
                · ✗{counts.failed}
                <span className="sr-only"> failed</span>
              </span>
            )}
          </div>
        )}
      </div>

      {column !== undefined && (
        <EditControls
          videoId={video.id}
          column={column}
          status={video.status}
          renderFailed={renderFailed}
          hasCut={hasCut}
          renderStartedAt={renderStartedAt}
          renderJobId={renderJobId}
        />
      )}
    </div>
  )
}

function EditControls({
  videoId,
  column,
  status,
  renderFailed,
  hasCut,
  renderStartedAt,
  renderJobId,
}: {
  videoId: string
  column: VideoColumnWithEdit
  status: VideoUpload["status"]
  renderFailed: boolean
  hasCut: boolean
  renderStartedAt: string | null
  renderJobId: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function renderCut() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/content-studio/captioned-cut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: videoId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      toast.message("Rendering captioned cut… runs in the background (a few minutes).")
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message || "Failed to start render")
    } finally {
      setBusy(false)
    }
  }

  async function markReady() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/videos/${videoId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ needs_edit: false }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      toast.success("Marked ready")
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message || "Failed to mark ready")
    } finally {
      setBusy(false)
    }
  }

  // Uploaded: nothing has kicked off transcription yet. A direct upload doesn't
  // auto-transcribe, so surface the trigger right here on the card.
  if (column === "uploaded") {
    return (
      <div className="relative z-10 flex flex-wrap items-center gap-1.5 pt-1">
        <TranscribeButton videoId={videoId} failed={false} />
      </div>
    )
  }

  // A failed transcription lands in the "transcribing" column (status === failed);
  // offer a retry. A genuinely in-flight transcription shows no button.
  if (column === "transcribing" && status === "failed") {
    return (
      <div className="relative z-10 flex flex-wrap items-center gap-1.5 pt-1">
        <TranscribeButton videoId={videoId} failed />
      </div>
    )
  }

  if (column === "rendering") {
    return (
      <div className="relative z-10 pt-1">
        <RenderProgressBar jobId={renderJobId} startedAt={renderStartedAt} />
      </div>
    )
  }

  if (column === "edited") {
    return (
      <div className="relative z-10 pt-1 text-[10px] font-medium text-success inline-flex items-center gap-1">
        <Clapperboard className="size-3" /> {hasCut ? "Cut ready" : "Marked ready"}
      </div>
    )
  }

  if (column === "needs_edit") {
    return (
      <div className="relative z-10 flex flex-wrap items-center gap-1.5 pt-1">
        {renderFailed && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-error px-1.5 py-0.5 rounded bg-error/10">
            <AlertCircle className="size-3" /> render failed
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void renderCut()
          }}
          className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {renderFailed ? <RefreshCw className="size-3" /> : <Clapperboard className="size-3" />}
          {renderFailed ? "Retry render" : "Render cut"}
        </button>
        {!renderFailed && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void markReady()
            }}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-surface disabled:opacity-60"
          >
            Mark ready
          </button>
        )}
      </div>
    )
  }

  return null
}

function TranscribeButton({ videoId, failed }: { videoId: string; failed: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [queued, setQueued] = useState(false)

  async function transcribe(e: React.MouseEvent) {
    // The whole card is a stretched <Link>; keep the click on the button.
    e.preventDefault()
    e.stopPropagation()
    setBusy(true)
    try {
      const res = await fetch("/api/admin/videos/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId: videoId }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Transcribe failed")
      setQueued(true)
      toast.success("Transcription queued — this takes 1-5 min")
      // Pull fresh server state; the card advances to Needs Edit once the
      // transcription job finishes (a few minutes) and the page is re-fetched.
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message || "Failed to start transcription")
    } finally {
      setBusy(false)
    }
  }

  if (queued) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-2 py-1 text-[10px] font-medium text-warning">
        <Loader2 className="size-3 animate-spin" /> Transcribing…
      </span>
    )
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={transcribe}
      className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="size-3 animate-spin" />
      ) : failed ? (
        <RefreshCw className="size-3" />
      ) : (
        <Sparkles className="size-3" />
      )}
      {failed ? "Retry" : "Transcribe"}
    </button>
  )
}

function RenderProgressBar({ jobId, startedAt }: { jobId: string | null; startedAt: string | null }) {
  // Tick a clock and derive elapsed from the render's real start time, so a refresh
  // or navigate-away-and-back shows true elapsed instead of restarting at 0:00.
  // Falls back to mount time only when we don't have a start timestamp.
  const [mountTime] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const parsed = startedAt ? Date.parse(startedAt) : NaN
  const anchor = Number.isFinite(parsed) ? parsed : mountTime
  const elapsedMs = Math.max(0, now - anchor)

  // Live percent from the worker (Realtime Database). Null until the first sample
  // (or when progress isn't being published) — then we show just the timer.
  const progress = useRenderProgress(jobId)
  const label = progress ? (progress.stage === "finalizing" ? "Finalizing" : "Rendering") : "Rendering"

  return (
    <div className="space-y-1">
      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-primary">
        <Loader2 className="size-3 animate-spin" /> {label}
        {progress ? `… ${progress.pct}%` : "…"}
        <span className="font-mono tabular-nums text-muted-foreground" aria-label="Elapsed time">
          {formatElapsed(elapsedMs)}
        </span>
      </span>
      {progress && (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-primary/15"
          role="progressbar"
          aria-valuenow={progress.pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      )}
    </div>
  )
}
