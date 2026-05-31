import { Clock, HardDrive, Calendar } from "lucide-react"
import type { VideoUpload } from "@/types/database"
import { GenerateQuoteCardsButton } from "@/components/admin/content-studio/drawer/GenerateQuoteCardsButton"
import { CaptionedCutPanel } from "@/components/admin/content-studio/drawer/CaptionedCutPanel"

interface VideoDetailSidebarProps {
  video: VideoUpload
  previewUrl: string | null
  hasTranscript?: boolean
  captionedCutEnabled?: boolean
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

export function VideoDetailSidebar({
  video,
  previewUrl,
  hasTranscript = false,
  captionedCutEnabled = false,
}: VideoDetailSidebarProps) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-black">
        {previewUrl ? (
          <video src={previewUrl} controls preload="metadata" className="w-full aspect-video bg-black">
            Your browser does not support the video element.
          </video>
        ) : (
          <div className="w-full aspect-video bg-muted flex items-center justify-center text-sm text-muted-foreground">
            Preview unavailable
          </div>
        )}
      </div>

      <div>
        <p className="text-xs text-muted-foreground truncate" title={video.original_filename}>
          {video.original_filename}
        </p>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
      </div>

      <div className="flex flex-wrap gap-2">
        <GenerateQuoteCardsButton videoUploadId={video.id} hasTranscript={hasTranscript} />
      </div>

      {captionedCutEnabled && <CaptionedCutPanel videoUploadId={video.id} hasTranscript={hasTranscript} />}
    </div>
  )
}
