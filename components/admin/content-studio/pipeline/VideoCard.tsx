import Link from "next/link"
import { Film, AlertCircle, Clock, Loader2, CheckCircle } from "lucide-react"
import type { VideoUpload } from "@/types/database"
import type { PostCounts } from "@/lib/content-studio/pipeline-data"
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
  /** Signed read URL for the thumbnail, if one has been generated. */
  thumbnailUrl?: string | null
}

export function VideoCard({ video, counts, thumbnailUrl }: VideoCardProps) {
  const title = video.title ?? video.original_filename
  const isFailed = video.status === "failed"

  return (
    <Link
      href={`/admin/content/${video.id}`}
      style={accentStyle(video.id)}
      data-video-id={video.id}
      className={cn(
        "group relative block overflow-hidden rounded-lg border border-border bg-white",
        "pl-[11px] pr-3 py-3 space-y-2.5",
        "transition hover:border-primary/40 hover:shadow-[0_2px_8px_-3px_rgba(15,23,42,0.1)]",
        isFailed && "border-error/40",
      )}
    >
      {/* color-chip strip — same hue appears on every post from this video */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px] bg-[color:var(--video-accent)]"
      />
      <div className="aspect-video rounded-md overflow-hidden ring-1 ring-border/60 bg-muted/40 flex items-center justify-center">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <Film className="size-6 text-muted-foreground/60" strokeWidth={1.5} />
        )}
      </div>
      <div className="space-y-0.5">
        <p
          className="font-heading text-[13px] font-medium text-primary leading-snug line-clamp-2"
          title={title}
        >
          {title}
        </p>
        <p className="font-mono text-[10.5px] text-muted-foreground truncate" title={video.original_filename}>
          {video.original_filename}
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground pt-0.5">
        <StatusBadge status={video.status} />
        <span className="inline-flex items-center gap-1 font-mono tabular-nums">
          <Clock className="size-3" /> {formatDuration(video.duration_seconds)}
        </span>
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
    </Link>
  )
}
