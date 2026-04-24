import { Clock, HardDrive, Calendar } from "lucide-react"
import type { VideoUpload } from "@/types/database"
import { GenerateQuoteCardsButton } from "./GenerateQuoteCardsButton"

interface DrawerVideoHeaderProps {
  video: VideoUpload
  previewUrl: string | null
  hasTranscript?: boolean
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—"
  const mb = bytes / 1_000_000
  if (mb < 1) return `${(bytes / 1_000).toFixed(0)} KB`
  if (mb < 1_000) return `${mb.toFixed(1)} MB`
  return `${(mb / 1_000).toFixed(2)} GB`
}

export function DrawerVideoHeader({ video, previewUrl, hasTranscript = false }: DrawerVideoHeaderProps) {
  const title = video.title ?? video.original_filename
  return (
    <div className="border-b border-border bg-surface/40">
      {previewUrl ? (
        <video src={previewUrl} controls preload="metadata" className="w-full aspect-video bg-black">
          Your browser does not support the video element.
        </video>
      ) : (
        <div className="w-full aspect-video bg-muted flex items-center justify-center text-sm text-muted-foreground">
          Preview unavailable
        </div>
      )}
      <div className="px-6 py-4">
        <h2 className="font-heading text-lg text-primary truncate" title={title}>
          {title}
        </h2>
        <p className="text-xs text-muted-foreground truncate" title={video.original_filename}>
          {video.original_filename}
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <div className="inline-flex items-center gap-1">
            <Calendar className="size-3.5" />
            <dt className="sr-only">Uploaded</dt>
            <dd>{new Date(video.created_at).toLocaleDateString()}</dd>
          </div>
          <div className="inline-flex items-center gap-1">
            <Clock className="size-3.5" />
            <dt className="sr-only">Duration</dt>
            <dd>{formatDuration(video.duration_seconds)}</dd>
          </div>
          <div className="inline-flex items-center gap-1">
            <HardDrive className="size-3.5" />
            <dt className="sr-only">Size</dt>
            <dd>{formatSize(video.size_bytes)}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <GenerateQuoteCardsButton videoUploadId={video.id} hasTranscript={hasTranscript} />
        </div>
      </div>
    </div>
  )
}
