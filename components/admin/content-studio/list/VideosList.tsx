import Link from "next/link"
import type { VideoUpload, VideoUploadStatus } from "@/types/database"
import { Film } from "lucide-react"
import type { PostCounts } from "@/lib/content-studio/pipeline-data"
import { VideoRowActions } from "./VideoRowActions"

interface VideosListProps {
  videos: VideoUpload[]
  postCountsByVideo?: Record<string, PostCounts>
  thumbnailUrlsByVideo?: Record<string, string>
}

const STATUS_PILL: Record<VideoUploadStatus, { label: string; className: string }> = {
  uploaded: { label: "Uploaded", className: "bg-accent/10 text-accent" },
  transcribing: { label: "Transcribing", className: "bg-warning/10 text-warning" },
  transcribed: { label: "Transcribed", className: "bg-success/10 text-success" },
  analyzed: { label: "Analyzed", className: "bg-primary/10 text-primary" },
  failed: { label: "Failed", className: "bg-error/10 text-error" },
}

function formatDuration(s: number | null) {
  if (!s) return "—"
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—"
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diffMs = Date.now() - then
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return new Date(iso).toLocaleDateString()
}

export function VideosList({ videos, postCountsByVideo, thumbnailUrlsByVideo }: VideosListProps) {
  if (videos.length === 0) {
    return (
      <div className="py-16 text-center">
        <Film className="size-8 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No videos yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Upload a video with the button above to start generating social posts.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {videos.map((v) => {
        const title = v.title ?? v.original_filename
        const counts = postCountsByVideo?.[v.id]
        const thumbUrl = thumbnailUrlsByVideo?.[v.id]
        const status = STATUS_PILL[v.status]
        return (
          <li
            key={v.id}
            className="flex items-stretch gap-3 rounded-lg border border-border bg-white overflow-hidden hover:border-primary/40 transition-colors"
          >
            <Link
              href={`/admin/content/${v.id}`}
              className="flex items-start gap-3 flex-1 min-w-0 p-3 hover:bg-surface/30"
            >
              {thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbUrl}
                  alt=""
                  loading="lazy"
                  className="size-16 shrink-0 rounded-md object-cover ring-1 ring-border bg-muted"
                />
              ) : (
                <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-border">
                  <Film className="size-6 text-primary/70" strokeWidth={1.5} />
                </span>
              )}

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="text-sm font-medium text-primary hover:underline truncate"
                    title={title}
                  >
                    {title}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full ${status.className}`}
                  >
                    {status.label}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="truncate max-w-[220px]" title={v.original_filename}>
                    {v.original_filename}
                  </span>
                  <span className="font-mono">{formatDuration(v.duration_seconds)}</span>
                  <span className="font-mono">{formatSize(v.size_bytes)}</span>
                  <span title={new Date(v.created_at).toLocaleString()}>
                    {relativeTime(v.created_at)}
                  </span>
                </div>

                {counts && counts.total > 0 ? (
                  <div className="flex flex-wrap items-center gap-1 pt-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      Posts:
                    </span>
                    {counts.needs_review > 0 ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning">
                        {counts.needs_review} draft
                      </span>
                    ) : null}
                    {counts.approved > 0 ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-success/10 text-success">
                        {counts.approved} approved
                      </span>
                    ) : null}
                    {counts.scheduled > 0 ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                        {counts.scheduled} scheduled
                      </span>
                    ) : null}
                    {counts.published > 0 ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        {counts.published} published
                      </span>
                    ) : null}
                    {counts.failed > 0 ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-error/10 text-error">
                        {counts.failed} failed
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Link>

            <div className="flex items-center pr-3 shrink-0">
              <VideoRowActions video={v} postCount={counts?.total ?? 0} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
