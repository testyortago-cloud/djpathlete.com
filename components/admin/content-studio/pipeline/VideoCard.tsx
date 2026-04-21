import Link from "next/link"
import { Film, AlertCircle, Clock, Loader2, CheckCircle } from "lucide-react"
import type { VideoUpload } from "@/types/database"
import type { PostCounts } from "@/lib/content-studio/pipeline-data"
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
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded bg-muted/40">
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
      className={cn(
        "group block rounded-lg border border-border bg-white hover:border-primary/50 transition p-3 space-y-2",
        isFailed && "border-error/40",
      )}
    >
      <div className="aspect-video bg-muted/50 rounded-md overflow-hidden flex items-center justify-center">
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
      <div>
        <p className="text-sm font-medium text-primary truncate" title={title}>
          {title}
        </p>
        <p className="text-[11px] text-muted-foreground truncate" title={video.original_filename}>
          {video.original_filename}
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <StatusBadge status={video.status} />
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> {formatDuration(video.duration_seconds)}
        </span>
      </div>
      {counts && counts.total > 0 && (
        <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
          {counts.total} posts · <span className="text-success">✓{counts.approved} approved</span>
          {counts.scheduled > 0 && (
            <>
              {" · "}
              <span className="text-accent">⏱{counts.scheduled} scheduled</span>
            </>
          )}
          {counts.published > 0 && (
            <>
              {" · "}
              <span className="text-primary">●{counts.published} published</span>
            </>
          )}
          {counts.failed > 0 && (
            <>
              {" · "}
              <span className="text-error">✗{counts.failed} failed</span>
            </>
          )}
        </p>
      )}
    </Link>
  )
}
